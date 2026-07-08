/**
 * COH-0 `_purpose` Work Record parser (COS-8c / spec §8.6 item 4). Targets the
 * OBSERVED on-disk schema (captured 2026-07-08 from live company `_purpose`
 * files): a frontmatter block whose scalar keys include `purpose_slug`,
 * `phase`, `intended_lifespan`, `started_at`, `active_handoff`,
 * `integration_target`; an inline list `ticket_ids: [A, B]`; and COH-0's
 * append-only `checkpoints:` block list whose entries are YAML FLOW MAPS
 * (`- {session: s, head_sha: …, wip: true, pushed: false, at: …, …}`).
 *
 * Field-extraction is regex-per-entry (the flow maps are machine-written by
 * coh-record.sh with a fixed key order and no nesting ambiguity we consume) —
 * a malformed entry degrades to nulls, never a throw. Pure; no I/O.
 */

import type { WorktreeCheckpoint, WorktreePurpose } from "../contracts/signals.js";

/** The frontmatter block between the first pair of `---` lines, or null. */
function frontmatterBlock(text: string): string | null {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return null;
  return lines.slice(1, end).join("\n");
}

function scalar(block: string, key: string): string | null {
  const m = block.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!m) return null;
  const raw = m[1].trim();
  if (raw === "" || raw === "null" || raw === "~") return null;
  return raw.replace(/^["']|["']$/g, "");
}

/** `ticket_ids: [A, B]` (inline flow list) or an empty list. */
function ticketIds(block: string): string[] {
  const m = block.match(/^ticket_ids:\s*\[([^\]]*)\]\s*$/m);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function flowField(entry: string, key: string): string | null {
  // Match up to the next comma or closing brace — flow-map values we lift
  // (sha/bool/ISO ts) never contain either.
  const m = entry.match(new RegExp(`(?:[{,]\\s*)${key}:\\s*([^,}]*)`));
  if (!m) return null;
  const raw = m[1].trim();
  return raw === "" || raw === "null" ? null : raw;
}

function flowBool(entry: string, key: string): boolean | null {
  const raw = flowField(entry, key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/** Parse the `checkpoints:` block list — one `WorktreeCheckpoint` per `- {…}` line. */
function checkpoints(block: string): WorktreeCheckpoint[] {
  const start = block.match(/^checkpoints:\s*$/m);
  if (!start) return [];
  const after = block.slice(block.indexOf(start[0]) + start[0].length);
  const out: WorktreeCheckpoint[] = [];
  for (const line of after.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (!line.startsWith(" ") || !trimmed.startsWith("- ")) break; // end of the block list
    const entry = trimmed.slice(2);
    out.push({
      headSha: flowField(entry, "head_sha"),
      wip: flowBool(entry, "wip"),
      pushed: flowBool(entry, "pushed"),
      at: flowField(entry, "at"),
    });
  }
  return out;
}

/**
 * The LATEST checkpoint by `at` (the file is machine-prepended newest-first,
 * but sorting by timestamp is robust to either ordering).
 */
export function latestCheckpoint(purpose: WorktreePurpose): WorktreeCheckpoint | null {
  let latest: WorktreeCheckpoint | null = null;
  for (const cp of purpose.checkpoints) {
    if (cp.at === null) continue;
    if (latest === null || latest.at === null || Date.parse(cp.at) > Date.parse(latest.at)) latest = cp;
  }
  return latest ?? purpose.checkpoints[0] ?? null;
}

/** Parse a `_purpose` file's head. Returns null when there is no frontmatter at all. */
export function parsePurposeRecord(text: string): WorktreePurpose | null {
  const block = frontmatterBlock(text);
  if (block === null) return null;
  return {
    ticketIds: ticketIds(block),
    slug: scalar(block, "purpose_slug"),
    phase: scalar(block, "phase"),
    lifespan: scalar(block, "intended_lifespan"),
    startedAt: scalar(block, "started_at"),
    activeHandoff: scalar(block, "active_handoff"),
    integrationTarget: scalar(block, "integration_target"),
    checkpoints: checkpoints(block),
  };
}
