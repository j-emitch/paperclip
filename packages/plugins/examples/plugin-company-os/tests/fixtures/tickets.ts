/**
 * A deterministic 500-issue Paperclip corpus with a KNOWN routing distribution,
 * shared by the `deriveBuildAtlas` routing tests (as `TicketSignal`s) and the
 * `PaperclipTicketSource` parse tests (as exported markdown). The `EXPECTED`
 * constants are the assertion oracle — change the corpus, change them in lockstep.
 *
 * Distribution (500 total): 227 routine_execution (collapsing to 3 routine
 * definitions) · 22 issue_productivity_review (all dropped) · 251 manual
 * (140 → MTP, 50 → SSF, 30 → Meta·Ops, 31 done/cancelled excluded).
 */

import type { TicketSignal } from "../../src/contracts/signals.js";
import { ticketSignal } from "./signals.js";

export interface FakeTicket {
  readonly identifier: string;
  readonly title: string;
  /** Family ids embedded in the description so the SOURCE re-derives these refs. */
  readonly refs: readonly string[];
  readonly status: string;
  readonly originKind: string;
  readonly parentId: string | null;
  readonly assigneeAgentId: string | null;
  readonly mtime: string;
}

/** Registered family prefixes the corpus routes against (the routing test registers these). */
export const CORPUS_FAMILIES = ["MTP", "SSF", "COS", "LYC"] as const;

/** The oracle the tests assert against. */
export const EXPECTED = {
  total: 500,
  routineChips: 3, // 227 firings → 3 routine definitions
  metaTickets: 33, // 3 routine + 30 ops
  opsUnrouted: 30,
  mtpTickets: 140, // 120 single-family + 20 multi-family (MTP first)
  ssfTickets: 50,
  productivityReviewDropped: 22,
  doneExcluded: 31,
} as const;

function ref(refs: readonly string[]): string {
  return refs.length ? `Relates to ${refs.map((p, i) => `${p}-${i + 1}`).join(", ")}.` : "General cleanup, no family.";
}

/** Build the 500-ticket corpus (deterministic; mtimes strictly increase per group). */
export function buildCorpus(): FakeTicket[] {
  const out: FakeTicket[] = [];
  let n = 0;
  const iso = (i: number) => `2026-05-${String((i % 27) + 1).padStart(2, "0")}T0${i % 9}:00:00.000Z`;
  const add = (t: Omit<FakeTicket, "identifier" | "mtime">) => {
    n += 1;
    out.push({ ...t, identifier: `LYC-${n}`, mtime: iso(n) });
  };

  // 227 routine_execution → 3 definitions.
  for (let i = 0; i < 100; i++)
    add({ title: "Daily health scan", refs: [], status: "done", originKind: "routine_execution", parentId: "rt-daily", assigneeAgentId: "coo" });
  for (let i = 0; i < 100; i++)
    add({ title: "Nightly snapshot", refs: [], status: "done", originKind: "routine_execution", parentId: "rt-nightly", assigneeAgentId: "cto" });
  for (let i = 0; i < 27; i++)
    add({ title: "Weekly digest", refs: [], status: "in_progress", originKind: "routine_execution", parentId: null, assigneeAgentId: "librarian" });

  // 22 issue_productivity_review → dropped.
  for (let i = 0; i < 22; i++)
    add({ title: "Productivity review", refs: ["MTP"], status: "in_progress", originKind: "issue_productivity_review", parentId: null, assigneeAgentId: null });

  // 251 manual.
  for (let i = 0; i < 120; i++)
    add({ title: "Improve MTP scoring", refs: ["MTP"], status: "in_progress", originKind: "manual", parentId: null, assigneeAgentId: null });
  for (let i = 0; i < 50; i++)
    add({ title: "Wire SSF board", refs: ["SSF"], status: "todo", originKind: "manual", parentId: null, assigneeAgentId: null });
  for (let i = 0; i < 20; i++)
    add({ title: "MTP + COS integration", refs: ["MTP", "COS"], status: "in_progress", originKind: "manual", parentId: null, assigneeAgentId: null });
  for (let i = 0; i < 30; i++)
    add({ title: "Untriaged chore", refs: [], status: "backlog", originKind: "manual", parentId: null, assigneeAgentId: null });
  for (let i = 0; i < 16; i++)
    add({ title: "Old MTP work", refs: ["MTP"], status: "done", originKind: "manual", parentId: null, assigneeAgentId: null });
  for (let i = 0; i < 15; i++)
    add({ title: "Abandoned MTP work", refs: ["MTP"], status: "cancelled", originKind: "manual", parentId: null, assigneeAgentId: null });

  return out;
}

/** The corpus as `TicketSignal`s (referencedFamilies set explicitly — the source's job). */
export function corpusSignals(): TicketSignal[] {
  return buildCorpus().map((t) =>
    ticketSignal(t.identifier, {
      title: t.title,
      description: ref(t.refs),
      status: t.status,
      originKind: t.originKind,
      parentId: t.parentId,
      assigneeAgentId: t.assigneeAgentId,
      referencedFamilies: t.refs.map((p) => p),
      mtime: t.mtime,
    }),
  );
}

/** Render a FakeTicket to exported markdown mirroring `export_tickets.py` frontmatter. */
export function ticketMarkdown(t: FakeTicket): string {
  const lines = [
    "---",
    `id: uuid-${t.identifier}`,
    `identifier: ${t.identifier}`,
    `title: ${JSON.stringify(t.title)}`,
    `status: ${t.status}`,
    "priority: medium",
    `origin_kind: ${t.originKind}`,
  ];
  if (t.parentId) lines.push(`parent_id: ${t.parentId}`);
  if (t.assigneeAgentId) lines.push(`assignee_agent_id: ${t.assigneeAgentId}`);
  lines.push(`updated: ${t.mtime}`, "---", "", `# ${t.identifier}: ${t.title}`, "", "## Description", "", ref(t.refs), "");
  // An activity feed that cites OTHER tickets — must NOT leak into referencedFamilies.
  lines.push("## Activity", "", "### @joe — 2026-05-01", "**status_changed**", "- note: see ARC-99 and GAP-7", "");
  return lines.join("\n");
}
