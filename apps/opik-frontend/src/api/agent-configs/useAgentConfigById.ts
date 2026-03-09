import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import api, { AGENT_CONFIGS_REST_ENDPOINT } from "@/api/api";
import { BlueprintDetails } from "@/types/agent-configs";

type UseAgentConfigByIdParams = {
  blueprintId: string;
};

const getAgentConfigById = async (
  blueprintId: string,
  signal: AbortSignal,
): Promise<BlueprintDetails> => {
  const { data } = await api.get(
    `${AGENT_CONFIGS_REST_ENDPOINT}blueprints/${blueprintId}`,
    { signal },
  );
  return data;
};

export default function useAgentConfigById({
  blueprintId,
}: UseAgentConfigByIdParams) {
  const { data: blueprint, isPending } = useQuery({
    queryKey: [AGENT_CONFIGS_REST_ENDPOINT, "blueprints", blueprintId],
    queryFn: ({ signal }) => getAgentConfigById(blueprintId, signal),
    placeholderData: keepPreviousData,
    enabled: !!blueprintId,
  });

  const sortedBlueprint = useMemo(() => {
    if (!blueprint) return undefined;
    return {
      ...blueprint,
      values: [...blueprint.values].sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
    };
  }, [blueprint]);

  return {
    data: sortedBlueprint,
    isPending,
  };
}
