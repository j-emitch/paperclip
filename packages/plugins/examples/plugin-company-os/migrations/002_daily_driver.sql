-- COS-1 Daily-Driver Cockpit — three new projection cache tables.
-- Namespace literal = plugin_company_os_cc959257d2 (same as 001; the migration
-- validator rejects bare names). All three mirror the LOCKLESS cos_artifact_index
-- shape exactly (PF-4) — only cos_board_state carries lock columns; these are
-- written via the after-fence upsert path in cache.ts, gated by the board lock.
-- Additive, IF NOT EXISTS, no backfill, no DROP (destructive DDL banned).
--
-- rollback: MANUAL — uninstall does NOT drop the namespace. To remove just these:
--   DROP TABLE IF EXISTS plugin_company_os_cc959257d2.cos_orientation,
--     plugin_company_os_cc959257d2.cos_git_state,
--     plugin_company_os_cc959257d2.cos_doc_index;
--   (the DROP SCHEMA … CASCADE uninstall path still covers full removal.)

CREATE TABLE IF NOT EXISTS plugin_company_os_cc959257d2.cos_orientation (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  derived_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_company_os_cc959257d2.cos_git_state (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  derived_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_company_os_cc959257d2.cos_doc_index (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  derived_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
