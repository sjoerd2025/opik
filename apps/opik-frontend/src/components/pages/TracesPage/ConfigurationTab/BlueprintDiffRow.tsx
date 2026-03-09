import React from "react";

import { TableCell, TableRow } from "@/components/ui/table";
import {
  BlueprintValueType,
  EnrichedBlueprintValue,
} from "@/types/agent-configs";
import BlueprintTypeIcon from "./BlueprintTypeIcon";
import TooltipWrapper from "@/components/shared/TooltipWrapper/TooltipWrapper";
import {
  type DiffSide,
  DiffCellBox,
  EmptyDiffCell,
  PromptDiffCell,
  formatBlueprintValue,
} from "./BlueprintDiffCell";

export type DiffPair = {
  key: string;
  type: BlueprintValueType;
  description?: string;
  baseValue?: EnrichedBlueprintValue;
  diffValue?: EnrichedBlueprintValue;
  changed: boolean;
};

const BlueprintDiffRow: React.FC<{ pair: DiffPair }> = ({ pair }) => {
  const { key, type, description, baseValue, diffValue, changed } = pair;
  const isPrompt = type === BlueprintValueType.PROMPT;

  const baseText = baseValue ? formatBlueprintValue(baseValue) : undefined;
  const diffText = diffValue ? formatBlueprintValue(diffValue) : undefined;

  const renderCell = (
    value: EnrichedBlueprintValue | undefined,
    text: string | undefined,
    side: DiffSide,
  ) => {
    if (isPrompt) {
      return (
        <PromptDiffCell commit={value?.value} changed={changed} side={side} />
      );
    }
    if (!value) return <EmptyDiffCell />;
    return <DiffCellBox text={text!} changed={changed} side={side} />;
  };

  return (
    <TableRow>
      <TableCell className="w-[240px] py-3 px-1 align-top">
        <TooltipWrapper content={key}>
          <div className="flex min-w-0 items-center gap-2">
            <BlueprintTypeIcon type={type} />
            <span className="comet-body-xs-accented truncate text-foreground">
              {key}
            </span>
          </div>
        </TooltipWrapper>
        {description && (
          <p className="comet-body-xs mt-1 text-light-slate">{description}</p>
        )}
      </TableCell>
      <TableCell className="w-1/2 py-3 pr-2 align-top">
        {renderCell(baseValue, baseText, "base")}
      </TableCell>
      <TableCell className="w-1/2 py-3 pl-2 align-top">
        {renderCell(diffValue, diffText, "diff")}
      </TableCell>
    </TableRow>
  );
};

export default BlueprintDiffRow;
