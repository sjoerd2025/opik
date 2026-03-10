export const AGENT_CONFIGURATION_METADATA_KEY = "agent_configuration";
export const AGENT_CONFIGURATION_PROD_ENV_NAME = "prod";

export const isProdTag = (tag: string) => /^prod(uction)?$/i.test(tag);

export const sortTags = (tags: string[]) => [
  ...tags.filter(isProdTag),
  ...tags.filter((t) => !isProdTag(t)),
];

import { BlueprintValue, BlueprintValueType } from "@/types/agent-configs";
import { formatNumericData } from "@/lib/utils";

export const formatBlueprintValue = (v: BlueprintValue): string => {
  const str = String(v.value);
  switch (v.type) {
    case BlueprintValueType.INT:
    case BlueprintValueType.FLOAT: {
      const num = Number(v.value);
      return isNaN(num) ? str : formatNumericData(num);
    }
    case BlueprintValueType.BOOLEAN:
      return v.value === "false" || v.value === false ? "false" : "true";
    default:
      return str;
  }
};

export const generateBlueprintDescription = (
  values: Array<{ key: string; value: unknown }>,
): string => {
  if (!values.length) return "";
  const changes = values.map(({ key, value }) => `${key} to ${value}`);
  return `Changed ${changes.join(", ")}.`;
};
