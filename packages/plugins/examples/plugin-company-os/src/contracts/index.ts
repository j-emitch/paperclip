/**
 * `CompanyOsSignals` contract barrel — the single import surface for the whole
 * cockpit. Worker sources/projections (COS-0c/0d) import contract types AND the
 * zod schemas from here; the UI (COS-0e/0f) imports ONLY the projection TYPES
 * from here (the import-boundary the board hardens) — never the sources, the
 * collection context, or `node:fs`/`child_process`.
 *
 * Layering (no cycles):
 *   vocab → { signals, diagnostics } → { collection-context, WorkSignalSource }
 *         → { board-state, artifact-index, routine-health } → extensions
 */

// Layer 0 — closed vocabularies + compile-time guards
export * from "./vocab.js";

// Layer 1 — signals + shared diagnostics primitives
export * from "./signals.js";
export * from "./diagnostics.js";
export * from "./registry.js";
export * from "./lineage.js";

// Layer 1 — the collection seam (sources collect against this) + the source interface
export * from "./collection-context.js";
export * from "./WorkSignalSource.js";

// Layer 2 — the persisted projection contracts (zod-validated)
export * from "./board-state.js";
export * from "./artifact-index.js";
export * from "./routine-health.js";
export * from "./agent-system.js";
// Layer 2 — COS-5 build atlas projection contract
export * from "./build-atlas.js";

// Layer 2 — COS-1 project taxonomy + daily-driver projection contracts
export * from "./projects.js";
// COS-5g — the unified grouping resolver (prefix lens + repo-badge facade)
export * from "./grouping.js";
export * from "./git-state.js";
// COS-5e — shared branch-health severity (Home digest + Branch·PR Health view)
export * from "./branch-health.js";
export * from "./orientation.js";
export * from "./doc-index.js";
export * from "./doc-git.js";
// Layer 2 — COS-1h skills catalog projection contract
export * from "./skills-catalog.js";

// Layer 2 — live per-request payload contracts (read on demand, not cached)
export * from "./report-content.js";
export * from "./teaching.js";

// Extension seams (empty in COS-0b; COS-1/COS-2 implement)
export * from "./extensions.js";
