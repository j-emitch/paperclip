/**
 * COS-2f — `readTeachingOverview` (the `teaching-overview` worker handler body).
 * Proves it folds an injected bundle through `deriveTeachingOverview`, stamps the
 * injected clock, and VALIDATES the result (a malformed fold would throw at the
 * parse before crossing the bridge). Pure over deps — no fs, no SDK.
 */

import { describe, expect, it } from "vitest";
import { readTeachingOverview } from "../src/teaching-overview-read.js";
import type { SignalBundle } from "../src/contracts/WorkSignalSource.js";
import type { ArtifactSignal } from "../src/contracts/signals.js";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

function inboxSig(nuggets: number): ArtifactSignal {
  return {
    kind: "artifact", source: "teaching", repo: "company",
    path: "docs/teachings/inbox/x.md", relPath: "docs/teachings/inbox/x.md",
    mtime: "2026-06-01T00:00:00.000Z", confidence: "high", freshness: "live", errors: [],
    artifactType: "teaching", system: "Company", prefix: null, status: null, sha256: "x", sizeBytes: 1, title: "x", createdBy: null,
    teaching: { entryKind: "inbox", lens: null, audience: null, publishState: null, unit: null, pendingNuggets: nuggets, lastVerified: null },
  };
}

function bundleOf(signals: ArtifactSignal[]): SignalBundle {
  return { collectedAt: NOW, batches: [{ source: "teaching", collectedAt: NOW, signals, repoFreshness: [{ repo: "company", freshness: "live", lastOkAt: null, errors: [] }] }] };
}

describe("readTeachingOverview", () => {
  it("folds the collected bundle into a validated overview stamped with the injected clock", async () => {
    const overview = await readTeachingOverview({
      collectBundle: async () => bundleOf([inboxSig(199)]),
      now: () => NOW,
    });
    expect(overview.schemaVersion).toBe(1);
    expect(overview.derivedAt).toBe(new Date(NOW).toISOString());
    expect(overview.backlog.pendingNuggets).toBe(199);
    // a long-stalled backlog with no synthesis is the critical headline.
    expect(overview.attention.level).toBe("critical");
  });

  it("returns a valid empty overview for an empty corpus", async () => {
    const overview = await readTeachingOverview({ collectBundle: async () => bundleOf([]), now: () => NOW });
    expect(overview.units).toEqual([]);
    expect(overview.backlog.pendingNuggets).toBe(0);
    expect(overview.synthesis.verdict).toBe("never_ran");
  });

  it("propagates a collector failure (surfaced as the tab's error state)", async () => {
    await expect(
      readTeachingOverview({ collectBundle: async () => { throw new Error("worker down"); }, now: () => NOW }),
    ).rejects.toThrow("worker down");
  });
});
