/**
 * The COS-0c adapter: the ONLY module that touches Node's process/filesystem
 * surface. It builds a `CollectionContext` (git/gh runners, a containment-checked
 * workspace reader, a SHA-256 hasher, the registry loader, a clock) from the
 * resolved repo roots + scope. Every source + `collect` stays pure and consumes
 * only the interfaces this wires up — which is what keeps the whole pipeline
 * unit-testable with fixture contexts and the import-boundary enforceable.
 *
 * Repo-derived data is NEVER interpolated into a shell string: subprocesses use
 * `execFile` with a fixed argv (no shell), hard timeouts, and a `gh` rate-limit
 * backoff (spec §5.1 security rule + §6 collection mechanism). The repo→absPath
 * map lives here and is never leaked into a source (sources see repo KEYS only).
 */

import { execFile, type ExecFileException } from "node:child_process";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readFile, readdir, lstat, realpath } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  Clock,
  CollectionContext,
  ContentHasher,
  GhRunner,
  GitRunner,
  RepoRoot,
  SignalLogger,
  SubprocessResult,
  WorkspaceFileStat,
  WorkspaceReader,
} from "../contracts/collection-context.js";
import type { RegistryEntry, RegistryLoadResult, RegistryLoader } from "../contracts/registry.js";
import type { SignalError } from "../contracts/signals.js";
import { globRootDirs, matchesAnyGlob } from "../sources/glob.js";

/** Tuning knobs (all overridable for tests / perf). */
export interface AdapterOptions {
  /** Hard timeout for a single `git` invocation. */
  readonly gitTimeoutMs?: number;
  /** Hard timeout for a single `gh` invocation. */
  readonly ghTimeoutMs?: number;
  /** Max retries for a rate-limited `gh` call. */
  readonly ghMaxRetries?: number;
  /** Max bytes read for a single artifact (docs-viewer size cap). */
  readonly maxFileBytes?: number;
  /** Directory names pruned from the workspace walk. */
  readonly ignoreDirs?: readonly string[];
}

const DEFAULTS = {
  gitTimeoutMs: 15_000,
  ghTimeoutMs: 20_000,
  ghMaxRetries: 2,
  maxFileBytes: 2_000_000,
  ignoreDirs: [".git", "node_modules", "dist", ".next", "coverage", ".turbo", "vendor"],
} satisfies Required<AdapterOptions>;

/** Inputs the worker resolves before constructing the context. */
export interface AdapterDeps {
  /** Absolute paths to the product repos (instanceConfigSchema.repoRoots). */
  readonly repoRoots: readonly string[];
  /** Scoped collect (a single repo key) or null for a full sweep. */
  readonly scopeRepo: string | null;
  readonly logger: SignalLogger;
  /** Injectable clock (defaults to wall clock). */
  readonly clock?: Clock;
  /** Hard-timeout cancellation for the whole derive. */
  readonly signal?: AbortSignal;
  readonly options?: AdapterOptions;
}

/** Map a repo's absolute path to its stable key (the directory basename). */
function repoKey(absPath: string): string {
  return path.basename(absPath.replace(/\/+$/, ""));
}

/** Resolve a requested relative path within a root, rejecting traversal escapes. */
function containedResolve(root: string, relPath: string): string | null {
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
async function realpathContained(root: string, abs: string): Promise<string | null> {
  try {
    const real = await realpath(abs);
    const realRoot = await realpath(root);
    const rel = path.relative(realRoot, real);
    return rel.startsWith("..") || path.isAbsolute(rel) ? null : real;
  } catch {
    return null;
  }
}

/** Promisified `execFile` that resolves (never rejects) into a `SubprocessResult`. */
function runProcess(
  cmd: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
): Promise<SubprocessResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
      { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true, signal: abortSignal },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        if (error) {
          const timedOut = error.killed === true || error.signal === "SIGTERM" || error.code === "ABORT_ERR";
          const code = typeof error.code === "number" ? error.code : null;
          resolve({ stdout: stdout ?? "", stderr: stderr || error.message, code: timedOut ? null : code, timedOut });
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code: 0, timedOut: false });
      },
    );
  });
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/**
 * Build the production `CollectionContext`. Resolves which repo roots are
 * available (a directory that is a git repo), wires the runners + reader +
 * hasher + registry loader, and stamps `scopeRepo`.
 */
export async function makeCollectionContext(deps: AdapterDeps): Promise<CollectionContext> {
  const opts = { ...DEFAULTS, ...(deps.options ?? {}) };
  const clock: Clock = deps.clock ?? { now: () => Date.now() };
  const logger = deps.logger;

  // repo key → absolute path (kept HERE; sources only ever see keys).
  const absByKey = new Map<string, string>();
  const repos: RepoRoot[] = [];
  for (const root of deps.repoRoots) {
    const key = repoKey(root);
    absByKey.set(key, root);
    repos.push({ repo: key, available: await isGitRepo(root) });
  }

  const git: GitRunner = {
    run: (repo, args) => {
      const abs = absByKey.get(repo);
      if (!abs) return Promise.resolve({ stdout: "", stderr: `unknown repo ${repo}`, code: null, timedOut: false });
      return runProcess("git", args, abs, opts.gitTimeoutMs, deps.signal);
    },
  };

  const gh: GhRunner = {
    run: async (repo, args) => {
      const abs = absByKey.get(repo);
      if (!abs) return { stdout: "", stderr: `unknown repo ${repo}`, code: null, timedOut: false };
      let result = await runProcess("gh", args, abs, opts.ghTimeoutMs, deps.signal);
      // Backoff on rate-limit (NOT on unauth — that won't fix itself; degrade fast).
      for (let attempt = 0; attempt < opts.ghMaxRetries && isRateLimited(result); attempt++) {
        await sleep(1000 * (attempt + 1), deps.signal);
        result = await runProcess("gh", args, abs, opts.ghTimeoutMs, deps.signal);
      }
      return result;
    },
  };

  const fs: WorkspaceReader = makeWorkspaceReader(absByKey, opts, logger);
  const hash: ContentHasher = (input) => createHash("sha256").update(input).digest("hex");
  const registry: RegistryLoader = makeRegistryLoader(absByKey, logger);

  return {
    repos,
    scopeRepo: deps.scopeRepo,
    git,
    gh,
    fs,
    clock,
    logger,
    registry,
    hash,
    signal: deps.signal,
  };
}

function isRateLimited(result: SubprocessResult): boolean {
  return result.code !== 0 && /rate limit|api rate/i.test(result.stderr);
}

async function isGitRepo(absPath: string): Promise<boolean> {
  try {
    await lstat(path.join(absPath, ".git")); // a `.git` dir OR a worktree `.git` file
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Workspace reader (containment-checked)
// ---------------------------------------------------------------------------

function makeWorkspaceReader(
  absByKey: Map<string, string>,
  opts: Required<AdapterOptions>,
  logger: SignalLogger,
): WorkspaceReader {
  const rootFor = (repo: string): string | null => absByKey.get(repo) ?? null;

  async function statRel(root: string, relPath: string): Promise<WorkspaceFileStat | null> {
    const abs = containedResolve(root, relPath);
    if (!abs) return null;
    // A symlink whose target escapes the root must not be reported (mirror readText).
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

  return {
    async list(repo, globs) {
      const root = rootFor(repo);
      if (!root) return [];
      const out: WorkspaceFileStat[] = [];
      // Prune the walk to the literal top-level dirs the globs can reach (huge
      // win vs walking a whole repo for `specs/**`); "*" means a glob could
      // touch any root, so fall back to a full walk.
      const roots = globRootDirs(globs);
      await walk(root, "", globs, opts, out, logger, roots.has("*") ? null : roots);
      out.sort((a, b) => a.relPath.localeCompare(b.relPath));
      return out;
    },

    async readText(repo, relPath) {
      const root = rootFor(repo);
      if (!root) throw new Error(`unknown repo ${repo}`);
      const abs = containedResolve(root, relPath);
      if (!abs) throw new Error(`path escapes workspace: ${relPath}`);
      // Reject a symlink that escapes the root (containment under realpath).
      const real = await realpathContained(root, abs);
      if (real === null) throw new Error(`path escapes workspace: ${relPath}`);
      const st = await lstat(real);
      if (st.size > opts.maxFileBytes) throw new Error(`file exceeds size cap (${st.size} > ${opts.maxFileBytes})`);
      return readFile(real, "utf-8");
    },

    stat(repo, relPath) {
      const root = rootFor(repo);
      if (!root) return Promise.resolve(null);
      return statRel(root, relPath);
    },
  };
}

/**
 * Recursively collect files matching any glob, pruning ignored + escaping dirs.
 * `topLevelRoots`, when non-null, limits the FIRST level to those directory
 * names (the glob-root optimization); null = walk every top-level dir.
 */
async function walk(
  root: string,
  relDir: string,
  globs: readonly string[],
  opts: Required<AdapterOptions>,
  out: WorkspaceFileStat[],
  logger: SignalLogger,
  topLevelRoots: ReadonlySet<string> | null,
): Promise<void> {
  const absDir = path.join(root, relDir);
  let entries: Dirent<string>[];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (err) {
    logger.debug?.("workspace walk: unreadable dir", { absDir, error: String(err) });
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks during the walk
    const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (opts.ignoreDirs.includes(entry.name)) continue;
      if (relDir === "" && topLevelRoots && !topLevelRoots.has(entry.name)) continue; // glob-root prune
      await walk(root, rel, globs, opts, out, logger, topLevelRoots);
    } else if (entry.isFile() && matchesAnyGlob(rel, globs)) {
      try {
        const st = await lstat(path.join(root, rel));
        out.push({ relPath: rel, sizeBytes: st.size, mtime: st.mtime.toISOString(), isSymlink: false });
      } catch {
        /* race: file vanished mid-walk — skip */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Registry loader — the SINGLE canonical parser (company/config/lib/prefix-registry.mjs)
// ---------------------------------------------------------------------------

/** Shape of the canonical parser module we dynamic-import (a subset we rely on). */
interface PrefixRegistryModule {
  loadRegistry?: (jsonPath?: string) => RegistryEntry[] | Promise<RegistryEntry[]>;
}

function makeRegistryLoader(absByKey: Map<string, string>, logger: SignalLogger): RegistryLoader {
  return {
    async load(): Promise<RegistryLoadResult> {
      const companyRoot = absByKey.get("company");
      if (!companyRoot) {
        return { entries: [], errors: [err("not_found", "company repo root not configured")] };
      }
      const parserPath = path.join(companyRoot, "config", "lib", "prefix-registry.mjs");
      try {
        const mod: PrefixRegistryModule = await import(pathToFileURL(parserPath).href);
        if (typeof mod.loadRegistry !== "function") {
          return { entries: [], errors: [err("parse_error", "prefix-registry.mjs has no loadRegistry export")] };
        }
        const jsonPath = path.join(companyRoot, "config", "prefix-registry.json");
        const entries = await mod.loadRegistry(jsonPath);
        if (!Array.isArray(entries)) {
          return { entries: [], errors: [err("parse_error", "loadRegistry did not return an array")] };
        }
        return { entries, errors: [] };
      } catch (e) {
        // Keep the absolute parserPath + raw error in the logs only — the
        // UI-facing signal stays host-path-free.
        logger.warn("registry load failed", { parserPath, error: String(e) });
        return { entries: [], errors: [err("parse_error", "registry load failed (see logs)")] };
      }
    },
  };
}

function err(code: SignalError["code"], message: string): SignalError {
  return { code, message, degraded: true };
}
