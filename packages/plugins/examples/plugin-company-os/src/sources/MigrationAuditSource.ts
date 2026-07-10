/**
 * `MigrationAuditSource` (COS-11) — reads the juice-bar drift-audit JSONs
 * (`reports/migrations/audit-*.json`, written by `audit-migrations-drift.ts`)
 * plus the newest apply receipt (`reports/migration-apply/*.md`), and emits one
 * `MigrationAuditSignal` per audit TARGET (staging/prod — newest file wins per
 * target). Single-repo like `LineageSource`: only when `juice-bar` is
 * responsible this run; a scoped refresh elsewhere leaves the last-good state.
 *
 * A parse-fail on the newest audit degrades (error + NO signal) — the row-8
 * last-good merge lives in the `deriveGatesState` fold, NOT here (§10.8 note).
 */

import { findRepoRoot, reposResponsibleFor, signalError, type CollectionContext } from "../contracts/collection-context.js";
import type { RepoFreshness, SignalBatch, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type { MigrationAuditSignal, Signal, SignalError } from "../contracts/signals.js";
import { MIGRATION_APPLY_GLOB, MIGRATION_AUDIT_GLOB, MIGRATION_AUDIT_REPO } from "../contracts/gates.js";
import { nowIso, readError } from "./_shared.js";

export const MIGRATION_AUDIT_SOURCE_ID = "migration_audit";

/** Count-or-array JSON fields (the audit writes arrays; older shapes wrote counts). */
function countOf(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

interface ParsedAudit {
  readonly target: string;
  readonly ranAt: string | null;
  readonly totalEntries: number;
  readonly notAppliedCount: number;
  readonly orphanTrackerRows: number;
  readonly unauditedBranchFiles: number;
  readonly grantSurfaceViolations: number;
  readonly grantSurfaceScanned: number;
}

/** Parse one audit JSON; null on any shape mismatch (caller degrades). */
export function parseMigrationAudit(text: string): ParsedAudit | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.target !== "string") return null;
  const entries = Array.isArray(o.entries) ? o.entries : [];
  let notApplied = 0;
  for (const e of entries) {
    if (typeof e === "object" && e !== null && (e as Record<string, unknown>).applied !== "yes") notApplied++;
  }
  return {
    target: o.target,
    ranAt: typeof o.ran_at === "string" ? o.ran_at : null,
    totalEntries: entries.length,
    notAppliedCount: notApplied,
    orphanTrackerRows: countOf(o.orphan_tracker_rows),
    unauditedBranchFiles: countOf(o.unaudited_branch_files),
    grantSurfaceViolations: countOf(o.grant_surface_violations),
    grantSurfaceScanned: countOf(o.grant_surface_scanned),
  };
}

export const migrationAuditSource: WorkSignalSource = {
  id: MIGRATION_AUDIT_SOURCE_ID,
  async collect(ctx: CollectionContext): Promise<SignalBatch> {
    const collectedAt = ctx.clock.now();
    if (!reposResponsibleFor(ctx).some((r) => r.repo === MIGRATION_AUDIT_REPO)) {
      return { source: MIGRATION_AUDIT_SOURCE_ID, collectedAt, signals: [], repoFreshness: [] };
    }
    const root = findRepoRoot(ctx, MIGRATION_AUDIT_REPO);
    if (!root || !root.available) {
      return {
        source: MIGRATION_AUDIT_SOURCE_ID,
        collectedAt,
        signals: [],
        repoFreshness: [
          {
            repo: MIGRATION_AUDIT_REPO,
            freshness: "stale",
            lastOkAt: null,
            errors: [signalError("repo_unavailable", `${MIGRATION_AUDIT_REPO} unavailable; migration audit not refreshed`)],
          },
        ],
      };
    }

    const errors: SignalError[] = [];
    const signals: Signal[] = [];

    // Newest apply receipt by mtime (shared by every emitted target signal).
    let lastApplyRelPath: string | null = null;
    let lastApplyAt: string | null = null;
    try {
      const receipts = await ctx.fs.list(MIGRATION_AUDIT_REPO, [MIGRATION_APPLY_GLOB]);
      for (const r of receipts) {
        if (lastApplyAt === null || r.mtime > lastApplyAt) {
          lastApplyAt = r.mtime;
          lastApplyRelPath = r.relPath;
        }
      }
    } catch (e) {
      errors.push(readError(MIGRATION_APPLY_GLOB, e));
    }

    try {
      const audits = await ctx.fs.list(MIGRATION_AUDIT_REPO, [MIGRATION_AUDIT_GLOB]);
      // Newest file per target wins — read newest-first, first hit per target sticks.
      const sorted = [...audits].sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
      const seenTargets = new Set<string>();
      for (const file of sorted) {
        let text: string;
        try {
          text = await ctx.fs.readText(MIGRATION_AUDIT_REPO, file.relPath);
        } catch (e) {
          errors.push(readError(file.relPath, e));
          continue;
        }
        const parsed = parseMigrationAudit(text);
        if (parsed === null) {
          // Degrade, emit NOTHING for this file — last-good merge is the fold's job.
          errors.push(signalError("parse_error", `unparseable migration audit: ${file.relPath}`));
          continue;
        }
        if (seenTargets.has(parsed.target)) continue;
        seenTargets.add(parsed.target);
        const signal: MigrationAuditSignal = {
          kind: "migration_audit",
          source: MIGRATION_AUDIT_SOURCE_ID,
          repo: MIGRATION_AUDIT_REPO,
          confidence: "high",
          freshness: "live",
          errors: [],
          target: parsed.target,
          ranAt: parsed.ranAt,
          auditRelPath: file.relPath,
          auditMtime: file.mtime,
          totalEntries: parsed.totalEntries,
          notAppliedCount: parsed.notAppliedCount,
          orphanTrackerRows: parsed.orphanTrackerRows,
          unauditedBranchFiles: parsed.unauditedBranchFiles,
          grantSurfaceViolations: parsed.grantSurfaceViolations,
          grantSurfaceScanned: parsed.grantSurfaceScanned,
          lastApplyRelPath,
          lastApplyAt,
        };
        signals.push(signal);
      }
    } catch (e) {
      errors.push(readError(MIGRATION_AUDIT_GLOB, e));
    }

    const degraded = errors.some((e) => e.degraded);
    return {
      source: MIGRATION_AUDIT_SOURCE_ID,
      collectedAt,
      signals,
      repoFreshness: [
        {
          repo: MIGRATION_AUDIT_REPO,
          freshness: degraded ? "stale" : "live",
          lastOkAt: degraded ? null : nowIso(ctx),
          errors,
        } satisfies RepoFreshness,
      ],
    };
  },
};
