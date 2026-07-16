/**
 * `deriveDocIndex` — pure fold of `DocSignal` (worktrees + main) + the existing
 * main-checkout `ArtifactSignal`s (specs + review reports + handoffs) into the
 * deduped **project → type → doc** tree the Docs tab reads (spec §5.4).
 *
 * Dedup is by the shared `docId` (= makeDocId(repoKey, checkoutId, relPath)) — a
 * main-checkout `artifactSource` entry WINS over a `DocsSource` main duplicate of
 * the same file, while worktree copies (different checkoutId → different docId)
 * stay distinct. Project grouping is projection-time (PF-5); an unresolvable repo
 * lands in the Company group's Reviews bucket (never dropped).
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import { isArtifactSignal, isDocSignal } from "../contracts/signals.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import { findProjectGroup, projectKeyForRepo, type ProjectTaxonomyV1 } from "../contracts/projects.js";
import {
  DOC_INDEX_SCHEMA_VERSION,
  classifyArtifactToDocIndexType,
  makeDocId,
  type DocEntryV1,
  type DocIndexV1,
  type DocProjectSectionV1,
  type DocTypeBucketV1,
} from "../contracts/doc-index.js";
import { DOC_INDEX_TYPES, type DocIndexType } from "../contracts/vocab.js";
import { aggregateSourceFreshness, isoFrom } from "./_shared.js";

interface IndexedDoc {
  readonly entry: DocEntryV1;
  readonly type: DocIndexType;
}

export function deriveDocIndex(bundle: SignalBundle, nowMs: number, taxonomy: ProjectTaxonomyV1): DocIndexV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const diagnostics: Diagnostic[] = [...taxonomy.diagnostics];

  // Surface a DocsSource truncation (MAX_DOCS_PER_REPO cap) as an index diagnostic
  // — it rides in RepoFreshness.errors as a NON-degraded "truncated" error, so the
  // freshness-derived diagnostics never see it; make it visible here (codex B P2).
  for (const batch of bundle.batches) {
    for (const rf of batch.repoFreshness) {
      for (const e of rf.errors) {
        if (e.code === "truncated") {
          diagnostics.push({ level: "warn", code: "doc_index_truncated", message: e.message, repo: rf.repo, source: batch.source });
        }
      }
    }
  }

  // Dedup by docId; an artifact main entry overwrites a DocsSource main dup.
  const byId = new Map<string, IndexedDoc>();

  for (const d of signals.filter(isDocSignal)) {
    if (byId.has(d.docId)) continue; // first DocSignal wins among DocSignals
    byId.set(d.docId, {
      type: d.docType,
      entry: {
        docId: d.docId,
        repoKey: d.repo,
        checkoutId: d.checkoutId,
        checkoutKey: d.checkoutKey,
        relPath: d.relPath,
        worktreeName: d.worktreeName,
        branch: d.branch,
        provenance: d.checkoutId === "main" ? "main" : "worktree",
        title: d.title,
        status: d.status,
        owner: d.owner,
        lastUpdated: d.lastUpdated,
        statusVerifiedAt: d.statusVerifiedAt,
        description: d.description,
        mtime: d.mtime,
      },
    });
  }

  // C1: status without status_verified_at = ASSERTED, not evidenced. One rolled-up
  // info diagnostic per repo (info tier — rail-only, never tints; a per-doc row
  // would flood the rail with the whole legacy corpus).
  const unverifiedByRepo = new Map<string, number>();
  for (const d of signals.filter(isDocSignal)) {
    if (d.checkoutId !== "main") continue; // count canon once — never per worktree copy
    if (d.status !== null && d.statusVerifiedAt === null) {
      unverifiedByRepo.set(d.repo, (unverifiedByRepo.get(d.repo) ?? 0) + 1);
    }
  }
  for (const [repo, count] of [...unverifiedByRepo.entries()].sort()) {
    diagnostics.push({
      level: "info",
      code: "status_unverified",
      message: `${count} doc${count === 1 ? "" : "s"} carry status: without status_verified_at`,
      repo,
      source: "doc-index",
    });
  }

  for (const a of signals.filter(isArtifactSignal)) {
    const docId = makeDocId(a.repo, "main", a.relPath);
    byId.set(docId, {
      type: classifyArtifactToDocIndexType(a.relPath),
      entry: {
        docId,
        repoKey: a.repo,
        checkoutId: "main",
        checkoutKey: a.repo,
        relPath: a.relPath,
        worktreeName: null,
        branch: null,
        provenance: "main",
        title: a.title,
        status: a.status,
        // ArtifactSignal carries no §2.3 head fields — nulls, honestly absent.
        owner: null,
        lastUpdated: null,
        statusVerifiedAt: null,
        description: null,
        mtime: a.mtime ?? isoFrom(nowMs),
      },
    });
  }

  // Bucket by project group → type. An unresolvable repo → Company group, Reviews bucket.
  const companyKey = taxonomy.groups.find((g) => g.kind === "company")?.key ?? taxonomy.groups[0]?.key ?? "company";
  const byGroup = new Map<string, Map<DocIndexType, DocEntryV1[]>>();
  const flaggedUnresolved = new Set<string>();

  for (const { entry, type } of byId.values()) {
    const resolved = findProjectGroup(taxonomy, entry.repoKey);
    const groupKey = resolved ? resolved.key : companyKey;
    const bucketType = resolved ? type : "review";
    if (!resolved && !flaggedUnresolved.has(entry.repoKey)) {
      flaggedUnresolved.add(entry.repoKey);
      diagnostics.push({
        level: "warn",
        code: "unresolved_repo",
        message: `repo "${entry.repoKey}" is not in the taxonomy; its docs land in Company / Reviews`,
        repo: entry.repoKey,
        source: "doc-index",
      });
    }
    const typeMap = byGroup.get(groupKey) ?? new Map<DocIndexType, DocEntryV1[]>();
    const arr = typeMap.get(bucketType) ?? [];
    arr.push(entry);
    typeMap.set(bucketType, arr);
    byGroup.set(groupKey, typeMap);
  }

  // Emit in taxonomy order; every group shows (calm 0-state when empty — show-0-counts).
  const groups: DocProjectSectionV1[] = [...taxonomy.groups]
    .sort((a, b) => a.order - b.order)
    .map((group): DocProjectSectionV1 => {
      const typeMap = byGroup.get(group.key);
      const types: DocTypeBucketV1[] = typeMap
        ? [...typeMap.entries()]
            .map(([type, docs]) => ({
              type,
              docs: docs.sort((x, y) => y.mtime.localeCompare(x.mtime) || x.relPath.localeCompare(y.relPath)),
            }))
            .sort((x, y) => DOC_INDEX_TYPES.indexOf(x.type) - DOC_INDEX_TYPES.indexOf(y.type))
        : [];
      return { group, types };
    });

  return {
    schemaVersion: DOC_INDEX_SCHEMA_VERSION,
    derivedAt: isoFrom(nowMs),
    sources: aggregateSourceFreshness(bundle),
    taxonomy,
    groups,
    diagnostics,
  };
}
