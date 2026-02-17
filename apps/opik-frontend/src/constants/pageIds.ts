export enum PAGE_ID {
  home = "home",
  dashboards = "dashboards",
  dashboard_detail = "dashboard_detail",
  projects = "projects",
  project_traces_table = "project_traces_table",
  project_spans_table = "project_spans_table",
  project_threads_table = "project_threads_table",
  project_metrics = "project_metrics",
  project_online_evaluation = "project_online_evaluation",
  project_annotation_queues = "project_annotation_queues",
  project_dashboard = "project_dashboard",
  experiments = "experiments",
  compare_experiments = "compare_experiments",
  optimizations = "optimizations",
  optimization_new = "optimization_new",
  optimization_detail = "optimization_detail",
  compare_optimizations = "compare_optimizations",
  compare_trials = "compare_trials",
  datasets = "datasets",
  dataset_detail = "dataset_detail",
  dataset_items = "dataset_items",
  prompts = "prompts",
  prompt_detail = "prompt_detail",
  playground = "playground",
  configuration = "configuration",
  alerts = "alerts",
  alert_edit = "alert_edit",
  online_evaluation = "online_evaluation",
  annotation_queues = "annotation_queues",
  annotation_queue_detail = "annotation_queue_detail",
  automation_logs = "automation_logs",
  get_started = "get_started",
  unknown = "unknown",
}

export type PageContext = {
  pageId: PAGE_ID;
  description: string;
  params: Record<string, string>;
};

const PAGE_DESCRIPTIONS: Record<PAGE_ID, string> = {
  [PAGE_ID.home]: "Home page - overview of workspace activity and recent items",
  [PAGE_ID.dashboards]: "Dashboards list - custom visualization dashboards",
  [PAGE_ID.dashboard_detail]:
    "Dashboard detail - viewing a specific dashboard with charts and metrics",
  [PAGE_ID.projects]:
    "Projects list - all LLM application projects in the workspace",
  [PAGE_ID.project_traces_table]:
    "Project traces table - viewing the list of traces for a specific project",
  [PAGE_ID.project_spans_table]:
    "Project spans table - viewing the list of spans for a specific project",
  [PAGE_ID.project_threads_table]:
    "Project threads table - viewing conversation threads for a specific project",
  [PAGE_ID.project_metrics]:
    "Project metrics - viewing metrics and charts for a specific project",
  [PAGE_ID.project_online_evaluation]:
    "Project online evaluation - managing online evaluation rules for a specific project",
  [PAGE_ID.project_annotation_queues]:
    "Project annotation queues - managing annotation queues for a specific project",
  [PAGE_ID.project_dashboard]:
    "Project dashboard - viewing a project performance dashboard",
  [PAGE_ID.experiments]:
    "Experiments list - evaluation experiments across datasets",
  [PAGE_ID.compare_experiments]:
    "Compare experiments - side-by-side comparison of experiment results",
  [PAGE_ID.optimizations]: "Optimizations list - prompt optimization runs",
  [PAGE_ID.optimization_new]:
    "New optimization - creating a new prompt optimization",
  [PAGE_ID.optimization_detail]:
    "Optimization detail - viewing results of a specific optimization",
  [PAGE_ID.compare_optimizations]:
    "Compare optimizations - comparing multiple optimization runs",
  [PAGE_ID.compare_trials]:
    "Compare trials - comparing individual trials within an optimization",
  [PAGE_ID.datasets]: "Datasets list - all datasets in the workspace",
  [PAGE_ID.dataset_detail]: "Dataset detail - viewing a specific dataset",
  [PAGE_ID.dataset_items]:
    "Dataset items - viewing and managing items within a dataset",
  [PAGE_ID.prompts]: "Prompt library - saved and versioned prompts",
  [PAGE_ID.prompt_detail]:
    "Prompt detail - viewing a specific prompt and its versions",
  [PAGE_ID.playground]:
    "Playground - interactive environment for testing LLM prompts",
  [PAGE_ID.configuration]: "Configuration - workspace settings and API keys",
  [PAGE_ID.alerts]: "Alerts list - monitoring alerts and rules",
  [PAGE_ID.alert_edit]: "Alert editor - creating or editing an alert rule",
  [PAGE_ID.online_evaluation]:
    "Online evaluation - real-time evaluation of production traces",
  [PAGE_ID.annotation_queues]:
    "Annotation queues list - human annotation workflows",
  [PAGE_ID.annotation_queue_detail]:
    "Annotation queue detail - reviewing and annotating items in a queue",
  [PAGE_ID.automation_logs]:
    "Automation logs - logs from automated evaluation and alert runs",
  [PAGE_ID.get_started]: "Get started - onboarding and setup guide",
  [PAGE_ID.unknown]: "Unknown page",
};

function ctx(
  pageId: PAGE_ID,
  params: Record<string, string> = {},
): PageContext {
  return { pageId, description: PAGE_DESCRIPTIONS[pageId], params };
}

export function derivePageContext(
  pathname: string,
  searchParams?: URLSearchParams,
): PageContext {
  // Strip leading slash and workspace name pattern
  // Pathname format: /{workspaceName}/...
  const parts = pathname.split("/").filter((p) => p !== "");

  if (parts.length === 0) {
    return ctx(PAGE_ID.unknown);
  }

  // Skip the workspace name (first part)
  const pathWithoutWorkspace = parts.slice(1);

  if (pathWithoutWorkspace.length === 0) {
    return ctx(PAGE_ID.unknown);
  }

  const [firstSegment, secondSegment, thirdSegment, fourthSegment] =
    pathWithoutWorkspace;

  // Match routes based on segments
  switch (firstSegment) {
    case "home":
    case "home-new":
      return ctx(PAGE_ID.home);

    case "get-started":
      return ctx(PAGE_ID.get_started);

    case "automation-logs":
      return ctx(PAGE_ID.automation_logs);

    case "dashboards":
      if (secondSegment) {
        return ctx(PAGE_ID.dashboard_detail, {
          dashboardId: secondSegment,
        });
      }
      return ctx(PAGE_ID.dashboards);

    case "projects":
      if (secondSegment && thirdSegment === "traces") {
        const projectParams: Record<string, string> = {
          projectId: secondSegment,
        };

        // Extract detail panel params if present
        const traceId = searchParams?.get("trace");
        const spanId = searchParams?.get("span");
        const threadId = searchParams?.get("thread");
        if (traceId) projectParams.traceId = traceId;
        if (spanId) projectParams.spanId = spanId;
        if (threadId) projectParams.threadId = threadId;

        // view=dashboards takes precedence
        const view = searchParams?.get("view");
        if (view === "dashboards") {
          const dashboardId = searchParams?.get("dashboardId");
          if (dashboardId) projectParams.dashboardId = dashboardId;
          return ctx(PAGE_ID.project_dashboard, projectParams);
        }

        // Determine tab
        const tab = searchParams?.get("tab");
        switch (tab) {
          case "metrics":
            return ctx(PAGE_ID.project_metrics, projectParams);
          case "rules":
            return ctx(PAGE_ID.project_online_evaluation, projectParams);
          case "annotation-queues":
            return ctx(PAGE_ID.project_annotation_queues, projectParams);
          case "logs":
          default: {
            const logsType = searchParams?.get("logsType");
            if (logsType === "spans") {
              return ctx(PAGE_ID.project_spans_table, projectParams);
            }
            if (logsType === "threads") {
              return ctx(PAGE_ID.project_threads_table, projectParams);
            }
            return ctx(PAGE_ID.project_traces_table, projectParams);
          }
        }
      }
      return ctx(PAGE_ID.projects);

    case "experiments":
      if (secondSegment && thirdSegment === "compare") {
        return ctx(PAGE_ID.compare_experiments, {
          datasetId: secondSegment,
        });
      }
      return ctx(PAGE_ID.experiments);

    case "optimizations":
      if (secondSegment === "new") {
        return ctx(PAGE_ID.optimization_new);
      }
      if (secondSegment && thirdSegment === "compare") {
        return ctx(PAGE_ID.compare_optimizations, {
          datasetId: secondSegment,
        });
      }
      if (secondSegment && thirdSegment) {
        if (fourthSegment === "compare") {
          return ctx(PAGE_ID.compare_trials, {
            datasetId: secondSegment,
            optimizationId: thirdSegment,
          });
        }
        return ctx(PAGE_ID.optimization_detail, {
          datasetId: secondSegment,
          optimizationId: thirdSegment,
        });
      }
      return ctx(PAGE_ID.optimizations);

    case "datasets":
      if (secondSegment) {
        if (thirdSegment === "items") {
          return ctx(PAGE_ID.dataset_items, {
            datasetId: secondSegment,
          });
        }
        return ctx(PAGE_ID.dataset_detail, {
          datasetId: secondSegment,
        });
      }
      return ctx(PAGE_ID.datasets);

    case "prompts":
      if (secondSegment) {
        return ctx(PAGE_ID.prompt_detail, { promptId: secondSegment });
      }
      return ctx(PAGE_ID.prompts);

    case "playground":
      return ctx(PAGE_ID.playground);

    case "configuration":
      return ctx(PAGE_ID.configuration);

    case "alerts":
      if (secondSegment) {
        return ctx(PAGE_ID.alert_edit, { alertId: secondSegment });
      }
      return ctx(PAGE_ID.alerts);

    case "online-evaluation":
      return ctx(PAGE_ID.online_evaluation);

    case "annotation-queues":
      if (secondSegment) {
        return ctx(PAGE_ID.annotation_queue_detail, {
          annotationQueueId: secondSegment,
        });
      }
      return ctx(PAGE_ID.annotation_queues);

    default:
      return ctx(PAGE_ID.unknown);
  }
}
