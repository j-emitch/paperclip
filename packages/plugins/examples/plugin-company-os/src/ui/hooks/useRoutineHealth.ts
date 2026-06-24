/**
 * `useRoutineHealth` — the Routines tab's data seam. Reads the worker's
 * `routine-health` handler (validated, version-gated cache row). Type-only
 * contract import keeps the browser bundle zod-free.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { RoutineHealthV1 } from "../../contracts/index.js";

export interface UseRoutineHealthResult {
  health: RoutineHealthV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useRoutineHealth(companyId: string | null): UseRoutineHealthResult {
  const { data, loading, error, refresh } = usePluginData<RoutineHealthV1>("routine-health", {
    companyId: companyId ?? "",
  });
  return { health: data, loading, error, refresh };
}
