import React from "react";
import { GitCommitVertical } from "lucide-react";

import { cn } from "@/lib/utils";
export { formatBlueprintValue } from "@/utils/agent-configurations";
import usePromptByCommit from "@/api/prompts/usePromptByCommit";
import Loader from "@/components/shared/Loader/Loader";
import { Tag } from "@/components/ui/tag";
import { TableCell } from "@/components/ui/table";

export type DiffSide = "base" | "diff";

const SIDE_STYLES = {
  base: "border-[var(--diff-removed-border)] bg-[var(--diff-removed-bg)] text-[var(--diff-removed-text)]",
  diff: "border-[var(--diff-added-border)] bg-[var(--diff-added-bg)] text-[var(--diff-added-text)]",
} as const;

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
                commitsChanged &&
                  "border-[var(--diff-removed-border)] bg-[var(--diff-removed-bg)] text-[var(--diff-removed-text)]",
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
                commitsChanged &&
                  "border-[var(--diff-added-border)] bg-[var(--diff-added-bg)] text-[var(--diff-added-text)]",
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
