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
import { errorFromSubprocess, nowIso, readError } from "./_shared.js";

/** The dupe-watch issue-title prefix + per-target rolling-issue body marker (matrix row 11). */
const DRIFT_ISSUE_TITLE_PREFIX = "[INFRA-DB-CD]";
const ROLLING_MARKER = (target: string): string => `<!-- infra-db-cd-rolling:${target} -->`;

interface DriftIssueLane {
  readonly openDriftIssueCount: number | null;
  readonly rollingByTarget: ReadonlyMap<string, number>;
  readonly error: SignalError | null;
}

/** ONE gh issue list read (shared by every target signal); gh failure → nulls + degraded error. */
async function readDriftIssueLane(ctx: CollectionContext): Promise<DriftIssueLane> {
  const none: DriftIssueLane = { openDriftIssueCount: null, rollingByTarget: new Map(), error: null };
  const result = await ctx.gh.run(MIGRATION_AUDIT_REPO, [
    "issue", "list", "--state", "open", "--json", "number,title,body", "--limit", "100",
  ]);
  const subErr = errorFromSubprocess(result, "gh issue list");
  if (subErr) return { ...none, error: subErr };
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    return { ...none, error: signalError("parse_error", "gh issue list returned non-JSON") };
  }
  if (!Array.isArray(raw)) return { ...none, error: signalError("parse_error", "gh issue list: expected an array") };
  let open = 0;
  const rollingByTarget = new Map<string, number>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const number = typeof o.number === "number" ? o.number : null;
    const title = typeof o.title === "string" ? o.title : "";
    const body = typeof o.body === "string" ? o.body : "";
    if (title.startsWith(DRIFT_ISSUE_TITLE_PREFIX)) open++;
    if (number !== null) {
      for (const target of ["staging", "prod"]) {
        if (!rollingByTarget.has(target) && body.includes(ROLLING_MARKER(target))) rollingByTarget.set(target, number);
      }
    }
  }
  return { openDriftIssueCount: open, rollingByTarget, error: null };
}

export const MIGRATION_AUDIT_SOURCE_ID = "migration_audit";

/**
 * Count-or-array JSON fields (the audit writes arrays; older shapes wrote
 * counts). STRICT (codex COS-11 P1 fail-open): a missing or invalid field is
 * null → the whole file parse-FAILS (degraded), never a silent clean 0 — and a
 * negative/fractional number can never reach the nonnegative-int zod at the
 * projection write (which would abort the entire derive).
 */
function countOf(v: unknown): number | null {
  if (Array.isArray(v)) return v.length;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  return null;
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
  // entries MUST be an array (ground-truthed shape) — a wrong-typed field is a
  // parse failure, not an empty-clean audit (fail-closed).
  if (!Array.isArray(o.entries)) return null;
  const entries = o.entries;
  let notApplied = 0;
  for (const e of entries) {
    if (typeof e === "object" && e !== null && (e as Record<string, unknown>).applied !== "yes") notApplied++;
  }
  const orphanTrackerRows = countOf(o.orphan_tracker_rows);
  const unauditedBranchFiles = countOf(o.unaudited_branch_files);
  const grantSurfaceViolations = countOf(o.grant_surface_violations);
  const grantSurfaceScanned = countOf(o.grant_surface_scanned);
  if (orphanTrackerRows === null || unauditedBranchFiles === null || grantSurfaceViolations === null || grantSurfaceScanned === null) {
    return null; // missing/invalid counters = unwitnessed evidence — fail the parse
  }
  return {
    target: o.target,
    ranAt: typeof o.ran_at === "string" ? o.ran_at : null,
    totalEntries: entries.length,
    notAppliedCount: notApplied,
    orphanTrackerRows,
    unauditedBranchFiles,
    grantSurfaceViolations,
    grantSurfaceScanned,
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

    // The drift-issue lane (matrix row 11) — fetched ONCE, lazily, only when a
    // signal will actually carry it (no audits on disk = no gh spend).
    let lane: DriftIssueLane | null = null;
    const driftLane = async (): Promise<DriftIssueLane> => {
      if (lane === null) {
        lane = await readDriftIssueLane(ctx);
        if (lane.error) errors.push(lane.error);
      }
      return lane;
    };

    try {
      const audits = await ctx.fs.list(MIGRATION_AUDIT_REPO, [MIGRATION_AUDIT_GLOB]);
      // Newest file per target wins — read newest-first, first hit per target sticks.
      const sorted = [...audits].sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
      const seenTargets = new Set<string>();
      // Targets whose NEWEST file failed to parse (target lifted from the
      // filename: audit-<target>-*.json). An older parseable file for such a
      // target still surfaces, but STALE — the fold marks it last-good, so a
      // corrupt newest audit can never render its predecessor as live-green
      // (codex COS-11 P1 on the row-8 story).
      const corruptTargets = new Set<string>();
      for (const file of sorted) {
        // Once a target has a parsed row, its OLDER files are superseded — skip
        // by filename-lifted target so they neither cost reads nor spray
        // parse_error diagnostics (pre-grant-era audits fail the strict parser).
        const fnameTarget = /audit-([a-z]+)/.exec(file.relPath.split("/").pop() ?? "")?.[1];
        if (fnameTarget && seenTargets.has(fnameTarget)) continue;
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
          const m = /audit-([a-z]+)/.exec(file.relPath.split("/").pop() ?? "");
          if (m && !seenTargets.has(m[1])) corruptTargets.add(m[1]);
          continue;
        }
        if (seenTargets.has(parsed.target)) continue;
        seenTargets.add(parsed.target);
        const issues = await driftLane();
        const signal: MigrationAuditSignal = {
          kind: "migration_audit",
          source: MIGRATION_AUDIT_SOURCE_ID,
          repo: MIGRATION_AUDIT_REPO,
          confidence: "high",
          freshness: corruptTargets.has(parsed.target) ? "stale" : "live",
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
          openDriftIssueCount: issues.openDriftIssueCount,
          rollingIssueNumber: issues.rollingByTarget.get(parsed.target) ?? null,
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
