import { useMemo } from "react";
import { Experiment } from "@/types/datasets";
import uniq from "lodash/uniq";
import { BarDataPoint, RadarDataPoint } from "@/types/chart";
import { ExperimentLabelsMap } from "@/components/pages/CompareExperimentsPage/CompareExperimentsDetails/useCompareExperimentsChartsData";

type UseCompareAssertionsChartsDataArgs = {
  isCompare: boolean;
  experiments: Experiment[];
};

type CompareAssertionsChartsData = {
  radarChartData: RadarDataPoint[];
  radarChartKeys: string[];
  barChartData: BarDataPoint[];
  barChartKeys: string[];
  experimentLabelsMap: ExperimentLabelsMap;
};

const MAX_VISIBLE_ENTITIES = 10;

const useCompareAssertionsChartsData = ({
  isCompare,
  experiments,
}: UseCompareAssertionsChartsDataArgs): CompareAssertionsChartsData => {
  const experimentsList = useMemo(() => {
    return experiments.slice(0, MAX_VISIBLE_ENTITIES);
  }, [experiments]);

  const assertionMap = useMemo(() => {
    if (!isCompare) return {};

    return experimentsList.reduce<Record<string, Record<string, number>>>(
      (acc, e) => {
        const assertions: Record<string, number> = {};
        (e.assertion_aggregations ?? []).forEach((agg) => {
          assertions[agg.name] = agg.pass_rate * 100;
        });
        acc[e.id] = assertions;
        return acc;
      },
      {},
    );
  }, [experimentsList, isCompare]);

  const assertionNames = useMemo(() => {
    return uniq(
      Object.values(assertionMap)
        .reduce<string[]>((acc, m) => acc.concat(Object.keys(m)), [])
        .slice(0, MAX_VISIBLE_ENTITIES),
    ).sort();
  }, [assertionMap]);

  const radarChartData = useMemo(() => {
    return assertionNames.map((name) => {
      const dataPoint: RadarDataPoint = { name };
      experimentsList.forEach((experiment) => {
        dataPoint[experiment.id] = assertionMap[experiment.id]?.[name] || 0;
      });
      return dataPoint;
    });
  }, [assertionNames, assertionMap, experimentsList]);

  const radarChartKeys = useMemo(() => {
    return experimentsList.map((experiment) => experiment.id);
  }, [experimentsList]);

  const barChartData = useMemo(() => {
    return experimentsList.map((experiment) => {
      const dataPoint: BarDataPoint = {
        name: experiment.name,
      };
      assertionNames.forEach((assertionName) => {
        dataPoint[assertionName] =
          assertionMap[experiment.id]?.[assertionName] || 0;
      });
      return dataPoint;
    });
  }, [assertionNames, assertionMap, experimentsList]);

  const experimentLabelsMap = useMemo(() => {
    const map: Record<string, string> = {};
    experimentsList.forEach((experiment) => {
      map[experiment.id] = experiment.name;
    });
    return map;
  }, [experimentsList]);

  return {
    radarChartData,
    radarChartKeys,
    barChartData,
    barChartKeys: assertionNames,
    experimentLabelsMap,
  };
};

export default useCompareAssertionsChartsData;
