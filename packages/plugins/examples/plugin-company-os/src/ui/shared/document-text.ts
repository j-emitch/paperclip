/**
 * Pure text helpers shared by the document viewer + the surfaces that build doc
 * titles (Docs, Reports/artifact browser). No SDK runtime, no contract VALUE
 * imports — SSR-safe + unit-testable.
 */

/** The base name of a workspace-relative path (a doc's primary line when it has no title). */
export function baseName(relPath: string): string {
  const parts = relPath.split("/");
  return parts[parts.length - 1] || relPath;
}

/**
 * Strip a leading YAML frontmatter block (`--- … ---`) from markdown before
 * render, so the viewer body doesn't show raw `key: value` lines — the header
 * already surfaces the title / type / status the frontmatter held. Only a block
 * anchored at the very start is removed; a mid-document `---` rule is untouched.
 */
export function stripFrontmatter(markdown: string): string {
  const m = /^﻿?\s*---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(markdown);
  return m ? markdown.slice(m[0].length) : markdown;
}
