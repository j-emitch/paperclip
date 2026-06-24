/**
 * `useArtifactIndex` — the Reports tab's data seam. Reads the worker's
 * `artifact-index` handler, which `safeParse`s the cached `cos_artifact_index`
 * and returns null for a malformed/stale-version row, so the UI trusts the
 * contract type. Type-only contract import keeps the browser bundle zod-free
 * (the import-boundary the board hardened).
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { ArtifactIndexV1 } from "../../contracts/index.js";

export interface UseArtifactIndexResult {
  index: ArtifactIndexV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useArtifactIndex(companyId: string | null): UseArtifactIndexResult {
  const { data, loading, error, refresh } = usePluginData<ArtifactIndexV1>("artifact-index", {
    companyId: companyId ?? "",
  });
  return { index: data, loading, error, refresh };
}
