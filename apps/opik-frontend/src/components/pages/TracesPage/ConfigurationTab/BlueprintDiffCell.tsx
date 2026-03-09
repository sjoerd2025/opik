import React from "react";

import { cn, formatNumericData } from "@/lib/utils";
import {
  BlueprintValueType,
  EnrichedBlueprintValue,
} from "@/types/agent-configs";
import usePromptByCommit from "@/api/prompts/usePromptByCommit";
import Loader from "@/components/shared/Loader/Loader";

export type DiffSide = "base" | "diff";

const SIDE_STYLES = {
  base: "border-red-200 bg-red-50 text-red-800",
  diff: "border-green-200 bg-green-50 text-green-800",
} as const;

export const formatBlueprintValue = (v: EnrichedBlueprintValue): string => {
  switch (v.type) {
    case BlueprintValueType.INT:
    case BlueprintValueType.FLOAT: {
      const num = Number(v.value);
      return isNaN(num) ? v.value : formatNumericData(num);
    }
    case BlueprintValueType.BOOLEAN:
      return v.value === "true" ? "true" : "false";
    default:
      return v.value;
  }
};

export const DiffCellBox: React.FC<{
  text: string;
  changed: boolean;
  side: DiffSide;
  className?: string;
}> = ({ text, changed, side, className }) => (
  <div
    className={cn(
      "comet-body-s whitespace-pre-wrap break-words rounded-md border p-2 text-sm",
      changed ? SIDE_STYLES[side] : "bg-primary-foreground text-muted-foreground",
      className,
    )}
  >
    {text || "(empty)"}
  </div>
);

export const EmptyDiffCell: React.FC = () => (
  <span className="comet-body-xs italic text-muted-slate">—</span>
);

export const PromptDiffCell: React.FC<{
  commit?: string;
  changed: boolean;
  side: DiffSide;
}> = ({ commit, changed, side }) => {
  const { data: prompt, isLoading } = usePromptByCommit(
    { commitId: commit ?? "" },
    { enabled: !!commit },
  );

  if (!commit) return <EmptyDiffCell />;
  if (isLoading) return <Loader />;

  const text = prompt?.requested_version?.template ?? "";

  return (
    <DiffCellBox
      text={text}
      changed={changed}
      side={side}
      className="comet-code max-h-48 overflow-y-auto"
    />
  );
};
