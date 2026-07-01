import { describe, it, expect } from "vitest";
import { paperclipTicketSource } from "../../src/sources/PaperclipTicketSource.js";
import { isTicketSignal, type TicketSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext } from "../fixtures/context.js";
import { ticketMarkdown, type FakeTicket } from "../fixtures/tickets.js";

const TDIR = "reports/paperclip/tickets";

function fake(over: Partial<FakeTicket> & { identifier: string }): FakeTicket {
  return {
    title: "A ticket",
    refs: [],
    status: "in_progress",
    originKind: "manual",
    parentId: null,
    assigneeAgentId: null,
    mtime: "2026-05-10T00:00:00.000Z",
    ...over,
  };
}

function ctxWith(files: Record<string, string>, over: Parameters<typeof makeFixtureContext>[0] = {}) {
  return makeFixtureContext({ files: { company: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { content: v }])) }, ...over });
}

describe("PaperclipTicketSource", () => {
  it("emits one company-scoped TicketSignal per top-level ticket file", async () => {
    const batch = await paperclipTicketSource.collect(
      ctxWith({
        [`${TDIR}/LYC-1.md`]: ticketMarkdown(fake({ identifier: "LYC-1", title: "First" })),
        [`${TDIR}/LYC-2.md`]: ticketMarkdown(fake({ identifier: "LYC-2", title: "Second" })),
      }),
    );
    const tickets = batch.signals.filter(isTicketSignal);
    expect(tickets).toHaveLength(2);
    expect(tickets.every((t) => t.repo === "company")).toBe(true);
    expect(tickets.map((t) => t.identifier).sort()).toEqual(["LYC-1", "LYC-2"]);
    expect(batch.repoFreshness[0]?.freshness).toBe("live");
  });

  it("parses the routing frontmatter (origin_kind / parent_id / assignee_agent_id / status)", async () => {
    const batch = await paperclipTicketSource.collect(
      ctxWith({
        [`${TDIR}/LYC-100.md`]: ticketMarkdown(
          fake({ identifier: "LYC-100", title: "Daily health scan", originKind: "routine_execution", parentId: "rt-daily", assigneeAgentId: "coo", status: "done" }),
        ),
      }),
    );
    const t = batch.signals.filter(isTicketSignal)[0] as TicketSignal;
    expect(t.originKind).toBe("routine_execution");
    expect(t.parentId).toBe("rt-daily");
    expect(t.assigneeAgentId).toBe("coo");
    expect(t.status).toBe("done");
  });

  it("derives referencedFamilies from title + Description only — never the activity feed", async () => {
    // ticketMarkdown embeds `Relates to MTP-1, COS-2.` in Description and `ARC-99 / GAP-7` in Activity.
    const batch = await paperclipTicketSource.collect(
      ctxWith({ [`${TDIR}/LYC-7.md`]: ticketMarkdown(fake({ identifier: "LYC-7", refs: ["MTP", "COS"] })) }),
    );
    const t = batch.signals.filter(isTicketSignal)[0] as TicketSignal;
    expect(t.referencedFamilies).toEqual(["MTP", "COS"]);
    expect(t.referencedFamilies).not.toContain("ARC"); // activity-feed refs excluded
    expect(t.referencedFamilies).not.toContain("GAP");
  });

  it("defaults origin_kind to 'manual' when the frontmatter predates the field", async () => {
    const md = ["---", "identifier: LYC-3", 'title: "Legacy"', "status: todo", "---", "", "## Description", "", "body"].join("\n");
    const batch = await paperclipTicketSource.collect(ctxWith({ [`${TDIR}/LYC-3.md`]: md }));
    expect((batch.signals.filter(isTicketSignal)[0] as TicketSignal).originKind).toBe("manual");
  });

  it("never surfaces retired tickets under archive/**", async () => {
    const batch = await paperclipTicketSource.collect(
      ctxWith({
        [`${TDIR}/LYC-1.md`]: ticketMarkdown(fake({ identifier: "LYC-1" })),
        [`${TDIR}/archive/LYC-OLD.md`]: ticketMarkdown(fake({ identifier: "LYC-OLD" })),
      }),
    );
    expect(batch.signals.filter(isTicketSignal).map((t) => t.identifier)).toEqual(["LYC-1"]);
  });

  it("skips a file with no identifier and degrades the source to stale", async () => {
    const noId = ["---", 'title: "Orphan"', "status: todo", "---", "", "body"].join("\n");
    const batch = await paperclipTicketSource.collect(
      ctxWith({
        [`${TDIR}/LYC-1.md`]: ticketMarkdown(fake({ identifier: "LYC-1" })),
        [`${TDIR}/broken.md`]: noId,
      }),
    );
    expect(batch.signals.filter(isTicketSignal)).toHaveLength(1); // the good one still emits
    expect(batch.repoFreshness[0]?.freshness).toBe("stale");
    expect(batch.repoFreshness[0]?.errors[0]?.code).toBe("parse_error");
  });

  it("leaves tickets alone on a scoped refresh that doesn't touch company", async () => {
    const batch = await paperclipTicketSource.collect(
      ctxWith({ [`${TDIR}/LYC-1.md`]: ticketMarkdown(fake({ identifier: "LYC-1" })) }, { scopeRepo: "juice-bar" }),
    );
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness).toEqual([]);
  });

  it("degrades to stale (no signals) when the company repo is unavailable", async () => {
    const batch = await paperclipTicketSource.collect(
      ctxWith(
        { [`${TDIR}/LYC-1.md`]: ticketMarkdown(fake({ identifier: "LYC-1" })) },
        { repos: [{ repo: "company", available: false }] },
      ),
    );
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness[0]?.freshness).toBe("stale");
    expect(batch.repoFreshness[0]?.errors[0]?.code).toBe("repo_unavailable");
  });
});
