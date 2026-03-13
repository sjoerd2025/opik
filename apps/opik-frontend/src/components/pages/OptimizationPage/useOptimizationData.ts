import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { keepPreviousData } from "@tanstack/react-query";
import { ColumnSort } from "@tanstack/react-table";
import useLocalStorageState from "use-local-storage-state";
import { StringParam, useQueryParam } from "use-query-params";

import {
  AggregatedFeedbackScore,
  COLUMN_ID_ID,
  COLUMN_NAME_ID,
  ROW_HEIGHT,
} from "@/types/shared";
import { Experiment, EXPERIMENT_TYPE } from "@/types/datasets";
import {
  OPTIMIZATION_ACTIVE_REFETCH_INTERVAL,
  IN_PROGRESS_OPTIMIZATION_STATUSES,
  checkIsEvaluationSuite,
} from "@/lib/optimizations";
import useAppStore from "@/store/AppStore";

import useOptimizationById from "@/api/optimizations/useOptimizationById";
import useExperimentsList from "@/api/datasets/useExperimentsList";
import { useOptimizationScores } from "@/components/pages-shared/experiments/useOptimizationScores";
import {
  AggregatedCandidate,
  ExperimentOptimizationMetadata,
} from "@/types/optimizations";
import { aggregateExperimentMetrics } from "@/lib/experiment-metrics";

const MAX_EXPERIMENTS_LOADED = 1000;

const SELECTED_COLUMNS_KEY = "optimization-experiments-selected-columns-v3";
const COLUMNS_WIDTH_KEY = "optimization-experiments-columns-width";
const COLUMNS_ORDER_KEY = "optimization-experiments-columns-order";
const COLUMNS_SORT_KEY = "optimization-experiments-columns-sort-v2";
const ROW_HEIGHT_KEY = "optimization-experiments-row-height";

const DEFAULT_SELECTED_COLUMNS: string[] = [
  COLUMN_NAME_ID,
  "step",
  "objective_name",
  "runtime_cost",
  "latency",
  "trace_count",
  "trial_status",
  "created_at",
];

const DEFAULT_COLUMNS_ORDER: string[] = [
  COLUMN_NAME_ID,
  "step",
  COLUMN_ID_ID,
  "objective_name",
  "runtime_cost",
  "latency",
  "trace_count",
  "trial_status",
  "created_at",
];

const DEFAULT_SORTING: ColumnSort[] = [{ id: COLUMN_NAME_ID, desc: false }];

export const CANDIDATE_SORT_FIELD_MAP: Record<
  string,
  keyof AggregatedCandidate | undefined
> = {
  [COLUMN_NAME_ID]: "trialNumber",
  step: "stepIndex",
  [COLUMN_ID_ID]: "id",
  objective_name: "score",
  runtime_cost: "runtimeCost",
  latency: "latencyP50",
  trace_count: "totalDatasetItemCount",
  created_at: "created_at",
};

export const sortCandidates = (
  candidates: AggregatedCandidate[],
  sortedColumns: ColumnSort[],
): AggregatedCandidate[] => {
  if (!sortedColumns.length) return candidates;

  const { id: columnId, desc } = sortedColumns[0];
  const field = CANDIDATE_SORT_FIELD_MAP[columnId];
  if (!field) return candidates;

  return [...candidates].sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    let cmp: number;
    if (typeof aVal === "number" && typeof bVal === "number") {
      cmp = aVal - bVal;
    } else {
      cmp = String(aVal).localeCompare(String(bVal));
    }

    return desc ? -cmp : cmp;
  });
};

const getOptimizationMetadata = (
  metadata: object | undefined,
  experimentId: string,
): ExperimentOptimizationMetadata => {
  if (metadata) {
    const m = metadata as Record<string, unknown>;
    if (typeof m.step_index === "number") {
      return {
        step_index: m.step_index,
        candidate_id: (m.candidate_id as string) ?? "",
        parent_candidate_ids: (m.parent_candidate_ids as string[]) ?? [],
        configuration: m.configuration as
          | ExperimentOptimizationMetadata["configuration"]
          | undefined,
      };
    }
    // Old-style optimizer with metadata but no step_index
    return {
      step_index: -1,
      candidate_id: experimentId,
      parent_candidate_ids: [],
      configuration: m.configuration as
        | ExperimentOptimizationMetadata["configuration"]
        | undefined,
    };
  }
  // No metadata at all: treat each experiment as its own candidate
  return {
    step_index: -1,
    candidate_id: experimentId,
    parent_candidate_ids: [],
  };
};

const aggregateCandidates = (
  experiments: Experiment[],
  objectiveName: string | undefined,
): AggregatedCandidate[] => {
  const groups = new Map<
    string,
    {
      experiments: Experiment[];
      meta: ExperimentOptimizationMetadata;
    }
  >();

  for (const exp of experiments) {
    const meta = getOptimizationMetadata(exp.metadata, exp.id);
    const key = meta.candidate_id;
    const existing = groups.get(key);
    if (existing) {
      existing.experiments.push(exp);
      // Keep the metadata with the lowest step_index — that's when the
      // candidate was first created, not a later re-evaluation step.
      if (meta.step_index >= 0 && meta.step_index < existing.meta.step_index) {
        existing.meta = meta;
      }
    } else {
      groups.set(key, { experiments: [exp], meta });
    }
  }

  const candidates: AggregatedCandidate[] = [];

  for (const [candidateId, group] of groups) {
    const exps = group.experiments.sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    const meta = group.meta;

    const metrics = aggregateExperimentMetrics(exps, objectiveName);

    candidates.push({
      id: candidateId,
      candidateId,
      stepIndex: meta.step_index,
      parentCandidateIds: meta.parent_candidate_ids,
      trialNumber: 0, // assigned below
      score: metrics.score,
      runtimeCost: metrics.cost,
      latencyP50: metrics.latency,
      totalTraceCount: metrics.totalTraceCount,
      totalDatasetItemCount: metrics.totalDatasetItemCount,
      passedCount: metrics.passedCount,
      totalCount: metrics.totalCount,
      experimentIds: exps.map((e) => e.id),
      name: exps[0].name,
      created_at: exps[0].created_at,
    });
  }

  // Sort by creation time and assign trial numbers
  candidates.sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Assign incremental step indices for old-style experiments
  candidates.forEach((c, i) => {
    if (c.stepIndex === -1) {
      c.stepIndex = i;
      if (i > 0) {
        c.parentCandidateIds = [candidates[i - 1].candidateId];
      }
    }
  });

  candidates.forEach((c, i) => {
    c.trialNumber = i + 1;
  });

  return candidates;
};

const mergeExperimentScores = (
  feedbackScores: AggregatedFeedbackScore[] | undefined,
  experimentScores: AggregatedFeedbackScore[] | undefined,
): AggregatedFeedbackScore[] => {
  if (!experimentScores?.length) return [];
  const existingNames = new Set(feedbackScores?.map((s) => s.name));
  return experimentScores.filter((s) => !existingNames.has(s.name));
};

export const useOptimizationData = () => {
  const navigate = useNavigate();
  const workspaceName = useAppStore((state) => state.activeWorkspaceName);

  const { optimizationId } = useParams({
    select: (params) => params,
    from: "/workspaceGuard/$workspaceName/optimizations/$optimizationId",
  });

  const [search = "", setSearch] = useQueryParam("search", StringParam, {
    updateType: "replaceIn",
  });

  const [sortedColumns, setSortedColumns] = useLocalStorageState<ColumnSort[]>(
    COLUMNS_SORT_KEY,
    {
      defaultValue: DEFAULT_SORTING,
    },
  );

  const [selectedColumns, setSelectedColumns] = useLocalStorageState<string[]>(
    SELECTED_COLUMNS_KEY,
    {
      defaultValue: DEFAULT_SELECTED_COLUMNS,
    },
  );

  const [columnsOrder, setColumnsOrder] = useLocalStorageState<string[]>(
    COLUMNS_ORDER_KEY,
    {
      defaultValue: DEFAULT_COLUMNS_ORDER,
    },
  );

  const [columnsWidth, setColumnsWidth] = useLocalStorageState<
    Record<string, number>
  >(COLUMNS_WIDTH_KEY, {
    defaultValue: {},
  });

  const [height, setHeight] = useLocalStorageState<ROW_HEIGHT>(ROW_HEIGHT_KEY, {
    defaultValue: ROW_HEIGHT.small,
  });

  const {
    data: optimization,
    isPending: isOptimizationPending,
    refetch: refetchOptimization,
  } = useOptimizationById(
    { optimizationId },
    {
      placeholderData: keepPreviousData,
      enabled: !!optimizationId,
      refetchInterval: OPTIMIZATION_ACTIVE_REFETCH_INTERVAL,
    },
  );

  const {
    data,
    isPending: isExperimentsPending,
    isPlaceholderData: isExperimentsPlaceholderData,
    isFetching: isExperimentsFetching,
    refetch: refetchExperiments,
  } = useExperimentsList(
    {
      workspaceName,
      optimizationId: optimizationId,
      sorting: [{ id: "created_at", desc: false }],
      forceSorting: true,
      types: [EXPERIMENT_TYPE.TRIAL],
      page: 1,
      size: MAX_EXPERIMENTS_LOADED,
    },
    {
      placeholderData: keepPreviousData,
      refetchInterval: OPTIMIZATION_ACTIVE_REFETCH_INTERVAL,
    },
  );

  const isInProgress =
    !!optimization?.status &&
    IN_PROGRESS_OPTIMIZATION_STATUSES.includes(optimization.status);

  // Fetch the latest experiment (any type) to detect reflection phase.
  // If it's a mini-batch, the optimizer is reflecting on failing examples.
  const { data: latestExperimentData } = useExperimentsList(
    {
      workspaceName,
      optimizationId: optimizationId,
      types: [
        EXPERIMENT_TYPE.TRIAL,
        EXPERIMENT_TYPE.MINI_BATCH,
        EXPERIMENT_TYPE.MUTATION,
      ],
      sorting: [{ id: "created_at", desc: true }],
      forceSorting: true,
      page: 1,
      size: 1,
      queryKey: "experiments-latest",
    },
    {
      enabled: !!optimizationId && isInProgress,
      refetchInterval: OPTIMIZATION_ACTIVE_REFETCH_INTERVAL,
    },
  );

  const sortableBy: string[] = useMemo(
    () => Object.keys(CANDIDATE_SORT_FIELD_MAP),
    [],
  );

  const title = optimization?.name || optimizationId;
  const noData = !search;
  const noDataText = noData ? "There are no trials yet" : "No search results";

  const isEvaluationSuite = useMemo(
    () => checkIsEvaluationSuite(data?.content ?? []),
    [data?.content],
  );

  const experiments = useMemo(() => {
    const content = data?.content ?? [];
    const objectiveName = optimization?.objective_name;

    return content.map((experiment) => {
      const additional = mergeExperimentScores(
        experiment.feedback_scores,
        experiment.experiment_scores,
      );

      let feedbackScores = additional.length
        ? [...(experiment.feedback_scores ?? []), ...additional]
        : experiment.feedback_scores;

      if (isEvaluationSuite && objectiveName && feedbackScores) {
        feedbackScores = feedbackScores.filter((s) => s.name === objectiveName);
      }

      if (!additional.length && !isEvaluationSuite) return experiment;
      return {
        ...experiment,
        feedback_scores: feedbackScores,
      };
    });
  }, [data?.content, isEvaluationSuite, optimization?.objective_name]);

  const candidates = useMemo(
    () => aggregateCandidates(experiments, optimization?.objective_name),
    [experiments, optimization?.objective_name],
  );

  // Derive in-progress candidate info from candidates with no score yet.
  // A candidate with score == null and parentCandidateIds means the optimizer
  // created trial experiments but scoring isn't done yet.
  const inProgressInfo = useMemo(() => {
    if (!isInProgress) return undefined;

    const unscoredCandidate = candidates.find(
      (c) => c.score == null && c.parentCandidateIds.length > 0,
    );
    if (unscoredCandidate) {
      return {
        candidateId: unscoredCandidate.candidateId,
        stepIndex: unscoredCandidate.stepIndex,
        parentCandidateIds: unscoredCandidate.parentCandidateIds,
      };
    }

    return undefined;
  }, [isInProgress, candidates]);

  // Detect reflection phase: the latest experiment is a mini-batch.
  const isRunningMiniBatches = useMemo(() => {
    if (!isInProgress) return false;

    const latest = latestExperimentData?.content?.[0];
    return latest?.type === EXPERIMENT_TYPE.MINI_BATCH;
  }, [isInProgress, latestExperimentData?.content]);

  const rows = useMemo(() => {
    const filtered = candidates.filter(({ name }) =>
      name.toLowerCase().includes(search!.toLowerCase()),
    );
    return sortCandidates(filtered, sortedColumns);
  }, [candidates, search, sortedColumns]);

  const { scoreMap, baseScore, bestExperiment } = useOptimizationScores(
    experiments,
    optimization?.objective_name,
  );

  const baselineCandidate = useMemo(
    () => candidates.find((c) => c.stepIndex === 0),
    [candidates],
  );

  const bestCandidate = useMemo(() => {
    if (!candidates.length) return undefined;

    return candidates.reduce<AggregatedCandidate | undefined>((best, c) => {
      if (c.score == null) return best;
      if (!best || best.score == null || c.score > best.score) return c;
      return best;
    }, undefined);
  }, [candidates]);

  const baselineExperiment = useMemo(() => {
    if (!experiments.length) return undefined;
    const sortedRows = experiments
      .slice()
      .sort((e1, e2) => e1.created_at.localeCompare(e2.created_at));
    return sortedRows[0];
  }, [experiments]);

  const handleRowClick = useCallback(
    (row: AggregatedCandidate) => {
      navigate({
        to: "/$workspaceName/optimizations/$optimizationId/trials",
        params: {
          optimizationId,
          workspaceName,
        },
        search: {
          trials: row.experimentIds,
          trialNumber: row.trialNumber,
        },
      });
    },
    [navigate, workspaceName, optimizationId],
  );

  const handleRefresh = useCallback(() => {
    refetchOptimization();
    refetchExperiments();
  }, [refetchOptimization, refetchExperiments]);

  return {
    // State
    workspaceName,
    optimizationId,
    optimization,
    experiments,
    candidates,
    isEvaluationSuite,
    rows,
    title,
    noDataText,
    scoreMap,
    baseScore,
    bestExperiment,
    bestCandidate,
    baselineCandidate,
    baselineExperiment,
    inProgressInfo,
    isRunningMiniBatches,
    sortableBy,
    // Loading states
    isOptimizationPending,
    isExperimentsPending,
    isExperimentsPlaceholderData,
    isExperimentsFetching,
    // Search
    search,
    setSearch,
    // Column state
    sortedColumns,
    setSortedColumns,
    selectedColumns,
    setSelectedColumns,
    columnsOrder,
    setColumnsOrder,
    columnsWidth,
    setColumnsWidth,
    // Row height
    height,
    setHeight,
    // Handlers
    handleRowClick,
    handleRefresh,
  };
};
