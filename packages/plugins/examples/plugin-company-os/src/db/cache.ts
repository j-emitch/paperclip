/**
 * The plugin-owned cache layer (COS-0d). All persistence of the projection
 * projections + the per-source last-good slices + the atomic derive lock lives
 * here, behind a narrow `DbClient` (the SDK `PluginDatabaseClient` satisfies it),
 * so the worker stays thin and the SQL is in one auditable place.
 *
 * Every projection is VALIDATED (schema parse) before write and on read — a
 * malformed or wrong-version cache row is rejected/staled, never rendered. The
 * derive lock is an atomic compare-and-set on `cos_board_state` (a concurrent
 * acquirer gets 0 rows), and a stale lease is reclaimable.
 */

import type { ProjectionSet } from "../collect-and-project.js";
import {
  BOARD_STATE_SCHEMA_VERSION,
  safeParseBoardStateV1,
  parseBoardStateV1,
  type BoardStateV1,
} from "../contracts/board-state.js";
import {
  ARTIFACT_INDEX_SCHEMA_VERSION,
  safeParseArtifactIndexV1,
  parseArtifactIndexV1,
  type ArtifactIndexV1,
} from "../contracts/artifact-index.js";
import {
  ROUTINE_HEALTH_SCHEMA_VERSION,
  safeParseRoutineHealthV1,
  parseRoutineHealthV1,
  type RoutineHealthV1,
} from "../contracts/routine-health.js";
import {
  ORIENTATION_SCHEMA_VERSION,
  safeParseOrientationV1,
  parseOrientationV1,
  type OrientationV1,
} from "../contracts/orientation.js";
import {
  GIT_STATE_SCHEMA_VERSION,
  safeParseGitStateV1,
  parseGitStateV1,
  type GitStateV1,
} from "../contracts/git-state.js";
import {
  DOC_INDEX_SCHEMA_VERSION,
  safeParseDocIndexV1,
  parseDocIndexV1,
  type DocIndexV1,
} from "../contracts/doc-index.js";
import {
  SKILLS_CATALOG_SCHEMA_VERSION,
  safeParseSkillsCatalogV1,
  parseSkillsCatalogV1,
  type SkillsCatalogV1,
} from "../contracts/skills-catalog.js";
import {
  AGENT_SYSTEM_SCHEMA_VERSION,
  safeParseAgentSystemV1,
  parseAgentSystemV1,
  type AgentSystemV1,
} from "../contracts/agent-system.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import { COS_DB_NAMESPACE } from "./namespace.js";
import type { SourceVersion } from "./scoped-merge.js";

/** The slice of the SDK `PluginDatabaseClient` the cache needs (kept narrow for testability). */
export interface DbClient {
  readonly namespace: string;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
}

const NS = COS_DB_NAMESPACE;

/**
 * Guard: the host-provided namespace MUST equal the literal the migration hard-codes.
 * A mismatch means the host derivation changed — fail loud rather than read/write
 * a schema the migration never created.
 */
export function assertNamespace(db: DbClient): void {
  if (db.namespace !== NS) {
    throw new Error(`Company OS DB namespace mismatch: host="${db.namespace}" expected="${NS}"`);
  }
}

/** Ensure the per-company board row exists so the lock CAS has something to update. */
export async function ensureBoardRow(db: DbClient, companyId: string): Promise<void> {
  await db.execute(
    `INSERT INTO ${NS}.cos_board_state (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING`,
    [companyId],
  );
}

/**
 * Atomically acquire the per-company derive lock. CAS: only updates when the
 * lease is free or expired, so a second concurrent acquirer affects 0 rows.
 * Returns true iff acquired. Caller must `ensureBoardRow` first.
 */
export async function acquireDeriveLock(
  db: DbClient,
  companyId: string,
  owner: string,
  leaseMs: number,
  nowMs: number,
): Promise<boolean> {
  const { rowCount } = await db.execute(
    `UPDATE ${NS}.cos_board_state
       SET lock_owner = $2, lock_until = to_timestamp($3 / 1000.0)
     WHERE company_id = $1 AND (lock_until IS NULL OR lock_until <= to_timestamp($4 / 1000.0))`,
    [companyId, owner, nowMs + leaseMs, nowMs],
  );
  return rowCount === 1;
}

/** Release the lock (only if still owned by `owner` — never steals another holder's lease). */
export async function releaseDeriveLock(db: DbClient, companyId: string, owner: string): Promise<void> {
  await db.execute(
    `UPDATE ${NS}.cos_board_state SET lock_owner = NULL, lock_until = NULL
     WHERE company_id = $1 AND lock_owner = $2`,
    [companyId, owner],
  );
}

/**
 * Validate + persist all projections for a company, FENCED by lock
 * ownership. The board write carries `AND lock_owner = $owner`: if a slow derive
 * lost its lease and another derive took over (changing lock_owner), this write
 * affects 0 rows and throws — so a stale derive can never overwrite a newer one
 * (codex A P0). The artifact/routine upserts run only after the board fence
 * passes, so they are gated by the same ownership check.
 */
export async function writeProjections(
  db: DbClient,
  companyId: string,
  set: ProjectionSet,
  owner: string,
): Promise<void> {
  // Validate-before-write: a malformed projection throws here, never reaches the DB.
  parseBoardStateV1(set.board);
  parseArtifactIndexV1(set.artifactIndex);
  parseRoutineHealthV1(set.routineHealth);
  parseOrientationV1(set.orientation);
  parseGitStateV1(set.gitState);
  parseDocIndexV1(set.docIndex);
  parseSkillsCatalogV1(set.skillsCatalog);
  parseAgentSystemV1(set.agentSystem);

  const { rowCount } = await db.execute(
    `UPDATE ${NS}.cos_board_state
       SET snapshot = $2::jsonb, schema_version = $3, derived_at = $4, updated_at = now()
     WHERE company_id = $1 AND lock_owner = $5`,
    [companyId, JSON.stringify(set.board), BOARD_STATE_SCHEMA_VERSION, set.board.derivedAt, owner],
  );
  if (rowCount !== 1) {
    throw new Error(`derive lease lost for ${companyId} — aborting write (owner=${owner})`);
  }
  // The seven lockless secondaries upsert only AFTER the board fence passes (same
  // after-fence pattern COS-0 already uses for artifact-index + routine-health).
  await upsertSnapshot(db, "cos_artifact_index", companyId, set.artifactIndex, ARTIFACT_INDEX_SCHEMA_VERSION, set.artifactIndex.derivedAt, owner);
  await upsertSnapshot(db, "cos_routine_health", companyId, set.routineHealth, ROUTINE_HEALTH_SCHEMA_VERSION, set.routineHealth.derivedAt, owner);
  await upsertSnapshot(db, "cos_orientation", companyId, set.orientation, ORIENTATION_SCHEMA_VERSION, set.orientation.derivedAt, owner);
  await upsertSnapshot(db, "cos_git_state", companyId, set.gitState, GIT_STATE_SCHEMA_VERSION, set.gitState.derivedAt, owner);
  await upsertSnapshot(db, "cos_doc_index", companyId, set.docIndex, DOC_INDEX_SCHEMA_VERSION, set.docIndex.derivedAt, owner);
  await upsertSnapshot(db, "cos_skills_catalog", companyId, set.skillsCatalog, SKILLS_CATALOG_SCHEMA_VERSION, set.skillsCatalog.derivedAt, owner);
  await upsertSnapshot(db, "cos_agent_system", companyId, set.agentSystem, AGENT_SYSTEM_SCHEMA_VERSION, set.agentSystem.derivedAt, owner);
}

/**
 * Upsert a secondary projection snapshot, FENCED by lock ownership (codex B P1 /
 * OI-6 folded): the `INSERT … SELECT … WHERE EXISTS (board row still owned by
 * $owner)` gates BOTH the insert and the ON CONFLICT update (the conflict only
 * fires when the guarded insert produced a row). So if the derive's lease was lost
 * AFTER the board write but DURING the secondaries, the remaining upserts write 0
 * rows — a newer derive's generation can never be partially overwritten. Closes
 * the residual window the board-only fence left open (also hardens the two COS-0
 * secondaries).
 */
async function upsertSnapshot(
  db: DbClient,
  table: string,
  companyId: string,
  snapshot: unknown,
  version: number,
  derivedAt: string,
  owner: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO ${NS}.${table} (company_id, snapshot, schema_version, derived_at, updated_at)
       SELECT $1, $2::jsonb, $3, $4, now()
       WHERE EXISTS (SELECT 1 FROM ${NS}.cos_board_state WHERE company_id = $1 AND lock_owner = $5)
     ON CONFLICT (company_id) DO UPDATE
       SET snapshot = EXCLUDED.snapshot, schema_version = EXCLUDED.schema_version,
           derived_at = EXCLUDED.derived_at, updated_at = now()`,
    [companyId, JSON.stringify(snapshot), version, derivedAt, owner],
  );
}

// ---------------------------------------------------------------------------
// Reads — safeParse + version-gate; a bad/stale-version row reads as null (re-derive)
// ---------------------------------------------------------------------------

interface SnapshotRow {
  snapshot: unknown;
  schema_version: number;
}

export async function readBoardState(db: DbClient, companyId: string): Promise<BoardStateV1 | null> {
  const rows = await db.query<SnapshotRow>(
    `SELECT snapshot, schema_version FROM ${NS}.cos_board_state WHERE company_id = $1`,
    [companyId],
  );
  return readSnapshot(rows, BOARD_STATE_SCHEMA_VERSION, (s) => safeParseBoardStateV1(s));
}

export async function readArtifactIndex(db: DbClient, companyId: string): Promise<ArtifactIndexV1 | null> {
  const rows = await db.query<SnapshotRow>(
    `SELECT snapshot, schema_version FROM ${NS}.cos_artifact_index WHERE company_id = $1`,
    [companyId],
  );
  return readSnapshot(rows, ARTIFACT_INDEX_SCHEMA_VERSION, (s) => safeParseArtifactIndexV1(s));
}

export async function readRoutineHealth(db: DbClient, companyId: string): Promise<RoutineHealthV1 | null> {
  const rows = await db.query<SnapshotRow>(
    `SELECT snapshot, schema_version FROM ${NS}.cos_routine_health WHERE company_id = $1`,
    [companyId],
  );
  return readSnapshot(rows, ROUTINE_HEALTH_SCHEMA_VERSION, (s) => safeParseRoutineHealthV1(s));
}

export async function readOrientation(db: DbClient, companyId: string): Promise<OrientationV1 | null> {
  const rows = await db.query<SnapshotRow>(
    `SELECT snapshot, schema_version FROM ${NS}.cos_orientation WHERE company_id = $1`,
    [companyId],
  );
  return readSnapshot(rows, ORIENTATION_SCHEMA_VERSION, (s) => safeParseOrientationV1(s));
}

export async function readGitState(db: DbClient, companyId: string): Promise<GitStateV1 | null> {
  const rows = await db.query<SnapshotRow>(
    `SELECT snapshot, schema_version FROM ${NS}.cos_git_state WHERE company_id = $1`,
    [companyId],
  );
  return readSnapshot(rows, GIT_STATE_SCHEMA_VERSION, (s) => safeParseGitStateV1(s));
}

export async function readDocIndex(db: DbClient, companyId: string): Promise<DocIndexV1 | null> {
  const rows = await db.query<SnapshotRow>(
    `SELECT snapshot, schema_version FROM ${NS}.cos_doc_index WHERE company_id = $1`,
    [companyId],
  );
  return readSnapshot(rows, DOC_INDEX_SCHEMA_VERSION, (s) => safeParseDocIndexV1(s));
}

export async function readSkillsCatalog(db: DbClient, companyId: string): Promise<SkillsCatalogV1 | null> {
  const rows = await db.query<SnapshotRow>(
    `SELECT snapshot, schema_version FROM ${NS}.cos_skills_catalog WHERE company_id = $1`,
    [companyId],
  );
  return readSnapshot(rows, SKILLS_CATALOG_SCHEMA_VERSION, (s) => safeParseSkillsCatalogV1(s));
}

export async function readAgentSystem(db: DbClient, companyId: string): Promise<AgentSystemV1 | null> {
  const rows = await db.query<SnapshotRow>(
    `SELECT snapshot, schema_version FROM ${NS}.cos_agent_system WHERE company_id = $1`,
    [companyId],
  );
  return readSnapshot(rows, AGENT_SYSTEM_SCHEMA_VERSION, (s) => safeParseAgentSystemV1(s));
}

function readSnapshot<T>(
  rows: readonly SnapshotRow[],
  expectedVersion: number,
  parse: (s: unknown) => { success: boolean; data?: T },
): T | null {
  const row = rows[0];
  if (!row || row.snapshot == null) return null;
  if (row.schema_version !== expectedVersion) return null; // stale schema → force re-derive
  const result = parse(row.snapshot);
  return result.success && result.data !== undefined ? result.data : null;
}

// ---------------------------------------------------------------------------
// Source-version slices (scoped-merge last-good)
// ---------------------------------------------------------------------------

interface SourceVersionRow {
  source: string;
  repo: string;
  signals: unknown;
  freshness: string;
  last_ok_at: string | null;
}

export async function loadSourceVersions(db: DbClient, companyId: string): Promise<SourceVersion[]> {
  const rows = await db.query<SourceVersionRow>(
    `SELECT source, repo, signals, freshness, last_ok_at FROM ${NS}.cos_source_versions WHERE company_id = $1`,
    [companyId],
  );
  return rows.map((r) => ({
    source: r.source,
    repo: r.repo,
    signals: Array.isArray(r.signals) ? (r.signals as SourceVersion["signals"]) : [],
    freshness: r.freshness === "live" || r.freshness === "cached" ? r.freshness : "stale",
    lastOkAt: r.last_ok_at,
  }));
}

/**
 * Persist the per-(source, repo) last-good slices, REPLACING rather than blindly
 * upserting so a stale slice can never resurrect (codex B P1):
 *   - full sweep (`scopeRepo === null`): authoritative — delete ALL the company's
 *     slices first, so a repo dropped from config is purged.
 *   - scoped refresh: delete only the scoped repo's slices, then insert its fresh
 *     ones (other repos' last-good is untouched).
 * Runs under the derive lock (single-writer per company), so the delete→insert
 * window is safe without an explicit transaction.
 */
export async function replaceSourceVersions(
  db: DbClient,
  companyId: string,
  scopeRepo: string | null,
  versions: readonly SourceVersion[],
): Promise<void> {
  if (scopeRepo === null) {
    await db.execute(`DELETE FROM ${NS}.cos_source_versions WHERE company_id = $1`, [companyId]);
  } else {
    await db.execute(`DELETE FROM ${NS}.cos_source_versions WHERE company_id = $1 AND repo = $2`, [companyId, scopeRepo]);
  }
  const toInsert = scopeRepo === null ? versions : versions.filter((v) => v.repo === scopeRepo);
  for (const v of toInsert) {
    await db.execute(
      `INSERT INTO ${NS}.cos_source_versions (company_id, source, repo, signals, freshness, last_ok_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, now())
       ON CONFLICT (company_id, source, repo) DO UPDATE
         SET signals = EXCLUDED.signals, freshness = EXCLUDED.freshness,
             last_ok_at = EXCLUDED.last_ok_at, updated_at = now()`,
      [companyId, v.source, v.repo, JSON.stringify(v.signals), v.freshness, v.lastOkAt],
    );
  }
}

// ---------------------------------------------------------------------------
// Run log
// ---------------------------------------------------------------------------

export interface RunRecord {
  readonly trigger: "schedule" | "hook" | "manual";
  readonly scopeRepo: string | null;
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly error: string | null;
}

export async function recordRun(db: DbClient, companyId: string, run: RunRecord): Promise<void> {
  await db.execute(
    `INSERT INTO ${NS}.cos_collection_runs (company_id, trigger, scope_repo, finished_at, ok, diagnostics, error)
       VALUES ($1, $2, $3, now(), $4, $5::jsonb, $6)`,
    [companyId, run.trigger, run.scopeRepo, run.ok, JSON.stringify(run.diagnostics), run.error],
  );
}
