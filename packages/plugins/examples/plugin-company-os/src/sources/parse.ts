/**
 * Pure parsing helpers shared by the source collectors. NOTHING here touches
 * git/gh/fs/the SDK — every function is a deterministic string→data transform,
 * so the whole classification surface is unit-testable with plain strings and
 * the sources stay thin wrappers that wire these to the `CollectionContext`
 * runners.
 *
 * Covers: ticket-id extraction (the commit grammar), branch→ticket precedence,
 * conventional-commit scope, commit trailers, revert detection, shipped
 * extraction (merge/squash/revert/multi-ticket), YAML frontmatter, the AGENTS.md
 * `company_os:` fenced-block subset parser, and review-report frontmatter.
 */

import type { CommitRef, CommitStat } from "../contracts/signals.js";
import type { ReviewReportKind, ReviewVerdict, UnclassifiedReason } from "../contracts/vocab.js";

// ---------------------------------------------------------------------------
// Ticket ids — the canonical commit/branch grammar
// ---------------------------------------------------------------------------

/**
 * Ticket-id grammar (CLAUDE.md commit format): an UPPERCASE prefix (≥2 letters)
 * + `-` + digits + an OPTIONAL single lowercase sub-ticket suffix
 * (`[A-Z]{2,}-\d+[a-z]?`). The surrounding non-alphanumeric lookarounds stop
 * `COS-0-y` from swallowing the `-y` and reject two-letter suffixes
 * (`GON-04bc`) — both per the grammar. Global + sticky-free so `matchAll` works.
 */
const TICKET_RE = /(?<![A-Za-z0-9])([A-Z]{2,}-\d+[a-z]?)(?![A-Za-z0-9])/g;

/** Extract every distinct ticket id from arbitrary text, order-preserving. */
export function extractTicketIds(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(TICKET_RE)) {
    const id = m[1];
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** The prefix half of a ticket id (`COS-0b` → `COS`); null when not a ticket. */
export function prefixOf(ticketId: string): string | null {
  const m = /^([A-Z]{2,})-\d+[a-z]?$/.exec(ticketId);
  return m ? m[1] : null;
}

/** First ticket id found in a path's basename (`2026-06-23-COS-0-plan.md` → `COS-0`); null when none. */
export function ticketFromFilename(relPath: string): string | null {
  const base = relPath.split("/").pop() ?? relPath;
  return extractTicketIds(base)[0] ?? null;
}

/**
 * Extract ticket ids from the bullet lines under a CONTEXT.md "What's In
 * Progress" heading (any level), stopping at the next heading of the same or a
 * higher level. Powers SpecBacklog's CONTEXT backstop for in-progress work that
 * has no worktree yet.
 */
export function extractContextInProgress(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  const seen = new Set<string>();
  let inSection = false;
  let sectionLevel = 0;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (!inSection && /what.?s\s+in\s+progress/i.test(heading[2])) {
        inSection = true;
        sectionLevel = level;
        continue;
      }
      if (inSection && level <= sectionLevel) break; // next sibling/parent heading ends the section
      continue;
    }
    if (inSection) {
      for (const id of extractTicketIds(line)) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Branch → ticket (precedence rung 1: branch_path)
// ---------------------------------------------------------------------------

/** Branch names that are not work branches — never "in progress", never Unclassified. */
const NON_WORK_BRANCHES = new Set(["main", "master", "HEAD", "develop", "trunk"]);

export interface BranchParse {
  /** Tickets found in the branch path (multi-ticket branches fan out). */
  readonly ticketIds: string[];
  /** True for main/master/HEAD/etc. — caller should ignore, not classify. */
  readonly isBaseBranch: boolean;
  /** Set when a real work branch yielded no parseable ticket. */
  readonly reason?: UnclassifiedReason;
}

/**
 * Resolve ticket ids from a branch path (`claude/COS-0/design`, `feat/COS-0-y`,
 * `docs/COS-0`, `fix/COS-0-z`, `claude/OB-08+OB-09/T2`). Splits on `/` and `+`
 * so multi-ticket branches fan out; a real branch with no ticket →
 * `bad_branch_format`.
 */
export function parseBranch(branch: string): BranchParse {
  const trimmed = branch.trim();
  if (trimmed === "" || NON_WORK_BRANCHES.has(trimmed)) {
    return { ticketIds: [], isBaseBranch: true };
  }
  const ticketIds = extractTicketIds(trimmed.replace(/\+/g, " "));
  if (ticketIds.length === 0) {
    return { ticketIds: [], isBaseBranch: false, reason: "bad_branch_format" };
  }
  return { ticketIds, isBaseBranch: false };
}

// ---------------------------------------------------------------------------
// Conventional-commit scope (precedence rung 3: commit_scope)
// ---------------------------------------------------------------------------

/**
 * Parse the ticket ids out of a conventional-commit subject's scope:
 * `feat(COS-0a): …` → `[COS-0a]`, `fix(GAP-00, GAP-01): …` → `[GAP-00, GAP-01]`.
 * Returns `[]` when the subject has no `(scope)` or the scope holds no ticket
 * (so free-text like a stray `UTF-8` in the body is never mistaken for a chip —
 * only the scope is authoritative).
 */
export function parseCommitScope(subject: string): string[] {
  const m = /^[a-zA-Z]+(?:\(([^)]*)\))?!?:/.exec(subject.trim());
  if (!m || m[1] === undefined) return [];
  return extractTicketIds(m[1]);
}

/**
 * Explicit ticket trailers in a commit body: `Ticket:`, `Tickets:`, `Refs:`,
 * `Ref:` lines. These are authoritative (the author named the ticket), so they
 * are scanned even though they are free text.
 */
export function parseTrailers(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^(?:Ticket|Tickets|Refs?|Closes|Fixes)\s*:\s*(.+)$/i.exec(line.trim());
    if (m) out.push(...extractTicketIds(m[1]));
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Revert detection + shipped extraction
// ---------------------------------------------------------------------------

export interface RevertParse {
  readonly isRevert: boolean;
  /** Tickets named in the reverted subject (`Revert "feat(COS-0a): …"` → `[COS-0a]`). */
  readonly revertedTicketIds: string[];
}

/** Detect a `Revert "<original subject>"` commit and recover the reverted scope. */
export function parseRevert(subject: string): RevertParse {
  const m = /^Revert\s+"(.+)"\s*$/.exec(subject.trim());
  if (!m) return { isRevert: false, revertedTicketIds: [] };
  // The quoted text is the original subject — recover its scope (or any ticket).
  const scoped = parseCommitScope(m[1]);
  const revertedTicketIds = scoped.length > 0 ? scoped : extractTicketIds(m[1]);
  return { isRevert: true, revertedTicketIds };
}

export interface ShippedCommit {
  readonly subject: string;
  readonly body: string;
  /** Branch name when known (git log ref) — overrides the subject-derived branch. */
  readonly branch?: string;
}

/**
 * Recover the source branch from a default merge-commit subject, the only place
 * a true merge commit (no conventional scope) names its ticket:
 *   `Merge pull request #5 from owner/feat/OB-01-x` → `feat/OB-01-x`
 *   `Merge branch 'feat/OB-01-x' into main`         → `feat/OB-01-x`
 * Returns null for non-merge subjects.
 */
export function parseMergeBranch(subject: string): string | null {
  const pr = /^Merge pull request #\d+ from [^/\s]+\/(.+?)\s*$/.exec(subject.trim());
  if (pr) return pr[1];
  const mb = /^Merge branch ['"](.+?)['"]/.exec(subject.trim());
  if (mb) return mb[1];
  return null;
}

export interface ShippedTicket {
  readonly ticketId: string;
  /** Which extraction rung produced it (audit/diagnostics). */
  readonly via: "scope" | "trailer" | "revert" | "branch";
  /** True when this is a revert of a prior ship (the projection un-ships it). */
  readonly reverted: boolean;
}

/**
 * Extract shipped tickets from a merged commit, covering the spec §6 cases:
 * (a) merge/(b) squash subject scope, (c) commit-body `Ticket:` trailers,
 * (d) reverts (un-ship), (e) branch-name fallback, and multi-ticket fanout
 * (one commit → many chips). A revert short-circuits to revert tickets so a
 * `Revert "feat(COS-0a): …"` un-ships COS-0a rather than re-shipping it.
 */
export function extractShipped(commit: ShippedCommit): ShippedTicket[] {
  const revert = parseRevert(commit.subject);
  if (revert.isRevert) {
    return revert.revertedTicketIds.map((ticketId) => ({ ticketId, via: "revert", reverted: true }));
  }

  const out: ShippedTicket[] = [];
  const seen = new Set<string>();
  const add = (ids: string[], via: ShippedTicket["via"]) => {
    for (const ticketId of ids) {
      if (!seen.has(ticketId)) {
        seen.add(ticketId);
        out.push({ ticketId, via, reverted: false });
      }
    }
  };

  add(parseCommitScope(commit.subject), "scope");
  add(parseTrailers(commit.body), "trailer");
  // Branch fallback only when nothing more authoritative classified the commit.
  // The branch comes from the git log ref when known, else from the merge
  // subject itself (`Merge pull request #N from owner/<branch>`).
  if (out.length === 0) {
    const branch = commit.branch ?? parseMergeBranch(commit.subject);
    if (branch) add(parseBranch(branch).ticketIds, "branch");
  }
  return out;
}

// ---------------------------------------------------------------------------
// git porcelain / log output parsing
// ---------------------------------------------------------------------------

export interface Worktree {
  /** Absolute filesystem path git reports for the worktree. */
  readonly path: string;
  /** Short branch name (`refs/heads/` stripped), or null when detached. */
  readonly branch: string | null;
  /** HEAD sha, when present. */
  readonly head: string | null;
  readonly detached: boolean;
}

/** Parse `git worktree list --porcelain` into structured worktrees (blank-line separated blocks). */
export function parseWorktreeList(porcelain: string): Worktree[] {
  const out: Worktree[] = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    if (block.trim() === "") continue;
    let path = "";
    let branch: string | null = null;
    let head: string | null = null;
    let detached = false;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim();
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length).trim();
      else if (line.startsWith("branch ")) branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      else if (line.trim() === "detached") detached = true;
    }
    if (path !== "") out.push({ path, branch, head, detached });
  }
  return out;
}

export interface GitLogRecord {
  readonly sha: string;
  /** Committer date (ISO-8601, `%cI`) — orders ship vs revert so the newest wins. */
  readonly committedAt: string;
  readonly subject: string;
  readonly body: string;
}

/** The `git log --format` string the shipped scan uses (sha · committer-date · subject · body). */
export const GIT_LOG_FORMAT = "%H%x1f%cI%x1f%s%x1f%b%x1e";

/**
 * Parse a `git log --format=%H%x1f%cI%x1f%s%x1f%b%x1e` stream: records separated
 * by `\x1e` (RS), fields by `\x1f` (US). Robust to multi-line bodies + CRLF.
 */
export function parseGitLogRecords(stdout: string): GitLogRecord[] {
  const out: GitLogRecord[] = [];
  for (const rec of stdout.split("\x1e")) {
    const trimmed = rec.replace(/^[\r\n]+/, "");
    if (trimmed.trim() === "") continue;
    const [sha = "", committedAt = "", subject = "", body = ""] = trimmed.split("\x1f");
    if (sha.trim() !== "") {
      out.push({ sha: sha.trim(), committedAt: committedAt.trim(), subject: subject.trim(), body: body.trim() });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// BranchSource (COS-1): for-each-ref + per-branch log --shortstat parsing
// ---------------------------------------------------------------------------

/** A local branch ref from `for-each-ref` (name · tip · committer date). */
export interface BranchRef {
  readonly branch: string;
  readonly headSha: string;
  /** ISO-8601 committer date of the tip. */
  readonly committedAt: string;
}

/**
 * `git for-each-ref` format for the local-branch enumeration. Fields are
 * separated by a literal US (`\x1f`) — passed verbatim through the no-shell argv
 * runner — so branch names containing `/` or spaces never break the split.
 */
export const FOR_EACH_REF_FORMAT = "%(refname:short)\x1f%(objectname)\x1f%(committerdate:iso-strict)";

/** Parse `git for-each-ref --format=FOR_EACH_REF_FORMAT refs/heads` (one line per branch). */
export function parseForEachRef(stdout: string): BranchRef[] {
  const out: BranchRef[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const [branch = "", headSha = "", committedAt = ""] = line.split("\x1f");
    if (branch.trim() !== "" && headSha.trim() !== "") {
      out.push({ branch: branch.trim(), headSha: headSha.trim(), committedAt: committedAt.trim() });
    }
  }
  return out;
}

/**
 * `git log` format for the per-branch recent-commits scan. Each record is
 * RS-prefixed (`\x1e`) so the optional `--shortstat` line(s) that follow a record
 * stay attached to it; fields within the record are US-separated (`\x1f`). The
 * subject (`%s`), author (`%an`) and date (`%cI`) are each single-line.
 */
export const BRANCH_LOG_FORMAT = "%x1e%H%x1f%s%x1f%an%x1f%cI";

const SHORTSTAT_RE =
  /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;

/** Parse a `--shortstat` summary line into a `CommitStat`; null when no match. */
export function parseShortstat(text: string): CommitStat | null {
  const m = SHORTSTAT_RE.exec(text);
  if (!m) return null;
  return {
    filesChanged: Number.parseInt(m[1] ?? "0", 10) || 0,
    insertions: Number.parseInt(m[2] ?? "0", 10) || 0,
    deletions: Number.parseInt(m[3] ?? "0", 10) || 0,
  };
}

/**
 * Parse `git log <ref> -n N --shortstat --format=BRANCH_LOG_FORMAT` into
 * `CommitRef[]`. Splits on the RS record marker, reads the first line of each
 * record as the US-separated fields, and scans the remaining lines for the
 * optional `--shortstat` summary (absent for merge/empty commits → no `stat`).
 */
export function parseBranchCommits(stdout: string): CommitRef[] {
  const out: CommitRef[] = [];
  for (const chunk of stdout.split("\x1e")) {
    const lines = chunk.replace(/^[\r\n]+/, "").split(/\r?\n/);
    const head = lines[0] ?? "";
    if (head.trim() === "") continue;
    const [sha = "", subject = "", author = "", committedAt = ""] = head.split("\x1f");
    if (sha.trim() === "") continue;
    let stat: CommitStat | null = null;
    for (let i = 1; i < lines.length && stat === null; i++) {
      stat = parseShortstat(lines[i] ?? "");
    }
    out.push({
      sha: sha.trim(),
      subject: subject.trim(),
      author: author.trim(),
      committedAt: committedAt.trim(),
      ...(stat ? { stat } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// gh pr list JSON
// ---------------------------------------------------------------------------

export interface GhPr {
  readonly number: number;
  readonly title: string;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly url: string;
  readonly isDraft: boolean;
  readonly updatedAt: string;
}

/**
 * Parse `gh pr list --json …` output. Returns `ok: false` on malformed JSON or a
 * non-array payload so the caller emits a `parse_error` signal rather than
 * throwing. Each PR's fields are defensively coerced (missing → safe default).
 */
export function parseGhPrList(stdout: string): { prs: GhPr[]; ok: boolean } {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { prs: [], ok: false };
  }
  if (!Array.isArray(raw)) return { prs: [], ok: false };
  const prs: GhPr[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const number = typeof o.number === "number" ? o.number : Number.parseInt(String(o.number), 10);
    if (!Number.isFinite(number)) continue;
    prs.push({
      number,
      title: typeof o.title === "string" ? o.title : "",
      headRefName: typeof o.headRefName === "string" ? o.headRefName : "",
      headRefOid: typeof o.headRefOid === "string" ? o.headRefOid : "",
      url: typeof o.url === "string" ? o.url : "",
      isDraft: o.isDraft === true,
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "",
    });
  }
  return { prs, ok: true };
}

// ---------------------------------------------------------------------------
// YAML frontmatter (a minimal, dependency-free subset)
// ---------------------------------------------------------------------------

/**
 * Strip a trailing `# comment` from a YAML scalar WITHOUT corrupting a quoted
 * value that legitimately contains `#` (e.g. `title: "Phase #1"`). A quoted
 * scalar keeps everything through its closing quote; an unquoted scalar drops
 * from the first whitespace-preceded `#`.
 */
export function stripScalarComment(value: string): string {
  const t = value.trim();
  const q = t[0];
  if (q === '"' || q === "'") {
    const end = t.indexOf(q, 1);
    return end === -1 ? t : t.slice(0, end + 1);
  }
  const idx = t.search(/\s#/);
  return idx === -1 ? t : t.slice(0, idx).trimEnd();
}

/** Strip surrounding quotes from an (already comment-stripped) scalar. */
function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse leading `--- … ---` YAML frontmatter into a flat string map. Handles the
 * scalar `key: value` lines our specs/reports/routine-outputs use (quotes
 * stripped, `#` comments trimmed quote-aware). Deliberately NOT a general YAML
 * parser — nested structures are ignored, which is all the frontmatter contract
 * needs. Returns `null` when the text has no frontmatter block.
 */
export function parseFrontmatter(text: string): Record<string, string> | null {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    if (rawLine.trim() === "" || /^\s/.test(rawLine) || rawLine.trimStart().startsWith("-")) continue;
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(rawLine.trimEnd());
    if (!kv) continue;
    out[kv[1]] = unquote(stripScalarComment(kv[2]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// AGENTS.md `company_os:` fenced-block parser (routine contracts)
// ---------------------------------------------------------------------------

export interface ParsedRoutine {
  readonly id: string;
  readonly display_name: string;
  readonly cadence: string;
  readonly expected_artifact: string;
  readonly owner_agent: string;
}

export interface CompanyOsBlock {
  readonly routines: ParsedRoutine[];
  /** True when the file carries a `write_authority:` key (PWA-01/COS-3 forward-compat — parsed, not used). */
  readonly hasWriteAuthority: boolean;
  /** Human-readable parse problems (never thrown). */
  readonly errors: string[];
}

const ROUTINE_FIELDS = ["id", "display_name", "cadence", "expected_artifact", "owner_agent"] as const;

/**
 * Extract the ```yaml fenced block containing a `company_os:` ROOT key from an
 * AGENTS.md file. The marker is a real YAML key (not a comment) precisely so it
 * survives a parser — we find the fence, then the `company_os:` line.
 */
export function extractCompanyOsYaml(markdown: string): string | null {
  const fenceRe = /```(?:ya?ml)?\s*\n([\s\S]*?)```/g;
  for (const m of markdown.matchAll(fenceRe)) {
    const body = m[1];
    if (/^company_os\s*:/m.test(body)) return body;
  }
  return null;
}

/**
 * Parse the `company_os:` block's `routines:` list (a fixed 2-level structure:
 * `routines:` → `- key: value` maps). Dependency-free on purpose (no yaml lib in
 * the plugin) — it targets exactly the block shape COS-0b authored and records
 * every malformed routine as an error rather than throwing. The optional
 * sibling `write_authority:` key is detected but ignored (COS-3 owns its policy).
 */
export function parseCompanyOsBlock(yamlText: string): CompanyOsBlock {
  const errors: string[] = [];
  const lines = yamlText.split(/\r?\n/);

  // Find the routines list under company_os (root, 0-indent) → indent of `routines:`.
  let routinesIndent = -1;
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^(\s*)routines\s*:\s*$/.exec(lines[i]);
    if (m) {
      routinesIndent = m[1].length;
      break;
    }
  }
  const hasWriteAuthority = lines.some((l) => /^\s*write_authority\s*:/.test(l));
  if (routinesIndent === -1) {
    errors.push("no `routines:` key under company_os");
    return { routines: [], hasWriteAuthority, errors };
  }

  const routines: ParsedRoutine[] = [];
  let current: Partial<Record<(typeof ROUTINE_FIELDS)[number], string>> | null = null;
  const flush = () => {
    if (!current) return;
    const missing = ROUTINE_FIELDS.filter((f) => current?.[f] === undefined || current[f] === "");
    if (missing.length > 0) {
      errors.push(`routine ${current.id ?? "(no id)"} missing: ${missing.join(", ")}`);
    } else {
      routines.push(current as ParsedRoutine);
    }
    current = null;
  };

  for (i++; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    const indent = raw.length - raw.trimStart().length;
    // A line at or below the routines indent (and not a list item) ends the list.
    const isListItem = /^\s*-\s+/.test(raw);
    if (indent <= routinesIndent && !isListItem) break;

    if (isListItem) {
      flush();
      current = {};
      const after = raw.replace(/^\s*-\s+/, "");
      const kv = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(after);
      if (kv) current[kv[1] as (typeof ROUTINE_FIELDS)[number]] = stripScalar(kv[2]);
      continue;
    }
    if (current) {
      const kv = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(raw.trim());
      if (kv) current[kv[1] as (typeof ROUTINE_FIELDS)[number]] = stripScalar(kv[2]);
    }
  }
  flush();

  if (routines.length === 0 && errors.length === 0) errors.push("routines list is empty");
  return { routines, hasWriteAuthority, errors };
}

function stripScalar(value: string): string {
  return unquote(stripScalarComment(value));
}

// ---------------------------------------------------------------------------
// Review-report frontmatter (cannons / reviews)
// ---------------------------------------------------------------------------

export interface ParsedReviewReport {
  readonly repo: string | null;
  readonly fullSha: string | null;
  readonly prNumber: number | null;
  readonly branch: string | null;
  readonly verdict: ReviewVerdict;
  readonly generatedAt: string | null;
  readonly p0: number | null;
  readonly p1: number | null;
  readonly p2: number | null;
}

const VERDICT_MAP: Record<string, ReviewVerdict> = {
  ship: "ship",
  "proceed-with-mitigation": "proceed",
  "proceed with mitigation": "proceed",
  proceed: "proceed",
  revise: "revise",
  "needs-revision": "revise",
  block: "block",
  "no-ship": "block",
  noship: "block",
};

/** Normalize a free-form verdict token to the closed `ReviewVerdict` set. */
export function normalizeVerdict(raw: string | undefined): ReviewVerdict {
  if (!raw) return "unknown";
  const key = raw.trim().toLowerCase().replace(/\*+/g, "");
  return VERDICT_MAP[key] ?? "unknown";
}

/** Map a report's store directory / `type` field to the closed report-kind set. */
export function reportKindFromPath(relPath: string): ReviewReportKind {
  return /(^|\/)reports\/review-cannons\//.test(relPath) ? "cannons" : "review";
}

/**
 * Parse a review/cannons report's frontmatter into the In-review join fields.
 * Tolerates absent fields (a missing `pr_number` is `null`, not an error) since
 * report formats vary and missing-report is itself meaningful upstream.
 */
export function parseReviewReport(frontmatter: Record<string, string>): ParsedReviewReport {
  const num = (s: string | undefined): number | null => {
    if (s === undefined) return null;
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    repo: frontmatter.repo ?? null,
    fullSha: frontmatter.commit ?? frontmatter.sha ?? frontmatter.full_sha ?? null,
    prNumber: num(frontmatter.pr_number ?? frontmatter.pr),
    branch: frontmatter.branch ?? null,
    verdict: normalizeVerdict(frontmatter.verdict),
    generatedAt: frontmatter.run_at ?? frontmatter.generated_at ?? null,
    p0: num(frontmatter.p0_count ?? frontmatter.p0),
    p1: num(frontmatter.p1_count ?? frontmatter.p1),
    p2: num(frontmatter.p2_count ?? frontmatter.p2),
  };
}
