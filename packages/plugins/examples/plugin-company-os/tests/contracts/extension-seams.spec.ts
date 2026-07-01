import { describe, expect, it } from "vitest";
import {
  ARTIFACT_TYPES,
  WORK_STATES,
  allSignals,
  artifactTypeSchema,
  boardStateV1Schema,
  columnIdSchema,
  isBranchSignal,
  isDocSignal,
  isAgentSignal,
  isRepoGitSignal,
  parseArtifactIndexV1,
  parseBoardStateV1,
  parseRoutineHealthV1,
  safeParseBoardStateV1,
  type ArtifactSignal,
  type Clock,
  type CollectionContext,
  type KnowledgeSource,
  type RepoRoot,
  type Signal,
  type SignalBatch,
  type SignalBundle,
  type TeachingSignalSource,
  type WorkSignal,
  type WorkSignalSource,
  reposResponsibleFor,
  reposReadableInScope,
} from "../../src/contracts/index.js";
import { agentSignal, branchSignal, docSignal, repoGitSignal, routine } from "../fixtures/signals.js";

// ---------------------------------------------------------------------------
// Fixtures — a minimal in-memory CollectionContext (no git/gh/fs touched).
// The whole point of the seam: sources are testable with zero host/Node deps.
// ---------------------------------------------------------------------------

const fixedClock: Clock = { now: () => 1_700_000_000_000 };

function fakeContext(overrides: Partial<CollectionContext> = {}): CollectionContext {
  const repos: readonly RepoRoot[] = [{ repo: "company", available: true }];
  const notUsed = () => {
    throw new Error("runner must not be touched by these dummy sources");
  };
  return {
    repos,
    worktrees: [],
    scopeRepo: null,
    git: { run: notUsed },
    gh: { run: notUsed },
    fs: {
      list: async () => [],
      readText: async () => "",
      readTextHead: async () => "",
      stat: async () => null,
    },
    clock: fixedClock,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registry: { load: async () => ({ entries: [], errors: [] }) },
    hash: (input: string) => `stub:${input.length}`,
    ...overrides,
  };
}

function artifactSignal(
  source: string,
  artifactType: ArtifactSignal["artifactType"],
  relPath: string,
): ArtifactSignal {
  return {
    kind: "artifact",
    source,
    repo: "company",
    path: relPath,
    relPath,
    mtime: "2026-06-23T00:00:00.000Z",
    artifactType,
    system: "Company",
    prefix: null,
    status: null,
    sha256: "deadbeef",
    sizeBytes: 128,
    title: null,
    createdBy: null,
    confidence: "high",
    freshness: "live",
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// COS-1 / COS-2 extension seams compose with the pipeline
// ---------------------------------------------------------------------------

describe("extension seams", () => {
  it("a dummy TeachingSignalSource (COS-1) is a WorkSignalSource emitting typed artifact signals", async () => {
    const teaching: TeachingSignalSource = {
      id: "teaching",
      extensionKind: "teaching",
      async collect(ctx): Promise<SignalBatch> {
        return {
          source: "teaching",
          collectedAt: ctx.clock.now(),
          signals: [artifactSignal("teaching", "teaching", "docs/teachings/units/u1.md")],
          repoFreshness: [{ repo: "company", freshness: "live", lastOkAt: null, errors: [] }],
        };
      },
    };

    // It satisfies the base seam (assignable to WorkSignalSource) without special-casing.
    const asBase: WorkSignalSource = teaching;
    const batch = await asBase.collect(fakeContext());

    expect(batch.source).toBe("teaching");
    expect(batch.signals).toHaveLength(1);
    const sig = batch.signals[0];
    expect(sig.kind).toBe("artifact");
    expect(sig.kind === "artifact" && sig.artifactType).toBe("teaching");
  });

  it("a dummy KnowledgeSource (COS-2) emits knowledge artifacts through the same seam", async () => {
    const knowledge: KnowledgeSource = {
      id: "knowledge",
      extensionKind: "knowledge",
      async collect(ctx): Promise<SignalBatch> {
        return {
          source: "knowledge",
          collectedAt: ctx.clock.now(),
          signals: [artifactSignal("knowledge", "knowledge", "company/library/topics/x.md")],
          repoFreshness: [{ repo: "company", freshness: "live", lastOkAt: null, errors: [] }],
        };
      },
    };
    const batch = await knowledge.collect(fakeContext());
    expect(batch.signals[0]?.kind).toBe("artifact");
    expect(batch.signals[0] && "artifactType" in batch.signals[0] && batch.signals[0].artifactType).toBe(
      "knowledge",
    );
  });

  it("existing-shape sources are unaffected — a WorkSignal source coexists in one bundle", async () => {
    const gitWork: WorkSignalSource = {
      id: "git-work",
      async collect(ctx): Promise<SignalBatch> {
        const work: WorkSignal = {
          kind: "work",
          source: "git-work",
          repo: "company",
          confidence: "high",
          freshness: "live",
          errors: [],
          ticketId: "COS-0b",
          prefix: "COS",
          state: "in_progress",
          precedence: "branch_path",
          evidence: "cos/COS-0",
        };
        return {
          source: "git-work",
          collectedAt: ctx.clock.now(),
          signals: [work],
          repoFreshness: [{ repo: "company", freshness: "live", lastOkAt: null, errors: [] }],
        };
      },
    };

    const ctx = fakeContext();
    const bundle: SignalBundle = {
      collectedAt: ctx.clock.now(),
      batches: [await gitWork.collect(ctx)],
    };
    const flat = allSignals(bundle);
    expect(flat).toHaveLength(1);
    expect(flat[0]?.kind).toBe("work");
  });
});

// ---------------------------------------------------------------------------
// Collection scope — a source is responsible for unavailable repos (to emit a
// stale signal) but only READS the available ones
// ---------------------------------------------------------------------------

describe("collection scope (responsible vs readable)", () => {
  it("is RESPONSIBLE for an unavailable scoped repo (can emit a stale signal) but does NOT read it", () => {
    const ctx = fakeContext({
      scopeRepo: "arc-scraper",
      repos: [
        { repo: "company", available: true },
        { repo: "arc-scraper", available: false },
      ],
    });
    expect(reposResponsibleFor(ctx).map((r) => r.repo)).toEqual(["arc-scraper"]);
    expect(reposReadableInScope(ctx).map((r) => r.repo)).toEqual([]);
  });

  it("a full sweep is responsible for every configured repo; readable = the available subset", () => {
    const ctx = fakeContext({
      scopeRepo: null,
      repos: [
        { repo: "company", available: true },
        { repo: "arc-scraper", available: false },
      ],
    });
    expect(reposResponsibleFor(ctx).map((r) => r.repo)).toEqual(["company", "arc-scraper"]);
    expect(reposReadableInScope(ctx).map((r) => r.repo)).toEqual(["company"]);
  });
});

// ---------------------------------------------------------------------------
// Vocab single-source — every zod enum is built FROM the canonical tuple
// ---------------------------------------------------------------------------

describe("vocabulary single-source", () => {
  it("board columns equal the WORK_STATES tuple, in order", () => {
    expect(columnIdSchema.options).toEqual([...WORK_STATES]);
  });

  it("artifact-type enum equals the ARTIFACT_TYPES tuple", () => {
    expect(artifactTypeSchema.options).toEqual([...ARTIFACT_TYPES]);
  });
});

// ---------------------------------------------------------------------------
// Projection schemas validate end-to-end (the cohesion spine is real, not nominal)
// ---------------------------------------------------------------------------

describe("projection contracts validate", () => {
  const minimalBoard = {
    schemaVersion: 1 as const,
    derivedAt: "2026-06-23T00:00:00.000Z",
    sources: [],
    lanes: [],
    rows: [],
    columns: [...WORK_STATES],
    chips: [],
    diagnostics: [],
    unclassified: [],
  };

  it("a minimal BoardStateV1 round-trips through parse", () => {
    const parsed = parseBoardStateV1(minimalBoard);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.columns).toEqual([...WORK_STATES]);
  });

  it("a malformed BoardStateV1 (bad column) is rejected", () => {
    const bad = { ...minimalBoard, columns: ["not_a_column"] };
    expect(() => parseBoardStateV1(bad)).toThrow();
    expect(safeParseBoardStateV1(bad).success).toBe(false);
  });

  it("a wrong schemaVersion is rejected (forces a re-derive on read)", () => {
    expect(boardStateV1Schema.safeParse({ ...minimalBoard, schemaVersion: 2 }).success).toBe(false);
  });

  it("reordered or duplicated columns are rejected (superRefine, not just the enum)", () => {
    const reordered = { ...minimalBoard, columns: ["shipped", "next_up", "in_progress", "in_review"] };
    expect(safeParseBoardStateV1(reordered).success).toBe(false);
    const duplicated = { ...minimalBoard, columns: ["next_up", "next_up", "in_review", "shipped"] };
    expect(safeParseBoardStateV1(duplicated).success).toBe(false);
  });

  it("a typo'd countsByType key is rejected (key constrained to artifact types)", () => {
    const bad = {
      schemaVersion: 1,
      derivedAt: "2026-06-23T00:00:00.000Z",
      entries: [],
      countsByType: { spec: 1, typo: 2 },
      sources: [],
      diagnostics: [],
    };
    expect(() => parseArtifactIndexV1(bad)).toThrow();
  });

  it("minimal ArtifactIndexV1 + RoutineHealthV1 round-trip", () => {
    const index = parseArtifactIndexV1({
      schemaVersion: 1,
      derivedAt: "2026-06-23T00:00:00.000Z",
      entries: [],
      countsByType: { spec: 0 },
      sources: [],
      diagnostics: [],
    });
    expect(index.countsByType.spec).toBe(0);

    const health = parseRoutineHealthV1({
      schemaVersion: 1,
      derivedAt: "2026-06-23T00:00:00.000Z",
      routines: [],
      sources: [],
      diagnostics: [],
    });
    expect(health.routines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// COS-1 git/doc signal kinds — compose through the seam + the never-guard
// ---------------------------------------------------------------------------

/**
 * Exhaustive `switch (kind)` over ALL ten signal kinds. The `never` default is
 * the guard: add a tenth kind to the union without a case here and this file
 * stops compiling — so no projection fold can silently absorb a new kind.
 */
function kindOf(signal: Signal): Signal["kind"] {
  switch (signal.kind) {
    case "work":
      return "work";
    case "artifact":
      return "artifact";
    case "routine":
      return "routine";
    case "taxonomy":
      return "taxonomy";
    case "review":
      return "review";
    case "branch":
      return "branch";
    case "repo_git":
      return "repo_git";
    case "doc":
      return "doc";
    case "skill":
      return "skill";
    case "agent":
      return "agent";
    default: {
      const _exhaustive: never = signal;
      return _exhaustive;
    }
  }
}

describe("COS-1 signal kinds", () => {
  it("a BranchSource-shaped source composes through the WorkSignalSource seam", async () => {
    const source: WorkSignalSource = {
      id: "branch",
      async collect(ctx): Promise<SignalBatch> {
        return {
          source: "branch",
          collectedAt: ctx.clock.now(),
          signals: [
            repoGitSignal("juice-bar"),
            branchSignal("cos/COS-1", { repo: "juice-bar" }),
            branchSignal(null, { repo: "juice-bar", headSha: "deadbee" }),
          ],
          repoFreshness: [{ repo: "juice-bar", freshness: "live", lastOkAt: null, errors: [] }],
        };
      },
    };
    const batch = await source.collect(fakeContext());
    expect(batch.signals.map((s) => s.kind)).toEqual(["repo_git", "branch", "branch"]);
    expect(batch.signals.filter(isBranchSignal)).toHaveLength(2);
    expect(batch.signals.filter(isRepoGitSignal)).toHaveLength(1);
  });

  it("a DocsSource-shaped source composes through the same seam (checkoutKey + worktree provenance)", async () => {
    const source: WorkSignalSource = {
      id: "docs",
      async collect(ctx): Promise<SignalBatch> {
        return {
          source: "docs",
          collectedAt: ctx.clock.now(),
          signals: [
            docSignal("specs/COS-1.md", { repo: "company" }),
            docSignal("docs/superpowers/plans/p.md", {
              repo: "company",
              docType: "plan",
              checkoutId: "worktree:abc",
              checkoutKey: "company::wt::abc",
              worktreeName: "cos-COS-1",
              branch: "docs/COS-1",
            }),
          ],
          repoFreshness: [{ repo: "company", freshness: "live", lastOkAt: null, errors: [] }],
        };
      },
    };
    const batch = await source.collect(fakeContext());
    expect(batch.signals.every(isDocSignal)).toBe(true);
    const docs = batch.signals.filter(isDocSignal);
    expect(docs[0]?.worktreeName).toBeNull();
    expect(docs[1]?.worktreeName).toBe("cos-COS-1");
    expect(docs[1]?.checkoutKey).toBe("company::wt::abc");
  });

  it("an AgentSource-shaped source composes through the WorkSignalSource seam", async () => {
    const source: WorkSignalSource = {
      id: "agent",
      async collect(ctx): Promise<SignalBatch> {
        return {
          source: "agent",
          collectedAt: ctx.clock.now(),
          signals: [agentSignal("cto", { displayName: "CTO" })],
          repoFreshness: [{ repo: "company", freshness: "live", lastOkAt: null, errors: [] }],
        };
      },
    };
    const batch = await source.collect(fakeContext());
    expect(batch.signals).toHaveLength(1);
    expect(batch.signals.every(isAgentSignal)).toBe(true);
    expect(batch.signals[0]?.kind).toBe("agent");
  });

  it("routine signals can carry optional freshness metadata while legacy routines stay additive", () => {
    expect(routine("daily-standup", "daily", "company/reports/standup/*.md").freshnessKind).toBeUndefined();

    const proposal = routine("R9f-context-rollup-stewardship", "weekly", "company/reports/paperclip/tickets/*.md", {
      freshnessKind: "proposal",
      proposalSource: "company/reports/paperclip/tickets/*.md",
      exclude: ["company/reports/paperclip/tickets/archive/**"],
    });
    expect(proposal.freshnessKind).toBe("proposal");
    expect(proposal.proposalSource).toBe("company/reports/paperclip/tickets/*.md");
    expect(proposal.exclude).toEqual(["company/reports/paperclip/tickets/archive/**"]);
  });

  it("the kind switch is exhaustive over all ten kinds (compile-time never-guard)", () => {
    const samples: Signal[] = [
      branchSignal("main"),
      repoGitSignal("company"),
      docSignal("specs/x.md"),
      agentSignal("cto"),
    ];
    for (const s of samples) {
      expect(kindOf(s)).toBe(s.kind);
    }
  });
});
