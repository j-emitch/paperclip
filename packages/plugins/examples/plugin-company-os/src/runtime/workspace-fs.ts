/**
 * Containment-checked filesystem primitives — the ONE audited implementation of
 * "read a workspace-relative path without escaping the repo root". Both the
 * collection adapter (`makeCollectionContext`, which walks globs to index docs)
 * and the live docs-viewer (`report-content`, which reads a single selected file)
 * go through these, so the traversal/symlink/oversize defenses live in exactly
 * one place and cannot drift between the two read paths (spec §7 docs-viewer
 * safety + §11 C1).
 *
 * Every function rejects: absolute paths, ANY `..` segment, and a symlink whose
 * realpath escapes the root. Error MESSAGES are part of the contract — the
 * source-layer `readError` classifier (`_shared.ts`) matches on `escapes
 * workspace` / `size cap`, so those phrases must stay stable.
 */

import { readFile, lstat, open, realpath } from "node:fs/promises";
import * as path from "node:path";
import type { WorkspaceFileStat } from "../contracts/collection-context.js";

/** Map a repo's absolute path to its stable key (the directory basename). */
export function repoKey(absPath: string): string {
  return path.basename(absPath.replace(/\/+$/, ""));
}

/** Build the repo-key → absolute-path map the readers resolve against (sources never see paths). */
export function absByKeyFromRoots(roots: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const root of roots) map.set(repoKey(root), root);
  return map;
}

/**
 * Resolve a requested relative path within a root, rejecting traversal escapes.
 * Returns the absolute path on success, or null when the request is unsafe
 * (absolute, contains a `..` segment, or normalizes outside the root).
 */
export function containedResolve(root: string, relPath: string): string | null {
  if (path.isAbsolute(relPath)) return null;
  // Reject ANY `..` segment outright (even one that would normalize back under
  // root, e.g. `specs/../CONTEXT.md`) — the contract forbids `..` in reads.
  if (relPath.split(/[\\/]/).some((seg) => seg === "..")) return null;
  const resolved = path.resolve(root, relPath);
  const rel = path.relative(root, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

/** Realpath-check that `abs` stays under `root` (follows symlinks). Null = escapes/absent. */
export async function realpathContained(root: string, abs: string): Promise<string | null> {
  try {
    const real = await realpath(abs);
    const realRoot = await realpath(root);
    const rel = path.relative(realRoot, real);
    return rel.startsWith("..") || path.isAbsolute(rel) ? null : real;
  } catch {
    return null;
  }
}

/** Result of a contained read: the UTF-8 content plus the workspace-relative stat. */
export interface ContainedReadResult {
  readonly content: string;
  readonly stat: WorkspaceFileStat;
}

/**
 * Read a UTF-8 file by workspace-relative path, rejecting traversal/symlink/
 * oversize. Throws with a `escapes workspace` / `size cap` message (the
 * classifier contract) rather than returning a sentinel, mirroring the prior
 * inline `readText`. `maxBytes` is the hard cap (checked BEFORE the read).
 */
export async function readContainedText(
  root: string,
  relPath: string,
  maxBytes: number,
): Promise<ContainedReadResult> {
  const abs = containedResolve(root, relPath);
  if (!abs) throw new Error(`path escapes workspace: ${relPath}`);
  const real = await realpathContained(root, abs);
  if (real === null) throw new Error(`path escapes workspace: ${relPath}`);
  const st = await lstat(real);
  if (st.size > maxBytes) throw new Error(`file exceeds size cap (${st.size} > ${maxBytes})`);
  const content = await readFile(real, "utf-8");
  return {
    content,
    // The stat describes the resolved TARGET (`real`) — what was actually read —
    // so `isSymlink` is always false here. `statContained` lstat's the requested
    // path instead and reports link-ness truthfully; both are internal-only
    // (the docs-viewer payload carries no isSymlink field), so the asymmetry is
    // intentional and harmless. `relPath` is always the caller's input string,
    // never an absolute host path.
    stat: {
      relPath: relPath.replace(/\\/g, "/"),
      sizeBytes: st.size,
      mtime: st.mtime.toISOString(),
      isSymlink: st.isSymbolicLink(),
    },
  };
}

/**
 * Read only the FIRST `maxBytes` of a workspace-relative file (containment-checked),
 * TRUNCATING rather than throwing on an oversize file. The docs INDEX scans only
 * the frontmatter head (≤4 KB) across hundreds of files, so this never pulls a
 * whole body — `readContainedText` (whole-file, throw-on-oversize) is the body
 * read. Same traversal/symlink defenses; `stat.sizeBytes` is the FULL file size.
 */
export async function readContainedTextHead(
  root: string,
  relPath: string,
  maxBytes: number,
): Promise<ContainedReadResult> {
  const abs = containedResolve(root, relPath);
  if (!abs) throw new Error(`path escapes workspace: ${relPath}`);
  const real = await realpathContained(root, abs);
  if (real === null) throw new Error(`path escapes workspace: ${relPath}`);
  const st = await lstat(real);
  const fh = await open(real, "r");
  try {
    const len = Math.max(0, Math.min(maxBytes, st.size));
    const buf = Buffer.alloc(len);
    const { bytesRead } = len > 0 ? await fh.read(buf, 0, len, 0) : { bytesRead: 0 };
    return {
      content: buf.subarray(0, bytesRead).toString("utf-8"),
      stat: {
        relPath: relPath.replace(/\\/g, "/"),
        sizeBytes: st.size,
        mtime: st.mtime.toISOString(),
        isSymlink: st.isSymbolicLink(),
      },
    };
  } finally {
    await fh.close();
  }
}

/** Stat a workspace-relative path (containment-checked); null when absent or escaping. */
export async function statContained(root: string, relPath: string): Promise<WorkspaceFileStat | null> {
  const abs = containedResolve(root, relPath);
  if (!abs) return null;
  // A symlink whose target escapes the root must not be reported (mirror readContainedText).
  if ((await realpathContained(root, abs)) === null) return null;
  try {
    const st = await lstat(abs);
    return {
      relPath: relPath.replace(/\\/g, "/"),
      sizeBytes: st.size,
      mtime: st.mtime.toISOString(),
      isSymlink: st.isSymbolicLink(),
    };
  } catch {
    return null;
  }
}
