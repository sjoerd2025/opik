import React, { useCallback, useEffect, useMemo } from "react";
import sortBy from "lodash/sortBy";
import isNumber from "lodash/isNumber";
import { BooleanParam, useQueryParam } from "use-query-params";
import { CircleCheck, Maximize2, Minimize2 } from "lucide-react";

import useBreadcrumbsStore from "@/store/BreadcrumbsStore";
import { Experiment } from "@/types/datasets";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import TooltipWrapper from "@/components/shared/TooltipWrapper/TooltipWrapper";
import DateTag from "@/components/shared/DateTag/DateTag";
import useCompareExperimentsChartsData from "@/components/pages/CompareExperimentsPage/CompareExperimentsDetails/useCompareExperimentsChartsData";
import useCompareAssertionsChartsData from "@/components/pages/CompareExperimentsPage/CompareExperimentsDetails/useCompareAssertionsChartsData";
import ExperimentsRadarChart from "@/components/pages-shared/experiments/ExperimentsRadarChart/ExperimentsRadarChart";
import ExperimentsBarChart from "@/components/pages-shared/experiments/ExperimentsBarChart/ExperimentsBarChart";
import NavigationTag from "@/components/shared/NavigationTag";
import ExperimentTag from "@/components/shared/ExperimentTag/ExperimentTag";
import FeedbackScoresList from "@/components/pages-shared/FeedbackScoresList/FeedbackScoresList";
import { formatPassRate } from "@/components/shared/DataTableCells/PassRateCell";
import { RESOURCE_TYPE } from "@/components/shared/ResourceLink/ResourceLink";
import {
  FeedbackScoreDisplay,
  SCORE_TYPE_FEEDBACK,
  SCORE_TYPE_EXPERIMENT,
} from "@/types/shared";
import { getScoreDisplayName } from "@/lib/feedback-scores";
import { generateExperimentIdFilter } from "@/lib/filters";
import { isEvalSuiteExperiment } from "@/lib/experiments";
import ViewSelector from "@/components/pages-shared/dashboards/ViewSelector/ViewSelector";
import { VIEW_TYPE } from "@/types/dashboard";
import { Separator } from "@/components/ui/separator";
import ExperimentTagsList from "@/components/pages/CompareExperimentsPage/ExperimentTagsList";
import { ValueType } from "recharts/types/component/DefaultTooltipContent";

type CompareExperimentsDetailsProps = {
  experimentsIds: string[];
  experiments: Experiment[];
  isPending: boolean;
  view: VIEW_TYPE;
  onViewChange: (value: VIEW_TYPE) => void;
};

const CompareExperimentsDetails: React.FunctionComponent<
  CompareExperimentsDetailsProps
> = ({ experiments, experimentsIds, isPending, view, onViewChange }) => {
  const setBreadcrumbParam = useBreadcrumbsStore((state) => state.setParam);

  const isCompare = experimentsIds.length > 1;

  const experiment = experiments[0];

  const title = !isCompare
    ? experiment?.name
    : `Compare (${experimentsIds.length})`;

  const [showCharts = true, setShowCharts] = useQueryParam(
    "chartsExpanded",
    BooleanParam,
    {
      updateType: "replaceIn",
    },
  );

  useEffect(() => {
    title && setBreadcrumbParam("compare", "compare", title);
    return () => setBreadcrumbParam("compare", "compare", "");
  }, [title, setBreadcrumbParam]);

  const {
    radarChartData,
    radarChartKeys,
    barChartData,
    barChartKeys,
    experimentLabelsMap,
    scoreLabelsMap,
  } = useCompareExperimentsChartsData({
    isCompare,
    experiments,
  });

  const assertionsCharts = useCompareAssertionsChartsData({
    isCompare,
    experiments,
  });

  const renderPassRateTooltipValue = useCallback(
    ({ value }: { value: ValueType }) => `${Number(value).toFixed(1)}%`,
    [],
  );

  const allEvalSuite = experiments.every(isEvalSuiteExperiment);

  const experimentTracesSearch = useMemo(
    () => ({
      traces_filters: generateExperimentIdFilter(experimentsIds[0]),
    }),
    [experimentsIds],
  );

  const renderCompareFeedbackScoresButton = () => {
    if (!isCompare) return null;

    const text = showCharts ? "Collapse charts" : "Expand charts";
    const Icon = showCharts ? Minimize2 : Maximize2;

    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setShowCharts(!showCharts);
        }}
      >
        <Icon className="mr-2 size-4 shrink-0" />
        {text}
      </Button>
    );
  };

  const experimentScores: FeedbackScoreDisplay[] = useMemo(() => {
    if (isCompare || !experiment) return [];
    return sortBy(
      [
        ...(experiment.feedback_scores ?? []).map((score) => ({
          ...score,
          colorKey: score.name,
          name: getScoreDisplayName(score.name, SCORE_TYPE_FEEDBACK),
        })),
        ...(experiment.experiment_scores ?? []).map((score) => ({
          ...score,
          colorKey: score.name,
          name: getScoreDisplayName(score.name, SCORE_TYPE_EXPERIMENT),
        })),
      ],
      "name",
    );
  }, [isCompare, experiment]);

  const renderSubSection = () => {
    if (isCompare) {
      const tag =
        experimentsIds.length === 2 ? (
          <ExperimentTag experimentName={experiments[1]?.name} />
        ) : (
          <ExperimentTag count={experimentsIds.length - 1} />
        );

      return (
        <div className="flex h-11 items-center gap-2">
          <span className="text-nowrap">Baseline of</span>
          <ExperimentTag experimentName={experiment?.name} />
          <span className="text-nowrap">compared against</span>
          {tag}
        </div>
      );
    }

    return <FeedbackScoresList scores={experimentScores} />;
  };

  const renderCharts = () => {
    if (!isCompare || !showCharts || isPending || view === VIEW_TYPE.DASHBOARDS)
      return null;

    if (allEvalSuite && !assertionsCharts.barChartKeys.length) return null;

    const charts = allEvalSuite
      ? {
          radarName: "Assertion pass rates",
          radarChartId: "assertion-pass-rates-radar-chart",
          radarData: assertionsCharts.radarChartData,
          radarKeys: assertionsCharts.radarChartKeys,
          radarLabelsMap: assertionsCharts.experimentLabelsMap,
          radarTooltipValue: renderPassRateTooltipValue,
          barName: "Assertion pass rates",
          barChartId: "assertion-pass-rates-bar-chart",
          barData: assertionsCharts.barChartData,
          barKeys: assertionsCharts.barChartKeys,
          barLabelsMap: undefined,
          barTooltipValue: renderPassRateTooltipValue,
        }
      : {
          radarName: "Feedback scores",
          radarChartId: "feedback-scores-radar-chart",
          radarData: radarChartData,
          radarKeys: radarChartKeys,
          radarLabelsMap: experimentLabelsMap,
          radarTooltipValue: undefined,
          barName: "Feedback scores distribution",
          barChartId: "feedback-scores-bar-chart",
          barData: barChartData,
          barKeys: barChartKeys,
          barLabelsMap: scoreLabelsMap,
          barTooltipValue: undefined,
        };

    return (
      <div className="mb-2 mt-4 overflow-auto">
        {experiments.length ? (
          <div
            className="flex flex-row gap-4"
            style={{ "--chart-height": "240px" } as React.CSSProperties}
          >
            {charts.radarData.length > 1 && (
              <div className="w-1/3 min-w-[400px]">
                <ExperimentsRadarChart
                  name={charts.radarName}
                  chartId={charts.radarChartId}
                  data={charts.radarData}
                  keys={charts.radarKeys}
                  experimentLabelsMap={charts.radarLabelsMap}
                  renderTooltipValue={charts.radarTooltipValue}
                />
              </div>
            )}
            <div className="min-w-[400px] flex-1">
              <ExperimentsBarChart
                name={charts.barName}
                chartId={charts.barChartId}
                data={charts.barData}
                keys={charts.barKeys}
                labelsMap={charts.barLabelsMap}
                renderTooltipValue={charts.barTooltipValue}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-28 items-center justify-center text-muted-slate">
            No chart data for selected experiments
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pb-4 pt-6">
      <div className="mb-4 flex min-h-8 items-center justify-between">
        <h1 className="comet-title-l truncate break-words">{title}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {isCompare &&
            view !== VIEW_TYPE.DASHBOARDS &&
            renderCompareFeedbackScoresButton()}
          {isCompare && view !== VIEW_TYPE.DASHBOARDS && (
            <Separator orientation="vertical" className="mx-2 h-6" />
          )}
          {!allEvalSuite && (
            <ViewSelector value={view} onChange={onViewChange} />
          )}
        </div>
      </div>
      <div className="mb-1 flex gap-2 overflow-x-auto">
        {!isCompare && (
          <DateTag
            date={experiment?.created_at}
            resource={RESOURCE_TYPE.experiment}
          />
        )}
        <NavigationTag
          id={experiment?.dataset_id}
          name={experiment?.dataset_name && `Go to ${experiment.dataset_name}`}
          resource={RESOURCE_TYPE.dataset}
        />
        {experiment?.prompt_versions &&
          experiment.prompt_versions.length > 0 && (
            <NavigationTag
              id={experiment.prompt_versions[0].prompt_id}
              name={`Go to ${experiment.prompt_versions[0].prompt_name}`}
              resource={RESOURCE_TYPE.prompt}
            />
          )}
        {!isCompare && experiment?.project_id && (
          <NavigationTag
            resource={RESOURCE_TYPE.traces}
            id={experiment.project_id}
            name="Go to traces"
            search={experimentTracesSearch}
            tooltipContent="View all traces for this experiment"
          />
        )}
        {!isCompare &&
          isEvalSuiteExperiment(experiment) &&
          isNumber(experiment.pass_rate) && (
            <TooltipWrapper
              content={formatPassRate(
                experiment.pass_rate,
                experiment.passed_count,
                experiment.total_count,
              )}
            >
              <Tag
                size="md"
                variant="transparent"
                className="flex shrink-0 items-center gap-1"
              >
                <CircleCheck
                  className={`size-3 shrink-0 ${
                    experiment.pass_rate === 1
                      ? "text-[var(--color-green)]"
                      : "text-[var(--color-red)]"
                  }`}
                />
                <div className="comet-body-s-accented truncate text-muted-slate">
                  {Math.round(experiment.pass_rate * 100)}% pass rate
                </div>
              </Tag>
            </TooltipWrapper>
          )}
      </div>
      {!isCompare && experiment && (
        <ExperimentTagsList
          tags={experiment?.tags ?? []}
          experimentId={experiment.id}
          experiment={experiment}
        />
      )}
      {renderSubSection()}
      {renderCharts()}
    </div>
  );
};

export default CompareExperimentsDetails;
