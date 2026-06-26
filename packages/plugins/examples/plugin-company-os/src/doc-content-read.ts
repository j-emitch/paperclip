/**
 * `readDocContent` — the Docs-viewer read (spec §5.4), the worker side of the
 * `doc-content` data handler. A SIBLING of `readReportContent` (which stays
 * byte-unchanged, spec §12) keyed by `docId` rather than `(repo, relPath)`, so a
 * worktree doc and its main-checkout namesake never cross-resolve.
 *
 * Defense-in-depth, outermost-first (mirrors report-content):
 *   1. INDEX GATE — only a `docId` already in `cos_doc_index` is readable.
 *   2. EXTENSION ALLOWLIST — `.md`/`.markdown` markdown, `.txt` text, else link-only.
 *   3. CHECKOUT RESOLVABLE — the entry's `checkoutKey` must resolve in the freshly
 *      rebuilt key map; a removed worktree → clean `not_found` (PF-9).
 *   4. CONTAINED READ — bytes via `workspace-fs` against the resolved checkout root.
 *
 * Returns the existing `ReportContentV1` contract (reused). `artifactType` is
 * always null (a doc's type is `DocEntryV1.type`/the bucket, not an ArtifactType).
 */

import type { DocEntryV1, DocIndexV1 } from "./contracts/doc-index.js";
import { parseReportContentV1, REPORT_CONTENT_SCHEMA_VERSION, type ReportContentV1 } from "./contracts/report-content.js";
import type { ReportRenderMode } from "./contracts/vocab.js";
import { DOCS_VIEWER_MAX_BYTES, extnameLower, type ContainedFileRead } from "./report-content-read.js";

const RENDER_BY_EXT: Record<string, ReportRenderMode> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
};

export interface DocContentDeps {
  /** Read the cached doc index (the worker wires `readDocIndex(db, …)`). */
  readIndex: (companyId: string) => Promise<DocIndexV1 | null>;
  /** Contained read by the entry's `checkoutKey` + `relPath` (the worker resolves the abs root). */
  readFile: (checkoutKey: string, relPath: string) => Promise<ContainedFileRead>;
  /** Whether a `checkoutKey` resolves in the freshly rebuilt map (else a removed worktree). */
  checkoutResolvable: (checkoutKey: string) => boolean;
  /** Override the size cap (tests). Defaults to `DOCS_VIEWER_MAX_BYTES`. */
  maxBytes?: number;
}

function findEntry(index: DocIndexV1 | null, docId: string): DocEntryV1 | null {
  if (!index) return null;
  for (const group of index.groups) {
    for (const bucket of group.types) {
      for (const doc of bucket.docs) {
        if (doc.docId === docId) return doc;
      }
    }
  }
  return null;
}

export async function readDocContent(
  deps: DocContentDeps,
  companyId: string,
  docId: string,
): Promise<ReportContentV1> {
  const maxBytes = deps.maxBytes ?? DOCS_VIEWER_MAX_BYTES;

  if (!docId) {
    return parseReportContentV1(refusal("?", "?", "not_found", null, "No document selected."));
  }

  // 1. INDEX GATE — only serve a docId the index already vetted.
  const index = await deps.readIndex(companyId);
  const entry = findEntry(index, docId);
  if (!entry) {
    return parseReportContentV1(
      refusal("?", "?", "not_indexed", null, "This doc isn’t in the index — refresh the cockpit or pick a listed doc."),
    );
  }

  // 2. EXTENSION ALLOWLIST.
  const renderMode = RENDER_BY_EXT[extnameLower(entry.relPath)];
  if (!renderMode) {
    return parseReportContentV1(
      refusal(entry.repoKey, entry.relPath, "unsupported_type", entry, "This file type isn’t rendered inline — open it in your editor."),
    );
  }

  // 3. CHECKOUT RESOLVABLE — a removed worktree's key is absent from the rebuilt map.
  if (!deps.checkoutResolvable(entry.checkoutKey)) {
    return parseReportContentV1(
      refusal(entry.repoKey, entry.relPath, "not_found", entry, "That checkout is no longer available (a removed worktree?)."),
    );
  }

  // 4. CONTAINED READ against the resolved checkout root.
  try {
    const read = await deps.readFile(entry.checkoutKey, entry.relPath);
    if (read.sizeBytes > maxBytes) {
      return parseReportContentV1(refusal(entry.repoKey, entry.relPath, "too_large", entry, tooLargeMessage(read.sizeBytes, maxBytes)));
    }
    return parseReportContentV1({
      schemaVersion: REPORT_CONTENT_SCHEMA_VERSION,
      repo: entry.repoKey,
      relPath: entry.relPath,
      status: "ok",
      renderMode,
      content: read.content,
      sizeBytes: read.sizeBytes,
      mtime: read.mtime ?? entry.mtime,
      title: entry.title,
      docStatus: entry.status,
      artifactType: null, // a doc's type is DocEntryV1's bucket, never an ArtifactType (v5)
      message: null,
    });
  } catch (err) {
    const raw = String(err);
    if (/escapes workspace|outside workspace/.test(raw)) {
      return parseReportContentV1(refusal(entry.repoKey, entry.relPath, "denied", entry, "That path is outside the workspace and can’t be read."));
    }
    if (/size cap/.test(raw)) {
      const capMb = (maxBytes / 1_000_000).toFixed(1);
      return parseReportContentV1(
        refusal(entry.repoKey, entry.relPath, "too_large", entry, `This file exceeds the ${capMb} MB inline cap — open it in your editor.`),
      );
    }
    return parseReportContentV1(refusal(entry.repoKey, entry.relPath, "not_found", entry, "That doc couldn’t be read — it may have moved or been removed."));
  }
}

function tooLargeMessage(sizeBytes: number, maxBytes: number): string {
  const mb = (sizeBytes / 1_000_000).toFixed(1);
  const capMb = (maxBytes / 1_000_000).toFixed(1);
  return `This file is ${mb} MB (cap ${capMb} MB) — open it in your editor.`;
}

/** Build a non-`ok` payload, carrying the doc-index entry's metadata when we have it. */
function refusal(
  repo: string,
  relPath: string,
  status: Exclude<ReportContentV1["status"], "ok">,
  entry: DocEntryV1 | null,
  message: string,
): ReportContentV1 {
  return {
    schemaVersion: REPORT_CONTENT_SCHEMA_VERSION,
    repo,
    relPath,
    status,
    renderMode: "none",
    content: null,
    sizeBytes: 0,
    mtime: entry?.mtime ?? null,
    title: entry?.title ?? null,
    docStatus: entry?.status ?? null,
    artifactType: null,
    message,
  };
}
