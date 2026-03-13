import { useQuery } from "@tanstack/react-query";
import api, { OLLIE_COMPUTE_KEY, OLLIE_REST_ENDPOINT } from "@/api/api";

type OllieComputeResponse = {
  compute_url: string;
  enabled: boolean;
};

const getOllieCompute = async () => {
  const { data } = await api.get<OllieComputeResponse>(
    `${OLLIE_REST_ENDPOINT}compute`,
  );
  return data;
};

export default function useOllieCompute(enabled: boolean = false) {
  return useQuery({
    queryKey: [OLLIE_COMPUTE_KEY],
    queryFn: getOllieCompute,
    enabled,
    staleTime: Infinity,
    retry: 2,
  });
}
