/**
 * The ticket-id GRAMMAR — a pure, layer-neutral module (no git/gh/fs/SDK, no
 * projection or source dependency). It lives in `contracts/` because the ticket-id
 * shape IS a contract shared across layers: the SOURCES parse ids out of
 * branches/commits/frontmatter, and the PROJECTIONS route by prefix. Housing the
 * grammar here (re-exported from `sources/parse.ts` for the source consumers) lets
 * `deriveBuildAtlas` reuse `prefixOf` without a projection→source import edge
 * (COS-5c cohesion fold, codex-5c-B-P2).
 */

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
