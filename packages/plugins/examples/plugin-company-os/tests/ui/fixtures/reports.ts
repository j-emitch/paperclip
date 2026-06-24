/**
 * Golden `ArtifactIndexV1` / `RoutineHealthV1` / `ReportContentV1` fixtures for
 * the Reports + Routines UI tests + the Playwright harness. The index + routine
 * health are built by running the REAL `deriveArtifactIndex` / `deriveRoutineHealth`
 * projections over curated signals, so they are contract-faithful by construction
 * and exercise every visual branch (each artifact type, cross-repo entries, a
 * stale source, and all four routine verdicts: fresh / stale / missing /
 * never_ran). The `report-content` payloads are validated against the contract.
 */

import type { ArtifactIndexV1, RoutineHealthV1, ReportContentV1 } from "../../../src/contracts/index.js";
import { parseReportContentV1, REPORT_CONTENT_SCHEMA_VERSION } from "../../../src/contracts/report-content.js";
import type { RepoFreshness, SignalBatch, SignalBundle } from "../../../src/contracts/WorkSignalSource.js";
import { deriveArtifactIndex } from "../../../src/projections/deriveArtifactIndex.js";
import { deriveRoutineHealth } from "../../../src/projections/deriveRoutineHealth.js";
import { NOW, artifact, routine } from "../../fixtures/signals.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

/** The render clock the SSR tests + harness use (30s after the default derive). */
export const REPORTS_NOW = NOW + 30 * 1000;

const live = (repo: string): RepoFreshness => ({ repo, freshness: "live", lastOkAt: iso(NOW - 30_000), errors: [] });
const staleArc = (): RepoFreshness => ({
  repo: "arc-scraper",
  freshness: "stale",
  lastOkAt: iso(NOW - 30 * 60_000),
  errors: [{ code: "gh_rate_limited", message: "GitHub API rate limit hit", degraded: true }],
});

// --- Artifacts: specs / handoffs / cannons / routine output across repos -------
const ARTIFACTS = [
  artifact("docs/superpowers/specs/2026-06-23-COS-0-company-os-cockpit.md", {
    repo: "company",
    artifactType: "spec",
    system: "Company",
    prefix: "COS",
    status: "approved",
    title: "COS-0 — Company OS Dev Cockpit",
    mtime: iso(NOW - 2 * HOUR),
  }),
  artifact("specs/coaching/MTP-omnibus.md", {
    repo: "juice-bar",
    artifactType: "spec",
    system: "JB",
    prefix: "MTP",
    status: "in_progress",
    title: "MTP Coaching Engine (omnibus)",
    mtime: iso(NOW - 6 * HOUR),
  }),
  artifact("reports/handoffs/2026-06-22-ssf-04-resume.md", {
    repo: "company",
    artifactType: "handoff",
    system: "JB",
    prefix: "SSF",
    title: "SSF-04 reconciliation rehaul — resume handoff",
    mtime: iso(NOW - DAY),
  }),
  artifact("reports/review-cannons/2026-06-23-cos-0e-kanban.md", {
    repo: "company",
    artifactType: "cannons",
    system: "Company",
    prefix: "COS",
    status: "ship",
    title: "COS-0e Kanban UI — cannons report",
    mtime: iso(NOW - 3 * HOUR),
  }),
  artifact("reports/reviews/2026-06-21-arc-pipeline.md", {
    repo: "arc-scraper",
    artifactType: "cannons",
    system: "ARC",
    prefix: "LDI",
    title: null, // exercises the baseName fallback
    mtime: iso(NOW - 5 * DAY),
  }),
  artifact("reports/standup/2026-06-23.md", {
    repo: "company",
    artifactType: "routine_output",
    system: "Company",
    prefix: null, // exercises the (none) facet
    title: "Daily standup — 2026-06-23",
    mtime: iso(NOW - 2 * HOUR),
  }),
];

// --- Routines: one of each verdict, computed by the real projection ------------
const ROUTINES = [
  // CTO daily standup — artifact 2h old (within the 1d window) → fresh.
  routine("daily-standup", "daily", "company/reports/standup/**/*.md", { displayName: "Daily Standup", ownerAgent: "CTO", lastRunAt: iso(NOW - 2 * HOUR) }),
  // COO weekly compliance — artifact 9d old (within (7d, 14d]) → stale.
  routine("weekly-compliance", "weekly", "company/reports/weekly-compliance/**/*.md", { displayName: "Process Enforcement (Weekly)", ownerAgent: "COO", lastRunAt: iso(NOW - 9 * DAY) }),
  // CEO weekly summary — ran 1h ago but no matching artifact → missing.
  routine("weekly-summary", "weekly", "company/reports/weekly-summary/**/*.md", { displayName: "Weekly Strategic Summary (Friday)", ownerAgent: "CEO", lastRunAt: iso(NOW - 1 * HOUR) }),
  // Librarian daily awareness — no run, no artifact → never_ran.
  routine("daily-awareness", "daily", "company/reports/awareness/**/*.md", { displayName: "Daily Codebase Awareness", ownerAgent: "Librarian" }),
];

// Artifacts the routines join against (separate from the Reports-tab artifacts above).
const ROUTINE_ARTIFACTS = [
  artifact("reports/standup/2026-06-23.md", { repo: "company", artifactType: "routine_output", mtime: iso(NOW - 2 * HOUR) }),
  artifact("reports/weekly-compliance/2026-06-14.md", { repo: "company", artifactType: "routine_output", mtime: iso(NOW - 9 * DAY) }),
];

function bundle(batches: SignalBatch[]): SignalBundle {
  return { collectedAt: NOW, batches };
}

export function goldenArtifactIndex(): ArtifactIndexV1 {
  return deriveArtifactIndex(
    bundle([
      { source: "artifact", collectedAt: NOW, signals: ARTIFACTS, repoFreshness: [live("company"), live("juice-bar"), staleArc()] },
    ]),
    NOW,
  );
}

export function goldenRoutineHealth(): RoutineHealthV1 {
  return deriveRoutineHealth(
    bundle([
      { source: "routine-contract", collectedAt: NOW, signals: [...ROUTINES, ...ROUTINE_ARTIFACTS], repoFreshness: [live("company")] },
    ]),
    NOW,
  );
}

/** An empty (but valid) artifact index — the cold/empty-workspace state. */
export function emptyArtifactIndex(): ArtifactIndexV1 {
  return deriveArtifactIndex(bundle([{ source: "artifact", collectedAt: NOW, signals: [], repoFreshness: [live("company")] }]), NOW);
}

// --- report-content payloads (validated) ---------------------------------------
const SAMPLE_MARKDOWN = `# COS-0 — Company OS Dev Cockpit\n\nA first-party Paperclip plugin: an auto-updating Kanban plus a docs/reports + routines viewer.\n\n## Status\n\n- **Board** — shipped (COS-0e)\n- **Reports + Routines** — this phase (COS-0f)\n\n> Read-only over the product repos.\n`;

export function okMarkdownContent(): ReportContentV1 {
  return parseReportContentV1({
    schemaVersion: REPORT_CONTENT_SCHEMA_VERSION,
    repo: "company",
    relPath: "docs/superpowers/specs/2026-06-23-COS-0-company-os-cockpit.md",
    status: "ok",
    renderMode: "markdown",
    content: SAMPLE_MARKDOWN,
    sizeBytes: SAMPLE_MARKDOWN.length,
    mtime: iso(NOW - 2 * HOUR),
    title: "COS-0 — Company OS Dev Cockpit",
    artifactType: "spec",
    message: null,
  });
}

export function tooLargeContent(): ReportContentV1 {
  return parseReportContentV1({
    schemaVersion: REPORT_CONTENT_SCHEMA_VERSION,
    repo: "juice-bar",
    relPath: "specs/coaching/MTP-omnibus.md",
    status: "too_large",
    renderMode: "none",
    content: null,
    sizeBytes: 2_400_000,
    mtime: iso(NOW - 6 * HOUR),
    title: "MTP Coaching Engine (omnibus)",
    artifactType: "spec",
    message: "This file is 2.4 MB (cap 1.0 MB) — open it in your editor.",
  });
}
