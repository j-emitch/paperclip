import { describe, expect, it } from "vitest";
import type { ArtifactSignal } from "../../src/contracts/signals.js";
import { evaluateRoutine } from "../../src/projections/routine-freshness.js";
import { NOW, artifact, routine } from "../fixtures/signals.js";

describe("evaluateRoutine", () => {
  it("filters artifact freshness by selector, exclude, and owner provenance", () => {
    const ev = evaluateRoutine(
      routine("daily-codebase-awareness", "daily", "company/reports/journal/*.md", {
        ownerAgent: "Librarian",
        freshnessKind: "artifact",
        exclude: [
          "company/reports/journal/*-knowledge-audit*.md",
          "company/reports/journal/*-worktree-sweep.md",
        ],
      }),
      [
        artifact("reports/journal/2026-06-23-codebase-awareness.md", {
          repo: "company",
          mtime: "2026-06-23T08:00:00.000Z",
          createdBy: "librarian",
        }),
        artifact("reports/journal/2026-06-23-codebase-awareness-foreign.md", {
          repo: "company",
          mtime: "2026-06-23T11:30:00.000Z",
          createdBy: "context-freshness",
        }),
        artifact("reports/journal/2026-06-23-codebase-awareness-research.md", {
          repo: "company",
          mtime: "2026-06-23T11:15:00.000Z",
          createdBy: "Researcher agent",
        }),
        artifact("reports/journal/2026-06-23-knowledge-audit-lyc-511.md", {
          repo: "company",
          mtime: "2026-06-23T11:45:00.000Z",
          createdBy: "Librarian Agent",
        }),
      ],
      NOW,
    );

    expect(ev.freshnessKind).toBe("artifact");
    expect(ev.verdict).toBe("fresh");
    expect(ev.latest?.relPath).toBe("reports/journal/2026-06-23-codebase-awareness.md");
  });

  it("uses selector fallback for legacy artifacts with absent created_by", () => {
    const ev = evaluateRoutine(
      routine("daily-standup", "daily", "company/reports/standup/*.md", {
        ownerAgent: "CTO",
        freshnessKind: "artifact",
      }),
      [
        artifact("reports/standup/2026-06-23.md", {
          repo: "company",
          mtime: "2026-06-23T08:00:00.000Z",
          createdBy: null,
        }),
      ],
      NOW,
    );

    expect(ev.latest?.relPath).toBe("reports/standup/2026-06-23.md");
    expect(ev.verdict).toBe("fresh");
  });

  it("uses selector fallback for cached legacy artifacts with a missing createdBy key", () => {
    const { createdBy, ...legacyArtifact } = artifact("reports/standup/2026-06-23.md", {
      repo: "company",
      mtime: "2026-06-23T08:00:00.000Z",
    });
    expect(createdBy).toBeNull();

    const ev = evaluateRoutine(
      routine("daily-standup", "daily", "company/reports/standup/*.md", {
        ownerAgent: "CTO",
        freshnessKind: "artifact",
      }),
      [legacyArtifact as unknown as ArtifactSignal],
      NOW,
    );

    expect(ev.latest?.relPath).toBe("reports/standup/2026-06-23.md");
    expect(ev.verdict).toBe("fresh");
  });

  it("evaluates proposal routines against proposalSource and embedded routines as duties-only", () => {
    const proposal = evaluateRoutine(
      routine("R9f-context-rollup-stewardship", "weekly", "company/reports/paperclip/tickets/LYC-*.md", {
        ownerAgent: "Librarian",
        freshnessKind: "proposal",
        proposalSource: "company/reports/paperclip/tickets/LYC-*.md",
      }),
      [artifact("reports/paperclip/tickets/LYC-511.md", { repo: "company", mtime: "2026-06-23T09:00:00.000Z" })],
      NOW,
    );
    const embedded = evaluateRoutine(
      routine("wiki-maintenance", "daily scan", "", { ownerAgent: "Librarian", freshnessKind: "embedded" }),
      [],
      NOW,
    );

    expect(proposal).toMatchObject({ freshnessKind: "proposal", verdict: "fresh", present: true });
    expect(embedded).toMatchObject({ freshnessKind: "embedded", verdict: null, latest: undefined, present: false });
  });
});
