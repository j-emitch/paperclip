/**
 * `readSkillContent` — the Skills-viewer read (COS-1h), the worker side of the
 * `skill-content` data handler. A SIBLING of `readDocContent` keyed by `skillId`
 * rather than `docId`, so a skill body is only ever served for an id the catalog
 * already vetted.
 *
 * Defense-in-depth, outermost-first (mirrors doc-content):
 *   1. INDEX GATE — only a `skillId` already in `cos_skills_catalog` is readable.
 *   2. EXTENSION ALLOWLIST — `.md`/`.markdown` markdown, `.txt` text, else link-only.
 *   3. CHECKOUT RESOLVABLE — the entry's `checkoutKey` (company repo key or a plugin
 *      read-key) must resolve in the rebuilt key map; a removed root → clean not_found.
 *   4. CONTAINED READ — bytes via `workspace-fs` against the resolved root.
 *
 * Returns the existing `ReportContentV1` contract (reused). `artifactType` is
 * always null (a skill has no ArtifactType); `docStatus` is always null (skills
 * carry no lifecycle status).
 */

import {
  parseReportContentV1,
  REPORT_CONTENT_SCHEMA_VERSION,
  type ReportContentV1,
} from "./contracts/report-content.js";
import type { ReportRenderMode } from "./contracts/vocab.js";
import type { SkillEntryV1, SkillsCatalogV1 } from "./contracts/skills-catalog.js";
import { DOCS_VIEWER_MAX_BYTES, extnameLower, type ContainedFileRead } from "./report-content-read.js";

const RENDER_BY_EXT: Record<string, ReportRenderMode> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
};

export interface SkillContentDeps {
  /** Read the cached skills catalog (the worker wires `readSkillsCatalog(db, …)`). */
  readIndex: (companyId: string) => Promise<SkillsCatalogV1 | null>;
  /** Contained read by the entry's `checkoutKey` + `relPath` (the worker resolves the abs root). */
  readFile: (checkoutKey: string, relPath: string) => Promise<ContainedFileRead>;
  /** Whether a `checkoutKey` resolves in the freshly rebuilt map (else a removed root). */
  checkoutResolvable: (checkoutKey: string) => boolean;
  /** Override the size cap (tests). Defaults to `DOCS_VIEWER_MAX_BYTES`. */
  maxBytes?: number;
}

function findEntry(index: SkillsCatalogV1 | null, skillId: string): SkillEntryV1 | null {
  if (!index) return null;
  for (const origin of index.origins) {
    for (const collection of origin.collections) {
      for (const skill of collection.skills) {
        if (skill.skillId === skillId) return skill;
      }
    }
  }
  return null;
}

export async function readSkillContent(
  deps: SkillContentDeps,
  companyId: string,
  skillId: string,
): Promise<ReportContentV1> {
  const maxBytes = deps.maxBytes ?? DOCS_VIEWER_MAX_BYTES;

  if (!skillId) {
    return parseReportContentV1(refusal("?", "?", "not_found", null, "No skill selected."));
  }

  // 1. INDEX GATE — only serve a skillId the catalog already vetted.
  const index = await deps.readIndex(companyId);
  const entry = findEntry(index, skillId);
  if (!entry) {
    return parseReportContentV1(
      refusal("?", "?", "not_indexed", null, "This skill isn’t in the catalog — refresh the cockpit or pick a listed skill."),
    );
  }

  // 2. EXTENSION ALLOWLIST.
  const renderMode = RENDER_BY_EXT[extnameLower(entry.relPath)];
  if (!renderMode) {
    return parseReportContentV1(
      refusal(entry.checkoutKey, entry.relPath, "unsupported_type", entry, "This file type isn’t rendered inline — open it in your editor."),
    );
  }

  // 3. CHECKOUT RESOLVABLE — a removed plugin root's key is absent from the rebuilt map.
  if (!deps.checkoutResolvable(entry.checkoutKey)) {
    return parseReportContentV1(
      refusal(entry.checkoutKey, entry.relPath, "not_found", entry, "That skill root is no longer available."),
    );
  }

  // 4. CONTAINED READ against the resolved root.
  try {
    const read = await deps.readFile(entry.checkoutKey, entry.relPath);
    if (read.sizeBytes > maxBytes) {
      return parseReportContentV1(refusal(entry.checkoutKey, entry.relPath, "too_large", entry, tooLargeMessage(read.sizeBytes, maxBytes)));
    }
    return parseReportContentV1({
      schemaVersion: REPORT_CONTENT_SCHEMA_VERSION,
      repo: entry.checkoutKey,
      relPath: entry.relPath,
      status: "ok",
      renderMode,
      content: read.content,
      sizeBytes: read.sizeBytes,
      mtime: read.mtime ?? entry.mtime,
      title: entry.name,
      docStatus: null, // skills carry no lifecycle status
      artifactType: null, // a skill is not an ArtifactType
      message: null,
    });
  } catch (err) {
    const raw = String(err);
    if (/escapes workspace|outside workspace/.test(raw)) {
      return parseReportContentV1(refusal(entry.checkoutKey, entry.relPath, "denied", entry, "That path is outside the workspace and can’t be read."));
    }
    if (/size cap/.test(raw)) {
      const capMb = (maxBytes / 1_000_000).toFixed(1);
      return parseReportContentV1(
        refusal(entry.checkoutKey, entry.relPath, "too_large", entry, `This file exceeds the ${capMb} MB inline cap — open it in your editor.`),
      );
    }
    return parseReportContentV1(refusal(entry.checkoutKey, entry.relPath, "not_found", entry, "That skill couldn’t be read — it may have moved or been removed."));
  }
}

function tooLargeMessage(sizeBytes: number, maxBytes: number): string {
  const mb = (sizeBytes / 1_000_000).toFixed(1);
  const capMb = (maxBytes / 1_000_000).toFixed(1);
  return `This file is ${mb} MB (cap ${capMb} MB) — open it in your editor.`;
}

/** Build a non-`ok` payload, carrying the catalog entry's metadata when we have it. */
function refusal(
  repo: string,
  relPath: string,
  status: Exclude<ReportContentV1["status"], "ok">,
  entry: SkillEntryV1 | null,
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
    title: entry?.name ?? null,
    docStatus: null,
    artifactType: null,
    message,
  };
}
