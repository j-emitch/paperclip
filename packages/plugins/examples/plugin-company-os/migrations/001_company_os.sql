-- Company OS cockpit — plugin-owned cache schema.
-- Namespace literal = derivePluginDatabaseNamespace("lycaon.company-os", "company_os")
--   = plugin_company_os_cc959257d2 (verified against server/services/plugin-database.ts).
-- Every object is fully-qualified with that schema (the migration validator
-- rejects bare names) and uses IF NOT EXISTS (no DROP — destructive DDL is banned
-- in Phase 1). public.companies is referenced read-only via coreReadTables.
--
-- rollback: MANUAL — uninstall does NOT drop the namespace. To fully remove:
--   psql "$DATABASE_URL" -c 'DROP SCHEMA plugin_company_os_cc959257d2 CASCADE'

CREATE TABLE IF NOT EXISTS plugin_company_os_cc959257d2.cos_board_state (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot jsonb,
  schema_version integer NOT NULL DEFAULT 1,
  derived_at timestamptz,
  lock_owner text,
  lock_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_company_os_cc959257d2.cos_artifact_index (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  derived_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_company_os_cc959257d2.cos_routine_health (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  derived_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_company_os_cc959257d2.cos_source_versions (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source text NOT NULL,
  repo text NOT NULL,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  freshness text NOT NULL DEFAULT 'stale',
  last_ok_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, source, repo)
);

CREATE TABLE IF NOT EXISTS plugin_company_os_cc959257d2.cos_collection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  scope_repo text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text
);

CREATE INDEX IF NOT EXISTS cos_collection_runs_company_started_idx
  ON plugin_company_os_cc959257d2.cos_collection_runs (company_id, started_at DESC);
