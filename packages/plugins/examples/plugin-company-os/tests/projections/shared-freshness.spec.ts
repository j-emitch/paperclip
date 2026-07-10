/**
 * B2 fold-side honesty: `git_budget_exceeded` on a repo's git header STALES that
 * repo's (source, repo) freshness row in `aggregateSourceFreshness` — a run that
 * nulled its expensive fields must never render "live". Pins the downgrade, the
 * blast-radius (other repos in the batch untouched), the message fallback order,
 * and the downstream `source_stale` diagnostic the strip renders.
 */

import { describe, expect, it } from "vitest";
import { aggregateSourceFreshness, diagnosticsFromFreshness } from "../../src/projections/_shared.js";
import type { SignalBatch } from "../../src/contracts/WorkSignalSource.js";
import { NOW, bundleOfBatches, repoGitSignal } from "../fixtures/signals.js";

const BUDGET_DIAG = {
  level: "warn" as const,
  code: "git_budget_exceeded",
  message: "git budget (4000ms) exceeded for juice-bar — expensive fields nulled",
  repo: "juice-bar",
  source: "branch",
};

function batchWith(over: Partial<SignalBatch> = {}): SignalBatch {
  return {
    source: "branch",
    collectedAt: NOW,
    signals: [repoGitSignal("juice-bar", { diagnostics: [BUDGET_DIAG] }), repoGitSignal("company")],
    repoFreshness: [
      { repo: "company", freshness: "live", lastOkAt: new Date(NOW).toISOString(), errors: [] },
      { repo: "juice-bar", freshness: "live", lastOkAt: new Date(NOW).toISOString(), errors: [] },
    ],
    ...over,
  };
}

describe("aggregateSourceFreshness — git_budget_exceeded staling (B2)", () => {
  it("downgrades the exceeded repo's live row to stale with the budget message", () => {
    const rows = aggregateSourceFreshness(bundleOfBatches([batchWith()]));
    const jb = rows.find((r) => r.repo === "juice-bar");
    expect(jb?.freshness).toBe("stale");
    expect(jb?.message).toContain("git budget exceeded");
  });

  it("leaves the other repos in the same batch live (per-repo blast radius)", () => {
    const rows = aggregateSourceFreshness(bundleOfBatches([batchWith()]));
    expect(rows.find((r) => r.repo === "company")?.freshness).toBe("live");
    expect(rows.find((r) => r.repo === "company")?.message).toBeNull();
  });

  it("a real collect error message still wins over the budget fallback", () => {
    const rows = aggregateSourceFreshness(
      bundleOfBatches([
        batchWith({
          repoFreshness: [
            {
              repo: "juice-bar",
              freshness: "stale",
              lastOkAt: null,
              errors: [{ code: "git_read_failed", message: "git enumerate failed", degraded: true }],
            },
          ],
        }),
      ]),
    );
    expect(rows[0]?.freshness).toBe("stale");
    expect(rows[0]?.message).toBe("git enumerate failed");
  });

  it("feeds the strip: the staled row yields a source_stale diagnostic downstream", () => {
    const diags = diagnosticsFromFreshness(aggregateSourceFreshness(bundleOfBatches([batchWith()])));
    expect(diags.some((d) => d.code === "source_stale" && d.repo === "juice-bar")).toBe(true);
    expect(diags.some((d) => d.repo === "company")).toBe(false);
  });
});
