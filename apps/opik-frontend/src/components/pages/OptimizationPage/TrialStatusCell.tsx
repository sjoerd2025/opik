import React from "react";
import { CellContext } from "@tanstack/react-table";

import CellWrapper from "@/components/shared/DataTableCells/CellWrapper";
import { Tag, TagProps } from "@/components/ui/tag";
import { AggregatedCandidate } from "@/types/optimizations";
import {
  computeCandidateStatuses,
  type TrialStatus,
} from "@/components/pages-shared/experiments/OptimizationProgressChart/optimizationChartUtils";

const STATUS_VARIANT_MAP: Record<TrialStatus, TagProps["variant"]> = {
  baseline: "gray",
  passed: "blue",
  pruned: "pink",
  running: "yellow",
};

const TrialStatusCell = (context: CellContext<unknown, unknown>) => {
  const row = context.row.original as AggregatedCandidate;
  const { custom } = context.column.columnDef.meta ?? {};
  const { candidates, bestCandidateId, isEvaluationSuite } = (custom ?? {}) as {
    candidates: AggregatedCandidate[];
    bestCandidateId?: string;
    isEvaluationSuite?: boolean;
  };

  const isBest = bestCandidateId === row.candidateId;

  const statusMap = computeCandidateStatuses(
    candidates ?? [],
    isEvaluationSuite,
  );
  const status = statusMap.get(row.candidateId) ?? "pruned";

  return (
    <CellWrapper
      metadata={context.column.columnDef.meta}
      tableMetadata={context.table.options.meta}
    >
      {isBest ? (
        <Tag variant="green" size="md">
          Best
        </Tag>
      ) : (
        <Tag
          variant={STATUS_VARIANT_MAP[status]}
          size="md"
          className="capitalize"
        >
          {status}
        </Tag>
      )}
    </CellWrapper>
  );
};

export default TrialStatusCell;
