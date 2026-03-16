import { useCallback, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { keepPreviousData } from "@tanstack/react-query";

import { AggregatedFeedbackScore } from "@/types/shared";
import { Experiment, EXPERIMENT_TYPE } from "@/types/datasets";
import {
  OPTIMIZATION_ACTIVE_REFETCH_INTERVAL,
  IN_PROGRESS_OPTIMIZATION_STATUSES,
  MAX_EXPERIMENTS_LOADED,
  checkIsEvaluationSuite,
  getBaselineCandidate,
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
    return {
      step_index: -1,
      candidate_id: experimentId,
      parent_candidate_ids: [],
      configuration: m.configuration as
        | ExperimentOptimizationMetadata["configuration"]
        | undefined,
    };
  }
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
      if (
        meta.step_index >= 0 &&
        (existing.meta.step_index < 0 ||
          meta.step_index < existing.meta.step_index)
      ) {
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
      trialNumber: 0,
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

  candidates.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return candidates.map((c, i) => {
    const isOldStyle = c.stepIndex === -1;
    return {
      ...c,
      stepIndex: isOldStyle ? i : c.stepIndex,
      parentCandidateIds:
        isOldStyle && i > 0
          ? [candidates[i - 1].candidateId]
          : c.parentCandidateIds,
      trialNumber: i + 1,
    };
  });
};

const mergeExperimentScores = (
  feedbackScores: AggregatedFeedbackScore[] | undefined,
  experimentScores: AggregatedFeedbackScore[] | undefined,
): AggregatedFeedbackScore[] => {
  if (!experimentScores?.length) return [];
  const existingNames = new Set(feedbackScores?.map((s) => s.name));
  return experimentScores.filter((s) => !existingNames.has(s.name));
};

export const useOptimizationExperiments = () => {
  const workspaceName = useAppStore((state) => state.activeWorkspaceName);

  const { optimizationId } = useParams({
    select: (params) => params,
    from: "/workspaceGuard/$workspaceName/optimizations/$optimizationId",
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

  const isRunningMiniBatches = useMemo(() => {
    if (!isInProgress) return false;

    const latest = latestExperimentData?.content?.[0];
    return latest?.type === EXPERIMENT_TYPE.MINI_BATCH;
  }, [isInProgress, latestExperimentData?.content]);

  const { scoreMap, baseScore, bestExperiment } = useOptimizationScores(
    experiments,
    optimization?.objective_name,
  );

  const baselineCandidate = useMemo(
    () => getBaselineCandidate(candidates),
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

  const handleRefresh = useCallback(() => {
    refetchOptimization();
    refetchExperiments();
  }, [refetchOptimization, refetchExperiments]);

  return {
    workspaceName,
    optimizationId,
    optimization,
    experiments,
    candidates,
    isEvaluationSuite,
    scoreMap,
    baseScore,
    bestExperiment: bestExperiment,
    bestCandidate,
    baselineCandidate,
    baselineExperiment,
    inProgressInfo,
    isRunningMiniBatches,
    sortableBy,
    isOptimizationPending,
    isExperimentsPending,
    isExperimentsPlaceholderData,
    isExperimentsFetching,
    handleRefresh,
  };
};

export const CANDIDATE_SORT_FIELD_MAP: Record<
  string,
  keyof AggregatedCandidate | undefined
> = {
  name: "trialNumber",
  step: "stepIndex",
  id: "id",
  objective_name: "score",
  runtime_cost: "runtimeCost",
  latency: "latencyP50",
  trace_count: "totalDatasetItemCount",
  created_at: "created_at",
};

export const sortCandidates = (
  candidates: AggregatedCandidate[],
  sortedColumns: { id: string; desc: boolean }[],
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
