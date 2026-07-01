/**
 * `PaperclipTicketSource` — the LYC tracker bridge. Emits one `TicketSignal` per
 * exported Paperclip issue (`company/reports/paperclip/tickets/*.md`), which
 * `deriveBuildAtlas` three-tier-routes (spec §5.5). The plugin worker has NO
 * network (`CollectionContext` = `gh` + `fs` only), so this reads the git-tracked
 * export via `ctx.fs` — exactly as `SpecBacklogSource`/`ArtifactSource` read
 * their docs — rather than the live API. The exporter (`export_tickets.py`) is
 * the sole writer; `origin_kind`/`parent_id`/`assignee_agent_id` frontmatter is
 * the load-bearing OQ-5 contract this source consumes.
 *
 * Company-scoped (the single-tenant tracker lives only in `company`), so it
 * mirrors `LineageSource`/`PrefixRegistrySource`'s responsible-for gate: a scoped
 * refresh that doesn't touch `company` leaves the last-good tickets in place via
 * the scoped-merge. Never throws — a read/parse failure skips that file with a
 * degraded `SignalError`, and the last-good snapshot persists (degrade-to-stale).
 */

import {
  findRepoRoot,
  reposResponsibleFor,
  signalError,
  type CollectionContext,
} from "../contracts/collection-context.js";
import type { RepoFreshness, SignalBatch, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type { Signal, SignalError, TicketSignal } from "../contracts/signals.js";
import { extractTicketIds, parseFrontmatter, prefixOf } from "./parse.js";
import { nowIso, readError } from "./_shared.js";

export const PAPERCLIP_TICKET_SOURCE_ID = "ticket";

/** The repo the exported tracker lives in (single-tenant). */
const TICKET_REPO = "company";

/**
 * Top-level ticket files ONLY. The recursive `**` is deliberately absent so the
 * ~111 retired tickets under `archive/` never resurface into the active Atlas
 * (codex-P7); the `/archive/` path guard below backs the glob up regardless of
 * the matcher's `*`-vs-`**` semantics.
 */
const TICKET_GLOB = "reports/paperclip/tickets/*.md";

export const paperclipTicketSource: WorkSignalSource = {
  id: PAPERCLIP_TICKET_SOURCE_ID,
  async collect(ctx: CollectionContext): Promise<SignalBatch> {
    const collectedAt = ctx.clock.now();
    const responsible = reposResponsibleFor(ctx).some((r) => r.repo === TICKET_REPO);

    // A scoped refresh that doesn't touch `company` leaves the tickets alone.
    if (!responsible) {
      return { source: PAPERCLIP_TICKET_SOURCE_ID, collectedAt, signals: [], repoFreshness: [] };
    }

    const companyRoot = findRepoRoot(ctx, TICKET_REPO);
    if (!companyRoot || !companyRoot.available) {
      return {
        source: PAPERCLIP_TICKET_SOURCE_ID,
        collectedAt,
        signals: [],
        repoFreshness: [staleFreshness("company repo unavailable; tickets not refreshed")],
      };
    }

    const signals: Signal[] = [];
    const errors: SignalError[] = [];

    let files: readonly { relPath: string }[];
    try {
      files = await ctx.fs.list(TICKET_REPO, [TICKET_GLOB]);
    } catch (err) {
      // list() is contract-bound not to throw, but a programming fault must not
      // blank the Atlas — degrade the whole source to stale and keep last-good.
      ctx.logger.error(`${PAPERCLIP_TICKET_SOURCE_ID}: list threw`, { error: String(err) });
      return {
        source: PAPERCLIP_TICKET_SOURCE_ID,
        collectedAt,
        signals: [],
        repoFreshness: [staleFreshness(`ticket list failed: ${String(err)}`)],
      };
    }

    for (const file of files) {
      if (file.relPath.includes("/archive/")) continue; // defensive: never resurface retired tickets
      let text: string;
      try {
        text = await ctx.fs.readText(TICKET_REPO, file.relPath);
      } catch (err) {
        errors.push(readError(file.relPath, err));
        continue;
      }
      const sig = ticketSignal(file.relPath, text);
      if (sig) signals.push(sig);
      else errors.push(signalError("parse_error", `ticket file has no identifier: ${file.relPath}`));
    }

    const degraded = errors.some((e) => e.degraded);
    const freshness: RepoFreshness = {
      repo: TICKET_REPO,
      freshness: degraded ? "stale" : "live",
      lastOkAt: degraded ? null : nowIso(ctx),
      errors,
    };
    return { source: PAPERCLIP_TICKET_SOURCE_ID, collectedAt, signals, repoFreshness: [freshness] };
  },
};

function staleFreshness(message: string): RepoFreshness {
  return {
    repo: TICKET_REPO,
    freshness: "stale",
    lastOkAt: null,
    errors: [signalError("repo_unavailable", message)],
  };
}

/**
 * Parse one exported ticket file into a `TicketSignal`. Returns null when the
 * frontmatter carries no `identifier` (a malformed/non-ticket file — the caller
 * records a degraded `parse_error`). `referencedFamilies` is derived here
 * MECHANICALLY (title + the Description section only — never the activity feed,
 * which cites unrelated tickets); the projection owns routing policy.
 */
function ticketSignal(relPath: string, text: string): TicketSignal | null {
  const fm = parseFrontmatter(text);
  const identifier = fm?.identifier;
  if (!identifier) return null;

  const title = fm?.title ?? "";
  const description = descriptionSection(text);
  const referencedFamilies = deriveReferencedFamilies(title, description);

  return {
    kind: "ticket",
    source: PAPERCLIP_TICKET_SOURCE_ID,
    repo: TICKET_REPO,
    path: relPath,
    mtime: fm?.updated ?? undefined,
    confidence: "high",
    freshness: "live",
    errors: [],
    identifier,
    title,
    description,
    status: fm?.status ?? null,
    priority: fm?.priority ?? null,
    // origin_kind is NOT NULL in the source (default "manual"); tolerate an old
    // export that predates the field by defaulting the same way the exporter does.
    originKind: fm?.origin_kind ?? "manual",
    parentId: fm?.parent_id ?? null,
    assigneeAgentId: fm?.assignee_agent_id ?? null,
    referencedFamilies,
  };
}

/**
 * The ticket's own `## Description` section (between that heading and the next
 * `## ` heading, i.e. `## Activity`). Restricting family extraction to this
 * section keeps the noisy activity feed — which references many unrelated tickets
 * — from producing false family routes. "" when the file has no Description.
 */
function descriptionSection(text: string): string {
  const m = /^##\s+Description\s*$/m.exec(text);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/** Distinct family prefixes referenced in the title + description, order-preserving. */
function deriveReferencedFamilies(title: string, description: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of extractTicketIds(`${title}\n${description}`)) {
    const prefix = prefixOf(id);
    if (prefix && !seen.has(prefix)) {
      seen.add(prefix);
      out.push(prefix);
    }
  }
  return out;
}
