/**
 * COS-5g — the unified grouping resolver (`contracts/grouping.ts`). Asserts the
 * prefix lens (`buildPrefixGrouping` / `resolveGrouping`) computes the SAME
 * `${l1}:${l2}` grouping the two former `buildTaxonomy` copies did, threads the
 * registry-sourced `isRolling`, and that the repo-badge facade (`repoBadge`) is a
 * faithful re-export of `projectKeyForRepo` — "one grouping path, no drift".
 */

import { describe, it, expect } from "vitest";
import { buildPrefixGrouping, resolveGrouping, repoBadge } from "../../src/contracts/grouping.js";
import { projectKeyForRepo, resolveTaxonomy } from "../../src/contracts/projects.js";
import { taxon } from "../fixtures/signals.js";

describe("grouping — prefix lens (buildPrefixGrouping / resolveGrouping)", () => {
  it("maps a registered prefix to l1/l2/laneId/domain, defaulting null l2 to General", () => {
    const g = buildPrefixGrouping([
      taxon("MTP", "MTP coaching engine", "JB", "Coaching"),
      { ...taxon("LYC", "Platform general", "JB", "x"), l2Subsystem: null },
    ]);
    expect(g.get("MTP")).toMatchObject({
      prefix: "MTP",
      family: "MTP coaching engine",
      l1: "JB",
      l2: "Coaching",
      laneId: "JB:Coaching",
      isGeneric: false,
      isRolling: false,
    });
    // null l2 → "General" (behaviour-preserving with the old buildTaxonomy).
    expect(g.get("LYC")?.l2).toBe("General");
    expect(g.get("LYC")?.laneId).toBe("JB:General");
  });

  it("threads the registry-sourced isRolling flag through the entry", () => {
    const g = buildPrefixGrouping([
      taxon("INFRA", "Infra", "Company", "Company-OS", false, true),
      taxon("OB", "Onboarding", "JB", "Onboarding", false, false),
    ]);
    expect(g.get("INFRA")?.isRolling).toBe(true);
    expect(g.get("OB")?.isRolling).toBe(false);
  });

  it("last-wins on a duplicate prefix (matches the prior Map.set behaviour)", () => {
    const g = buildPrefixGrouping([
      taxon("RE", "Report engine v1", "JB", "Reports"),
      taxon("RE", "Report engine v2", "JB", "Reports"),
    ]);
    expect(g.get("RE")?.family).toBe("Report engine v2");
    expect(g.size).toBe(1);
  });

  it("resolveGrouping returns null for an unregistered or null prefix (Ops-lane candidate)", () => {
    const g = buildPrefixGrouping([taxon("MTP", "MTP", "JB", "Coaching")]);
    expect(resolveGrouping(g, "MTP")?.prefix).toBe("MTP");
    expect(resolveGrouping(g, "NOPE")).toBeNull();
    expect(resolveGrouping(g, null)).toBeNull();
  });

  it("carries the generic flag through unchanged", () => {
    const g = buildPrefixGrouping([taxon("IMPRV", "Improvements", "JB", "Platform-infra", true)]);
    expect(g.get("IMPRV")?.isGeneric).toBe(true);
  });
});

describe("grouping — repo lens facade (repoBadge)", () => {
  const roots = ["/x/company", "/x/juice-bar", "/x/arc-scraper", "/x/paperclip"];
  const taxonomy = resolveTaxonomy(roots);

  it("repoBadge equals projectKeyForRepo for every repo (faithful re-export)", () => {
    for (const repo of ["company", "juice-bar", "arc-scraper", "paperclip", "unknown-repo"]) {
      expect(repoBadge(taxonomy, repo)).toBe(projectKeyForRepo(taxonomy, repo));
    }
  });

  it("groups a dependency repo under its project primary (arc-scraper → juice-bar)", () => {
    expect(repoBadge(taxonomy, "arc-scraper")).toBe("juice-bar");
  });

  it("falls back to the company group for an unassigned repo", () => {
    expect(repoBadge(taxonomy, "totally-unknown")).toBe("company");
  });
});
