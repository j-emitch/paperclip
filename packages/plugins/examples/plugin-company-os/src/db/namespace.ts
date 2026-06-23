/**
 * The plugin's Postgres namespace literal — the single source of truth the
 * migration hardcodes and the cache layer asserts at runtime against
 * `ctx.db.namespace`. Derived by the host as
 * `derivePluginDatabaseNamespace("lycaon.company-os", "company_os")` =
 * `plugin_${slug}_${sha256(pluginKey).slice(0,10)}` (server/services/
 * plugin-database.ts) — kept here so a host-side change is caught by the
 * namespace-guard test, not discovered at install time.
 */
export const COS_DB_NAMESPACE = "plugin_company_os_cc959257d2";
