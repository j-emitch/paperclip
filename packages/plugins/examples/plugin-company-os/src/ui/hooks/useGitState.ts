/**
 * `useGitState` — the Source tab's data seam. Reads the worker's `git-state`
 * handler (validated, version-gated cache row — the project-grouped branch/worktree
 * tree `deriveGitState` folds). Type-only contract import keeps the browser bundle
 * zod-free, mirroring `useOrientation` / `useRoutineHealth`.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { GitStateV1 } from "../../contracts/index.js";

export interface UseGitStateResult {
  gitState: GitStateV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useGitState(companyId: string | null): UseGitStateResult {
  const { data, loading, error, refresh } = usePluginData<GitStateV1>("git-state", {
    companyId: companyId ?? "",
  });
  return { gitState: data, loading, error, refresh };
}
