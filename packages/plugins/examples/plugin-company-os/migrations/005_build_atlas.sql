-- COS-5 Build Atlas — one new projection cache table (spec §5.4).
-- Namespace literal = plugin_company_os_cc959257d2 (same as 001/002/003/004; the
-- migration validator rejects bare names). Mirrors the LOCKLESS cos_agent_system
-- / cos_skills_catalog shape exactly (PF-4) — written via the after-fence upsert
-- path in cache.ts, gated by the board lock. Additive, IF NOT EXISTS, no backfill,
-- no DROP (destructive DDL banned). 005 is next-free after COS-1R's 004.
--
-- The PK covers the only access path (read-by-company); no secondary indexes.
--
-- rollback: MANUAL — uninstall does NOT drop the namespace. To remove just this:
--   DROP TABLE IF EXISTS plugin_company_os_cc959257d2.cos_build_atlas;
--   (the DROP SCHEMA … CASCADE uninstall path still covers full removal.)

CREATE TABLE IF NOT EXISTS plugin_company_os_cc959257d2.cos_build_atlas (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  derived_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
