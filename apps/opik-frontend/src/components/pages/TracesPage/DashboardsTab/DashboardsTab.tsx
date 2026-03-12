import React, { useCallback, useEffect } from "react";
import { StringParam } from "use-query-params";

import Loader from "@/components/shared/Loader/Loader";
import {
  useMetricDateRangeWithQueryAndStorage,
  MetricDateRangeSelect,
} from "@/components/pages-shared/traces/MetricDateRangeSelect";
import DashboardSaveActions from "@/components/pages-shared/dashboards/DashboardSaveActions/DashboardSaveActions";
import DashboardContent from "@/components/pages-shared/dashboards/DashboardContent/DashboardContent";
import DashboardSelectBox from "@/components/pages-shared/dashboards/DashboardSelectBox/DashboardSelectBox";
import ShareDashboardButton from "@/components/pages-shared/dashboards/ShareDashboardButton/ShareDashboardButton";
import useQueryParamAndLocalStorageState from "@/hooks/useQueryParamAndLocalStorageState";
import { DASHBOARD_SCOPE, DASHBOARD_TYPE } from "@/types/dashboard";
import { useDashboardLifecycle } from "@/components/pages-shared/dashboards/hooks/useDashboardLifecycle";
import {
  useDashboardStore,
  selectSetRuntimeConfig,
  selectHasUnsavedChanges,
} from "@/store/DashboardStore";
import PageBodyStickyContainer from "@/components/layout/PageBodyStickyContainer/PageBodyStickyContainer";
import {
  PROJECT_TEMPLATE_LIST,
  DEPRECATED_PROJECT_METRICS_ID,
  DEPRECATED_PROJECT_PERFORMANCE_ID,
} from "@/lib/dashboard/templates";
import { Separator } from "@/components/ui/separator";
import TooltipWrapper from "@/components/shared/TooltipWrapper/TooltipWrapper";
import { useActiveWorkspaceName } from "@/store/AppStore";

const DASHBOARD_QUERY_PARAM_KEY = "dashboardId";
const DASHBOARD_LOCAL_STORAGE_KEY_PREFIX = "opik-project-dashboard";

interface DashboardsTabProps {
  projectId: string;
}

const DashboardsTab: React.FunctionComponent<DashboardsTabProps> = ({
  projectId,
}) => {
  const workspaceName = useActiveWorkspaceName();

  const [dashboardId, setDashboardId] = useQueryParamAndLocalStorageState({
    localStorageKey: `${DASHBOARD_LOCAL_STORAGE_KEY_PREFIX}-${workspaceName}`,
    queryKey: DASHBOARD_QUERY_PARAM_KEY,
    defaultValue: null as string | null,
    queryParamConfig: StringParam,
    syncQueryWithLocalStorageOnInit: true,
    syncLocalStorageAcrossTabs: false,
  });

  useEffect(() => {
    if (!dashboardId) {
      setDashboardId(PROJECT_TEMPLATE_LIST[0].id);
      return;
    }
    if (
      dashboardId === DEPRECATED_PROJECT_METRICS_ID ||
      dashboardId === DEPRECATED_PROJECT_PERFORMANCE_ID
    ) {
      setDashboardId(PROJECT_TEMPLATE_LIST[0].id);
    }
  }, [dashboardId, setDashboardId]);

  const { dashboard, isPending, save, discard, isTemplate } =
    useDashboardLifecycle({
      dashboardId: dashboardId || null,
      enabled: Boolean(dashboardId),
    });

  const hasUnsavedChanges = useDashboardStore(selectHasUnsavedChanges);
  const setRuntimeConfig = useDashboardStore(selectSetRuntimeConfig);

  const { dateRange, handleDateRangeChange, minDate, maxDate, dateRangeValue } =
    useMetricDateRangeWithQueryAndStorage({
      key: "dashboard_time_range",
      localStorageKey: "opik-project-insights-daterange",
    });

  useEffect(() => {
    setRuntimeConfig({
      projectIds: [projectId],
      dateRange: dateRangeValue,
      dashboardType: dashboard?.type,
    });

    return () => {
      setRuntimeConfig({});
    };
  }, [projectId, dateRangeValue, dashboard?.type, setRuntimeConfig]);

  const handleDashboardCreated = useCallback(
    (newDashboardId: string) => {
      setDashboardId(newDashboardId);
    },
    [setDashboardId],
  );

  const handleDashboardDeleted = useCallback(
    (deletedDashboardId: string) => {
      if (dashboardId === deletedDashboardId) {
        setDashboardId(PROJECT_TEMPLATE_LIST[0]?.id || null);
      }
    },
    [dashboardId, setDashboardId],
  );

  const dashboardSelectBox = (
    <DashboardSelectBox
      value={dashboardId || null}
      onChange={setDashboardId}
      buttonClassName="w-[300px]"
      onDashboardCreated={handleDashboardCreated}
      onDashboardDeleted={handleDashboardDeleted}
      disabled={hasUnsavedChanges}
      templates={PROJECT_TEMPLATE_LIST}
      dashboardType={DASHBOARD_TYPE.MULTI_PROJECT}
      dashboardScope={DASHBOARD_SCOPE.INSIGHTS}
    />
  );

  return (
    <>
      <PageBodyStickyContainer
        className="flex items-center justify-between gap-4 pb-3 pt-2"
        direction="bidirectional"
        limitWidth
      >
        {hasUnsavedChanges ? (
          <TooltipWrapper content="Save or discard your changes before switching">
            <div>{dashboardSelectBox}</div>
          </TooltipWrapper>
        ) : (
          dashboardSelectBox
        )}

        <div className="flex shrink-0 items-center gap-2">
          {dashboard && (
            <DashboardSaveActions
              onSave={save}
              onDiscard={discard}
              dashboard={dashboard}
              isTemplate={isTemplate}
              navigateOnCreate={false}
              onDashboardCreated={handleDashboardCreated}
            />
          )}
          <MetricDateRangeSelect
            value={dateRange}
            onChangeValue={handleDateRangeChange}
            minDate={minDate}
            maxDate={maxDate}
            hideAlltime
          />
          <Separator orientation="vertical" className="mx-2 h-4" />
          <ShareDashboardButton />
        </div>
      </PageBodyStickyContainer>

      <div className="px-6 pb-4 pt-1">
        {isPending && <Loader />}

        {!isPending && !dashboardId && (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">
              No dashboard selected. Please select or create a dashboard.
            </p>
          </div>
        )}

        {!isPending && dashboardId && !dashboard && (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">
              Dashboard could not be loaded. Please select another dashboard
              from the dropdown.
            </p>
          </div>
        )}

        {!isPending && dashboard && <DashboardContent />}
      </div>
    </>
  );
};

export default DashboardsTab;
