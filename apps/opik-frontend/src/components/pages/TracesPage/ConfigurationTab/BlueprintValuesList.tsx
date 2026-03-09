import React from "react";

import {
  BlueprintValue,
  BlueprintValueType,
  EnrichedBlueprintValue,
} from "@/types/agent-configs";
import { formatNumericData } from "@/lib/utils";
import BlueprintTypeIcon from "./BlueprintTypeIcon";
import BlueprintValuePrompt from "./BlueprintValuePrompt";

const renderValue = (v: BlueprintValue) => {
  switch (v.type) {
    case BlueprintValueType.INT:
    case BlueprintValueType.FLOAT: {
      const num = Number(v.value);
      return (
        <div className="comet-body-s whitespace-pre-wrap break-words rounded-md border bg-primary-foreground p-3 text-foreground">
          {isNaN(num) ? v.value : formatNumericData(num)}
        </div>
      );
    }
    case BlueprintValueType.BOOLEAN:
      return (
        <div className="comet-body-s whitespace-pre-wrap break-words rounded-md border bg-primary-foreground p-3 text-foreground">
          {v.value === "true" ? "true" : "false"}
        </div>
      );
    case BlueprintValueType.PROMPT:
      return <BlueprintValuePrompt value={v as EnrichedBlueprintValue} />;
    default:
      return (
        <div className="comet-body-s whitespace-pre-wrap break-words rounded-md border bg-primary-foreground p-3 text-foreground">
          {v.value}
        </div>
      );
  }
};

type BlueprintValuesListProps = {
  values: BlueprintValue[];
};

const BlueprintValuesList: React.FC<BlueprintValuesListProps> = ({
  values,
}) => (
  <div className="flex flex-col divide-y">
    {values.map((v) => (
      <div key={v.key} className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-2">
          <BlueprintTypeIcon type={v.type} />
          <span className="comet-body-xs-accented text-foreground">
            {v.key}
          </span>
        </div>
        {v.description && (
          <span className="comet-body-xs text-light-slate">
            {v.description}
          </span>
        )}
        <div className="overflow-hidden">{renderValue(v)}</div>
      </div>
    ))}
  </div>
);

export default BlueprintValuesList;
