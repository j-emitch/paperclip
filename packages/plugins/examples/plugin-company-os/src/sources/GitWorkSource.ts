/**
 * `GitWorkSource` — In-progress (worktrees + branch names + commit/worktree
 * fallbacks) AND Shipped (merged scopes on the trunk). Both columns are pure
 * git, so they live in one source per the plan's file set; the two concerns are
 * kept in separate readers (`collectInProgress` / `collectShipped`) to stay
 * decoupled within the source.
 *
 * In-progress emits CANDIDATE signals tagged with their precedence rung
 * (branch_path > commit_scope > worktree_meta); the deriveBoardState projection
 * (COS-0d) resolves the winner per ticket. PR-scope (rung 2) and spec-frontmatter
 * (rung 4) are owned by `PullRequestSource` / `SpecBacklogSource` respectively.
 */

import {
  findRepoRoot,
  signalError,
  type CollectionContext,
  type RepoRoot,
} from "../contracts/collection-context.js";
import type { WorkSignalSource, SignalBatch } from "../contracts/WorkSignalSource.js";
import type { Signal, SignalError, WorkSignal } from "../contracts/signals.js";
import type { WorkSignalPrecedence, WorkState } from "../contracts/vocab.js";
import {
  extractShipped,
  GIT_LOG_FORMAT,
  parseBranch,
  parseCommitScope,
  parseFrontmatter,
  parseGitLogRecords,
  parseWorktreeList,
  prefixOf,
  type ShippedTicket,
} from "./parse.js";
import { collectPerRepo, errorFromSubprocess, type RepoReadResult } from "./_shared.js";

export const GIT_WORK_SOURCE_ID = "git-work";

/** Trunk candidates probed (in order) for the Shipped column. */
const SHIPPED_BASE_CANDIDATES = ["origin/main", "main", "lycaon", "master"] as const;
/** How many trunk commits back the Shipped column scans (bounded for perf). */
const SHIPPED_SCAN_LIMIT = 400;

export const gitWorkSource: WorkSignalSource = {
  id: GIT_WORK_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    return collectPerRepo(GIT_WORK_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const errors: SignalError[] = [];
      const signals: Signal[] = [];
      const inProgress = await collectInProgress(repo, c, errors);
      signals.push(...inProgress);
      const shipped = await collectShipped(repo, c, errors);
      signals.push(...shipped);
      return { signals, errors };
    });
  },
};

function workSignal(
  repo: string,
  state: WorkState,
  ticketId: string | null,
  precedence: WorkSignalPrecedence,
  evidence: string,
  extra: Partial<WorkSignal> = {},
): WorkSignal {
  return {
    kind: "work",
    source: GIT_WORK_SOURCE_ID,
    repo,
    confidence: "high",
    freshness: "live",
    errors: [],
    ticketId,
    prefix: ticketId ? prefixOf(ticketId) : null,
    state,
    precedence,
    evidence,
    ...extra,
  };
}

async function collectInProgress(
  repo: RepoRoot,
  ctx: CollectionContext,
  errors: SignalError[],
): Promise<WorkSignal[]> {
  const list = await ctx.git.run(repo.repo, ["worktree", "list", "--porcelain"]);
  const listErr = errorFromSubprocess(list, "git worktree list");
  if (listErr) {
    errors.push(listErr);
    return [];
  }

  const out: WorkSignal[] = [];
  for (const wt of parseWorktreeList(list.stdout)) {
    if (wt.branch === null || wt.detached) continue; // detached HEAD = not a work branch
    const parsed = parseBranch(wt.branch);
    if (parsed.isBaseBranch) continue; // main/master/etc. — not in progress

    if (parsed.reason === "bad_branch_format") {
      out.push(
        workSignal(repo.repo, "in_progress", null, "none", wt.branch, {
          confidence: "low",
          unclassifiedReason: "bad_branch_format",
        }),
      );
    } else {
      for (const ticketId of parsed.ticketIds) {
        out.push(workSignal(repo.repo, "in_progress", ticketId, "branch_path", wt.branch));
      }
    }

    // Rung 3: commit-scope of the worktree HEAD (a lower-precedence alternative).
    if (wt.head) {
      const log = await ctx.git.run(repo.repo, ["log", "-1", "--format=%s", wt.head]);
      if (!errorFromSubprocess(log, "git log") && log.stdout.trim() !== "") {
        for (const ticketId of parseCommitScope(log.stdout)) {
          out.push(
            workSignal(repo.repo, "in_progress", ticketId, "commit_scope", log.stdout.trim(), {
              confidence: "medium",
              sha: wt.head,
            }),
          );
        }
      }
    }

    // Rung 5: _purpose worktree metadata (last resort — stale by design).
    const meta = await readWorktreeMeta(repo, ctx, wt.path);
    if (meta) out.push(meta);
  }
  return out;
}

async function readWorktreeMeta(
  repo: RepoRoot,
  ctx: CollectionContext,
  worktreePath: string,
): Promise<WorkSignal | null> {
  const base = worktreePath.replace(/\/+$/, "").split("/").pop() ?? "";
  if (base === "") return null;
  try {
    const text = await ctx.fs.readText(repo.repo, `_purpose/${base}.md`);
    const fm = parseFrontmatter(text);
    const ticketId = fm?.ticket ?? fm?.id ?? null;
    if (!ticketId || !prefixOf(ticketId)) return null;
    return workSignal(repo.repo, "in_progress", ticketId, "worktree_meta", `_purpose/${base}.md`, {
      confidence: "low",
      freshness: "stale",
      path: `_purpose/${base}.md`,
    });
  } catch {
    return null; // absent _purpose file is the common case, not an error
  }
}

async function collectShipped(
  repo: RepoRoot,
  ctx: CollectionContext,
  errors: SignalError[],
): Promise<WorkSignal[]> {
  for (const base of SHIPPED_BASE_CANDIDATES) {
    const log = await ctx.git.run(repo.repo, [
      "log",
      "--first-parent",
      `--format=${GIT_LOG_FORMAT}`,
      "-n",
      String(SHIPPED_SCAN_LIMIT),
      base,
    ]);
    if (errorFromSubprocess(log, "git log")) continue; // base ref absent — try the next
    if (log.stdout.trim() === "") return [];

    const out: WorkSignal[] = [];
    for (const rec of parseGitLogRecords(log.stdout)) {
      for (const t of extractShipped({ subject: rec.subject, body: rec.body })) {
        out.push(shippedSignal(repo.repo, rec.sha, rec.subject, rec.committedAt, t));
      }
    }
    return out;
  }
  // No trunk ref resolved — not fatal (a fresh worktree may have none).
  errors.push(signalError("not_found", `no shipped base ref resolved for ${repo.repo}`, false));
  return [];
}

function shippedSignal(repo: string, sha: string, subject: string, committedAt: string, t: ShippedTicket): WorkSignal {
  const precedence: WorkSignalPrecedence = t.via === "branch" ? "branch_path" : "commit_scope";
  return workSignal(repo, "shipped", t.ticketId, precedence, subject, {
    sha,
    reverted: t.reverted,
    // The committer date orders ship vs revert at projection time (newest wins).
    ...(committedAt ? { mtime: committedAt } : {}),
  });
}
