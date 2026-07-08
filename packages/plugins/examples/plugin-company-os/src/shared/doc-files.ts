/**
 * Doc-file detection — the ONE predicate deciding "is this changed path a
 * doc?", shared by the worktree-board projection (`docChangedCount`) and the
 * Worktrees lens (the docs-updated chip's first-doc pick). zod-free on purpose:
 * `src/ui/**` may value-import this without dragging contracts into the
 * browser bundle. Widen it here (e.g. `.mdx`) and BOTH surfaces move together.
 */
export const DOC_FILE_RE = /\.(md|markdown)$/i;

export function isDocFile(path: string): boolean {
  return DOC_FILE_RE.test(path);
}
