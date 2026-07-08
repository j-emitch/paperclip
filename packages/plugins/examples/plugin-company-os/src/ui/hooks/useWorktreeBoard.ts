/**
 * `useWorktreeBoard` — the Worktrees lens data seam (COS-8c). Reads the
 * worker's `worktree-board` handler (validated, version-gated cache row).
 * Type-only contract import keeps the browser bundle zod-free, mirroring
 * `useDocIndex` / `useGitState`. Mount only while the lens is active.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { WorktreeBoardV1 } from "../../contracts/worktree-board.js";

export interface UseWorktreeBoardResult {
  board: WorktreeBoardV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useWorktreeBoard(companyId: string | null): UseWorktreeBoardResult {
  const { data, loading, error, refresh } = usePluginData<WorktreeBoardV1>("worktree-board", {
    companyId: companyId ?? "",
  });
  return { board: data, loading, error, refresh };
}
