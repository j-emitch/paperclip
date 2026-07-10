/**
 * `parseFrontmatterHead` — title/status extraction from the FRONTMATTER HEAD of a
 * doc (the first ~4 KB), shared by `DocsSource` (spec §5.4). Reuses the
 * dependency-free `parseFrontmatter` (parse.ts) for the YAML block, then falls
 * back to the first `# H1` found AFTER the frontmatter block (so a `# comment`
 * line inside the YAML is never mistaken for the title).
 */

import { parseFrontmatter } from "./parse.js";

export interface FrontmatterHead {
  /** Frontmatter `title`, else the first H1 in the body head, else null. */
  readonly title: string | null;
  /** Frontmatter `status`, when present. */
  readonly status: string | null;
  /** Frontmatter `owner`, when present (C1 — the §2.3 operational spine). */
  readonly owner: string | null;
  /** Frontmatter `last_updated`, else `date` (the standard's minimum pairing). */
  readonly lastUpdated: string | null;
  /** Frontmatter `status_verified_at` — evidence the status was checked, not asserted. */
  readonly statusVerifiedAt: string | null;
  /** Frontmatter `description`/`summary`, else the first body paragraph in the head (≤280 chars). */
  readonly description: string | null;
  /** The raw parsed frontmatter map (null when the head has no `--- … ---` block). */
  readonly frontmatter: Record<string, string> | null;
}

const FRONTMATTER_BLOCK = /^﻿?---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/;

/** The text after a leading `--- … ---` frontmatter block (the whole text when none). */
function bodyAfterFrontmatter(text: string): string {
  const m = FRONTMATTER_BLOCK.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** First ATX `# H1` heading in the text; null when none. */
function firstH1(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * First non-heading body paragraph within the scanned head — the §2.3
 * description fallback (same skip rules as the company lib's
 * `firstBodyParagraph`: headings, tables, code fences, blockquotes). Capped at
 * 280 chars; the head itself is already byte-capped by the caller.
 */
function firstBodyParagraph(body: string): string | null {
  for (const block of body.split(/\n\s*\n/)) {
    const t = block.trim();
    if (t === "" || t.startsWith("#") || t.startsWith("|") || t.startsWith("```") || t.startsWith(">")) continue;
    return t.replace(/\s+/g, " ").slice(0, 280);
  }
  return null;
}

export function parseFrontmatterHead(headText: string): FrontmatterHead {
  const frontmatter = parseFrontmatter(headText);
  const body = bodyAfterFrontmatter(headText);
  const title = frontmatter?.title ?? firstH1(body) ?? null;
  return {
    title,
    status: frontmatter?.status ?? null,
    owner: frontmatter?.owner ?? null,
    lastUpdated: frontmatter?.last_updated ?? frontmatter?.date ?? null,
    statusVerifiedAt: frontmatter?.status_verified_at ?? null,
    description: frontmatter?.description ?? frontmatter?.summary ?? firstBodyParagraph(body),
    frontmatter,
  };
}
