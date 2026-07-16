import { describe, expect, it, vi } from "vitest";
import { docsSource } from "../../src/sources/DocsSource.js";
import { isArtifactSignal, isDocSignal, type DocSignal } from "../../src/contracts/signals.js";
import { MAX_DOCS_PER_REPO } from "../../src/contracts/doc-index.js";
import { makeFixtureContext, type FixtureFs } from "../fixtures/context.js";
import type { WorktreeCheckout } from "../../src/contracts/collection-context.js";

const WT_AAA: WorktreeCheckout = { key: "company::wt::aaa", checkoutId: "worktree:aaa", parentRepoKey: "company", branch: "docs/COS-1", name: "cos-COS-1" };
const WT_BBB: WorktreeCheckout = { key: "company::wt::bbb", checkoutId: "worktree:bbb", parentRepoKey: "company", branch: "feat/x", name: "codex-wt" };

function fixtureFiles(): FixtureFs {
  return {
    company: {
      "specs/main.md": { content: "---\ntitle: Main Spec\nstatus: shipped\n---\n# Body" },
      "docs/superpowers/plans/2026-06-25-p.md": { content: "---\ntitle: A Plan\n---\n# Plan body" },
      "company/reports/handoffs/h.md": { content: "# A Handoff" },
      "backlog/b.md": { content: "# Backlog item" },
      // A handoff UNDER .claude/worktrees — must be pruned from the MAIN scan (it
      // belongs to the worktree checkout, never checkoutId:"main").
      ".claude/worktrees/cos-COS-1/handoffs/leak.md": { content: "# leak" },
      // The interim review mirror — must be excluded.
      "docs/review/cos-1/handoffs/mirror.md": { content: "# mirror" },
      // Archived docs — pruned by bare dir NAME at any depth (WF-09 convention;
      // the mass that was starving the MAX_DOCS_PER_REPO budget).
      "reports/handoffs/archive/consumed.md": { content: "# consumed handoff" },
      "archive/context-decisions/rollup-handoffs/old.md": { content: "# rollup" },
      "backlog/archive/done.md": { content: "# done backlog" },
    },
    "company::wt::aaa": {
      "specs/main.md": { content: "---\ntitle: Worktree Spec\n---\n# Body" },
      "handoffs/wt-handoff.md": { content: "# Worktree Handoff" },
      // Worktrees carry the same repo tree — their archives are pruned too.
      "reports/handoffs/archive/wt-consumed.md": { content: "# wt consumed" },
      // Dependency dirs: the root-wildcard handoffs glob must not index these.
      "node_modules/some-pkg/handoffs/pkg.md": { content: "# pkg noise" },
    },
    "company::wt::bbb": {
      "specs/oor.md": { content: "# Out-of-root Spec" },
    },
  };
}

function run(files: FixtureFs, worktrees: WorktreeCheckout[] = [WT_AAA, WT_BBB]) {
  const ctx = makeFixtureContext({ repos: [{ repo: "company", available: true }], worktrees, files });
  return { ctx, collect: () => docsSource.collect(ctx) };
}

describe("DocsSource", () => {
  it("emits DocSignals (not ArtifactSignals) across main + worktrees with distinct provenance", async () => {
    const { collect } = run(fixtureFiles());
    const batch = await collect();
    const docs = batch.signals.filter(isDocSignal) as DocSignal[];

    expect(batch.signals.some(isArtifactSignal)).toBe(false); // a distinct kind, never an artifact
    expect(docs.every((d) => d.repo === "company")).toBe(true);
    expect(docs.every((d) => !("projectKey" in d))).toBe(true); // resolved at projection time (PF-5)

    const byCheckout = new Map<string, DocSignal[]>();
    for (const d of docs) byCheckout.set(d.checkoutId, [...(byCheckout.get(d.checkoutId) ?? []), d]);
    expect([...byCheckout.keys()].sort()).toEqual(["main", "worktree:aaa", "worktree:bbb"]);

    // Main vs each worktree → distinct checkoutKey + docId for the same relPath.
    const mainSpec = docs.find((d) => d.checkoutId === "main" && d.relPath === "specs/main.md")!;
    const wtSpec = docs.find((d) => d.checkoutId === "worktree:aaa" && d.relPath === "specs/main.md")!;
    expect(mainSpec.checkoutKey).toBe("company");
    expect(wtSpec.checkoutKey).toBe("company::wt::aaa");
    expect(mainSpec.docId).not.toBe(wtSpec.docId);
    expect(mainSpec.worktreeName).toBeNull();
    expect(wtSpec.worktreeName).toBe("cos-COS-1"); // basename, never an abs path
    expect(wtSpec.branch).toBe("docs/COS-1");
  });

  it("indexes the OUT-of-root worktree", async () => {
    const { collect } = run(fixtureFiles());
    const docs = (await collect()).signals.filter(isDocSignal) as DocSignal[];
    const oor = docs.find((d) => d.checkoutId === "worktree:bbb");
    expect(oor?.relPath).toBe("specs/oor.md");
    expect(oor?.worktreeName).toBe("codex-wt");
  });

  it("the MAIN scan walk-time-prunes .claude/worktrees + docs/review (no checkoutId:main leak)", async () => {
    const { collect } = run(fixtureFiles());
    const docs = (await collect()).signals.filter(isDocSignal) as DocSignal[];
    // The leaked + mirror handoffs must NEVER appear as a main-checkout doc.
    expect(docs.some((d) => d.checkoutId === "main" && d.relPath.includes(".claude/worktrees"))).toBe(false);
    expect(docs.some((d) => d.checkoutId === "main" && d.relPath.includes("docs/review"))).toBe(false);
    // The worktree's OWN handoff is found under the worktree checkout.
    expect(docs.some((d) => d.checkoutId === "worktree:aaa" && d.relPath === "handoffs/wt-handoff.md")).toBe(true);
  });

  it("prunes archive/ dirs by bare name at any depth, on main AND worktree scans", async () => {
    const { collect } = run(fixtureFiles());
    const docs = (await collect()).signals.filter(isDocSignal) as DocSignal[];
    // Main: consumed handoffs, the context-decisions rollup, archived backlog — all pruned.
    expect(docs.some((d) => d.relPath.split("/").includes("archive"))).toBe(false);
    // Worktree: same prune (previously worktrees scanned with NO exclude at all).
    expect(docs.some((d) => d.checkoutId === "worktree:aaa" && d.relPath.includes("archive"))).toBe(false);
    // Dependency dirs never feed the root-wildcard handoffs glob.
    expect(docs.some((d) => d.relPath.includes("node_modules"))).toBe(false);
    // The prune is by DIRECTORY name — live docs adjacent to archives still index.
    expect(docs.some((d) => d.checkoutId === "main" && d.relPath === "company/reports/handoffs/h.md")).toBe(true);
    expect(docs.some((d) => d.checkoutId === "main" && d.relPath === "backlog/b.md")).toBe(true);
  });

  it("classifies doc types by precedence + reads title from the frontmatter head", async () => {
    const { collect } = run(fixtureFiles(), []); // main only
    const docs = (await collect()).signals.filter(isDocSignal) as DocSignal[];
    const byPath = (p: string) => docs.find((d) => d.relPath === p)!;
    expect(byPath("specs/main.md").docType).toBe("spec");
    expect(byPath("specs/main.md").title).toBe("Main Spec");
    expect(byPath("specs/main.md").status).toBe("shipped");
    expect(byPath("docs/superpowers/plans/2026-06-25-p.md").docType).toBe("plan");
    expect(byPath("company/reports/handoffs/h.md").docType).toBe("handoff");
    expect(byPath("company/reports/handoffs/h.md").title).toBe("A Handoff"); // first H1 (no frontmatter)
    expect(byPath("backlog/b.md").docType).toBe("backlog");
  });

  it("resolves DocSignal.prefix + verified (COS-5) from frontmatter id / filename / *_verified", async () => {
    const files: FixtureFs = {
      company: {
        // Frontmatter id + spec_verified approved → prefix COS, verified true.
        "specs/atlas.md": { content: "---\nid: COS-5\ntitle: Atlas\nspec_verified: approved\n---\n# Atlas" },
        // No id → filename ticket fallback (COS-3), and no *_verified → verified false.
        "specs/2026-07-01-COS-3-build.md": { content: "---\ntitle: Build\n---\n# Build" },
        // Plan with plan_verified pending → verified false.
        "docs/superpowers/plans/COS-5-plan.md": { content: "---\nid: COS-5\nplan_verified: pending\n---\n# Plan" },
        // Plan approved → verified true.
        "docs/superpowers/plans/COS-1-plan.md": { content: "---\nid: COS-1\nplan_verified: approved\n---\n# Plan" },
        // No ticket anywhere → prefix null.
        "specs/manifesto.md": { content: "---\ntitle: Manifesto\n---\n# No ticket" },
        // A handoff carrying spec_verified must NOT be treated as verified (wrong docType).
        "company/reports/handoffs/COS-9-h.md": { content: "---\nid: COS-9\nspec_verified: approved\n---\n# Handoff" },
      },
    };
    const docs = (await run(files, []).collect()).signals.filter(isDocSignal) as DocSignal[];
    const byPath = (p: string) => docs.find((d) => d.relPath === p)!;

    expect(byPath("specs/atlas.md").prefix).toBe("COS");
    expect(byPath("specs/atlas.md").verified).toBe(true);
    expect(byPath("specs/2026-07-01-COS-3-build.md").prefix).toBe("COS"); // filename fallback
    expect(byPath("specs/2026-07-01-COS-3-build.md").verified).toBe(false);
    expect(byPath("docs/superpowers/plans/COS-5-plan.md").verified).toBe(false); // pending
    expect(byPath("docs/superpowers/plans/COS-1-plan.md").verified).toBe(true); // approved
    expect(byPath("specs/manifesto.md").prefix).toBeNull();
    // Handoff docType never reads spec_verified.
    expect(byPath("company/reports/handoffs/COS-9-h.md").verified).toBe(false);
    expect(byPath("company/reports/handoffs/COS-9-h.md").prefix).toBe("COS");
  });

  it("reads HEAD-only (readTextHead, never the whole-file readText)", async () => {
    const { ctx, collect } = run(fixtureFiles(), []);
    const headSpy = vi.spyOn(ctx.fs, "readTextHead");
    const textSpy = vi.spyOn(ctx.fs, "readText");
    await collect();
    expect(headSpy).toHaveBeenCalled();
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("records a degraded read without throwing", async () => {
    const { ctx, collect } = run(fixtureFiles(), []);
    vi.spyOn(ctx.fs, "readTextHead").mockRejectedValueOnce(new Error("path escapes workspace: specs/main.md"));
    const batch = await collect();
    const docs = batch.signals.filter(isDocSignal) as DocSignal[];
    expect(docs.length).toBeGreaterThan(0); // other docs still indexed
    expect(batch.repoFreshness[0]!.errors.length).toBeGreaterThan(0);
    expect(batch.repoFreshness[0]!.freshness).toBe("stale");
  });

  it("caps at MAX_DOCS_PER_REPO with a 'truncated' diagnostic (no silent drop)", async () => {
    const many: Record<string, { content: string }> = {};
    for (let i = 0; i < MAX_DOCS_PER_REPO + 5; i++) many[`specs/s${i}.md`] = { content: `# Spec ${i}` };
    const { collect } = run({ company: many }, []);
    const batch = await collect();
    const docs = batch.signals.filter(isDocSignal) as DocSignal[];
    expect(docs).toHaveLength(MAX_DOCS_PER_REPO);
    expect(batch.repoFreshness[0]!.errors.some((e) => e.code === "truncated")).toBe(true);
    expect(batch.repoFreshness[0]!.freshness).toBe("live"); // truncation is non-degraded
  });
});

describe("DocsSource — C1 §2.3 spine fields", () => {
  it("lifts owner/lastUpdated/statusVerifiedAt/description from the frontmatter head", async () => {
    const files: FixtureFs = {
      company: {
        "specs/full.md": {
          content:
            "---\ntitle: Full Spec\nstatus: active\nowner: joe\nlast_updated: 2026-07-01\nstatus_verified_at: 2026-07-02\ndescription: The one-line summary.\n---\n# H1\n\nBody paragraph here.",
        },
        // No description/summary → the first body paragraph is the fallback; `date` backs last_updated.
        "specs/fallback.md": { content: "---\ntitle: Fallback\nstatus: draft\ndate: 2026-06-30\n---\n# Heading\n\nFirst real paragraph of the body.\n\nSecond." },
        // No frontmatter at all → all four are null except description (body paragraph).
        "specs/bare.md": { content: "# Bare\n\nJust a body." },
      },
    };
    const { collect } = run(files, []);
    const docs = (await collect()).signals.filter(isDocSignal) as DocSignal[];
    const byPath = (p: string) => docs.find((d) => d.relPath === p)!;

    const full = byPath("specs/full.md");
    expect(full.owner).toBe("joe");
    expect(full.lastUpdated).toBe("2026-07-01");
    expect(full.statusVerifiedAt).toBe("2026-07-02");
    expect(full.description).toBe("The one-line summary.");

    const fb = byPath("specs/fallback.md");
    expect(fb.owner).toBeNull();
    expect(fb.lastUpdated).toBe("2026-06-30"); // `date` fallback
    expect(fb.statusVerifiedAt).toBeNull();
    expect(fb.description).toBe("First real paragraph of the body.");

    const bare = byPath("specs/bare.md");
    expect(bare.owner).toBeNull();
    expect(bare.lastUpdated).toBeNull();
    expect(bare.description).toBe("Just a body.");
  });
});

describe("DocsSource — codex order-0 fold: prefix: frontmatter attribution", () => {
  it("attributes a doc via canonical `prefix:` when no id/ticket/filename ticket exists", async () => {
    const files: FixtureFs = {
      company: {
        "specs/OFFICE-MANAGEMENT-SPEC.md": { content: "---\ntitle: OM\nprefix: OM\n---\n# OM" },
        "specs/bad-prefix.md": { content: "---\ntitle: X\nprefix: not-a-prefix\n---\n# X" },
      },
    };
    const { collect } = run(files, []);
    const docs = (await collect()).signals.filter(isDocSignal) as DocSignal[];
    expect(docs.find((d) => d.relPath.includes("OFFICE"))?.prefix).toBe("OM");
    expect(docs.find((d) => d.relPath.includes("bad-prefix"))?.prefix).toBeNull(); // shape-gated
  });
});
