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

export function parseFrontmatterHead(headText: string): FrontmatterHead {
  const frontmatter = parseFrontmatter(headText);
  const title = frontmatter?.title ?? firstH1(bodyAfterFrontmatter(headText)) ?? null;
  const status = frontmatter?.status ?? null;
  return { title, status, frontmatter };
}
