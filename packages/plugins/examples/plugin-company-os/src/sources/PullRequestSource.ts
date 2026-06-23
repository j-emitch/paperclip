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

import { type CollectionContext, type RepoRoot } from "../contracts/collection-context.js";
import type { WorkSignalSource, SignalBatch } from "../contracts/WorkSignalSource.js";
import type { SignalError, WorkSignal } from "../contracts/signals.js";
import { extractTicketIds, parseBranch, parseGhPrList, prefixOf, type GhPr } from "./parse.js";
import { collectPerRepo, errorFromSubprocess, type RepoReadResult } from "./_shared.js";

export const PULL_REQUEST_SOURCE_ID = "pull-request";

/** Fields requested from gh — kept minimal + stable so the JSON contract is tight. */
const PR_JSON_FIELDS = "number,title,headRefName,headRefOid,url,isDraft,updatedAt";
const PR_LIST_LIMIT = 200;

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
      return { signals: prs.flatMap((pr) => prSignals(repo, pr)) };
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

function prSignals(repo: RepoRoot, pr: GhPr): WorkSignal[] {
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
