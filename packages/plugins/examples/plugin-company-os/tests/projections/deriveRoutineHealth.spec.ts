import { describe, expect, it } from "vitest";
import { cadenceWindowMs, deriveRoutineHealth } from "../../src/projections/deriveRoutineHealth.js";
import { parseRoutineHealthV1 } from "../../src/contracts/routine-health.js";
import { NOW, artifact, bundleOf, routine } from "../fixtures/signals.js";

// NOW = 2026-06-23T12:00:00Z
describe("deriveRoutineHealth", () => {
  it("cadenceWindowMs maps tokens; cron → null", () => {
    expect(cadenceWindowMs("daily")).toBe(86_400_000);
    expect(cadenceWindowMs("weekly")).toBe(604_800_000);
    expect(cadenceWindowMs("0 9 * * 1")).toBeNull();
  });

  it("fresh when a matching artifact is within the cadence window", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("daily-standup", "daily", "company/reports/standup/*.md"),
        artifact("reports/standup/2026-06-23.md", { repo: "company", mtime: "2026-06-23T08:00:00.000Z" }),
      ]),
      NOW,
    );
    expect(health.routines[0]).toMatchObject({
      routineKey: "daily-standup",
      verdict: "fresh",
      expectedArtifactPresent: true,
      latestArtifactPath: "reports/standup/2026-06-23.md",
    });
    expect(() => parseRoutineHealthV1(health)).not.toThrow();
  });

  it("stale when the newest artifact is 1–2 windows old", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("daily-standup", "daily", "company/reports/standup/*.md"),
        artifact("reports/standup/old.md", { repo: "company", mtime: "2026-06-22T00:00:00.000Z" }), // ~36h old
      ]),
      NOW,
    );
    expect(health.routines[0].verdict).toBe("stale");
  });

  it("missing when the newest artifact is older than 2 windows", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("daily-standup", "daily", "company/reports/standup/*.md"),
        artifact("reports/standup/ancient.md", { repo: "company", mtime: "2026-06-19T00:00:00.000Z" }), // >4 days
      ]),
      NOW,
    );
    expect(health.routines[0].verdict).toBe("missing");
  });

  it("never_ran when no artifact matches and no last-run", () => {
    const health = deriveRoutineHealth(
      bundleOf([routine("weekly-report", "weekly", "company/reports/weekly/*.md")]),
      NOW,
    );
    expect(health.routines[0]).toMatchObject({ verdict: "never_ran", expectedArtifactPresent: false, latestArtifactPath: null });
  });

  it("a recent last-run with NO artifact is 'missing', not 'fresh' (ran, produced nothing)", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("daily-standup", "daily", "company/reports/standup/*.md", { lastRunAt: "2026-06-23T11:00:00.000Z" }),
      ]),
      NOW,
    );
    expect(health.routines[0]).toMatchObject({ verdict: "missing", expectedArtifactPresent: false });
  });

  it("matches the monorepo-parent glob against the repo-relative artifact path", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("weekly-report", "weekly", "company/reports/weekly/*.md"),
        artifact("reports/weekly/w26.md", { repo: "company", mtime: "2026-06-23T00:00:00.000Z" }),
      ]),
      NOW,
    );
    expect(health.routines[0].verdict).toBe("fresh");
  });

  it("uses selector, exclude, and owner provenance before choosing the newest artifact", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("daily-codebase-awareness", "daily", "company/reports/journal/*.md", {
          displayName: "Daily Codebase Awareness",
          ownerAgent: "Librarian",
          freshnessKind: "artifact",
          exclude: [
            "company/reports/journal/*-knowledge-audit*.md",
            "company/reports/journal/*-worktree-sweep.md",
          ],
        }),
        artifact("reports/journal/2026-06-23-codebase-awareness.md", {
          repo: "company",
          mtime: "2026-06-23T08:00:00.000Z",
          createdBy: "Librarian Agent (Paperclip)",
        }),
        artifact("reports/journal/2026-06-23-codebase-awareness-foreign.md", {
          repo: "company",
          mtime: "2026-06-23T11:30:00.000Z",
          createdBy: "worktree-sweep",
        }),
        artifact("reports/journal/2026-06-23-codebase-awareness-research.md", {
          repo: "company",
          mtime: "2026-06-23T11:00:00.000Z",
          createdBy: "Researcher agent",
        }),
        artifact("reports/journal/2026-06-23-knowledge-audit-lyc-511.md", {
          repo: "company",
          mtime: "2026-06-23T11:45:00.000Z",
          createdBy: "Librarian Agent",
        }),
      ]),
      NOW,
    );

    expect(health.routines[0]).toMatchObject({
      verdict: "fresh",
      latestArtifactPath: "reports/journal/2026-06-23-codebase-awareness.md",
      freshnessKind: "artifact",
    });
    expect(() => parseRoutineHealthV1(health)).not.toThrow();
  });

  it("keeps legacy artifacts with absent created_by on the selector fallback", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("daily-standup", "daily", "company/reports/standup/*.md", {
          ownerAgent: "CTO",
          freshnessKind: "artifact",
        }),
        artifact("reports/standup/2026-06-23.md", {
          repo: "company",
          mtime: "2026-06-23T08:00:00.000Z",
          createdBy: null,
        }),
      ]),
      NOW,
    );

    expect(health.routines[0].verdict).toBe("fresh");
  });

  it("evaluates proposal freshness from proposalSource", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("R9f-context-rollup-stewardship", "weekly", "company/reports/paperclip/tickets/LYC-*.md", {
          ownerAgent: "Librarian",
          freshnessKind: "proposal",
          proposalSource: "company/reports/paperclip/tickets/LYC-*.md",
        }),
        artifact("reports/paperclip/tickets/LYC-511.md", {
          repo: "company",
          mtime: "2026-06-23T09:00:00.000Z",
          createdBy: "user",
        }),
      ]),
      NOW,
    );

    expect(health.routines[0]).toMatchObject({
      verdict: "fresh",
      expectedArtifactPresent: true,
      latestArtifactPath: "reports/paperclip/tickets/LYC-511.md",
      freshnessKind: "proposal",
    });
  });

  it("renders embedded duties as nullable-verdict routine entries", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("wiki-maintenance", "daily scan", "", {
          ownerAgent: "Librarian",
          freshnessKind: "embedded",
        }),
      ]),
      NOW,
    );

    expect(health.routines[0]).toMatchObject({
      freshnessKind: "embedded",
      verdict: null,
      expectedArtifactPresent: false,
      latestArtifactPath: null,
    });
    expect(() => parseRoutineHealthV1(health)).not.toThrow();
  });
});
