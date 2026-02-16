import { QueryFunctionContext, useQuery } from "@tanstack/react-query";

import api, {
  BASE_OPIK_AI_URL,
  QueryConfig,
  COPILOT_KEY,
  COPILOT_REST_ENDPOINT,
} from "@/api/api";
import { TraceAnalyzerHistoryResponse } from "@/types/ai-assistant";

const getCopilotHistory = async ({ signal }: QueryFunctionContext) => {
  const { data } = await api.get<TraceAnalyzerHistoryResponse>(
    COPILOT_REST_ENDPOINT,
    {
      baseURL: BASE_OPIK_AI_URL,
      signal,
    },
  );

  return data;
};

export default function useCopilotHistory(
  options?: QueryConfig<TraceAnalyzerHistoryResponse>,
) {
  return useQuery({
    queryKey: [COPILOT_KEY, {}],
    queryFn: getCopilotHistory,
    ...options,
  });
}
