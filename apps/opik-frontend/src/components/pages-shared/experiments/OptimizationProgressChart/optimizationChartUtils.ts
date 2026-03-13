/**
 * Utility functions for optimization chart data processing
 */

import { AggregatedCandidate } from "@/types/optimizations";

export type FeedbackScore = {
  name: string;
  value: number;
};

export type TrialStatus = "baseline" | "passed" | "pruned" | "running";

export const TRIAL_STATUS_COLORS: Record<TrialStatus, string> = {
  baseline: "var(--color-gray)",
  passed: "var(--color-blue)",
  pruned: "var(--color-pink)",
  running: "var(--color-yellow)",
};

export const TRIAL_STATUS_LABELS: Record<TrialStatus, string> = {
  baseline: "Baseline",
  passed: "Passed",
  pruned: "Pruned",
  running: "Running",
};

export const TRIAL_STATUS_ORDER: readonly TrialStatus[] = [
  "baseline",
  "passed",
  "pruned",
  "running",
] as const;

export type CandidateDataPoint = {
  candidateId: string;
  stepIndex: number;
  parentCandidateIds: string[];
  value: number | null;
  status: TrialStatus;
  name: string;
};

export type ParentChildEdge = {
  parentCandidateId: string;
  childCandidateId: string;
};

export type InProgressInfo = {
  candidateId: string;
  stepIndex: number;
  parentCandidateIds: string[];
};

/**
 * Compute status for each candidate:
 * - Step 0 = "baseline"
 * - score == null (still being evaluated) = "running"
 * - When isEvaluationSuite (default): scored higher than best parent = "passed", otherwise "pruned"
 * - When !isEvaluationSuite: all scored non-baseline candidates = "passed" (no pruning)
 */
export const computeCandidateStatuses = (
  candidates: AggregatedCandidate[],
  isEvaluationSuite = true,
): Map<string, TrialStatus> => {
  const statusMap = new Map<string, TrialStatus>();
  if (!candidates.length) return statusMap;

  const candidateById = new Map<string, AggregatedCandidate>();
  for (const c of candidates) {
    candidateById.set(c.candidateId, c);
  }

  for (const c of candidates) {
    if (c.stepIndex === 0) {
      statusMap.set(c.candidateId, "baseline");
    } else if (!isEvaluationSuite) {
      if (c.score == null) {
        statusMap.set(c.candidateId, "running");
      } else {
        statusMap.set(c.candidateId, "passed");
      }
    } else if (c.score == null) {
      statusMap.set(c.candidateId, "running");
    } else {
      const bestParentScore = c.parentCandidateIds.reduce<number | undefined>(
        (best, pid) => {
          const parent = candidateById.get(pid);
          if (parent?.score == null) return best;
          return best == null ? parent.score : Math.max(best, parent.score);
        },
        undefined,
      );

      if (bestParentScore == null || c.score > bestParentScore) {
        statusMap.set(c.candidateId, "passed");
      } else {
        statusMap.set(c.candidateId, "pruned");
      }
    }
  }

  return statusMap;
};

/**
 * Build scatter data points from aggregated candidates.
 * Each candidate becomes one dot on the chart.
 */
export const buildCandidateChartData = (
  candidates: AggregatedCandidate[],
  isEvaluationSuite = true,
): CandidateDataPoint[] => {
  const statusMap = computeCandidateStatuses(candidates, isEvaluationSuite);

  return candidates
    .slice()
    .sort(
      (a, b) =>
        a.stepIndex - b.stepIndex || a.created_at.localeCompare(b.created_at),
    )
    .map((c) => ({
      candidateId: c.candidateId,
      stepIndex: c.stepIndex,
      parentCandidateIds: c.parentCandidateIds,
      value: c.score ?? null,
      status: statusMap.get(c.candidateId) ?? "pruned",
      name: c.name,
    }));
};

/**
 * Build parent-child edges from chart data.
 */
export const buildParentChildEdges = (
  data: CandidateDataPoint[],
): ParentChildEdge[] => {
  const candidateIds = new Set(data.map((d) => d.candidateId));
  const edges: ParentChildEdge[] = [];

  for (const point of data) {
    for (const parentId of point.parentCandidateIds) {
      if (candidateIds.has(parentId)) {
        edges.push({
          parentCandidateId: parentId,
          childCandidateId: point.candidateId,
        });
      }
    }
  }

  return edges;
};

/**
 * Get unique step indices from candidates, sorted.
 */
export const getUniqueSteps = (candidates: AggregatedCandidate[]): number[] => {
  const steps = new Set(candidates.map((c) => c.stepIndex));
  return Array.from(steps).sort((a, b) => a - b);
};

const MAIN_OBJECTIVE_COLOR = "var(--color-blue)";

const SECONDARY_SCORE_COLORS = [
  "var(--color-orange)",
  "var(--color-green)",
  "var(--color-purple)",
  "var(--color-pink)",
  "var(--color-turquoise)",
  "var(--color-yellow)",
  "var(--color-burgundy)",
];

export const generateDistinctColorMap = (
  mainObjective: string,
  secondaryScores: string[],
): Record<string, string> => {
  const colorMap: Record<string, string> = {};
  colorMap[mainObjective] = MAIN_OBJECTIVE_COLOR;

  const sortedSecondaryScores = [...secondaryScores].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  sortedSecondaryScores.forEach((scoreName, index) => {
    colorMap[scoreName] =
      SECONDARY_SCORE_COLORS[index % SECONDARY_SCORE_COLORS.length];
  });

  return colorMap;
};
