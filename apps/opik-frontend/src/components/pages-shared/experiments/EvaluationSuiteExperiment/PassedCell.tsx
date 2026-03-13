import React from "react";
import { CellContext } from "@tanstack/react-table";

import CellWrapper from "@/components/shared/DataTableCells/CellWrapper";
import AssertionsBreakdownTooltip from "./AssertionsBreakdownTooltip";
import { Tag, TagProps } from "@/components/ui/tag";
import { AssertionResult, ExperimentsCompare } from "@/types/datasets";
import { ExperimentItemStatus } from "@/types/evaluation-suites";

const STATUS_DISPLAY: Record<
  ExperimentItemStatus,
  { label: string; variant: TagProps["variant"] }
> = {
  [ExperimentItemStatus.PASSED]: { label: "Passed", variant: "green" },
  [ExperimentItemStatus.FAILED]: { label: "Failed", variant: "pink" },
  [ExperimentItemStatus.SKIPPED]: { label: "Skipped", variant: "gray" },
};

type StatusInfo = {
  status: ExperimentItemStatus | undefined;
  assertionsByRun: AssertionResult[][];
  passedCount: number;
  totalCount: number;
};

function getStatusFromExperimentItems(row: ExperimentsCompare): StatusInfo {
  const items = row.experiment_items;
  if (!items?.length) {
    return {
      status: undefined,
      assertionsByRun: [],
      passedCount: 0,
      totalCount: 0,
    };
  }

  const assertionsByRun = items.map((item) => item.assertion_results ?? []);
  const passedCount = items.filter(
    (item) => item.status === ExperimentItemStatus.PASSED,
  ).length;

  return {
    status: items[0].status,
    assertionsByRun,
    passedCount,
    totalCount: items.length,
  };
}

const PassedCell: React.FC<CellContext<ExperimentsCompare, unknown>> = (
  context,
) => {
  const row = context.row.original;
  const { status, assertionsByRun, passedCount, totalCount } =
    getStatusFromExperimentItems(row);

  const isMultiRun = totalCount > 1;

  return (
    <CellWrapper
      metadata={context.column.columnDef.meta}
      tableMetadata={context.table.options.meta}
    >
      {status ? (
        <AssertionsBreakdownTooltip assertionsByRun={assertionsByRun}>
          <Tag
            variant={STATUS_DISPLAY[status].variant}
            size="md"
            className="cursor-default"
          >
            {STATUS_DISPLAY[status].label}
            {isMultiRun && ` (${passedCount}/${totalCount})`}
          </Tag>
        </AssertionsBreakdownTooltip>
      ) : (
        <span className="text-muted-slate">{"\u2014"}</span>
      )}
    </CellWrapper>
  );
};

export default PassedCell;
