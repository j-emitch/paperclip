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
