-- COS-8c Worktrees lens — one new projection cache table (omnibus spec §5.2).
-- Namespace literal = plugin_company_os_cc959257d2 (same as 001-005; the
-- migration validator rejects bare names). Mirrors the LOCKLESS cos_artifact_index
-- / cos_build_atlas shape exactly (PF-4) — written via the after-fence upsert
-- path in cache.ts, gated by the board lock. Additive, IF NOT EXISTS, no backfill,
-- no DROP (destructive DDL banned). 006 is next-free after COS-5's 005.
--
-- The PK covers the only access path (read-by-company); no secondary indexes.
-- Retention = latest snapshot per company (replace-on-derive, not history).
--
-- rollback: MANUAL — uninstall does NOT drop the namespace. To remove just this:
--   DROP TABLE IF EXISTS plugin_company_os_cc959257d2.cos_worktree_board;
--   (the DROP SCHEMA … CASCADE uninstall path still covers full removal.)

CREATE TABLE IF NOT EXISTS plugin_company_os_cc959257d2.cos_worktree_board (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  derived_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
