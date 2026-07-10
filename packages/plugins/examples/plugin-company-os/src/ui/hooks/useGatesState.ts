/**
 * `useGatesState` — the Gates band data seam (COS-11). Reads the worker's
 * `gates-state` handler (validated, version-gated cache row). Type-only
 * contract import keeps the browser bundle zod-free, mirroring
 * `useWorktreeBoard` / `useGitState`.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { GatesStateV1 } from "../../contracts/gates-state.js";

export interface UseGatesStateResult {
  gates: GatesStateV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useGatesState(companyId: string | null): UseGatesStateResult {
  const { data, loading, error, refresh } = usePluginData<GatesStateV1>("gates-state", {
    companyId: companyId ?? "",
  });
  return { gates: data, loading, error, refresh };
}
