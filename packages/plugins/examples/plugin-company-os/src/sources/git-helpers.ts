/**
 * Git-command knowledge shared by `GitWorkSource` (the Shipped trunk scan) and
 * `BranchSource` (trunk resolution → `TrunkRef`) — extracted so the trunk
 * candidate ladder lives in ONE place (PF-3b). `parseWorktreeList` already lives
 * in `parse.ts` (the pure-parse module); it is re-exported here so both git
 * sources import their worktree + trunk helpers from a single surface.
 */

export { parseWorktreeList, type Worktree } from "./parse.js";

/**
 * Trunk refs probed in order — the first that exists wins (shared by both git
 * sources). `origin/main` first so a fetched remote trunk is preferred over a
 * possibly-stale local `main`.
 */
export const TRUNK_CANDIDATES = ["origin/main", "main", "lycaon", "master"] as const;
