import React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadarDataPoint } from "@/types/chart";
import useChartConfig from "@/hooks/useChartConfig";
import { ExperimentLabelsMap } from "@/components/pages/CompareExperimentsPage/CompareExperimentsDetails/useCompareExperimentsChartsData";
import RadarChart from "@/components/shared/Charts/RadarChart/RadarChart";
import { renderScoreTooltipValue } from "@/lib/feedback-scores";
import { ValueType } from "recharts/types/component/DefaultTooltipContent";

interface ExperimentsRadarChartProps {
  name: string;
  chartId: string;
  data: RadarDataPoint[];
  keys: string[];
  experimentLabelsMap: ExperimentLabelsMap;
  renderTooltipValue?: (data: { value: ValueType }) => ValueType;
}

const ExperimentsRadarChart: React.FunctionComponent<
  ExperimentsRadarChartProps
> = ({
  name,
  chartId,
  data,
  keys,
  experimentLabelsMap,
  renderTooltipValue,
}) => {
  const config = useChartConfig(keys, experimentLabelsMap);

  return (
    <Card>
      <CardHeader className="space-y-0.5 px-5 py-4">
        <CardTitle className="comet-body-s-accented">{name}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-3">
        <RadarChart
          chartId={chartId}
          config={config}
          data={data}
          angleAxisKey="name"
          showLegend
          renderTooltipValue={renderTooltipValue ?? renderScoreTooltipValue}
        />
      </CardContent>
    </Card>
  );
};

export default ExperimentsRadarChart;
