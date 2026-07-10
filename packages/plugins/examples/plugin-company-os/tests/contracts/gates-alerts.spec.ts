/**
 * COS-11 B17 — the diagnostics-class alert lane: gates signals map onto the
 * unified Home alert union (`gate_unprotected` error tier, `system_degraded`
 * warn tier) through `deriveOrientation`, alongside the existing kinds.
 */

import { describe, expect, it } from "vitest";
import { deriveOrientation } from "../../src/projections/deriveOrientation.js";
import { PROTECTION_SOURCE_ID } from "../../src/sources/ProtectionSource.js";
import { MIGRATION_AUDIT_SOURCE_ID } from "../../src/sources/MigrationAuditSource.js";
import { resolveTaxonomy } from "../../src/contracts/projects.js";
import type { SignalBatch, SignalBundle } from "../../src/contracts/WorkSignalSource.js";
import type { ProtectionSignal } from "../../src/contracts/signals.js";
import { parseOrientationV1 } from "../../src/contracts/orientation.js";
import { FIXED_NOW } from "../fixtures/context.js";

const TAXONOMY = resolveTaxonomy(["/tmp/juice-bar", "/tmp/company"], undefined);

function bundleOf(...batches: SignalBatch[]): SignalBundle {
  return { collectedAt: FIXED_NOW, batches };
}

function protectionSignal(overrides: Partial<ProtectionSignal>): ProtectionSignal {
  return {
    kind: "protection",
    source: PROTECTION_SOURCE_ID,
    repo: "company",
    confidence: "high",
    freshness: "live",
    errors: [],
    repoName: "juice-bar",
    slug: "j-emitch/JuiceBar",
    branch: "main",
    enforceAdmins: false,
    requiredChecks: ["API"],
    requiredReviews: 1,
    verifiedAt: null,
    ...overrides,
  };
}

describe("B17 gates alert lane (deriveOrientation)", () => {
  it("enforce_admins=true (the drift class) fires gate_unprotected at HIGH within the derive", () => {
    const o = deriveOrientation(
      bundleOf({
        source: PROTECTION_SOURCE_ID,
        collectedAt: FIXED_NOW,
        signals: [protectionSignal({ enforceAdmins: true })],
        repoFreshness: [],
      }),
      FIXED_NOW,
      TAXONOMY,
    );
    expect(() => parseOrientationV1(o)).not.toThrow(); // the new kinds are schema-valid
    const alert = o.alerts.find((a) => a.kind === "gate_unprotected");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("high");
    expect(alert!.id).toBe("gate:protection:juice-bar");
    expect(alert!.detail).toContain("enforce_admins=true");
    // Counted in the metrics strip like every other alert.
    expect(o.metrics.alerts).toBe(o.alerts.length);
  });

  it("the codified desired posture (enforce_admins=false) fires NOTHING", () => {
    const o = deriveOrientation(
      bundleOf({
        source: PROTECTION_SOURCE_ID,
        collectedAt: FIXED_NOW,
        signals: [protectionSignal({ enforceAdmins: false }), protectionSignal({ repoName: "company", enforceAdmins: null })],
        repoFreshness: [],
      }),
      FIXED_NOW,
      TAXONOMY,
    );
    expect(o.alerts.filter((a) => a.kind === "gate_unprotected")).toHaveLength(0);
  });

  it("a degraded gates source fires system_degraded (medium), deduped per (source, repo); non-gates sources do not", () => {
    const degradedFreshness = {
      repo: "juice-bar",
      freshness: "stale" as const,
      lastOkAt: null,
      errors: [
        { code: "parse_error" as const, message: "unparseable audit", degraded: true },
        { code: "not_found" as const, message: "also broken", degraded: true },
      ],
    };
    const o = deriveOrientation(
      bundleOf(
        { source: MIGRATION_AUDIT_SOURCE_ID, collectedAt: FIXED_NOW, signals: [], repoFreshness: [degradedFreshness] },
        { source: "git-work", collectedAt: FIXED_NOW, signals: [], repoFreshness: [degradedFreshness] },
      ),
      FIXED_NOW,
      TAXONOMY,
    );
    const degraded = o.alerts.filter((a) => a.kind === "system_degraded");
    expect(degraded).toHaveLength(1); // two errors, one (source, repo) pair; git-work ignored
    expect(degraded[0].severity).toBe("medium");
    expect(degraded[0].id).toBe(`gate:degraded:${MIGRATION_AUDIT_SOURCE_ID}:juice-bar`);
    expect(degraded[0].detail).toContain("unparseable audit");
  });
});
