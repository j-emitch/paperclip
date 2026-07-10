import { describe, expect, it } from "vitest";
import { specBacklogSource } from "../../src/sources/SpecBacklogSource.js";
import { isWorkSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext } from "../fixtures/context.js";

describe("SpecBacklogSource", () => {
  it("emits a next_up signal for a not-yet-started spec", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: {
        "juice-bar": {
          "specs/OM-15-pay-rate.md": { content: `---\nid: OM-15\nstatus: planned\ntitle: Pay rate UI\n---\n` },
        },
      },
    });
    const w = (await specBacklogSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ ticketId: "OM-15", state: "next_up", precedence: "spec_frontmatter", confidence: "high", title: "Pay rate UI" });
  });

  it("an in-progress spec → low-confidence in_progress (git overrides at projection)", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: { "juice-bar": { "specs/SSF-04.md": { content: `---\nid: SSF-04\nstatus: in-progress\n---\n` } } },
    });
    const w = (await specBacklogSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(w[0]).toMatchObject({ ticketId: "SSF-04", state: "in_progress", confidence: "low" });
  });

  it("a done/shipped spec emits nothing (git owns Shipped)", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: { "juice-bar": { "specs/OB-01.md": { content: `---\nid: OB-01\nstatus: done\n---\n` } } },
    });
    expect((await specBacklogSource.collect(ctx)).signals).toEqual([]);
  });

  it("derives the ticket from the filename when frontmatter lacks an id", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: { company: { "docs/superpowers/specs/2026-06-23-COS-0-cockpit.md": { content: `---\nstatus: approved\n---\n` } } },
    });
    const w = (await specBacklogSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(w[0]?.ticketId).toBe("COS-0");
  });

  it("reads CONTEXT.md 'What's In Progress' as low-confidence in_progress backstops", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: {
        "juice-bar": {
          "CONTEXT.md": { content: `## What's In Progress\n- OM-15 pay rate UI\n- GU-06 dedupe\n\n## Recent Decisions\n- SSF-02 shipped\n` },
        },
      },
    });
    const w = (await specBacklogSource.collect(ctx)).signals.filter(isWorkSignal);
    const ctxIds = w.filter((s) => /What's In Progress/.test(s.evidence)).map((s) => s.ticketId);
    expect(ctxIds).toEqual(["OM-15", "GU-06"]);
    expect(w.every((s) => s.evidence.includes("Decisions") ? false : true)).toBe(true);
  });
});

describe("SpecBacklogSource — C5/B9 backlog-standard vocab sync", () => {
  it("maps triaged → next_up and validation-ready/implemented-pending-review → in_review", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: {
        "juice-bar": {
          "backlog/t.md": { content: "---\nid: AAA-1\ntitle: T\nstatus: triaged\n---\n# T" },
          "backlog/v.md": { content: "---\nid: AAA-2\ntitle: V\nstatus: validation-ready\n---\n# V" },
          "backlog/i.md": { content: "---\nid: AAA-3\ntitle: I\nstatus: implemented-pending-review\n---\n# I" },
          "backlog/d.md": { content: "---\nid: AAA-4\ntitle: D\nstatus: deferred\n---\n# D" },
          "backlog/a.md": { content: "---\nid: AAA-5\ntitle: A\nstatus: archived\n---\n# A" },
        },
      },
    });
    const w = (await specBacklogSource.collect(ctx)).signals.filter(isWorkSignal);
    const stateOf = (id: string) => w.find((s) => s.ticketId === id)?.state;
    expect(stateOf("AAA-1")).toBe("next_up");
    expect(stateOf("AAA-2")).toBe("in_review");
    expect(stateOf("AAA-3")).toBe("in_review");
    expect(stateOf("AAA-4")).toBeUndefined(); // deferred = parked, off the board
    expect(stateOf("AAA-5")).toBeUndefined(); // archived = closed
  });

  it("LOCKSTEP: the hand-copied mapping covers the canonical backlog vocabulary (WF-06 machine copy)", async () => {
    // Cross-repo import is unavailable at source layer (order-0 plan §10 note) —
    // this test pins the hand-copy against the company lib when it is present,
    // and SKIPS (loudly) on machines without the company checkout.
    const libPath = `${process.env.HOME}/projects/company/config/lib/frontmatter-meta.mjs`;
    const { existsSync } = await import("node:fs");
    if (!existsSync(libPath)) {
      console.warn("lockstep skip: company checkout absent — vocab pin not exercised");
      return;
    }
    const lib = (await import(libPath)) as { STATUS_VOCAB: Record<string, readonly string[] | null> };
    const canonical = lib.STATUS_VOCAB.backlog ?? [];
    // Every canonical backlog state must be DELIBERATELY handled: board-mapped or parked.
    const boardMapped = new Set(["active", "in_progress", "blocked", "triaged", "validation-ready", "implemented-pending-review"]);
    const parked = new Set(["deferred", "archived"]);
    for (const s of canonical) {
      expect(boardMapped.has(s) || parked.has(s), `unhandled canonical backlog status: ${s}`).toBe(true);
    }
    // And the source agrees: board-mapped states emit a signal, parked ones don't.
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: {
        "juice-bar": Object.fromEntries(
          [...canonical].map((s, i) => [`backlog/${i}.md`, { content: `---\nid: ZZZ-${i}\ntitle: Z\nstatus: ${s}\n---\n# Z` }]),
        ),
      },
    });
    const w = (await specBacklogSource.collect(ctx)).signals.filter(isWorkSignal);
    for (const [i, s] of [...canonical].entries()) {
      const emitted = w.some((x) => x.ticketId === `ZZZ-${i}`);
      expect(emitted, `status ${s}`).toBe(boardMapped.has(s));
    }
  });
});
