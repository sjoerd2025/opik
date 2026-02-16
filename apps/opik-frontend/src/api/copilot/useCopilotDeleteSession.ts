import { useMutation, useQueryClient } from "@tanstack/react-query";
import api, {
  BASE_OPIK_AI_URL,
  COPILOT_KEY,
  COPILOT_REST_ENDPOINT,
} from "@/api/api";

const deleteCopilotSession = async () => {
  await api.delete(COPILOT_REST_ENDPOINT, {
    baseURL: BASE_OPIK_AI_URL,
  });
};

export default function useCopilotDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCopilotSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [COPILOT_KEY] });
    },
  });
}
