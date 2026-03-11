import React, { useMemo } from "react";
import { diffLines, diffWords, Change } from "diff";
import { cn } from "@/lib/utils";

type DiffMode = "lines" | "words";

type CodeDiffProps = {
  content1: string;
  content2: string;
  mode?: DiffMode;
};

const WORD_DIFF_CHANGE_THRESHOLD = 0.6;

const getChangedRatio = (changes: Change[]): number => {
  let changed = 0;
  let total = 0;
  for (const c of changes) {
    total += c.value.length;
    if (c.added || c.removed) changed += c.value.length;
  }
  return total === 0 ? 0 : changed / total;
};

/**
 * Renders a single change item with appropriate styling.
 */
const DiffChange: React.FC<{ change: Change; mode: DiffMode }> = ({
  change,
  mode,
}) => {
  if (!change.added && !change.removed) {
    return <span className="text-muted-foreground">{change.value}</span>;
  }

  return (
    <span
      className={cn(
        mode === "lines" ? "block p-0.5 rounded-[2px]" : "rounded-[2px] px-0.5",
        {
          "text-diff-removed-text bg-diff-removed-bg line-through":
            change.removed,
          "text-diff-added-text bg-diff-added-bg": change.added,
        },
      )}
    >
      {change.value}
    </span>
  );
};

/**
 * When word diff is too noisy (most content changed), show as two
 * separate removed/added blocks instead of interleaved words.
 */
const BlockDiff: React.FC<{ content1: string; content2: string }> = ({
  content1,
  content2,
}) => (
  <div className="flex flex-col gap-2">
    {content1 && (
      <span className="whitespace-pre-wrap break-words rounded-[2px] bg-diff-removed-bg px-0.5 text-diff-removed-text line-through">
        {content1}
      </span>
    )}
    {content2 && (
      <span className="whitespace-pre-wrap break-words rounded-[2px] bg-diff-added-bg px-0.5 text-diff-added-text">
        {content2}
      </span>
    )}
  </div>
);

/**
 * TextDiff component that shows differences between two text strings.
 * Supports both line-level and word-level diff modes.
 * Falls back to block diff when word changes exceed 60% of content.
 */
const TextDiff: React.FunctionComponent<CodeDiffProps> = ({
  content1,
  content2,
  mode = "lines",
}) => {
  const { changes, useBlockDiff } = useMemo(() => {
    if (mode === "words") {
      const wordChanges = diffWords(content1, content2);
      if (getChangedRatio(wordChanges) > WORD_DIFF_CHANGE_THRESHOLD) {
        return { changes: wordChanges, useBlockDiff: true };
      }
      return { changes: wordChanges, useBlockDiff: false };
    }
    return { changes: diffLines(content1, content2), useBlockDiff: false };
  }, [content1, content2, mode]);

  if (useBlockDiff) {
    return <BlockDiff content1={content1} content2={content2} />;
  }

  return (
    <div
      className={cn(
        mode === "lines"
          ? "flex w-fit flex-col gap-[3px]"
          : "whitespace-pre-wrap break-words",
      )}
    >
      {changes.map((change, index) => (
        <DiffChange key={change.value + index} change={change} mode={mode} />
      ))}
    </div>
  );
};

export default TextDiff;
