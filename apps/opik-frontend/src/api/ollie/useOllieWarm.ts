import { useQuery } from "@tanstack/react-query";
import api, { OLLIE_REST_ENDPOINT } from "@/api/api";

const warmOllie = async () => {
  await api.post(`${OLLIE_REST_ENDPOINT}warm`);
  return null;
};

export default function useOllieWarm({ enabled }: { enabled: boolean }) {
  useQuery({
    queryKey: ["ollie-warm"],
    queryFn: warmOllie,
    enabled,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
}
