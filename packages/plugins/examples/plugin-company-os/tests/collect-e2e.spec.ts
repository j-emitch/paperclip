import { describe, expect, it } from "vitest";
import { collect } from "../src/collect.js";
import { allSignals } from "../src/contracts/WorkSignalSource.js";
import {
  isArtifactSignal,
  isReviewSignal,
  isRoutineSignal,
  isTaxonomySignal,
  isWorkSignal,
} from "../src/contracts/signals.js";
import type { RegistryEntry } from "../src/contracts/registry.js";
import { makeFixtureContext, gitTable, proc } from "./fixtures/context.js";

const REGISTRY: RegistryEntry[] = [
  { prefix: "COS", family: "Company OS", l1_system: "Company", l2_subsystem: "Company-OS", description: "x", is_generic: false, created_at: "2026-06-23" },
  { prefix: "OB", family: "Onboarding", l1_system: "JB", l2_subsystem: "Onboarding", description: "y", is_generic: false, created_at: null },
];

const AGENTS = `# CTO
\`\`\`yaml
company_os:
  routines:
    - id: daily-standup
      display_name: Daily Standup
      cadence: daily
      expected_artifact: company/reports/standup/*.md
      owner_agent: CTO
\`\`\`
`;

/**
 * A scenario where COS-0 deliberately surfaces from THREE sources at once:
 * a worktree branch (in_progress/branch_path), an open PR (in_review/pr_scope),
 * and a planned spec (next_up/spec_frontmatter) — the projection's job is to
 * resolve these; collect's job is to faithfully assemble all of them.
 */
function fullContext() {
  return makeFixtureContext({
    repos: [
      { repo: "juice-bar", available: true },
      { repo: "company", available: true },
    ],
    registry: REGISTRY,
    git: gitTable({
      "worktree list --porcelain": proc.ok("worktree /r/main\nHEAD a\nbranch refs/heads/main\n\nworktree /r/wt\nHEAD bbb\nbranch refs/heads/claude/COS-0\n"),
      "log -1 --format=%s bbb": proc.ok("feat(COS-0c): wip"),
      "log --first-parent": proc.ok(`m1\x1f2026-05-01T00:00:00Z\x1ffeat(OB-01): step engine\x1f\x1e`),
    }),
    gh: (repo) =>
      repo === "juice-bar"
        ? proc.ok(JSON.stringify([{ number: 5, title: "feat(COS-0): cockpit", headRefName: "claude/COS-0", headRefOid: "bbb", url: "u", isDraft: false, updatedAt: "t" }]))
        : proc.ok("[]"),
    files: {
      "juice-bar": {
        "specs/COS-0.md": { content: `---\nid: COS-0\nstatus: planned\ntitle: Cockpit\n---\n` },
        "CONTEXT.md": { content: `## What's In Progress\n- COS-0 cockpit\n` },
        "reports/review-cannons/2026-05-01-OB-01.md": { content: `---\ntype: cannons-report\nrepo: juice-bar\ncommit: m1\nverdict: ship\nrun_at: 2026-05-01T00:00:00Z\n---\n` },
      },
      company: {
        "config/paperclip/agents/cto/AGENTS.md": { content: AGENTS },
      },
    },
  });
}

describe("collect (end-to-end bundle assembly)", () => {
  it("assembles one batch per source, none failing", async () => {
    const { bundle, failedSources } = await collect(fullContext());
    expect(failedSources).toEqual([]);
    expect(bundle.batches.map((b) => b.source).sort()).toEqual(
      ["artifact", "git-work", "prefix-registry", "pull-request", "review-report", "routine-contract", "spec-backlog"].sort(),
    );
  });

  it("COS-0 surfaces from three independent sources with distinct precedence", async () => {
    const sigs = allSignals((await collect(fullContext())).bundle);
    const cos0Work = sigs.filter(isWorkSignal).filter((s) => s.ticketId === "COS-0");
    const precByState = new Set(cos0Work.map((s) => `${s.state}:${s.precedence}`));
    expect(precByState.has("in_progress:branch_path")).toBe(true); // GitWorkSource
    expect(precByState.has("in_review:pr_scope")).toBe(true); // PullRequestSource
    expect(precByState.has("next_up:spec_frontmatter")).toBe(true); // SpecBacklogSource
  });

  it("produces every signal KIND across the bundle", async () => {
    const sigs = allSignals((await collect(fullContext())).bundle);
    expect(sigs.some(isWorkSignal)).toBe(true);
    expect(sigs.some(isArtifactSignal)).toBe(true);
    expect(sigs.some(isReviewSignal)).toBe(true);
    expect(sigs.some(isRoutineSignal)).toBe(true);
    expect(sigs.some(isTaxonomySignal)).toBe(true);
  });

  it("the OB-01 cannons review joins by sha to the shipped commit (both reference m1)", async () => {
    const sigs = allSignals((await collect(fullContext())).bundle);
    const review = sigs.filter(isReviewSignal).find((r) => r.sha === "m1");
    const shipped = sigs.filter(isWorkSignal).find((s) => s.state === "shipped" && s.ticketId === "OB-01");
    expect(review?.verdict).toBe("ship");
    expect(shipped?.sha).toBe("m1"); // the projection's join key is available end-to-end
  });

  it("a thrown source is contained, not fatal", async () => {
    const ctx = fullContext();
    const exploding = { id: "boom", collect: async () => { throw new Error("kaboom"); } };
    const { failedSources, bundle } = await collect(ctx, [exploding]);
    expect(failedSources).toEqual(["boom"]);
    expect(bundle.batches[0]).toMatchObject({ source: "boom", signals: [] });
  });
});
