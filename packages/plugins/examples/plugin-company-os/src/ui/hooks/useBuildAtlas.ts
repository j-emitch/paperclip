/**
 * `useBuildAtlas` — the Build Atlas data seam (COS-5). Reads the worker's
 * `build-atlas` handler (validated, version-gated cache row). Type-only contract
 * import keeps the browser bundle zod-free.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { BuildAtlasV1 } from "../../contracts/index.js";

export interface UseBuildAtlasResult {
  buildAtlas: BuildAtlasV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useBuildAtlas(companyId: string | null): UseBuildAtlasResult {
  const { data, loading, error, refresh } = usePluginData<BuildAtlasV1>("build-atlas", {
    companyId: companyId ?? "",
  });
  return { buildAtlas: data, loading, error, refresh };
}
