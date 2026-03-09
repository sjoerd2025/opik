import React from "react";

import { cn, formatNumericData } from "@/lib/utils";
import {
  BlueprintValueType,
  BlueprintValue,
} from "@/types/agent-configs";
import { GitCommitVertical } from "lucide-react";
import usePromptByCommit from "@/api/prompts/usePromptByCommit";
import Loader from "@/components/shared/Loader/Loader";
import { Tag } from "@/components/ui/tag";
import { TableCell } from "@/components/ui/table";

export type DiffSide = "base" | "diff";

const SIDE_STYLES = {
  base: "border-red-200 bg-red-50 text-red-800",
  diff: "border-green-200 bg-green-50 text-green-800",
} as const;

export const formatBlueprintValue = (v: BlueprintValue): string => {
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
      changed
        ? SIDE_STYLES[side]
        : "bg-primary-foreground text-muted-foreground",
      className,
    )}
  >
    {text || "(empty)"}
  </div>
);

export const EmptyDiffCell: React.FC = () => (
  <span className="comet-body-xs italic text-muted-slate">—</span>
);

export const PromptDiffPair: React.FC<{
  baseCommit: string;
  diffCommit: string;
}> = ({ baseCommit, diffCommit }) => {
  const { data: basePrompt, isLoading: baseLoading } = usePromptByCommit(
    { commitId: baseCommit },
    { enabled: !!baseCommit },
  );
  const { data: diffPrompt, isLoading: diffLoading } = usePromptByCommit(
    { commitId: diffCommit },
    { enabled: !!diffCommit },
  );

  if (baseLoading || diffLoading) {
    return (
      <>
        <TableCell className="w-1/2 py-3 pr-2 align-top">
          <Loader />
        </TableCell>
        <TableCell className="w-1/2 py-3 pl-2 align-top">
          <Loader />
        </TableCell>
      </>
    );
  }

  const baseText = basePrompt?.requested_version?.template ?? "";
  const diffText = diffPrompt?.requested_version?.template ?? "";
  const changed = baseText !== diffText;
  const commitsChanged = baseCommit !== diffCommit;

  return (
    <>
      <TableCell className="w-1/2 py-3 pr-2 align-top">
        {baseCommit ? (
          <div className="flex flex-col gap-1">
            <Tag
              className={cn(
                "flex w-fit items-center gap-1",
                commitsChanged && "border-red-300 bg-red-50 text-red-700",
              )}
              variant="gray"
              size="sm"
              title={baseCommit}
            >
              <GitCommitVertical className="size-3.5 shrink-0" />
              {baseCommit.slice(0, 8)}
            </Tag>
            <DiffCellBox
              text={baseText}
              changed={changed}
              side="base"
              className="comet-code max-h-48 overflow-y-auto"
            />
          </div>
        ) : (
          <EmptyDiffCell />
        )}
      </TableCell>
      <TableCell className="w-1/2 py-3 pl-2 align-top">
        {diffCommit ? (
          <div className="flex flex-col gap-1">
            <Tag
              className={cn(
                "flex w-fit items-center gap-1",
                commitsChanged && "border-green-300 bg-green-50 text-green-700",
              )}
              variant="gray"
              size="sm"
              title={diffCommit}
            >
              <GitCommitVertical className="size-3.5 shrink-0" />
              {diffCommit.slice(0, 8)}
            </Tag>
            <DiffCellBox
              text={diffText}
              changed={changed}
              side="diff"
              className="comet-code max-h-48 overflow-y-auto"
            />
          </div>
        ) : (
          <EmptyDiffCell />
        )}
      </TableCell>
    </>
  );
};
