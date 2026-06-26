/**
 * `ProjectTaxonomyV1` — the project-family grouping layer (spec §5.7).
 *
 * The cockpit's instance-config is a flat `repoRoots: string[]`; this module adds
 * a grouping LENS on top so every surface presents *projects* (Company · Juice
 * Bar · Viacava Arts · Paperclip), not loose repos. The taxonomy is:
 *   - CONFIG-TIME ONLY — derived from operator config + the repoRoot basename,
 *     NEVER from repo content (read-only/trust invariant, §5.7/§9).
 *   - DEGRADE-NEVER-THROW — every malformed-config case drops with a diagnostic.
 *   - resolved each derive tick (no `cos_project_taxonomy` table) + embedded in
 *     each `*V1` projection so the UI renders headers without a 2nd fetch.
 *
 * `projectKey` is resolved at PROJECTION time via `projectKeyForRepo` (plan
 * PF-5) — the signals never carry it, so sources stay repo-oriented and the
 * taxonomy threads as a `collectAndProject` param, not on every fixture/context.
 *
 * zod-first with vocab-built enums + drift guards, mirroring `artifact-index.ts`.
 */

import { z } from "@paperclipai/plugin-sdk";
import { diagnosticSchema, type Diagnostic } from "./diagnostics.js";
import {
  PROJECT_KINDS,
  PROJECT_REPO_ROLES,
  TAXONOMY_SOURCES,
  type AssertEqual,
  type Expect,
  type ProjectKind,
  type ProjectRepoRole,
  type TaxonomySource,
} from "./vocab.js";

export const PROJECT_TAXONOMY_SCHEMA_VERSION = 1 as const;

export const projectKindSchema = z.enum(PROJECT_KINDS);
export const projectRepoRoleSchema = z.enum(PROJECT_REPO_ROLES);
export const taxonomySourceSchema = z.enum(TAXONOMY_SOURCES);

/** One member repo of a project family (basename key + role). */
export const projectRepoV1Schema = z.object({
  /** Basename key matching `absByKeyFromRoots` (e.g. "juice-bar", "arc-scraper"). */
  repoKey: z.string().min(1),
  role: projectRepoRoleSchema,
});
export type ProjectRepoV1 = z.infer<typeof projectRepoV1Schema>;

/**
 * A project family = a group of repos under one stable key. NB: there is NO
 * `displayPrimaryRepoKey` here — it depends on on-disk availability and so lives
 * on the projection-time `ProjectGitSectionV1` (§5.3), set by `deriveGitState`.
 */
export const projectGroupV1Schema = z.object({
  /** Stable UNIQUE slug, e.g. "juice-bar", "viacava-arts", "company". */
  key: z.string().min(1),
  displayName: z.string().min(1),
  kind: projectKindSchema,
  /** Member repos in display order (primary first). */
  repos: z.array(projectRepoV1Schema),
  /** Rail / section ordering. */
  order: z.number().int(),
  /** Optional one-liner, e.g. "cross-project / company-meta". */
  note: z.string().optional(),
});
export type ProjectGroupV1 = z.infer<typeof projectGroupV1Schema>;

export const projectTaxonomyV1Schema = z.object({
  schemaVersion: z.literal(PROJECT_TAXONOMY_SCHEMA_VERSION),
  groups: z.array(projectGroupV1Schema),
  /** Provenance for the UI ("configured vs derived"). */
  source: taxonomySourceSchema,
  /** Dropped/auto-added/misconfigured notes surface here (never thrown). */
  diagnostics: z.array(diagnosticSchema),
});
export type ProjectTaxonomyV1 = z.infer<typeof projectTaxonomyV1Schema>;

/** Parse + validate (throws on malformed). */
export function parseProjectTaxonomyV1(input: unknown): ProjectTaxonomyV1 {
  return projectTaxonomyV1Schema.parse(input);
}

export function safeParseProjectTaxonomyV1(
  input: unknown,
): z.SafeParseReturnType<unknown, ProjectTaxonomyV1> {
  return projectTaxonomyV1Schema.safeParse(input);
}

// ---------------------------------------------------------------------------
// Resolver (config-time, pure — never touches the filesystem)
// ---------------------------------------------------------------------------

/** A taxonomy-layer diagnostic (source is always "taxonomy"). */
function diag(level: Diagnostic["level"], code: string, message: string, repo: string | null = null): Diagnostic {
  return { level, code, message, repo, source: "taxonomy" };
}

/**
 * Pure basename of a repo root — the SAME keying `absByKeyFromRoots` uses (last
 * non-empty path segment). Kept node-free so the contracts layer has no
 * `node:path` dependency; `buildCheckoutKeyMap` + `makeCollectionContext` share
 * `sanitizeRepoRoots` (PF-7) so the keying can never drift between them.
 */
function basename(root: string): string {
  const parts = root.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : root;
}

/** "viacava-arts" → "Viacava Arts" (display name for an unknown/auto-added root). */
function titleCase(repoKey: string): string {
  return repoKey
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Dedup raw repo roots by basename (PF-7). `absByKeyFromRoots` keys each root by
 * basename (last-wins via `Map.set`), so two roots with the same basename
 * already collide upstream — COS-1 detects this from the RAW paths (before the
 * basename map loses it) and drops the collision with a diagnostic. Returns the
 * unique-by-basename roots in first-seen order with the last-seen value (matching
 * the existing `Map.set` overwrite), so collection-time + render-time + taxonomy
 * all derive the identical kept root.
 */
export function sanitizeRepoRoots(repoRoots: readonly string[]): {
  roots: string[];
  diagnostics: Diagnostic[];
} {
  const byBasename = new Map<string, string>(); // basename → kept root (last-wins)
  const counts = new Map<string, number>();
  for (const root of repoRoots) {
    const key = basename(root);
    byBasename.set(key, root);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const diagnostics: Diagnostic[] = [];
  for (const [key, count] of counts) {
    if (count > 1) {
      diagnostics.push(
        diag(
          "warn",
          "duplicate_basename",
          `${count} configured roots share basename "${key}" — duplicate basenames are unsupported in COS-1; keeping one, dropping the rest`,
        ),
      );
    }
  }
  return { roots: [...byBasename.values()], diagnostics };
}

/** The §5.7 default taxonomy templates, in display order. */
const KNOWN_GROUP_TEMPLATES: readonly {
  key: string;
  displayName: string;
  kind: ProjectKind;
  order: number;
  note?: string;
  repos: readonly ProjectRepoV1[];
}[] = [
  {
    key: "company",
    displayName: "Company",
    kind: "company",
    order: 0,
    note: "cross-project / company-meta — the OS itself lives here",
    repos: [{ repoKey: "company", role: "primary" }],
  },
  {
    key: "juice-bar",
    displayName: "Juice Bar",
    kind: "product",
    order: 1,
    note: "the primary product + its data pipeline",
    repos: [
      { repoKey: "juice-bar", role: "primary" },
      { repoKey: "arc-scraper", role: "dependency" },
    ],
  },
  {
    key: "viacava-arts",
    displayName: "Viacava Arts",
    kind: "side_project",
    order: 2,
    note: "separate side project",
    repos: [{ repoKey: "viacava-arts", role: "primary" }],
  },
  {
    key: "paperclip",
    displayName: "Paperclip",
    kind: "platform",
    order: 3,
    note: "the host platform the cockpit runs on",
    repos: [{ repoKey: "paperclip", role: "primary" }],
  },
];

function withNote(group: Omit<ProjectGroupV1, "note">, note?: string): ProjectGroupV1 {
  return note !== undefined ? { ...group, note } : group;
}

/** Promote the first member to `primary` when no assigned member is primary (§5.7). */
function ensurePrimary(repos: readonly ProjectRepoV1[]): ProjectRepoV1[] {
  if (repos.length === 0 || repos.some((r) => r.role === "primary")) return [...repos];
  return repos.map((r, i) => (i === 0 ? { ...r, role: "primary" as const } : r));
}

/**
 * Build the §5.7 default taxonomy from the assigned repo keys: known basenames →
 * the canonical Company / Juice Bar / Viacava Arts / Paperclip groups (members
 * filtered to those actually assigned, primary promoted if absent); any
 * unrecognized root → its own `kind:"product"` group keyed by basename. A known
 * group with zero assigned members is simply omitted (not an error).
 */
export function deriveDefaultTaxonomy(repoKeys: readonly string[]): {
  groups: ProjectGroupV1[];
  diagnostics: Diagnostic[];
} {
  const assigned = new Set(repoKeys);
  const claimed = new Set<string>();
  const groups: ProjectGroupV1[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const tmpl of KNOWN_GROUP_TEMPLATES) {
    const present = tmpl.repos.filter((r) => assigned.has(r.repoKey));
    if (present.length === 0) continue; // group not present in this install — omit silently
    const hadPrimary = present.some((r) => r.role === "primary");
    const repos = ensurePrimary(present);
    if (!hadPrimary) {
      diagnostics.push(
        diag(
          "warn",
          "primary_promoted",
          `project "${tmpl.key}" primary repo not configured — promoted "${repos[0].repoKey}" to primary`,
        ),
      );
    }
    groups.push(
      withNote({ key: tmpl.key, displayName: tmpl.displayName, kind: tmpl.kind, repos, order: tmpl.order }, tmpl.note),
    );
    for (const r of present) claimed.add(r.repoKey);
  }

  let order = KNOWN_GROUP_TEMPLATES.length;
  for (const key of repoKeys.filter((k) => !claimed.has(k)).sort()) {
    groups.push({
      key,
      displayName: titleCase(key),
      kind: "product",
      repos: [{ repoKey: key, role: "primary" }],
      order: order++,
    });
  }

  return { groups, diagnostics };
}

/**
 * Resolve the full taxonomy from the RAW repo roots + the optional operator
 * `projects` config (spec §5.7). Takes raw roots (NOT basenames) so it can
 * `sanitizeRepoRoots` and surface the dup-basename diagnostic before the
 * basename map collapses it (PF-7/AC-492). Every validation case degrades with a
 * diagnostic — it never throws.
 *
 * No (or empty) `projects` → `deriveDefaultTaxonomy` (`source:"derived-default"`).
 * A non-empty `projects` → `source:"merged"`: configured groups first (validated,
 * dup-keys/dup-assignments/empty-groups dropped, primary promoted), then every
 * still-unassigned root auto-added as its own fallback group (never invisible).
 */
export function resolveTaxonomy(
  repoRoots: readonly string[],
  projects?: readonly ProjectGroupV1[],
): ProjectTaxonomyV1 {
  const { roots, diagnostics: sanitizeDiagnostics } = sanitizeRepoRoots(repoRoots);
  const repoKeys = roots.map(basename);

  if (!projects || projects.length === 0) {
    const { groups, diagnostics } = deriveDefaultTaxonomy(repoKeys);
    return {
      schemaVersion: PROJECT_TAXONOMY_SCHEMA_VERSION,
      groups,
      source: "derived-default",
      diagnostics: [...sanitizeDiagnostics, ...diagnostics],
    };
  }

  const assigned = new Set(repoKeys);
  const diagnostics: Diagnostic[] = [...sanitizeDiagnostics];
  const seenGroupKeys = new Set<string>();
  const repoToGroup = new Map<string, string>(); // repoKey → the FIRST group (by order) that claimed it
  const configured: ProjectGroupV1[] = [];

  // First-wins repo assignment is "by order", so process configured groups in order.
  for (const g of [...projects].sort((a, b) => a.order - b.order)) {
    if (seenGroupKeys.has(g.key)) {
      diagnostics.push(diag("warn", "duplicate_group_key", `duplicate project key "${g.key}" — later definition dropped`));
      continue;
    }
    const keptRepos: ProjectRepoV1[] = [];
    for (const r of g.repos) {
      if (!assigned.has(r.repoKey)) {
        diagnostics.push(
          diag("info", "repo_not_assigned", `repo "${r.repoKey}" in project "${g.key}" is not in repoRoots — dropped`),
        );
        continue;
      }
      if (repoToGroup.has(r.repoKey)) {
        diagnostics.push(
          diag(
            "warn",
            "duplicate_repo_assignment",
            `repo "${r.repoKey}" already assigned to project "${repoToGroup.get(r.repoKey)}" — dropped from "${g.key}"`,
          ),
        );
        continue;
      }
      keptRepos.push(r);
    }
    if (keptRepos.length === 0) {
      diagnostics.push(diag("info", "empty_group", `project "${g.key}" has no assigned repos — dropped`));
      continue;
    }
    seenGroupKeys.add(g.key);
    for (const r of keptRepos) repoToGroup.set(r.repoKey, g.key);
    const hadPrimary = keptRepos.some((r) => r.role === "primary");
    const repos = ensurePrimary(keptRepos);
    if (!hadPrimary) {
      diagnostics.push(
        diag("warn", "primary_promoted", `project "${g.key}" had no assigned primary — promoted "${repos[0].repoKey}"`),
      );
    }
    configured.push(withNote({ key: g.key, displayName: g.displayName, kind: g.kind, repos, order: g.order }, g.note));
  }

  configured.sort((a, b) => a.order - b.order);

  // Auto-add every still-unassigned root as its own fallback group (never invisible).
  const fallback: ProjectGroupV1[] = [];
  let nextOrder = configured.length > 0 ? Math.max(...configured.map((g) => g.order)) + 1 : 0;
  for (const key of repoKeys.filter((k) => !repoToGroup.has(k)).sort()) {
    fallback.push({
      key,
      displayName: titleCase(key),
      kind: "product",
      repos: [{ repoKey: key, role: "primary" }],
      order: nextOrder++,
    });
    diagnostics.push(
      diag("info", "auto_added_group", `repo "${key}" was not in any configured project — auto-added as its own group`),
    );
  }

  return {
    schemaVersion: PROJECT_TAXONOMY_SCHEMA_VERSION,
    groups: [...configured, ...fallback],
    source: "merged",
    diagnostics,
  };
}

/** The group a repo belongs to, or null when the taxonomy doesn't contain it. */
export function findProjectGroup(taxonomy: ProjectTaxonomyV1, repoKey: string): ProjectGroupV1 | null {
  for (const g of taxonomy.groups) {
    if (g.repos.some((r) => r.repoKey === repoKey)) return g;
  }
  return null;
}

/**
 * The projection-time project-key resolver (PF-5). Returns the group key for a
 * repo, or the default group (the `company`-kind group, else the first group)
 * when the repo is unassigned. The projection detects the unassigned case via
 * `findProjectGroup` to emit a drift diagnostic (this fn stays pure).
 */
export function projectKeyForRepo(taxonomy: ProjectTaxonomyV1, repoKey: string): string {
  const group = findProjectGroup(taxonomy, repoKey);
  if (group) return group.key;
  const company = taxonomy.groups.find((g) => g.kind === "company");
  return company?.key ?? taxonomy.groups[0]?.key ?? "company";
}

// Drift guards: the schema enums and the canonical tuples cannot diverge.
type _KindMatches = Expect<AssertEqual<z.infer<typeof projectKindSchema>, ProjectKind>>;
type _RoleMatches = Expect<AssertEqual<z.infer<typeof projectRepoRoleSchema>, ProjectRepoRole>>;
type _SourceMatches = Expect<AssertEqual<z.infer<typeof taxonomySourceSchema>, TaxonomySource>>;
