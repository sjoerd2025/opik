import { useEffect, useRef } from "react";
import api, { OLLIE_REST_ENDPOINT } from "@/api/api";

export default function useOllieWarm(enabled: boolean) {
  const hasFired = useRef(false);

  useEffect(() => {
    if (enabled && !hasFired.current) {
      hasFired.current = true;
      api.post(`${OLLIE_REST_ENDPOINT}warm`).catch(() => {});
    }
  }, [enabled]);
}
