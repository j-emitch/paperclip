/**
 * `CollectionContext` — the narrow seam every `WorkSignalSource` collects
 * against (spec §5.1: `collect(ctx: CollectionContext)`).
 *
 * This is the single decoupling that makes the whole pipeline testable and
 * keeps the host out of the sources. A source NEVER imports `child_process`,
 * `node:fs`, the SDK `PluginContext`, or a real clock — it asks this context.
 * COS-0c ships ONE adapter (`makeCollectionContext(ctx)`) that satisfies these
 * interfaces from the SDK runtime + Node; the unit tests ship fixture
 * implementations. The runner interfaces are the entire subprocess + filesystem
 * + time surface, declared here so the rest of the module is side-effect-free.
 *
 * Why the interfaces live in the contracts (not in COS-0c with the impl): the
 * source signatures reference them, the fixture doubles in tests implement
 * them, and the COS-0c adapter implements them — three consumers, one shape.
 */

import type { SignalError } from "./signals.js";
import type { SignalFreshness } from "./vocab.js";

/**
 * A resolved product-repo root, as the SOURCES see it. Deliberately path-free:
 * the runners + reader operate by repo KEY (`run(repo, …)`), so the absolute
 * filesystem path (operator-configured via instanceConfigSchema.repoRoots) lives
 * only in the COS-0c adapter that constructs them — it is never leaked into a
 * source. A source needs exactly two things about a repo: its key and whether
 * it is readable this run.
 */
export interface RepoRoot {
  /** Stable repo key used across signals + the board (e.g. "juice-bar"). */
  readonly repo: string;
  /**
   * False when the path is missing or not a git repo at derive time — that
   * repo's lanes show a stale badge instead of crashing the derive (spec §5.1).
   */
  readonly available: boolean;
}

/** Result of a fixed-argv subprocess. Resolves on non-zero exit; the caller inspects `code`. */
export interface SubprocessResult {
  readonly stdout: string;
  readonly stderr: string;
  /** Exit code; null when killed by a signal/timeout. */
  readonly code: number | null;
  /** True when the process was killed by the hard timeout. */
  readonly timedOut: boolean;
}

/**
 * Runs `git` in a repo with a FIXED argv — no shell, so repo-derived data is
 * never interpolated into a command string (spec §5.1 security rule). Resolves
 * even on git error; only a programming fault rejects.
 */
export interface GitRunner {
  run(repo: string, args: readonly string[]): Promise<SubprocessResult>;
}

/**
 * Runs `gh` with a FIXED argv + backoff. On unauth / rate-limit / no-network it
 * returns a degraded result (`code != 0` or `timedOut`) so the collector can
 * emit a typed stale/error signal rather than throw (spec §6, COS-0c gh spec).
 */
export interface GhRunner {
  run(repo: string, args: readonly string[]): Promise<SubprocessResult>;
}

/** Stat of one workspace file (paths are always workspace-relative — never absolute). */
export interface WorkspaceFileStat {
  readonly relPath: string;
  readonly sizeBytes: number;
  /** ISO-8601 mtime. */
  readonly mtime: string;
  readonly isSymlink: boolean;
}

/**
 * Containment-checked filesystem reads. Every method rejects `..`, absolute
 * paths, and symlink escape (spec §7 docs-viewer safety) — the browser only
 * ever receives workspace-relative paths + content.
 */
export interface WorkspaceReader {
  /** List files under workspace-relative globs within `repo`. */
  list(repo: string, globs: readonly string[]): Promise<readonly WorkspaceFileStat[]>;
  /** Read a UTF-8 file by workspace-relative path; rejects traversal/symlink/oversize. */
  readText(repo: string, relPath: string): Promise<string>;
  /** Stat a workspace-relative path; null when absent. */
  stat(repo: string, relPath: string): Promise<WorkspaceFileStat | null>;
}

/**
 * Injectable clock — every "now" in the pipeline goes through this so derives
 * are deterministic in tests and the self-implemented schedule jitter (spec §6,
 * no host jitter primitive) is testable.
 */
export interface Clock {
  /** Current wall-clock as epoch milliseconds. */
  now(): number;
}

/** Minimal structured logger (the SDK `PluginLogger` satisfies this in COS-0c). */
export interface SignalLogger {
  debug(message: string, meta?: Readonly<Record<string, unknown>>): void;
  info(message: string, meta?: Readonly<Record<string, unknown>>): void;
  warn(message: string, meta?: Readonly<Record<string, unknown>>): void;
  error(message: string, meta?: Readonly<Record<string, unknown>>): void;
}

/** The context handed to every `WorkSignalSource.collect`. */
export interface CollectionContext {
  /** All resolved repo roots (available or not). Sources skip unavailable repos with a stale signal. */
  readonly repos: readonly RepoRoot[];
  /** Scoped collect: null = full sweep; else only this repo key (the hook fast-path). */
  readonly scopeRepo: string | null;
  readonly git: GitRunner;
  readonly gh: GhRunner;
  readonly fs: WorkspaceReader;
  readonly clock: Clock;
  readonly logger: SignalLogger;
  /** Hard-timeout cancellation (spec §6: 60s hard timeout on the full derive). */
  readonly signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Pure helpers — usable by every source, no side effects
// ---------------------------------------------------------------------------

/**
 * The repos a source is RESPONSIBLE for this run — INCLUDING unavailable ones.
 * A full sweep covers every configured repo; a hook fast-path covers just the
 * scoped repo. A source iterates this set and, for an unavailable repo, emits a
 * degraded/stale signal (per the `WorkSignalSource` contract) instead of
 * silently dropping it — that is what keeps an unreadable repo's lane on the
 * board with a stale badge rather than vanishing.
 */
export function reposResponsibleFor(ctx: CollectionContext): readonly RepoRoot[] {
  if (ctx.scopeRepo === null) return ctx.repos;
  return ctx.repos.filter((r) => r.repo === ctx.scopeRepo);
}

/**
 * The subset of responsible repos that are actually READABLE (available) — what
 * a source iterates to do real git/gh/fs reads. The scoped-merge in COS-0d folds
 * the untouched repos back from last-good cache.
 */
export function reposReadableInScope(ctx: CollectionContext): readonly RepoRoot[] {
  return reposResponsibleFor(ctx).filter((r) => r.available);
}

/** True when `repo` is responsible-for AND readable this run. */
export function repoInScope(ctx: CollectionContext, repo: string): boolean {
  return reposReadableInScope(ctx).some((r) => r.repo === repo);
}

/** Look up a configured repo root by key (available or not), or null. */
export function findRepoRoot(ctx: CollectionContext, repo: string): RepoRoot | null {
  return ctx.repos.find((r) => r.repo === repo) ?? null;
}

/** Build a `SignalError` succinctly — keeps source code terse + consistent. */
export function signalError(
  code: SignalError["code"],
  message: string,
  degraded = true,
): SignalError {
  return { code, message, degraded };
}

/** The freshness implied by a set of errors: stale if any degraded, else live. */
export function freshnessFromErrors(errors: readonly SignalError[]): SignalFreshness {
  return errors.some((e) => e.degraded) ? "stale" : "live";
}
