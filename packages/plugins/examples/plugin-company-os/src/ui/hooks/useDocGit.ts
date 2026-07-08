/**
 * `useDocFreshness` / `useDocDiff` — the Docs viewer's git-truth seams
 * (COS-8f T4). Thin `usePluginData` wrappers over the worker's index-gated
 * `doc-git-freshness` / `doc-diff` handlers, mirroring `useDocContent`:
 * type-only contract imports (browser bundle stays zod-free), and mounted only
 * from components that render while a doc is selected — the diff hook lives in
 * a child that mounts when the pane opens, so no diff is computed unseen.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { DocDiffV1, DocFreshnessV1 } from "../../contracts/index.js";

export interface UseDocFreshnessResult {
  freshness: DocFreshnessV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useDocFreshness(companyId: string | null, docId: string): UseDocFreshnessResult {
  const { data, loading, error, refresh } = usePluginData<DocFreshnessV1>("doc-git-freshness", {
    companyId: companyId ?? "",
    docId,
  });
  return { freshness: data, loading, error, refresh };
}

export interface UseDocDiffResult {
  diff: DocDiffV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useDocDiff(companyId: string | null, docId: string): UseDocDiffResult {
  const { data, loading, error, refresh } = usePluginData<DocDiffV1>("doc-diff", {
    companyId: companyId ?? "",
    docId,
  });
  return { diff: data, loading, error, refresh };
}
