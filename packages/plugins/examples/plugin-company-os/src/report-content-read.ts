/**
 * `readReportContent` — the docs-viewer read (spec §7), the worker side of the
 * `report-content` data handler. It is deliberately PURE over injected deps
 * (index read + a contained file read + a repo-config check) so every refusal
 * branch is unit-testable without a filesystem, and the real fs containment is
 * proven separately against `workspace-fs`.
 *
 * Defense-in-depth, outermost-first:
 *   1. INDEX GATE — only files already in the vetted `cos_artifact_index` are
 *      readable. The browser cannot request an arbitrary repo path; it can only
 *      open something the index already walked, classified, and the Reports list
 *      surfaced. This is the strongest containment (a path not in the index is
 *      refused before any fs touch).
 *   2. EXTENSION ALLOWLIST — `.md`/`.markdown` render as markdown, `.txt` as
 *      text; anything else is link-only (`unsupported_type`).
 *   3. SIZE CAP — checked against the index size BEFORE reading, then re-checked
 *      on the real read (race).
 *   4. CONTAINED READ — the actual bytes come through `workspace-fs`
 *      (traversal/symlink/oversize rejected); a refusal maps to `denied`.
 *
 * Every returned object is validated against the contract and carries only a
 * workspace-relative path — never an absolute host path or a raw read error.
 */

import type { ArtifactIndexV1, ArtifactEntry } from "./contracts/artifact-index.js";
import { parseReportContentV1, REPORT_CONTENT_SCHEMA_VERSION, type ReportContentV1 } from "./contracts/report-content.js";
import type { ReportRenderMode } from "./contracts/vocab.js";

/** Docs-viewer hard size cap (spec §7: ~1 MB → "too large, open in editor"). */
export const DOCS_VIEWER_MAX_BYTES = 1_000_000;

/** Extension → render mode. Keys not present here are link-only (`unsupported_type`). */
const RENDER_BY_EXT: Record<string, ReportRenderMode> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
};

/** The lowercase extension of a path (incl. the dot), or "" when none. */
export function extnameLower(relPath: string): string {
  const m = /\.[^./\\]+$/.exec(relPath);
  return m ? m[0].toLowerCase() : "";
}

/** A contained file read: UTF-8 content + authoritative byte size + ISO mtime. */
export interface ContainedFileRead {
  readonly content: string;
  readonly sizeBytes: number;
  readonly mtime: string;
}

export interface ReportContentDeps {
  /** Read the cached artifact index (the worker wires `readArtifactIndex(db, …)`). */
  readIndex: (companyId: string) => Promise<ArtifactIndexV1 | null>;
  /**
   * Contained read of a workspace-relative file. MUST throw with an `escapes
   * workspace` / `size cap` message on refusal (the `workspace-fs` contract).
   */
  readFile: (repo: string, relPath: string) => Promise<ContainedFileRead>;
  /** Whether `repo` is a configured repo root (else the read is impossible). */
  repoConfigured: (repo: string) => boolean;
  /** Override the size cap (tests). Defaults to `DOCS_VIEWER_MAX_BYTES`. */
  maxBytes?: number;
}

export async function readReportContent(
  deps: ReportContentDeps,
  companyId: string,
  repo: string,
  relPath: string,
): Promise<ReportContentV1> {
  const maxBytes = deps.maxBytes ?? DOCS_VIEWER_MAX_BYTES;

  // A missing/blank request is a clean "nothing selected", not an error.
  if (!repo || !relPath) {
    return parseReportContentV1(refusal(repo || "?", relPath || "?", "not_found", null, "No document selected."));
  }

  // 1. INDEX GATE — only ever serve a file the index already vetted.
  const index = await deps.readIndex(companyId);
  const entry = index?.entries.find((e) => e.repo === repo && e.relPath === relPath) ?? null;
  if (!entry) {
    return parseReportContentV1(
      refusal(repo, relPath, "not_indexed", null, "This file isn’t in the artifact index — refresh the cockpit or pick a listed report."),
    );
  }

  // 2. EXTENSION ALLOWLIST.
  const renderMode = RENDER_BY_EXT[extnameLower(relPath)];
  if (!renderMode) {
    return parseReportContentV1(
      refusal(repo, relPath, "unsupported_type", entry, "This file type isn’t rendered inline — open it in your editor."),
    );
  }

  // 3. SIZE CAP (pre-read, from the index).
  if (entry.sizeBytes > maxBytes) {
    return parseReportContentV1(refusal(repo, relPath, "too_large", entry, tooLargeMessage(entry.sizeBytes, maxBytes)));
  }

  // The repo must be a configured root for the contained read to resolve.
  if (!deps.repoConfigured(repo)) {
    return parseReportContentV1(refusal(repo, relPath, "not_found", entry, "That repository isn’t configured for the cockpit."));
  }

  // 4. CONTAINED READ.
  try {
    const read = await deps.readFile(repo, relPath);
    if (read.sizeBytes > maxBytes) {
      return parseReportContentV1(refusal(repo, relPath, "too_large", entry, tooLargeMessage(read.sizeBytes, maxBytes)));
    }
    return parseReportContentV1({
      schemaVersion: REPORT_CONTENT_SCHEMA_VERSION,
      repo,
      relPath,
      status: "ok",
      renderMode,
      content: read.content,
      sizeBytes: read.sizeBytes,
      mtime: read.mtime ?? entry.mtime,
      title: entry.title,
      artifactType: entry.artifactType,
      message: null,
    });
  } catch (err) {
    const raw = String(err);
    if (/escapes workspace|outside workspace/.test(raw)) {
      return parseReportContentV1(refusal(repo, relPath, "denied", entry, "That path is outside the workspace and can’t be read."));
    }
    if (/size cap/.test(raw)) {
      return parseReportContentV1(refusal(repo, relPath, "too_large", entry, tooLargeMessage(entry.sizeBytes, maxBytes)));
    }
    return parseReportContentV1(refusal(repo, relPath, "not_found", entry, "That file couldn’t be read — it may have moved or been removed."));
  }
}

function tooLargeMessage(sizeBytes: number, maxBytes: number): string {
  const mb = (sizeBytes / 1_000_000).toFixed(1);
  const capMb = (maxBytes / 1_000_000).toFixed(1);
  return `This file is ${mb} MB (cap ${capMb} MB) — open it in your editor.`;
}

/** Build a non-`ok` payload, carrying the index entry's metadata when we have it. */
function refusal(
  repo: string,
  relPath: string,
  status: Exclude<ReportContentV1["status"], "ok">,
  entry: ArtifactEntry | null,
  message: string,
): ReportContentV1 {
  return {
    schemaVersion: REPORT_CONTENT_SCHEMA_VERSION,
    repo,
    relPath,
    status,
    renderMode: "none",
    content: null,
    sizeBytes: entry?.sizeBytes ?? 0,
    mtime: entry?.mtime ?? null,
    title: entry?.title ?? null,
    artifactType: entry?.artifactType ?? null,
    message,
  };
}
