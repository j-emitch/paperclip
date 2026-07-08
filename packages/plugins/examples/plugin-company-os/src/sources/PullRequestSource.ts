/**
 * `PullRequestSource` — the In-review column from open PRs (`gh pr list --json`).
 * Each open PR resolves a ticket via its title scope (rung 2: pr_scope), falling
 * back to its head branch; multi-ticket PRs fan out. The review STATE
 * (reviewed/unknown) is NOT decided here — `ReviewReportSource` supplies the
 * report join and the projection combines them.
 *
 * gh is the one networked dependency, so this source is the strictest about the
 * degrade-never-throw contract: an unauth / rate-limited / offline / timed-out
 * `gh` yields a typed error + stale `RepoFreshness`, and the board keeps the
 * last-good In-review chips (spec §6, COS-0c gh spec).
 */

import { type CollectionContext, type PriorPrRollup, type RepoRoot } from "../contracts/collection-context.js";
import type { WorkSignalSource, SignalBatch } from "../contracts/WorkSignalSource.js";
import type { SignalError, WorkSignal } from "../contracts/signals.js";
import type { PrCiState, PrMergeableState } from "../contracts/vocab.js";
import { extractTicketIds, parseBranch, parseGhPrList, parseGhPrRollup, prefixOf, type GhPr } from "./parse.js";
import { collectPerRepo, errorFromSubprocess, type RepoReadResult } from "./_shared.js";

export const PULL_REQUEST_SOURCE_ID = "pull-request";

/** Fields requested from gh — kept minimal + stable so the JSON contract is tight. */
const PR_JSON_FIELDS = "number,title,headRefName,headRefOid,url,isDraft,updatedAt";
const PR_LIST_LIMIT = 200;

/**
 * COS-11.gh-fields rate contract (spec §7 row 4): the LIST call stays untouched;
 * CI/mergeability come from a SECOND, bounded, per-PR step — and only for PRs
 * whose `(headSha, updatedAt)` changed vs the previous derive's persisted cache
 * (`ctx.prior.prRollups`, threaded by the derive because this source is
 * stateless). 288 derives/day x open-PR count would otherwise hammer the API.
 */
const MAX_ROLLUP_FETCHES = 20;
const ROLLUP_JSON_FIELDS = "statusCheckRollup,mergeable";

interface ResolvedRollup {
  readonly ciState: PrCiState;
  readonly mergeableState: PrMergeableState;
}

function isRateLimit(stderr: string): boolean {
  return /rate limit|API rate limit|secondary rate/i.test(stderr);
}

/**
 * Resolve each PR's rollup: cache hit (unchanged PR) → cached values, ZERO gh
 * calls; changed/uncached → one bounded `gh pr view`; over-bound / rate-limited
 * / failed → cached-stale if present, else unknown (+ a typed error). Mutates
 * nothing; returns a map keyed by PR number.
 */
async function resolveRollups(
  ctx: CollectionContext,
  repoKey: string,
  prs: readonly GhPr[],
  errors: SignalError[],
): Promise<Map<number, ResolvedRollup>> {
  const cache: Readonly<Record<string, PriorPrRollup>> = ctx.prior?.prRollups ?? {};
  const out = new Map<number, ResolvedRollup>();
  let fetches = 0;
  let rateLimited = false;

  for (const pr of prs) {
    const cached = cache[`${repoKey}#${pr.number}`];
    const unchanged =
      cached !== undefined && cached.headSha === (pr.headRefOid || null) && cached.updatedAt === (pr.updatedAt || null);
    if (unchanged) {
      out.set(pr.number, { ciState: cached.ciState, mergeableState: cached.mergeableState });
      continue;
    }
    const stale: ResolvedRollup = cached
      ? { ciState: cached.ciState, mergeableState: cached.mergeableState }
      : { ciState: "unknown", mergeableState: "unknown" };

    if (rateLimited || fetches >= MAX_ROLLUP_FETCHES) {
      out.set(pr.number, stale);
      continue;
    }
    fetches++;
    const r = await ctx.gh.run(repoKey, ["pr", "view", String(pr.number), "--json", ROLLUP_JSON_FIELDS]);
    if (r.code !== 0 || r.timedOut) {
      if (isRateLimit(r.stderr)) {
        // Stop fetching this tick; the 5-minute derive grid is the backoff and
        // the cache means the NEXT tick only retries still-changed PRs.
        rateLimited = true;
        errors.push({ code: "gh_rate_limited", message: `gh rate-limited during rollup fetch for ${repoKey}`, degraded: true });
      } else {
        errors.push({ code: "subprocess_failed", message: `gh pr view ${pr.number} rollup failed in ${repoKey}`, degraded: true });
      }
      out.set(pr.number, stale);
      continue;
    }
    const { rollup, ok } = parseGhPrRollup(r.stdout);
    if (!ok) {
      errors.push({ code: "parse_error", message: `gh pr view ${pr.number} rollup returned unparseable JSON`, degraded: true });
      out.set(pr.number, stale);
      continue;
    }
    out.set(pr.number, rollup);
  }
  return out;
}

export const pullRequestSource: WorkSignalSource = {
  id: PULL_REQUEST_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    return collectPerRepo(PULL_REQUEST_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const result = await c.gh.run(repo.repo, [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        String(PR_LIST_LIMIT),
        "--json",
        PR_JSON_FIELDS,
      ]);
      const ghErr = errorFromSubprocess(result, "gh pr list");
      if (ghErr) return { signals: [], errors: [ghErr] };

      const { prs, ok } = parseGhPrList(result.stdout);
      if (!ok) {
        const errors: SignalError[] = [
          { code: "parse_error", message: "gh pr list returned unparseable JSON", degraded: true },
        ];
        return { signals: [], errors };
      }
      const errors: SignalError[] = [];
      const rollups = await resolveRollups(c, repo.repo, prs, errors);
      return { signals: prs.flatMap((pr) => prSignals(repo, pr, rollups.get(pr.number))), errors };
    });
  },
};

/** Resolve a PR's tickets from its title scope, falling back to the head branch. */
function ticketsForPr(pr: GhPr): { ticketIds: string[]; viaBranch: boolean } {
  const fromTitle = extractTicketIds(pr.title);
  if (fromTitle.length > 0) return { ticketIds: fromTitle, viaBranch: false };
  const fromBranch = parseBranch(pr.headRefName).ticketIds;
  return { ticketIds: fromBranch, viaBranch: true };
}

function prSignals(repo: RepoRoot, pr: GhPr, rollup?: ResolvedRollup): WorkSignal[] {
  const { ticketIds, viaBranch } = ticketsForPr(pr);
  const common = {
    kind: "work",
    source: PULL_REQUEST_SOURCE_ID,
    repo: repo.repo,
    freshness: "live",
    errors: [],
    state: "in_review",
    evidence: pr.title || pr.headRefName,
    prNumber: pr.number,
    sha: pr.headRefOid || undefined,
    url: pr.url || undefined,
    title: pr.title || undefined,
    // Branch·PR Health join keys (COS-5e): the head ref names the local branch the
    // PR belongs to; isDraft + updatedAt(mtime) drive its lifecycle chip. The board
    // ignores these; only the git-state projection reads them.
    headRef: pr.headRefName || undefined,
    isDraft: pr.isDraft,
    mtime: pr.updatedAt || undefined,
    ciState: rollup?.ciState ?? "unknown",
    prMergeable: rollup?.mergeableState ?? "unknown",
  } as const satisfies Partial<WorkSignal>;

  if (ticketIds.length === 0) {
    return [
      {
        ...common,
        ticketId: null,
        prefix: null,
        precedence: "none",
        unclassifiedReason: "bad_branch_format",
        confidence: "low",
      },
    ];
  }

  return ticketIds.map(
    (ticketId): WorkSignal => ({
      ...common,
      ticketId,
      prefix: prefixOf(ticketId),
      precedence: "pr_scope",
      confidence: viaBranch ? "medium" : "high",
    }),
  );
}
