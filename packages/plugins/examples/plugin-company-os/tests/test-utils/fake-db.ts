/**
 * A faithful in-memory `DbClient` for the cache tests. It models the LOCK CAS
 * semantics (the acquire UPDATE's WHERE clause, by reading the owner/expiry/now
 * params) and the snapshot + source-version tables, by recognizing the cache
 * layer's own stable SQL. This tests the cache contract (right SQL, right params,
 * right rowCount handling) without a real Postgres; the live migration + SQL
 * semantics are verified at install time.
 *
 * Lives under test-utils/ (a sanctioned test path) because the generic
 * `DbClient.query<T>` requires one localized typed cast to satisfy the SDK
 * interface — the allowed test-only pattern, never used in production code.
 */

import { COS_DB_NAMESPACE } from "../../src/db/namespace.js";
import type { DbClient } from "../../src/db/cache.js";

interface BoardRow {
  lockOwner: string | null;
  lockUntil: number | null; // epoch ms
  snapshot: unknown;
  schemaVersion: number;
}
interface SnapRow {
  snapshot: unknown;
  schemaVersion: number;
}

export class FakeDb implements DbClient {
  readonly namespace: string;
  board = new Map<string, BoardRow>();
  artifact = new Map<string, SnapRow>();
  routine = new Map<string, SnapRow>();
  orientation = new Map<string, SnapRow>();
  gitState = new Map<string, SnapRow>();
  docIndex = new Map<string, SnapRow>();
  skillsCatalog = new Map<string, SnapRow>();
  agentSystem = new Map<string, SnapRow>();
  buildAtlas = new Map<string, SnapRow>();

  worktreeBoard = new Map<string, SnapRow>();
  sourceVersions = new Map<string, { companyId: string; source: string; repo: string; signals: unknown; freshness: string; lastOkAt: string | null }>();
  runs: Array<Record<string, unknown>> = [];

  constructor(namespace: string = COS_DB_NAMESPACE) {
    this.namespace = namespace;
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
    const s = sql.replace(/\s+/g, " ");

    if (s.includes("INSERT INTO") && s.includes("cos_board_state (company_id) VALUES")) {
      const id = String(params[0]);
      if (!this.board.has(id)) {
        this.board.set(id, { lockOwner: null, lockUntil: null, snapshot: null, schemaVersion: 1 });
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    // Acquire CAS (`<=` boundary — exactly-at-expiry is reclaimable).
    if (s.includes("cos_board_state") && s.includes("SET lock_owner = $2, lock_until = to_timestamp")) {
      const id = String(params[0]);
      const owner = String(params[1]);
      const expiryMs = Number(params[2]);
      const nowMs = Number(params[3]);
      const row = this.board.get(id);
      if (!row) return { rowCount: 0 };
      const free = row.lockUntil === null || row.lockUntil <= nowMs;
      if (!free) return { rowCount: 0 };
      row.lockOwner = owner;
      row.lockUntil = expiryMs;
      return { rowCount: 1 };
    }

    // Release.
    if (s.includes("cos_board_state") && s.includes("SET lock_owner = NULL")) {
      const id = String(params[0]);
      const owner = String(params[1]);
      const row = this.board.get(id);
      if (row && row.lockOwner === owner) {
        row.lockOwner = null;
        row.lockUntil = null;
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    // Board snapshot write — FENCED by lock ownership (WHERE ... lock_owner = $5).
    if (s.includes("cos_board_state") && s.includes("SET snapshot = $2::jsonb")) {
      const row = this.board.get(String(params[0]));
      if (!row || row.lockOwner !== String(params[4])) return { rowCount: 0 }; // lease lost
      row.snapshot = JSON.parse(String(params[1]));
      row.schemaVersion = Number(params[2]);
      return { rowCount: 1 };
    }

    // The five secondary upserts are now lock-owner-fenced (INSERT … WHERE EXISTS
    // board row owned by $5) — model the guard: write only if the lease is still held.
    if (s.includes("INSERT INTO") && s.includes("cos_artifact_index")) return this.fencedUpsert(this.artifact, params);
    if (s.includes("INSERT INTO") && s.includes("cos_routine_health")) return this.fencedUpsert(this.routine, params);
    if (s.includes("INSERT INTO") && s.includes("cos_orientation")) return this.fencedUpsert(this.orientation, params);
    if (s.includes("INSERT INTO") && s.includes("cos_git_state")) return this.fencedUpsert(this.gitState, params);
    if (s.includes("INSERT INTO") && s.includes("cos_doc_index")) return this.fencedUpsert(this.docIndex, params);
    if (s.includes("INSERT INTO") && s.includes("cos_skills_catalog")) return this.fencedUpsert(this.skillsCatalog, params);
    if (s.includes("INSERT INTO") && s.includes("cos_agent_system")) return this.fencedUpsert(this.agentSystem, params);
    if (s.includes("INSERT INTO") && s.includes("cos_build_atlas")) return this.fencedUpsert(this.buildAtlas, params);
    if (s.includes("INSERT INTO") && s.includes("cos_worktree_board")) return this.fencedUpsert(this.worktreeBoard, params);
    if (s.includes("DELETE FROM") && s.includes("cos_source_versions")) {
      const companyId = String(params[0]);
      const scopeRepo = params.length > 1 ? String(params[1]) : null; // scoped delete passes repo
      let n = 0;
      for (const [key, v] of this.sourceVersions) {
        if (v.companyId === companyId && (scopeRepo === null || v.repo === scopeRepo)) {
          this.sourceVersions.delete(key);
          n++;
        }
      }
      return { rowCount: n };
    }
    if (s.includes("INSERT INTO") && s.includes("cos_source_versions")) {
      const key = `${params[0]}|${params[1]}|${params[2]}`;
      this.sourceVersions.set(key, {
        companyId: String(params[0]),
        source: String(params[1]),
        repo: String(params[2]),
        signals: JSON.parse(String(params[3])),
        freshness: String(params[4]),
        lastOkAt: params[5] === null ? null : String(params[5]),
      });
      return { rowCount: 1 };
    }
    if (s.includes("INSERT INTO") && s.includes("cos_collection_runs")) {
      this.runs.push({ companyId: params[0], trigger: params[1], scopeRepo: params[2], ok: params[3], error: params[5] });
      return { rowCount: 1 };
    }
    throw new Error(`FakeDb.execute: unrecognized SQL: ${s.slice(0, 80)}`);
  }

  /** Model the lock-owner fence on a secondary upsert: write only if the lease ($5) is still held. */
  private fencedUpsert(map: Map<string, SnapRow>, params: unknown[]): { rowCount: number } {
    const companyId = String(params[0]);
    const owner = String(params[4]);
    if (this.board.get(companyId)?.lockOwner !== owner) return { rowCount: 0 }; // lease lost → guarded out
    map.set(companyId, { snapshot: JSON.parse(String(params[1])), schemaVersion: Number(params[2]) });
    return { rowCount: 1 };
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const s = sql.replace(/\s+/g, " ");
    const id = String(params[0]);
    const rows = this.rowsFor(s, id);
    return rows as T[];
  }

  private rowsFor(s: string, id: string): Record<string, unknown>[] {
    const snap = (row: SnapRow | BoardRow | undefined): Record<string, unknown>[] =>
      row ? [{ snapshot: row.snapshot, schema_version: row.schemaVersion }] : [];
    if (s.includes("FROM") && s.includes("cos_board_state")) return snap(this.board.get(id));
    if (s.includes("FROM") && s.includes("cos_artifact_index")) return snap(this.artifact.get(id));
    if (s.includes("FROM") && s.includes("cos_routine_health")) return snap(this.routine.get(id));
    if (s.includes("FROM") && s.includes("cos_orientation")) return snap(this.orientation.get(id));
    if (s.includes("FROM") && s.includes("cos_git_state")) return snap(this.gitState.get(id));
    if (s.includes("FROM") && s.includes("cos_doc_index")) return snap(this.docIndex.get(id));
    if (s.includes("FROM") && s.includes("cos_skills_catalog")) return snap(this.skillsCatalog.get(id));
    if (s.includes("FROM") && s.includes("cos_agent_system")) return snap(this.agentSystem.get(id));
    if (s.includes("FROM") && s.includes("cos_build_atlas")) return snap(this.buildAtlas.get(id));
    if (s.includes("FROM") && s.includes("cos_worktree_board")) return snap(this.worktreeBoard.get(id));
    if (s.includes("FROM") && s.includes("cos_source_versions")) {
      return [...this.sourceVersions.values()]
        .filter((v) => v.companyId === id) // mirror the real WHERE company_id = $1
        .map((v) => ({ source: v.source, repo: v.repo, signals: v.signals, freshness: v.freshness, last_ok_at: v.lastOkAt }));
    }
    throw new Error(`FakeDb.query: unrecognized SQL: ${s.slice(0, 80)}`);
  }
}
