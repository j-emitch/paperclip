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
import { open, readdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { readContainedText, readContainedTextHead, statContained } from "./workspace-fs.js";
import { buildCheckoutKeyMap } from "./checkout-keys.js";

import type {
  AllowlistedLogKey,
  AllowlistedLogReader,
  AllowlistedTailResult,
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
import type { LineageData, LineageLoadResult, LineageLoader } from "../contracts/lineage.js";
import type { SignalError } from "../contracts/signals.js";
import type { SkillOrigin, SkillRootRef } from "../contracts/skills-catalog.js";
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

/** An extra, out-of-workspace read-root scanned for skills (design skills or a plugin cache). */
export interface SkillRootInput {
  /** Stable read-KEY (namespaced to avoid colliding with a repo key). */
  readonly key: string;
  /** Absolute directory the key resolves to (containment-checked on read). */
  readonly absPath: string;
  /** "company" (e.g. `~/.agents/skills` design) or "plugins" (a plugin cache). */
  readonly origin: SkillOrigin;
  /** Fixed collection for every skill under this root; null = derive per-skill. */
  readonly collection: string | null;
}

/** Inputs the worker resolves before constructing the context. */
export interface AdapterDeps {
  /** Absolute paths to the product repos (instanceConfigSchema.repoRoots). */
  readonly repoRoots: readonly string[];
  /**
   * Optional extra read-roots for installed-plugin skills (COS-1h). Each is merged
   * into the read-key map (so `fs.list`/`readTextHead` resolve it) and surfaced as
   * a `ctx.skillRoots` key — but NOT added to `ctx.repos`/`ctx.worktrees`, so only
   * `SkillsSource` reads them; every other source ignores them.
   */
  readonly skillRoots?: readonly SkillRootInput[];
  /** Scoped collect (a single repo key) or null for a full sweep. */
  readonly scopeRepo: string | null;
  readonly logger: SignalLogger;
  /** Injectable clock (defaults to wall clock). */
  readonly clock?: Clock;
  /** Hard-timeout cancellation for the whole derive. */
  readonly signal?: AbortSignal;
  readonly options?: AdapterOptions;
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

  // repo key → absolute path, PLUS worktree pseudo-keys (kept HERE; sources see
  // keys only). The shared builder also dedups dup-basename roots (PF-7) and
  // enumerates each repo's non-primary worktrees (PF-8), so collection-time and
  // render-time (`doc-content`) resolve the identical `absByKey`.
  const checkoutKeys = await buildCheckoutKeyMap(deps.repoRoots);
  const absByKey = checkoutKeys.absByKey;
  // Merge the optional plugin skill roots into the read-key map so `fs` can list +
  // read them (contained), WITHOUT adding them to `repos`/`worktrees` — only
  // `SkillsSource` consumes `ctx.skillRoots`; every other source stays unaffected.
  // A skill-root key that collides with an existing repo/worktree key is skipped
  // (the workspace always wins) and logged, so a stray config can't shadow a repo.
  const skillRootRefs: SkillRootRef[] = [];
  for (const root of deps.skillRoots ?? []) {
    if (absByKey.has(root.key)) {
      logger.warn("skill root key collides with an existing read key — skipped", { key: root.key });
      continue;
    }
    absByKey.set(root.key, root.absPath);
    skillRootRefs.push({ key: root.key, origin: root.origin, collection: root.collection });
  }
  const repos: RepoRoot[] = await Promise.all(
    checkoutKeys.mainRoots.map(async ({ repoKey: key, absPath }) => ({
      repo: key,
      available: await isGitRepo(absPath),
    })),
  );

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
  // The guardrails allowlist covers MAIN repo roots only — never worktree
  // checkout keys or skill roots (CodeRabbit COS-11: passing the full read-key
  // map widened the §3.3b repo_guardrails domain beyond configured repos).
  const mainRootAbsByKey = new Map(checkoutKeys.mainRoots.map((r) => [r.repoKey, r.absPath]));
  const logs: AllowlistedLogReader = makeAllowlistedLogReader(mainRootAbsByKey, logger);
  const hash: ContentHasher = (input) => createHash("sha256").update(input).digest("hex");
  const registry: RegistryLoader = makeRegistryLoader(absByKey, logger);
  const lineage: LineageLoader = makeLineageLoader(absByKey, logger);

  return {
    repos,
    worktrees: checkoutKeys.worktrees,
    skillRoots: skillRootRefs,
    scopeRepo: deps.scopeRepo,
    git,
    gh,
    fs,
    logs,
    clock,
    logger,
    registry,
    lineage,
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

  return {
    async list(repo, globs, listOpts) {
      const root = rootFor(repo);
      if (!root) return [];
      const out: WorkspaceFileStat[] = [];
      // Prune the walk to the literal top-level dirs the globs can reach (huge
      // win vs walking a whole repo for `specs/**`); "*" means a glob could
      // touch any root, so fall back to a full walk.
      const roots = globRootDirs(globs);
      // Per-call walk-time excludes (e.g. `.claude/worktrees`, `docs/review`) —
      // pruned at traversal so a recursive glob never descends into them (PF-8).
      const exclude = new Set(listOpts?.exclude ?? []);
      await walk(root, "", globs, opts, out, logger, roots.has("*") ? null : roots, exclude);
      out.sort((a, b) => a.relPath.localeCompare(b.relPath));
      return out;
    },

    async readText(repo, relPath) {
      const root = rootFor(repo);
      if (!root) throw new Error(`unknown repo ${repo}`);
      // Single audited containment path (traversal/symlink/oversize) — see workspace-fs.
      const { content } = await readContainedText(root, relPath, opts.maxFileBytes);
      return content;
    },

    async readTextHead(repo, relPath, maxBytes) {
      const root = rootFor(repo);
      if (!root) throw new Error(`unknown repo ${repo}`);
      const { content } = await readContainedTextHead(root, relPath, maxBytes);
      return content;
    },

    stat(repo, relPath) {
      const root = rootFor(repo);
      if (!root) return Promise.resolve(null);
      return statContained(root, relPath);
    },
  };
}

/**
 * Recursively collect files matching any glob, pruning ignored + escaping dirs.
 * `topLevelRoots`, when non-null, limits the FIRST level to those directory
 * names (the glob-root optimization); null = walk every top-level dir.
 * `excludePaths` prunes a directory at traversal when its rel path OR its name
 * is in the set (the per-call walk-time exclude — `.claude/worktrees` etc.).
 */
async function walk(
  root: string,
  relDir: string,
  globs: readonly string[],
  opts: Required<AdapterOptions>,
  out: WorkspaceFileStat[],
  logger: SignalLogger,
  topLevelRoots: ReadonlySet<string> | null,
  excludePaths: ReadonlySet<string>,
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
      if (excludePaths.has(rel) || excludePaths.has(entry.name)) continue; // walk-time exclude prune (PF-8)
      if (relDir === "" && topLevelRoots && !topLevelRoots.has(entry.name)) continue; // glob-root prune
      await walk(root, rel, globs, opts, out, logger, topLevelRoots, excludePaths);
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
// Allowlisted out-of-repo log reader (COS-11 T0 — spec §3.3b)
// ---------------------------------------------------------------------------

/**
 * Resolve an `AllowlistedLogKey` to its ONE sanctioned absolute path. This map
 * is the entire out-of-repo read surface: enum-addressed here, never exposed as
 * a free path to any source. `homeRoot` is injectable for tests.
 */
export function allowlistedLogPath(key: AllowlistedLogKey, absByKey: ReadonlyMap<string, string>, homeRoot: string): string | null {
  switch (key.log) {
    case "codex_invocations":
      return path.join(homeRoot, ".claude", "logs", "codex-invocations.ndjson");
    case "cannons_runs":
      return path.join(homeRoot, ".claude", "logs", "cannons-runs.log");
    case "repo_guardrails": {
      const repoAbs = absByKey.get(key.repoKey);
      return repoAbs ? path.join(repoAbs, ".claude", "logs", "guardrails.ndjson") : null;
    }
  }
}

/**
 * Bounded tail read: at most the LAST `maxBytes` of the file. Truncation is an
 * EXPECTED state (logs grow forever and retention-prune) — the result flags it
 * and the text may begin mid-line; consumers drop the first partial line.
 * Absence (ENOENT) returns null (NORMAL); a PRESENT-but-unreadable log
 * (perm/IO/symlink) returns `unreadable: true` so consumers degrade instead of
 * rendering a fake empty (never throws either way).
 */
export async function readTailBounded(absPath: string, maxBytes: number, logger: SignalLogger): Promise<AllowlistedTailResult | null> {
  // An unreadable-but-present log is NOT absence (codex COS-11 P1): perm/IO
  // errors and symlinks (never followed — the allowlist is by PATH, and a
  // symlink would widen it to its target) surface as `unreadable: true`.
  const unreadable: AllowlistedTailResult = {
    text: "",
    truncated: false,
    mtime: new Date(0).toISOString(),
    sizeBytes: 0,
    unreadable: true,
  };
  try {
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) {
      logger.warn("allowlisted log is a symlink — refused (allowlist is by literal path)", { absPath });
      return unreadable;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; // absent — normal
    logger.warn("allowlisted log lstat failed", { absPath, error: String(e) });
    return unreadable;
  }
  let fh;
  try {
    fh = await open(absPath, "r");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; // raced away — absent
    logger.warn("allowlisted log open failed (exists but unreadable)", { absPath, error: String(e) });
    return unreadable;
  }
  try {
    const st = await fh.stat();
    const size = st.size;
    const readBytes = Math.min(size, Math.max(0, maxBytes));
    const start = size - readBytes;
    const buf = Buffer.alloc(readBytes);
    const { bytesRead } = await fh.read(buf, 0, readBytes, start);
    return {
      // Decode only what was actually read — a short read must not append NULs.
      text: buf.subarray(0, bytesRead).toString("utf8"),
      truncated: size > maxBytes,
      mtime: st.mtime.toISOString(),
      sizeBytes: size,
    };
  } catch (e) {
    logger.warn("allowlisted tail read failed (exists but unreadable)", { absPath, error: String(e) });
    return unreadable;
  } finally {
    await fh.close().catch(() => {});
  }
}

function makeAllowlistedLogReader(absByKey: ReadonlyMap<string, string>, logger: SignalLogger): AllowlistedLogReader {
  const home = homedir();
  return {
    async readAllowlistedTail(key, maxBytes) {
      const abs = allowlistedLogPath(key, absByKey, home);
      if (!abs) return null; // unknown repoKey — normal (a repo without a root)
      return readTailBounded(abs, maxBytes, logger);
    },
  };
}

// ---------------------------------------------------------------------------
// Registry loader — the SINGLE canonical parser (company/config/lib/prefix-registry.mjs)
// ---------------------------------------------------------------------------

/** Shape of the canonical parser module we dynamic-import (a subset we rely on). */
interface PrefixRegistryModule {
  loadRegistry?: (jsonPath?: string) => RegistryEntry[] | Promise<RegistryEntry[]>;
}

/**
 * The host-path-free `detail` a prefix-registry `RegistryLoadError` carries, if
 * present. `prefix-registry.mjs` deliberately keeps the absolute path in
 * `.message`/logs only and runs `.detail` through `redactHomePaths`, so this is
 * safe to surface in the UI. Falls back to the generic message for any other
 * throw (plain Error, string, etc.).
 */
function registryErrorDetail(e: unknown): string {
  if (e !== null && typeof e === "object" && "detail" in e) {
    const detail = (e as { detail: unknown }).detail;
    if (typeof detail === "string" && detail.length > 0) return detail;
  }
  return "registry load failed (see logs)";
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
        return { entries: [], errors: [err("parse_error", registryErrorDetail(e))] };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Lineage loader — the SINGLE canonical parser (company/config/lib/build-atlas-lineage.mjs)
// ---------------------------------------------------------------------------

/** Shape of the canonical lineage parser module we dynamic-import (subset we rely on). */
interface BuildAtlasLineageModule {
  loadLineage?: (jsonPath?: string) => LineageData | Promise<LineageData>;
}

function makeLineageLoader(absByKey: Map<string, string>, logger: SignalLogger): LineageLoader {
  return {
    async load(): Promise<LineageLoadResult> {
      const companyRoot = absByKey.get("company");
      if (!companyRoot) {
        return { data: null, errors: [err("not_found", "company repo root not configured")] };
      }
      const parserPath = path.join(companyRoot, "config", "lib", "build-atlas-lineage.mjs");
      try {
        const mod: BuildAtlasLineageModule = await import(pathToFileURL(parserPath).href);
        if (typeof mod.loadLineage !== "function") {
          return { data: null, errors: [err("parse_error", "build-atlas-lineage.mjs has no loadLineage export")] };
        }
        const jsonPath = path.join(companyRoot, "config", "build-atlas-lineage.json");
        const data = await mod.loadLineage(jsonPath);
        if (!data || !Array.isArray(data.laneGroups) || !Array.isArray(data.edges)) {
          return { data: null, errors: [err("parse_error", "loadLineage did not return { laneGroups[], edges[] }")] };
        }
        return { data, errors: [] };
      } catch (e) {
        // Keep the absolute parserPath + raw error in the logs only.
        logger.warn("lineage load failed", { parserPath, error: String(e) });
        return { data: null, errors: [err("parse_error", "lineage load failed (see logs)")] };
      }
    },
  };
}

function err(code: SignalError["code"], message: string): SignalError {
  return { code, message, degraded: true };
}
