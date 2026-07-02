/**
 * SSR fixtures for the Teaching tab (COS-2f) — golden overviews the render-doc
 * harness screenshots and the e2e asserts against. `golden` is the critical
 * headline case (a real 199-nugget stall behind a never-run synthesis) + a small
 * two-lens corpus; `healthy` is the drained/fresh case.
 */

import type { TeachingOverviewV1 } from "../../../src/contracts/index.js";

export const TEACHING_NOW = Date.parse("2026-07-02T12:00:00.000Z");

export function goldenTeachingOverview(): TeachingOverviewV1 {
  return {
    schemaVersion: 1,
    derivedAt: "2026-07-02T12:00:00.000Z",
    backlog: { pendingLogs: 10, pendingNuggets: 199, oldestPendingAt: "2026-06-22T07:45:00.000Z", oldestPendingAgeHours: 244 },
    synthesis: { lastSynthesisAt: null, ageHours: null, verdict: "never_ran" },
    attention: { level: "critical", reason: "199 nuggets across 10 logs awaiting synthesis — the synthesis has never run." },
    units: [
      { repo: "company", relPath: "docs/teachings/internal/units/02-adversarial-review/codex-agentic.md", title: "Codex agentic invocation", unit: "02-adversarial-review", lens: "internal", audience: "internal", publishState: "ready", lastVerifiedAt: "2026-06-30T00:00:00.000Z", mtime: "2026-06-30T00:00:00.000Z" },
      { repo: "company", relPath: "docs/teachings/external/units/02-adversarial-review/refute-default.md", title: "Refute-by-default verification", unit: "02-adversarial-review", lens: "external", audience: "external", publishState: "published", lastVerifiedAt: "2026-06-28T00:00:00.000Z", mtime: "2026-06-28T00:00:00.000Z" },
      { repo: "company", relPath: "docs/teachings/internal/units/03-migrations-and-staging/checksum-drift.md", title: "Migration checksum drift ≠ live ACL", unit: "03-migrations-and-staging", lens: "internal", audience: "internal", publishState: "candidate", lastVerifiedAt: "2026-06-26T00:00:00.000Z", mtime: "2026-06-26T00:00:00.000Z" },
      { repo: "company", relPath: "docs/teachings/units/06-worktree-and-checkout-hygiene/main-checkout.md", title: "Main checkout is single-tenant", unit: "06-worktree-and-checkout-hygiene", lens: "unspecified", audience: "internal", publishState: "private", lastVerifiedAt: null, mtime: "2026-06-10T00:00:00.000Z" },
    ],
    unitCounts: {
      total: 4,
      audience: { internal: 3, external: 1, both: 0 },
      publishState: { private: 1, candidate: 1, ready: 1, published: 1 },
      lens: { internal: 2, external: 1, unspecified: 1 },
    },
    sources: [{ source: "teaching", repo: "company", freshness: "live", lastOkAt: "2026-07-02T12:00:00.000Z", errorCount: 0, message: null }],
    diagnostics: [{ level: "error", code: "teaching_backlog_stuck", message: "199 nuggets across 10 logs awaiting synthesis — the synthesis has never run.", repo: null, source: "teaching" }],
  };
}

export function healthyTeachingOverview(): TeachingOverviewV1 {
  const g = goldenTeachingOverview();
  return {
    ...g,
    backlog: { pendingLogs: 0, pendingNuggets: 0, oldestPendingAt: null, oldestPendingAgeHours: null },
    synthesis: { lastSynthesisAt: "2026-07-02T06:00:00.000Z", ageHours: 6, verdict: "fresh" },
    attention: { level: "ok", reason: null },
    diagnostics: [],
  };
}
