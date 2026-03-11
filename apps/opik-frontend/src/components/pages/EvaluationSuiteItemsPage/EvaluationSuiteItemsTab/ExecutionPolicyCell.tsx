import React from "react";
import { CellContext } from "@tanstack/react-table";
import { DatasetItem } from "@/types/datasets";
import { useEffectiveItemExecutionPolicy } from "@/hooks/useEffectiveItemExecutionPolicy";
import { useEffectiveExecutionPolicy } from "@/hooks/useEffectiveExecutionPolicy";
import { useSuiteIdFromURL } from "@/hooks/useSuiteIdFromURL";

interface ExecutionPolicyCellInnerProps {
  itemId: string;
  item: DatasetItem;
}

const ExecutionPolicyCellInner: React.FC<ExecutionPolicyCellInnerProps> = ({
  itemId,
  item,
}) => {
  const suiteId = useSuiteIdFromURL();
  const globalPolicy = useEffectiveExecutionPolicy(suiteId);
  const localPolicy = useEffectiveItemExecutionPolicy(
    itemId,
    item.execution_policy,
  );

  if (localPolicy === null) {
    return (
      <span className="text-light-slate">
        {globalPolicy.pass_threshold} of {globalPolicy.runs_per_item} must pass
      </span>
    );
  }

  return (
    <span>
      {localPolicy.pass_threshold} of {localPolicy.runs_per_item} must pass
    </span>
  );
};

export const ExecutionPolicyCell: React.FC<
  CellContext<DatasetItem, unknown>
> = (context) => {
  const item = context.row.original;
  return <ExecutionPolicyCellInner itemId={item.id} item={item} />;
};
