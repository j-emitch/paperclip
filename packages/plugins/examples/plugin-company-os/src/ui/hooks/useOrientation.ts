/**
 * `useOrientation` — the Home (default landing) data seam. Reads the worker's
 * `orientation` handler (validated, version-gated cache row — the digest the
 * `deriveOrientation` projection folds). Type-only contract import keeps the
 * browser bundle zod-free, mirroring `useRoutineHealth` / `useArtifactIndex`.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { OrientationV1 } from "../../contracts/index.js";

export interface UseOrientationResult {
  orientation: OrientationV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useOrientation(companyId: string | null): UseOrientationResult {
  const { data, loading, error, refresh } = usePluginData<OrientationV1>("orientation", {
    companyId: companyId ?? "",
  });
  return { orientation: data, loading, error, refresh };
}
