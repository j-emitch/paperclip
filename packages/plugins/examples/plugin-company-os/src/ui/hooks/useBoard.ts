/**
 * `useBoard` — the board's single data seam. Reads the worker's `board-state`
 * handler via the SDK bridge. The worker is the validation gate: `readBoardState`
 * already `safeParse`s the cache row against `boardStateV1Schema` and returns
 * `null` for a malformed or stale-version snapshot, so the UI can trust the
 * contract type and re-derive on null — no zod in the browser bundle, and the
 * import boundary stays clean (this module imports a contract TYPE + a data hook
 * only). This is the ONLY board module that touches the SDK runtime.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { BoardStateV1 } from "../../contracts/index.js";

export interface UseBoardResult {
  board: BoardStateV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useBoard(companyId: string | null): UseBoardResult {
  const { data, loading, error, refresh } = usePluginData<BoardStateV1>("board-state", {
    companyId: companyId ?? "",
  });
  return { board: data, loading, error, refresh };
}
