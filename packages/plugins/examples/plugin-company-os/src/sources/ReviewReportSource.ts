/**
 * `ReviewReportSource` — emits a `ReviewSignal` per on-disk review report under
 * `reports/review-cannons/**` and `reports/reviews/**` (both gitignored,
 * machine-local). Each signal carries the In-review join key
 * `{repo, sha (full), prNumber?, reportKind, generatedAt}` parsed from the
 * report frontmatter; the projection joins these onto In-review work chips to
 * resolve `ChipReviewState`, rendering only head-SHA-current reports and
 * treating an ABSENT report as `unknown` (not "unreviewed").
 *
 * This source does NOT feed the docs/reports viewer index — that is
 * `ArtifactSource` (artifactType "cannons"). Keeping the review-state join and
 * the viewer index in separate sources keeps the two concerns decoupled.
 */

import { type CollectionContext, type RepoRoot } from "../contracts/collection-context.js";
import type { WorkSignalSource, SignalBatch } from "../contracts/WorkSignalSource.js";
import type { ReviewSignal, Signal, SignalError } from "../contracts/signals.js";
import {
  parseFrontmatter,
  parseReviewReport,
  reportKindFromPath,
  type ParsedReviewReport,
} from "./parse.js";
import { collectPerRepo, type RepoReadResult } from "./_shared.js";

export const REVIEW_REPORT_SOURCE_ID = "review-report";

/** Workspace globs for the two report stores (both gitignored / machine-local). */
const REPORT_GLOBS = ["reports/review-cannons/**/*.md", "reports/reviews/**/*.md"] as const;

export const reviewReportSource: WorkSignalSource = {
  id: REVIEW_REPORT_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    return collectPerRepo(REVIEW_REPORT_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const files = await c.fs.list(repo.repo, [...REPORT_GLOBS]);
      const signals: Signal[] = [];
      const errors: SignalError[] = [];
      for (const file of files) {
        let text: string;
        try {
          text = await c.fs.readText(repo.repo, file.relPath);
        } catch (err) {
          errors.push({ code: "not_found", message: `unreadable report ${file.relPath}: ${String(err)}`, degraded: false });
          continue;
        }
        const fm = parseFrontmatter(text);
        if (!fm) {
          errors.push({ code: "parse_error", message: `report ${file.relPath} has no frontmatter`, degraded: false });
          continue;
        }
        signals.push(reviewSignal(repo, file.relPath, file.mtime, parseReviewReport(fm)));
      }
      return { signals, errors };
    });
  },
};

function reviewSignal(
  repo: RepoRoot,
  relPath: string,
  mtime: string,
  parsed: ParsedReviewReport,
): ReviewSignal {
  // The report pertains to its frontmatter `repo` when present (a report is
  // stored in the repo it reviews, but the field is authoritative).
  const pertains = parsed.repo ?? repo.repo;
  const signal: ReviewSignal = {
    kind: "review",
    source: REVIEW_REPORT_SOURCE_ID,
    repo: pertains,
    path: relPath,
    mtime,
    confidence: "high",
    freshness: "live",
    errors: [],
    reportKind: reportKindFromPath(relPath),
    verdict: parsed.verdict,
    generatedAt: parsed.generatedAt ?? mtime,
    ...(parsed.fullSha ? { sha: parsed.fullSha } : {}),
    ...(parsed.prNumber !== null ? { prNumber: parsed.prNumber } : {}),
    ...(parsed.branch ? { branch: parsed.branch } : {}),
    ...(parsed.p0 !== null ? { p0: parsed.p0 } : {}),
    ...(parsed.p1 !== null ? { p1: parsed.p1 } : {}),
    ...(parsed.p2 !== null ? { p2: parsed.p2 } : {}),
  };
  return signal;
}
