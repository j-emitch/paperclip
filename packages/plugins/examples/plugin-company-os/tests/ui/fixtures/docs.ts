/**
 * Golden + empty `DocIndexV1` fixtures for the Docs SSR tests. Built against the
 * real `taxonomyFixture()` + the real `makeDocId`, and validated through
 * `parseDocIndexV1` at construction so a fixture can never drift from the
 * contract. Exercises: project grouping, all five type buckets (spec/plan/
 * handoff/backlog/review), and BOTH provenances — incl. the Dogfood-#2 case
 * (this COS-1 spec read from the `cos-COS-1 @ docs/COS-1` worktree).
 */

import { DOC_INDEX_SCHEMA_VERSION, makeDocId, parseDocIndexV1, type DocEntryV1, type DocIndexV1 } from "../../../src/contracts/index.js";
import { findProjectGroup } from "../../../src/contracts/projects.js";
import type { DocIndexType } from "../../../src/contracts/vocab.js";
import { taxonomyFixture } from "../../fixtures/taxonomy.js";

export const DOCS_NOW = Date.parse("2026-06-26T18:00:00Z");

const TAX = taxonomyFixture();
const grp = (key: string) => {
  const g = findProjectGroup(TAX, key);
  if (!g) throw new Error(`taxonomy fixture missing group ${key}`);
  return g;
};

function mainDoc(repoKey: string, relPath: string, title: string | null, status: string | null, mtime: string): DocEntryV1 {
  return {
    docId: makeDocId(repoKey, "main", relPath),
    repoKey,
    checkoutId: "main",
    checkoutKey: repoKey,
    relPath,
    worktreeName: null,
    branch: null,
    provenance: "main",
    title,
    status,
    owner: null,
    lastUpdated: null,
    statusVerifiedAt: null,
    description: null,
    mtime,
  };
}

function worktreeDoc(
  repoKey: string,
  checkoutHash: string,
  worktreeName: string,
  branch: string,
  relPath: string,
  title: string | null,
  status: string | null,
  mtime: string,
): DocEntryV1 {
  const checkoutId = `worktree:${checkoutHash}`;
  return {
    docId: makeDocId(repoKey, checkoutId, relPath),
    repoKey,
    checkoutId,
    checkoutKey: `${repoKey}::wt::${checkoutHash}`,
    relPath,
    worktreeName,
    branch,
    provenance: "worktree",
    title,
    status,
    owner: null,
    lastUpdated: null,
    statusVerifiedAt: null,
    description: null,
    mtime,
  };
}

function bucket(type: DocIndexType, docs: DocEntryV1[]) {
  return { type, docs };
}

export function goldenDocIndex(): DocIndexV1 {
  return parseDocIndexV1({
    schemaVersion: DOC_INDEX_SCHEMA_VERSION,
    derivedAt: "2026-06-26T17:56:00Z",
    taxonomy: TAX,
    groups: [
      {
        group: grp("company"),
        types: [
          bucket("spec", [
            // Dogfood-#2: this very spec, read from the docs/COS-1 worktree.
            worktreeDoc("company", "a1e4d26", "cos-COS-1", "docs/COS-1", "docs/superpowers/specs/2026-06-24-COS-1-orientation-home.md", "COS-1 — Orientation Home", "draft", "2026-06-26T16:50:00Z"),
          ]),
          bucket("plan", [
            worktreeDoc("company", "a1e4d26", "cos-COS-1", "docs/COS-1", "docs/superpowers/plans/2026-06-25-COS-1-daily-driver-cockpit-plan.md", "COS-1 daily-driver cockpit plan", "approved", "2026-06-25T20:00:00Z"),
          ]),
          bucket("handoff", [mainDoc("company", "reports/handoffs/2026-06-24-cos-1-spec-shipped.md", "COS-1 spec shipped — plan resume", null, "2026-06-24T22:00:00Z")]),
          bucket("review", [mainDoc("company", "reports/reviews/2026-06-22-cos-0.md", "COS-0 review report", null, "2026-06-22T12:00:00Z")]),
        ],
      },
      {
        group: grp("juice-bar"),
        types: [
          bucket("spec", [mainDoc("juice-bar", "specs/SSF-04-reconciliation.md", "SSF-04 reconciliation rehaul", "in_progress", "2026-06-23T16:00:00Z")]),
          bucket("backlog", [mainDoc("juice-bar", "backlog/2026-06-22-mtp-launch-blocker.md", null, null, "2026-06-22T10:00:00Z")]),
        ],
      },
    ],
    diagnostics: [],
  });
}

export function emptyDocIndex(): DocIndexV1 {
  return parseDocIndexV1({
    schemaVersion: DOC_INDEX_SCHEMA_VERSION,
    derivedAt: "2026-06-26T17:56:00Z",
    taxonomy: TAX,
    groups: [],
    diagnostics: [],
  });
}

/** The docId of the Dogfood-#2 spec (the COS-1 spec on the worktree). */
export function dogfoodSpecDocId(): string {
  return goldenDocIndex().groups[0].types[0].docs[0].docId;
}
