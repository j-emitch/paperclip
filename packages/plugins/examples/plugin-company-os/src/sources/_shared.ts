/**
 * Shared collection scaffolding for the sources. Centralizes the load-bearing
 * `WorkSignalSource` contract — "MUST NOT throw on a read failure; degrade to a
 * stale `RepoFreshness` instead" — in ONE place so every source inherits it
 * uniformly and an unavailable/failing repo never blanks the board.
 */

import {
  reposResponsibleFor,
  signalError,
  type CollectionContext,
  type RepoRoot,
} from "../contracts/collection-context.js";
import type { SignalBatch, RepoFreshness } from "../contracts/WorkSignalSource.js";
import type { Signal, SignalError } from "../contracts/signals.js";

/** ISO-8601 of the injected clock's current time. */
export function nowIso(ctx: CollectionContext): string {
  return new Date(ctx.clock.now()).toISOString();
}

/** What a per-repo reader returns: the signals it produced + any non-fatal errors. */
export interface RepoReadResult {
  readonly signals: readonly Signal[];
  readonly errors?: readonly SignalError[];
}

/** A reader for one available repo. It SHOULD record errors, not throw. */
export type RepoReader = (repo: RepoRoot, ctx: CollectionContext) => Promise<RepoReadResult>;

/**
 * Run `read` over every repo this source is responsible for this run, assembling
 * a `SignalBatch`. Unavailable repos contribute a stale `RepoFreshness`
 * (`repo_unavailable`) and no signals; a reader that records degraded errors —
 * or throws (a programming-fault backstop) — also yields stale freshness. The
 * batch is always produced; this never rejects.
 */
export async function collectPerRepo(
  sourceId: string,
  ctx: CollectionContext,
  read: RepoReader,
): Promise<SignalBatch> {
  const collectedAt = ctx.clock.now();
  const signals: Signal[] = [];
  const repoFreshness: RepoFreshness[] = [];

  for (const repo of reposResponsibleFor(ctx)) {
    if (!repo.available) {
      repoFreshness.push({
        repo: repo.repo,
        freshness: "stale",
        lastOkAt: null,
        errors: [signalError("repo_unavailable", `repo ${repo.repo} is not available this run`)],
      });
      continue;
    }
    try {
      const { signals: produced, errors = [] } = await read(repo, ctx);
      signals.push(...produced);
      const degraded = errors.some((e) => e.degraded);
      repoFreshness.push({
        repo: repo.repo,
        freshness: degraded ? "stale" : "live",
        lastOkAt: degraded ? null : nowIso(ctx),
        errors,
      });
    } catch (err) {
      // The contract forbids throwing; this is a backstop for a programming
      // fault inside a reader. Degrade the repo, keep the rest of the board.
      ctx.logger.error(`${sourceId}: reader threw for ${repo.repo}`, { error: String(err) });
      repoFreshness.push({
        repo: repo.repo,
        freshness: "stale",
        lastOkAt: null,
        errors: [signalError("subprocess_failed", `reader threw: ${String(err)}`)],
      });
    }
  }

  return { source: sourceId, collectedAt, signals, repoFreshness };
}

/**
 * Classify a workspace-read failure into a DEGRADED `SignalError`. A file that
 * `fs.list` just returned but `readText` then rejects is a real read failure
 * (containment violation, oversize, vanished, permission) — it MUST stale the
 * repo, not pass as live (the source no-throw/degrade contract). The message is
 * sanitized to the workspace-relative path only; the raw error (which may embed
 * an absolute host path) goes nowhere near the UI-facing signal.
 */
export function readError(relPath: string, err: unknown): SignalError {
  const raw = String(err);
  if (/escapes workspace|outside workspace/.test(raw)) {
    return signalError("containment_violation", `path escapes workspace: ${relPath}`);
  }
  if (/size cap/.test(raw)) {
    return signalError("oversize", `file exceeds size cap: ${relPath}`);
  }
  return signalError("not_found", `unreadable file: ${relPath}`);
}

/** Classify a subprocess result into an optional `SignalError` (null = clean exit). */
export function errorFromSubprocess(
  result: { code: number | null; timedOut: boolean; stderr: string },
  toolName: string,
): SignalError | null {
  if (result.timedOut) {
    return signalError("subprocess_timeout", `${toolName} timed out`);
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim().split(/\r?\n/)[0] ?? "";
    // gh's auth/rate-limit failures get a precise code so the UI can nudge.
    if (/gh auth|not logged into|authentication/i.test(result.stderr)) {
      return signalError("gh_unauthenticated", `${toolName} unauthenticated: ${detail}`);
    }
    if (/rate limit|api rate/i.test(result.stderr)) {
      return signalError("gh_rate_limited", `${toolName} rate-limited: ${detail}`);
    }
    return signalError("subprocess_failed", `${toolName} exited ${result.code}: ${detail}`);
  }
  return null;
}
