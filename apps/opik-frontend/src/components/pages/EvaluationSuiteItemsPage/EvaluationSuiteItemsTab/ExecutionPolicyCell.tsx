import React from "react";
import { CellContext } from "@tanstack/react-table";
import { DatasetItem } from "@/types/datasets";
import { useEffectiveItemExecutionPolicy } from "@/hooks/useEffectiveItemExecutionPolicy";

interface ExecutionPolicyCellInnerProps {
  itemId: string;
  item: DatasetItem;
}

const ExecutionPolicyCellInner: React.FC<ExecutionPolicyCellInnerProps> = ({
  itemId,
  item,
}) => {
  const policy = useEffectiveItemExecutionPolicy(itemId, item.execution_policy);

  if (policy === null) {
    return <span className="text-muted-slate">&mdash;</span>;
  }

  return (
    <span>
      {policy.pass_threshold} of {policy.runs_per_item} must pass
    </span>
  );
};

export const ExecutionPolicyCell: React.FC<
  CellContext<DatasetItem, unknown>
> = (context) => {
  const item = context.row.original;
  return <ExecutionPolicyCellInner itemId={item.id} item={item} />;
};
