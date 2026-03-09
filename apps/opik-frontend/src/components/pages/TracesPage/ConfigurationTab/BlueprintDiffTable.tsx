import React, { useMemo, useState } from "react";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BlueprintValueType } from "@/types/agent-configs";
import useAgentConfigById from "@/api/agent-configs/useAgentConfigById";
import Loader from "@/components/shared/Loader/Loader";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DiffCellBox, formatBlueprintValue } from "./BlueprintDiffCell";
import BlueprintDiffRow, { type DiffPair } from "./BlueprintDiffRow";

export type BlueprintVersionInfo = {
  label: string;
  blueprintId: string;
};

type BlueprintDiffTableProps = {
  base: BlueprintVersionInfo;
  diff: BlueprintVersionInfo;
};

const BlueprintDiffTable: React.FC<BlueprintDiffTableProps> = ({
  base,
  diff,
}) => {
  const [onlyDiff, setOnlyDiff] = useState(false);

  const { data: baseConfig, isPending: baseLoading } = useAgentConfigById({
    blueprintId: base.blueprintId,
  });
  const { data: diffConfig, isPending: diffLoading } = useAgentConfigById({
    blueprintId: diff.blueprintId,
  });

  const pairs = useMemo<DiffPair[]>(() => {
    if (!baseConfig || !diffConfig) return [];

    const baseMap = new Map(baseConfig.values.map((v) => [v.key, v]));
    const diffMap = new Map(diffConfig.values.map((v) => [v.key, v]));
    const allKeys = new Set([...baseMap.keys(), ...diffMap.keys()]);

    return Array.from(allKeys)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => {
        const bv = baseMap.get(key);
        const dv = diffMap.get(key);
        const type = (dv?.type ?? bv?.type) as BlueprintValueType;
        const isPrompt = type === BlueprintValueType.PROMPT;
        const changed = isPrompt
          ? bv?.value !== dv?.value
          : (bv ? formatBlueprintValue(bv) : undefined) !==
            (dv ? formatBlueprintValue(dv) : undefined);
        return {
          key,
          type,
          description: dv?.description ?? bv?.description,
          baseValue: bv,
          diffValue: dv,
          changed,
        };
      });
  }, [baseConfig, diffConfig]);

  if (baseLoading || diffLoading) return <Loader />;

  const descChanged =
    (baseConfig?.description ?? "") !== (diffConfig?.description ?? "");
  const hasDifferences = descChanged || pairs.some((p) => p.changed);
  const visiblePairs = onlyDiff ? pairs.filter((p) => p.changed) : pairs;

  if (!hasDifferences) {
    return (
      <p className="comet-body-s py-8 text-center text-muted-slate">
        No differences between {base.label} and {diff.label}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Switch
          id="only-diff"
          checked={onlyDiff}
          onCheckedChange={setOnlyDiff}
        />
        <Label htmlFor="only-diff" className="comet-body-xs cursor-pointer">
          Show only differences
        </Label>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {(!onlyDiff || descChanged) && descChanged && (
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <p className="comet-body-xs-accented mb-1 text-muted-slate">
                Description ({base.label})
              </p>
              <DiffCellBox
                text={baseConfig?.description ?? ""}
                changed
                side="base"
              />
            </div>
            <div>
              <p className="comet-body-xs-accented mb-1 text-muted-slate">
                Description ({diff.label})
              </p>
              <DiffCellBox
                text={diffConfig?.description ?? ""}
                changed
                side="diff"
              />
            </div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[240px] pb-2 pr-3">
                <span className="comet-body-xs-accented text-muted-slate">
                  Key
                </span>
              </TableHead>
              <TableHead className="w-1/2 pb-2 pr-2">
                <span className="comet-body-xs-accented text-muted-slate">
                  {base.label}
                </span>
              </TableHead>
              <TableHead className="w-1/2 pb-2 pl-2">
                <span className="comet-body-xs-accented text-muted-slate">
                  {diff.label}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiblePairs.map((pair) => (
              <BlueprintDiffRow key={pair.key} pair={pair} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default BlueprintDiffTable;
