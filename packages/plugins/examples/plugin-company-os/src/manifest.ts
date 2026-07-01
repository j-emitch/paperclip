import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

/** Stable plugin id used for host registration, DB namespacing, and the hook trigger. */
export const PLUGIN_ID = "lycaon.company-os";

/** Scheduled job that recomputes the board/artifact/routine cache (handler in COS-0d/0g). */
export const DERIVE_BOARD_JOB_KEY = "derive-board";

/** Route segment the cockpit mounts under (`/:companyPrefix/company-os`). */
export const COMPANY_OS_ROUTE = "company-os";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Company OS",
  description:
    "Owner/developer cockpit: an auto-updating Kanban (system x spec-prefix family) plus Home, Source, Docs, and Agents surfaces over the Lycaon multi-repo workspace. Read-only over product repos; the only writes are the plugin-owned company_os cache, plugin state, and an opt-in git hook.",
  author: "Lycaon",
  categories: ["automation", "ui"],
  // No minimumHostVersion floor: the local dev host the cockpit installs into
  // reports its version to the plugin loader as "0.0.0" (the app bootstrap
  // fallback in server/app.ts; healthz separately reports the package's 0.3.1),
  // so ANY floor above 0.0.0 blocks install on the very machine this runs on.
  // The SDK features the cockpit uses (ctx.companies/jobs, the data/action
  // bridge, DB namespaces) are present regardless of the version string, so a
  // floor adds no safety here and only breaks the single-machine deploy.
  capabilities: [
    // Read — per-company derive + workspace file reads + routine last-run.
    "companies.read",
    "projects.read",
    "project.workspaces.read",
    "issues.read",
    // Plugin-owned DB cache (company_os namespace).
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    // Scheduled derive job.
    "jobs.schedule",
    // Derive-failure diagnostics.
    "activity.log.write",
    // Plugin state.
    "plugin.state.read",
    "plugin.state.write",
    // UI surfaces (routeSidebar rides on ui.page.register — no separate cap).
    "ui.sidebar.register",
    "ui.page.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      repoRoots: {
        type: "array",
        title: "Repository roots",
        description:
          "Absolute paths to the product repos the cockpit reads (read-only): e.g. /Users/joseph/projects/juice-bar, /Users/joseph/projects/arc-scraper, /Users/joseph/projects/company, /Users/joseph/projects/paperclip/paperclip.",
        items: { type: "string" },
        default: [],
      },
      // COS-1: OPTIONAL project-family grouping (PF-12). When omitted, a default
      // taxonomy is derived from repo basenames — `repoRoots` is unchanged.
      projects: {
        type: "array",
        title: "Project families (optional)",
        description:
          "Group repoRoots into project families. Each: {key, displayName, kind, repos:[{repoKey, role}], order, note?}. Omit to derive the default taxonomy from basenames.",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            displayName: { type: "string" },
            kind: { type: "string", enum: ["company", "product", "side_project", "platform"] },
            repos: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  repoKey: { type: "string" },
                  role: { type: "string", enum: ["primary", "dependency"] },
                },
                required: ["repoKey", "role"],
              },
            },
            order: { type: "number" },
            note: { type: "string" },
          },
          required: ["key", "displayName", "kind", "repos", "order"],
        },
      },
      // COS-1h: OPTIONAL extra roots for installed-PLUGIN skills (the Skills tab's
      // secondary sub-section). Absolute dirs scanned recursively for SKILL.md.
      // OMIT the key to default to the Claude + Codex plugin caches
      // (`~/.claude/plugins/cache`, `~/.codex/plugins/cache`) when present; set an
      // explicit `[]` to disable the plugins sub-section. The company design skills
      // (`~/.agents/skills`) are always indexed and are NOT configured here.
      skillRoots: {
        type: "array",
        title: "Installed-plugin skill roots (optional)",
        description:
          "Absolute dirs of installed-plugin skills to index (e.g. /Users/you/.claude/plugins/cache, /Users/you/.codex/plugins/cache). Omit to auto-detect both caches; set [] to disable.",
        items: { type: "string" },
      },
    },
  },
  database: {
    namespaceSlug: "company_os",
    migrationsDir: "migrations",
    coreReadTables: ["companies"],
  },
  jobs: [
    {
      jobKey: DERIVE_BOARD_JOB_KEY,
      displayName: "Derive board state",
      description:
        "Recompute the Company OS board, artifact index, and routine health from repo signals (read-only). Runs per-company under an atomic cache lock.",
      schedule: "*/5 * * * *",
    },
  ],
  ui: {
    slots: [
      {
        type: "sidebar",
        id: "company-os-sidebar",
        displayName: "Company OS",
        exportName: "SidebarLink",
        order: 5,
      },
      {
        type: "page",
        id: "company-os-page",
        displayName: "Company OS",
        exportName: "CompanyOsPage",
        routePath: COMPANY_OS_ROUTE,
      },
      {
        type: "routeSidebar",
        id: "company-os-route-sidebar",
        displayName: "Company OS",
        exportName: "CompanyOsRouteSidebar",
        routePath: COMPANY_OS_ROUTE,
      },
    ],
  },
};

export default manifest;
