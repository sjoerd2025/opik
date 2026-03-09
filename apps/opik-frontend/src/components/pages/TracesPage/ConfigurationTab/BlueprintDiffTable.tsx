import React, { useMemo } from "react";

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
import { DiffCellBox } from "./BlueprintDiffCell";
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
        return {
          key,
          type: (dv?.type ?? bv?.type) as BlueprintValueType,
          description: dv?.description ?? bv?.description,
          baseValue: bv,
          diffValue: dv,
        };
      });
  }, [baseConfig, diffConfig]);

  if (baseLoading || diffLoading) return <Loader />;

  const descChanged =
    (baseConfig?.description ?? "") !== (diffConfig?.description ?? "");

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      {descChanged && (
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
          {pairs.map((pair) => (
            <BlueprintDiffRow key={pair.key} pair={pair} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default BlueprintDiffTable;
