/**
 * Golden `BuildAtlasV1` fixtures for the Atlas cockpit UI. Built through the REAL
 * `deriveBuildAtlas` fold (not hand-authored) so families, lifecycle, lineage,
 * tickets, and diagnostics are always internally consistent — the view is tested
 * against contract-valid data on the true derivation path (same discipline as
 * `fixtures/agents.ts`).
 *
 * The `golden` scenario deliberately exercises every region:
 *  • three domains (ARC / Company / JB);
 *  • builds across all four states (shipped / in-review / in-progress) + a
 *    shipped-only rolling family (PULSE → "· live") + a zero-build show-0 family
 *    (TPR → "no builds yet");
 *  • a generic-prefix family (IMPRV → anti-pattern marker) + a plan-gap family
 *    (MTP: verified spec, no plan → the plan-gap pill);
 *  • a lineage graph with a flow group + a distinct Second-Brain lane + a
 *    pseudo-sink (COS receives MTP→COS but emits nothing);
 *  • the synthetic Meta family (a routine chip + an unrouted Ops ticket);
 *  • every diagnostic class — unknown_prefix (XYZ work + ZZZ ticket ref),
 *    orphan_family (LDI in no lane), unrouted_ticket (LYC-200), + a stale source.
 */

import { deriveBuildAtlas } from "../../../src/projections/deriveBuildAtlas.js";
import { bundleOf, docSignal, lineageSignal, taxon, ticketSignal, work, NOW } from "../../fixtures/signals.js";
import type { BuildAtlasV1 } from "../../../src/contracts/build-atlas.js";

/** The fixture clock — matches the projection golden's `NOW` (2026-06-23T12:00Z). */
export const ATLAS_NOW = NOW;

export function goldenAtlas(): BuildAtlasV1 {
  return deriveBuildAtlas(
    bundleOf(
      [
        // Registered families (prefix registry).
        taxon("COS", "Company OS", "JB", "Company-OS"),
        taxon("MTP", "Coaching", "JB", "Coaching"),
        taxon("TPR", "Tap Redesign", "JB", "Coaching"),
        taxon("PULSE", "Pulse", "JB", "Observability", false, true), // rolling program
        taxon("IMPRV", "Improvements", "JB", "Platform", true), // generic prefix (anti-pattern)
        taxon("LDI", "Data Ingest", "ARC", "Pipeline"),

        // Lifecycle docs — COS spec+plan verified (Plan done); MTP spec-only (plan gap).
        docSignal("specs/COS.md", { docType: "spec", prefix: "COS", verified: true, status: "active", lastUpdated: "2026-06-22", description: "The daily-driver Company OS cockpit." }),
        docSignal("docs/superpowers/plans/COS-plan.md", { docType: "plan", prefix: "COS", verified: true }),
        docSignal("specs/MTP.md", { docType: "spec", prefix: "MTP", verified: true }),

        // Builds — COS carries live chips (shipped + in-review + in-progress).
        work("COS-0", "shipped", "commit_scope", {
          prefix: "COS",
          repo: "company",
          title: "Cockpit spine",
          prNumber: 196,
          url: "https://github.com/lycaon/company/pull/196",
          mtime: "2026-06-20T10:00:00.000Z",
        }),
        work("COS-1", "in_progress", "branch_path", { prefix: "COS", repo: "company", title: "Daily-driver cockpit" }),
        work("COS-2", "in_review", "pr_scope", {
          prefix: "COS",
          repo: "company",
          title: "Agents cohesion",
          prNumber: 210,
          url: "https://github.com/lycaon/company/pull/210",
        }),
        work("MTP-04", "shipped", "commit_scope", { prefix: "MTP", repo: "juice-bar", title: "Coaching engine" }),
        work("PULSE-01", "shipped", "commit_scope", { prefix: "PULSE", repo: "juice-bar", title: "Owner vitals" }),
        work("IMPRV-14", "in_progress", "branch_path", { prefix: "IMPRV", repo: "juice-bar", title: "Knip sweep" }),
        work("LDI-12", "shipped", "commit_scope", { prefix: "LDI", repo: "arc-scraper", title: "Closed-world vocab guard" }),
        // Unregistered prefix → an unknown_prefix diagnostic (the family is NOT fabricated).
        work("XYZ-9", "in_progress", "branch_path", { prefix: "XYZ", repo: "juice-bar" }),

        // Lineage graph — flow value-chain + a distinct Second-Brain lane.
        lineageSignal({
          laneGroups: [
            {
              id: "vc",
              title: "Value Chain",
              kind: "flow",
              lanes: [
                { id: "coach", title: "Coaching", families: ["MTP", "TPR"] },
                { id: "obs", title: "Observability", families: ["PULSE"] },
              ],
            },
            {
              id: "sb",
              title: "Second Brain",
              kind: "second-brain",
              lanes: [{ id: "os", title: "Company OS", families: ["COS"] }],
            },
          ],
          // PULSE→MTP→COS: COS receives but never emits → a pseudo-sink.
          edges: [
            { from: "PULSE", to: "MTP", kind: "consumes" },
            { from: "MTP", to: "COS", kind: "observes" },
          ],
        }),

        // Tickets — one routes to COS (route: family), one parks in Meta·Ops, one routine chip.
        ticketSignal("LYC-100", { originKind: "manual", status: "in_progress", priority: "high", referencedFamilies: ["COS"] }),
        ticketSignal("LYC-200", { originKind: "manual", status: "todo", referencedFamilies: ["ZZZ"] }),
        ticketSignal("routine-fire-1", {
          originKind: "routine_execution",
          status: "done",
          parentId: "librarian-audit",
          title: "Librarian knowledge audit",
          mtime: "2026-06-23T06:00:00.000Z",
        }),
      ],
      // A stale source → the stale-source pill + a source diagnostic.
      [{ repo: "juice-bar", freshness: "stale", lastOkAt: "2026-06-23T09:00:00.000Z", errors: [] }],
    ),
    ATLAS_NOW,
  );
}

/** The zero-state: nothing derived yet (cold company) → no families. */
export function emptyAtlas(): BuildAtlasV1 {
  return deriveBuildAtlas(bundleOf([]), ATLAS_NOW);
}
