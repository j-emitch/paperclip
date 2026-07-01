/**
 * `SkillsSource` — the Skills-catalog index (COS-1h). Emits a `SkillSignal` (a
 * DISTINCT kind — never an `ArtifactSignal`/`DocSignal`, so skills can't leak into
 * the Board/Docs folds) for every SKILL.md across two origins:
 *
 *   - `company` — the curated "ours" skills. The `config/skills/**` real skill
 *     dirs are read from the `company` repo; the DESIGN skills are read from an
 *     extra `origin:"company", collection:"design"` root (`~/.agents/skills`) —
 *     their `config/skills/*` entries are symlinks up to `$HOME` and the workspace
 *     walk never follows symlinks, so they MUST be read at their real out-of-repo
 *     path via a contained read-key (`ctx.skillRoots`). Collection = "core" | "design".
 *
 *   - `plugins` — installed marketplace/plugin skills read from optional, contained
 *     `ctx.skillRoots` read-keys (e.g. `~/.claude/plugins/cache`, `~/.codex/plugins/cache`).
 *     Only scanned on a FULL sweep (`scopeRepo === null`); a scoped refresh preserves
 *     their last-good via the scoped merge. Collection = the plugin slug from the path.
 *
 * Metadata-only at index time: only the frontmatter HEAD (`readTextHead`) is read,
 * never the body (fetched on demand by `skill-content`). Capped at
 * `MAX_SKILLS_PER_ROOT` per read-key with a `truncated` diagnostic — never a
 * silent drop. Head-read failures degrade the containing key's freshness (the
 * no-throw source contract), never blank the tab.
 */

import { signalError, type CollectionContext } from "../contracts/collection-context.js";
import type { RepoFreshness, SignalBatch, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type { Signal, SignalError, SkillSignal } from "../contracts/signals.js";
import type { SkillOrigin, SkillRootRef } from "../contracts/skills-catalog.js";
import { MAX_SKILLS_PER_ROOT, SKILL_FRONTMATTER_SCAN_BYTES, makeSkillId } from "../contracts/skills-catalog.js";
import { nowIso, readError } from "./_shared.js";
import { parseFrontmatterHead } from "./frontmatter-head.js";

export const SKILLS_SOURCE_ID = "skills";

/** The repo key the "ours" core skills live in (`config/skills/**`). */
export const COMPANY_REPO_KEY = "company";

/** The in-repo core skills glob (design skills come from an out-of-repo `skillRoots` entry). */
const COMPANY_CORE_GLOBS = ["config/skills/**/SKILL.md"] as const;

/** Extra roots (design + plugin caches) are scanned recursively for any nested SKILL.md. */
const ROOT_SKILL_GLOBS = ["**/SKILL.md"] as const;

export const skillsSource: WorkSignalSource = {
  id: SKILLS_SOURCE_ID,
  async collect(ctx: CollectionContext): Promise<SignalBatch> {
    const collectedAt = ctx.clock.now();
    const signals: Signal[] = [];
    const fullSweep = ctx.scopeRepo === null;
    const companyScope = fullSweep || ctx.scopeRepo === COMPANY_REPO_KEY;

    // Read errors accumulate per LOGICAL slice repo. Company CORE (`config/skills/**`)
    // and the company DESIGN root (`~/.agents/skills`) are read from DIFFERENT keys but
    // belong to the SAME `company` slice, so a scoped `company` refresh collects, merges,
    // and persists them together. The scoped merge + `replaceSourceVersions` key by
    // `repo`; a design skill tagged with its read-key (`skillroot:company:*`) instead of
    // the `company` slice is silently dropped on a scoped refresh, leaving stale last-good
    // (codex A/B P1). Plugin roots are their own slice and full-sweep only.
    const errorsByRepo = new Map<string, SignalError[]>();
    const addErrors = (repo: string, errs: readonly SignalError[]): void => {
      const acc = errorsByRepo.get(repo) ?? [];
      acc.push(...errs);
      errorsByRepo.set(repo, acc);
    };

    // --- company CORE skills, read from + sliced to `company` (config/skills/**). ---
    if (companyScope) {
      const companyRepo = ctx.repos.find((r) => r.repo === COMPANY_REPO_KEY);
      if (!companyRepo || !companyRepo.available) {
        // Not a hard error — a workspace without the company repo simply has no core
        // skills; record a calm degraded marker so the freshness line is honest.
        addErrors(COMPANY_REPO_KEY, [
          signalError("repo_unavailable", `repo ${COMPANY_REPO_KEY} is ${companyRepo ? "not available this run" : "not configured"}`),
        ]);
      } else {
        const { produced, errors } = await scanKey(ctx, COMPANY_REPO_KEY, COMPANY_CORE_GLOBS, "company", () => "core", COMPANY_REPO_KEY);
        signals.push(...produced);
        addErrors(COMPANY_REPO_KEY, errors);
      }
    }

    // --- extra roots: design skills (origin company -> `company` slice) + plugin caches
    //     (origin plugins -> own slice). Company-origin roots follow the company scope;
    //     plugin roots are full-sweep only (a scoped refresh preserves their last-good via
    //     the scoped merge). The signal `repo` is the SLICE; `checkoutKey` stays the READ
    //     key, so `skill-content` still reads each file at its real out-of-repo path. ---
    for (const ref of ctx.skillRoots ?? []) {
      const inScope = ref.origin === "company" ? companyScope : fullSweep;
      if (!inScope) continue;
      const sliceRepo = ref.origin === "company" ? COMPANY_REPO_KEY : ref.key;
      const { produced, errors } = await scanKey(ctx, ref.key, ROOT_SKILL_GLOBS, ref.origin, collectionResolver(ref), sliceRepo);
      signals.push(...produced);
      addErrors(sliceRepo, errors);
    }

    // One freshness row per logical slice (company core + design merged into `company`).
    const repoFreshness: RepoFreshness[] = [...errorsByRepo.entries()].map(([repo, errs]) => freshnessFor(repo, errs, ctx));

    return { source: SKILLS_SOURCE_ID, collectedAt, signals, repoFreshness };
  },
};

/** A ref with a fixed collection uses it verbatim; otherwise derive the plugin slug per-skill. */
function collectionResolver(ref: SkillRootRef): (relPath: string) => string {
  return ref.collection !== null ? () => ref.collection as string : pluginCollection;
}

/** Build a `RepoFreshness` row for a scanned read-key (live unless a read degraded it). */
function freshnessFor(repo: string, errors: readonly SignalError[], ctx: CollectionContext): RepoFreshness {
  const degraded = errors.some((e) => e.degraded);
  return { repo, freshness: degraded ? "stale" : "live", lastOkAt: degraded ? null : nowIso(ctx), errors };
}

/**
 * Scan one read-key for SKILL.md files, head-only, capped, deriving each skill's
 * collection. `key` is the READ key (where the files live + the `checkoutKey`
 * `skill-content` reads from); `sliceRepo` is the LOGICAL repo the signals belong
 * to (the scoped-refresh + persistence unit) — the two diverge for the company
 * design root, which is read from `skillroot:company:design` but sliced to `company`.
 */
async function scanKey(
  ctx: CollectionContext,
  key: string,
  globs: readonly string[],
  origin: SkillOrigin,
  collectionOf: (relPath: string) => string,
  sliceRepo: string,
): Promise<{ produced: SkillSignal[]; errors: SignalError[] }> {
  const produced: SkillSignal[] = [];
  const errors: SignalError[] = [];
  let files;
  try {
    files = await ctx.fs.list(key, globs);
  } catch (err) {
    // A whole-key list failure (e.g. root vanished) degrades this key, never throws.
    errors.push(signalError("not_found", `skill root ${key} could not be listed: ${String(err)}`));
    return { produced, errors };
  }

  let scanned = 0;
  let truncated = false;
  for (const file of files) {
    if (scanned >= MAX_SKILLS_PER_ROOT) {
      truncated = true;
      break;
    }
    let head: string;
    try {
      head = await ctx.fs.readTextHead(key, file.relPath, SKILL_FRONTMATTER_SCAN_BYTES);
    } catch (err) {
      errors.push(readError(file.relPath, err)); // degraded read — recorded, never thrown
      continue;
    }
    const fm = parseFrontmatterHead(head);
    const slug = skillSlug(file.relPath);
    const name = fm.frontmatter?.name?.trim() || fm.title || slug;
    const summary = fm.frontmatter?.description?.trim() || null;
    const skillId = makeSkillId(key, file.relPath);
    const indexFingerprint = ctx.hash(`${file.mtime} ${file.sizeBytes} ${head}`);
    produced.push({
      kind: "skill",
      source: SKILLS_SOURCE_ID,
      repo: sliceRepo,
      path: file.relPath,
      confidence: "high",
      freshness: "live",
      errors: [],
      skillId,
      origin,
      collection: collectionOf(file.relPath),
      checkoutKey: key,
      relPath: file.relPath,
      slug,
      name,
      summary,
      mtime: file.mtime,
      sizeBytes: file.sizeBytes,
      indexFingerprint,
    });
    scanned++;
  }

  if (truncated) {
    errors.push(signalError("truncated", `skill index truncated at ${MAX_SKILLS_PER_ROOT} for ${key}`, false));
  }
  return { produced, errors };
}

/** A skill's slug = the basename of its directory (the segment above SKILL.md). */
function skillSlug(relPath: string): string {
  const parts = relPath.split("/");
  return parts.length >= 2 ? parts[parts.length - 2]! : (parts[0] ?? relPath);
}

/** A version-like (`5.0.7`, `v2`) OR revision-like (`3fdeeb49` hex, `abc123…`) path segment. */
function isVersionOrRevision(seg: string): boolean {
  return /^v?\d+(\.\d+)*$/.test(seg) || /^[0-9a-f]{7,40}$/i.test(seg);
}

/**
 * Plugin collection = the plugin slug: the path segment just above `skills/`,
 * walking BACK past version- or revision-like segments so
 * `openai-curated/codex-security/3fdeeb49/skills/x` → "codex-security" and
 * `superpowers/5.0.7/skills/x` → "superpowers". Falls back to the top-level
 * segment when the path has no `skills/` marker.
 */
function pluginCollection(relPath: string): string {
  const parts = relPath.split("/");
  const si = parts.lastIndexOf("skills");
  if (si > 0) {
    let i = si - 1;
    while (i > 0 && isVersionOrRevision(parts[i]!)) i--;
    return parts[i] || parts[0] || "plugins";
  }
  return parts[0] || "plugins";
}
