/**
 * Temporary demo triggers for GEPA optimizer scripts.
 * Exposes window.__runGEPA for browser console usage.
 *
 * AI_REMOVAL_NOTE: This is temporary demo code. To remove, revert the commit
 * titled "[NA] [FE+SDK] feat: temporary demo GEPA trigger from browser console".
 */

import useAppStore from "@/store/AppStore";

const PYTHON_BACKEND_BASE =
  import.meta.env.VITE_PYTHON_BACKEND_URL ??
  `${window.location.protocol}//${window.location.hostname}:8000`;

async function call(path: string, method = "POST") {
  const workspace = useAppStore.getState().activeWorkspaceName || "default";
  const url = `${PYTHON_BACKEND_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify({ workspace }) : undefined,
  });
  const data = await res.json();
  console.log(`[GEPA Demo] ${path}:`, data);
  return data;
}

const __runGEPA = {
  quick: () => call("/v1/private/demo/run/gepa-quick"),
  e2e: () => call("/v1/private/demo/run/gepa-e2e"),
  status: () => call("/v1/private/demo/status", "GET"),
  stop: (key = "gepa-quick") => call(`/v1/private/demo/stop/${key}`),
};

(window as unknown as Record<string, unknown>).__runGEPA = __runGEPA;

console.log(
  "[GEPA Demo] Available: __runGEPA.quick(), __runGEPA.e2e(), __runGEPA.status(), __runGEPA.stop(key)",
);
