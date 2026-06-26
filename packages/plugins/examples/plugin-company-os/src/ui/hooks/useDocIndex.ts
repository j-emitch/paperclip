/**
 * `useDocIndex` — the Docs tab's tree data seam. Reads the worker's `doc-index`
 * handler (validated, version-gated cache row — the worktree-aware project→type→doc
 * tree `deriveDocIndex` folds). Type-only contract import keeps the browser bundle
 * zod-free, mirroring `useOrientation` / `useGitState`.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { DocIndexV1 } from "../../contracts/index.js";

export interface UseDocIndexResult {
  docIndex: DocIndexV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useDocIndex(companyId: string | null): UseDocIndexResult {
  const { data, loading, error, refresh } = usePluginData<DocIndexV1>("doc-index", {
    companyId: companyId ?? "",
  });
  return { docIndex: data, loading, error, refresh };
}
