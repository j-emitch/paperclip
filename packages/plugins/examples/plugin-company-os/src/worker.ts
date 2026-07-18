import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { DERIVE_BOARD_JOB_KEY, PLUGIN_ID } from "./manifest.js";
import { makeCollectionContext, type SkillRootInput } from "./runtime/makeCollectionContext.js";
import { absByKeyFromRoots, readContainedText } from "./runtime/workspace-fs.js";
import { buildCheckoutKeyMap, defaultGitRun } from "./runtime/checkout-keys.js";
import { deriveForCompany, type DeriveDeps } from "./derive.js";
import { runDeriveBoardJob } from "./derive-job.js";
import {
  readArtifactIndex,
  readAgentSystem,
  readBoardState,
  readBuildAtlas,
  readWorktreeBoard,
  readDocIndex,
  readGatesState,
  readGitState,
  readOrientation,
  readRoutineHealth,
  readSkillsCatalog,
} from "./db/cache.js";
import { DOCS_VIEWER_MAX_BYTES, readReportContent } from "./report-content-read.js";
import { readDocContent } from "./doc-content-read.js";
import { readDocFreshness, type DocGitDeps } from "./doc-freshness-read.js";
import { readDocDiff } from "./doc-diff-read.js";
import { readSkillContent } from "./skill-content-read.js";
import { projectGroupV1Schema, resolveTaxonomy, type ProjectGroupV1 } from "./contracts/projects.js";
import { readTeachingOverview } from "./teaching-overview-read.js";
import { teachingSource } from "./sources/TeachingSource.js";

/**
 * Company OS cockpit worker — COS-0d/0g.
 *
 * Registers the read-side data handlers (board-state / artifact-index /
 * routine-health), the `refresh-board` action (on-demand full or scoped derive,
 * hit by the COS-0g git-hook thin trigger + the UI refresh), and the real
 * `derive-board` scheduled job (per-company, jitter-spread, under the atomic
 * cache lock). The deterministic pipeline — collect → scoped-merge →
 * collectAndProject → cache — lives in `deriveForCompany`; the per-tick
 * fan-out + jitter live in `runDeriveBoardJob`; this file is just the SDK wiring.
 *
 * The COS-0e Kanban UI reads `board-state` directly, so the COS-0a/0b
 * `scaffold-status` bridge has been removed.
 */

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    ctx.logger.info(`${PLUGIN_ID} worker setup (COS-0d derive)`);

    const readRepoRoots = async (): Promise<string[]> => {
      const config = await ctx.config.get();
      const raw = (config as Record<string, unknown> | undefined)?.repoRoots;
      return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === "string") : [];
    };

    // The optional `projects` config → validated ProjectGroupV1[] (undefined when
    // absent or all-invalid → resolveTaxonomy derives the default taxonomy).
    const readProjects = async (): Promise<ProjectGroupV1[] | undefined> => {
      const config = await ctx.config.get();
      const raw = (config as Record<string, unknown> | undefined)?.projects;
      if (!Array.isArray(raw)) return undefined;
      const groups: ProjectGroupV1[] = [];
      for (const item of raw) {
        const parsed = projectGroupV1Schema.safeParse(item);
        if (parsed.success) groups.push(parsed.data);
      }
      return groups.length > 0 ? groups : undefined;
    };

    // The COS-1h skill read-roots: contained dirs OUTSIDE the workspace that
    // `SkillsSource` scans for PLUGIN skills — from `config.skillRoots` when set,
    // else the Claude + Codex plugin caches when present. An EXPLICIT `skillRoots: []`
    // DISABLES the plugin fallback (only an ABSENT key defaults). Collection derived
    // from the plugin path.
    //
    // Company DESIGN skills are NO LONGER read here: WF-12 (2026-07-18) git-tracked
    // them into `config/skills`, so `SkillsSource` reads them in-repo as company
    // skills and classifies them via `config/skills-collections.json`. The old
    // out-of-repo `~/.agents/skills` company root is dropped — post-materialization
    // it DUPLICATED every design skill (real in-repo copy + out-of-repo copy, minted
    // under different skillIds) and was wrong on a fresh Mac where `~/.agents` is absent.
    //
    // Every root is required to be a REAL directory (a symlinked root is rejected —
    // its target could escape the intended tree). Keys are namespaced
    // (`skillroot:<basename>`) so they can never shadow a repo/worktree key.
    const isRealDir = (abs: string): boolean => {
      try {
        const st = lstatSync(abs); // lstat: a symlinked root is NOT a real dir → rejected
        return st.isDirectory();
      } catch {
        return false;
      }
    };
    const readSkillRoots = async (): Promise<SkillRootInput[]> => {
      const config = await ctx.config.get();
      const raw = (config as Record<string, unknown> | undefined)?.skillRoots;
      const configured = Array.isArray(raw);
      const pluginPaths: string[] = configured
        ? raw.filter((r): r is string => typeof r === "string" && r !== "")
        : [];
      // Default the plugin caches ONLY when the config key is entirely ABSENT
      // (an explicit `[]` is a deliberate "no plugins", honored).
      if (!configured) {
        for (const p of [path.join(homedir(), ".claude", "plugins", "cache"), path.join(homedir(), ".codex", "plugins", "cache")]) {
          pluginPaths.push(p);
        }
      }

      const specs: Array<{ absPath: string; origin: "company" | "plugins"; collection: string | null }> = [
        ...pluginPaths.map((absPath) => ({ absPath, origin: "plugins" as const, collection: null })),
      ];

      // Guard: never let a configured skillRoot re-add the company design root
      // (~/.agents/skills). WF-12 reads the 21 design skills in-repo via SkillsSource +
      // config/skills-collections.json; scanning ~/.agents here too would re-mint each
      // under a plugin skillId and re-create the double-index this fix removed (codex
      // re-review P1). Best-effort canonical; null (absent on a fresh Mac) disables it.
      const agentsSkillsCanonical = ((): string | null => {
        try {
          return realpathSync.native(path.join(homedir(), ".agents", "skills"));
        } catch {
          return null;
        }
      })();

      const seen = new Set<string>();
      const out: SkillRootInput[] = [];
      for (const spec of specs) {
        // Configured plugin paths are documented as ABSOLUTE dirs; a relative entry
        // would resolve against the worker cwd and silently read the wrong tree, so
        // ignore it rather than guess (codex A P2).
        if (!path.isAbsolute(spec.absPath)) continue;
        if (!isRealDir(spec.absPath)) continue; // absent or symlinked → degrade to nothing
        // Key by STABLE absolute-path identity, never discovery order. A basename-only
        // key made `.claude/plugins/cache` and `.codex/plugins/cache` both `cache`,
        // suffixed by presence order (`cache`, `cache-2`); if one root vanished between
        // derives the survivor could inherit the other's key and orphan its skillIds
        // (codex B P1). A path-hash suffix is presence-independent + collision-free.
        // Canonicalize to a REAL filesystem identity: `realpathSync.native` resolves
        // any symlink in the path AND normalizes case on a case-insensitive FS (macOS),
        // so two spellings of the same dir can't mint two roots + duplicate skills
        // (both convergence reviewers). A 16-hex (64-bit) digest keeps distinct paths
        // collision-proof, so `seen` dedups only a genuinely repeated root. A path that
        // vanished between `isRealDir` and here (race) degrades to a skip.
        let canonical: string;
        try {
          canonical = realpathSync.native(spec.absPath);
        } catch {
          continue;
        }
        // Never re-add the removed company design root — reject exact, an ancestor
        // (e.g. a configured `~/.agents` recurses into `~/.agents/skills`), or a descendant.
        if (
          agentsSkillsCanonical !== null &&
          (canonical === agentsSkillsCanonical ||
            agentsSkillsCanonical.startsWith(canonical + path.sep) ||
            canonical.startsWith(agentsSkillsCanonical + path.sep))
        )
          continue;
        const base = path.basename(canonical) || spec.origin;
        const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
        const key = `skillroot:${spec.origin}:${base}-${digest}`;
        if (seen.has(key)) continue; // same real dir listed twice → one root
        seen.add(key);
        out.push({ key, absPath: canonical, origin: spec.origin, collection: spec.collection });
      }
      return out;
    };

    const deps: DeriveDeps = {
      db: ctx.db,
      makeContext: async (scopeRepo) =>
        makeCollectionContext({
          repoRoots: await readRepoRoots(),
          skillRoots: await readSkillRoots(),
          scopeRepo,
          logger: ctx.logger,
        }),
      now: () => Date.now(),
      logger: ctx.logger,
      // Resolve the taxonomy FRESH from raw config each derive (PF-5/v6) — raw
      // repoRoots (not ctx.repos) so the dup-basename diagnostic survives (PF-7).
      resolveTaxonomy: async () => resolveTaxonomy(await readRepoRoots(), await readProjects()),
    };

    // --- read-side data handlers (the UI's usePluginData reads these) ---
    ctx.data.register("board-state", async (params) => readBoardState(ctx.db, str(params.companyId)));
    ctx.data.register("artifact-index", async (params) => readArtifactIndex(ctx.db, str(params.companyId)));
    ctx.data.register("routine-health", async (params) => readRoutineHealth(ctx.db, str(params.companyId)));
    // COS-1 daily-driver read handlers (Home / Source / Docs).
    ctx.data.register("orientation", async (params) => readOrientation(ctx.db, str(params.companyId)));
    ctx.data.register("git-state", async (params) => readGitState(ctx.db, str(params.companyId)));
    ctx.data.register("doc-index", async (params) => readDocIndex(ctx.db, str(params.companyId)));
    // COS-1h skills catalog read handler (the Skills tab's tree).
    ctx.data.register("skills-catalog", async (params) => readSkillsCatalog(ctx.db, str(params.companyId)));
    // COS-1R agent-system read handler (the Agents cockpit).
    ctx.data.register("agent-system", async (params) => readAgentSystem(ctx.db, str(params.companyId)));
    // COS-5 build-atlas read handler (the Build Atlas tab — families/lifecycle/lineage).
    ctx.data.register("build-atlas", async (params) => readBuildAtlas(ctx.db, str(params.companyId)));
    // COS-8c worktrees-lens read handler (the Branch·PR Worktrees toggle).
    ctx.data.register("worktree-board", async (params) => readWorktreeBoard(ctx.db, str(params.companyId)));
    // COS-11 gates & pipeline read handler (the Gates band + tab).
    ctx.data.register("gates-state", async (params) => readGatesState(ctx.db, str(params.companyId)));

    // --- docs viewer: a LIVE, index-gated, containment-checked single-file read ---
    ctx.data.register("report-content", async (params) => {
      const repoRoots = await readRepoRoots();
      const absByKey = absByKeyFromRoots(repoRoots);
      return readReportContent(
        {
          readIndex: (companyId) => readArtifactIndex(ctx.db, companyId),
          readFile: async (repo, relPath) => {
            const root = absByKey.get(repo);
            if (!root) throw new Error(`unknown repo ${repo}`);
            const { content, stat } = await readContainedText(root, relPath, DOCS_VIEWER_MAX_BYTES);
            return { content, sizeBytes: stat.sizeBytes, mtime: stat.mtime };
          },
          repoConfigured: (repo) => absByKey.has(repo),
        },
        str(params.companyId),
        str(params.repo),
        str(params.relPath),
      );
    });

    // --- docs viewer (worktree-aware): index-gated by docId → checkoutKey read ---
    ctx.data.register("doc-content", async (params) => {
      // Rebuild the SAME worktree-aware key map the derive used (PF-9) — it builds
      // its own git runner, so no GitRunner to thread here.
      const ckm = await buildCheckoutKeyMap(await readRepoRoots());
      return readDocContent(
        {
          readIndex: (companyId) => readDocIndex(ctx.db, companyId),
          readFile: async (checkoutKey, relPath) => {
            const root = ckm.absByKey.get(checkoutKey);
            if (!root) throw new Error(`unknown checkout ${checkoutKey}`);
            const { content, stat } = await readContainedText(root, relPath, DOCS_VIEWER_MAX_BYTES);
            return { content, sizeBytes: stat.sizeBytes, mtime: stat.mtime };
          },
          checkoutResolvable: (checkoutKey) => ckm.absByKey.has(checkoutKey),
        },
        str(params.companyId),
        str(params.docId),
      );
    });

    // --- COS-8f doc git-truth reads: freshness ladder + diff-vs-trunk. Same
    //     index-gate + checkoutKey funnel as doc-content; the abs root resolves
    //     ONLY here (key-only invariant), git runs bounded fixed-argv. ---
    const docGitDeps = async (): Promise<DocGitDeps> => {
      const ckm = await buildCheckoutKeyMap(await readRepoRoots());
      return {
        readIndex: (companyId) => readDocIndex(ctx.db, companyId),
        checkoutResolvable: (checkoutKey) => ckm.absByKey.has(checkoutKey),
        gitRun: async (checkoutKey, args) => {
          const root = ckm.absByKey.get(checkoutKey);
          if (!root) throw new Error(`unknown checkout ${checkoutKey}`);
          return defaultGitRun(root, args);
        },
      };
    };
    ctx.data.register("doc-git-freshness", async (params) => {
      return readDocFreshness(await docGitDeps(), str(params.companyId), str(params.docId));
    });
    ctx.data.register("doc-diff", async (params) => {
      return readDocDiff(await docGitDeps(), str(params.companyId), str(params.docId));
    });

    // --- skills viewer: index-gated by skillId → checkoutKey read (company repo or
    //     a plugin skill-root), reusing the same contained-read + size-cap defenses. ---
    ctx.data.register("skill-content", async (params) => {
      const repoRoots = await readRepoRoots();
      const skillRoots = await readSkillRoots();
      // Rebuild the SAME read-key map the derive used: repo/worktree keys PLUS the
      // plugin skill-root keys, so a company skill ("company") and a plugin skill
      // ("skillroot:…") both resolve. Skill-root keys never shadow a repo key.
      const ckm = await buildCheckoutKeyMap(repoRoots);
      const absByKey = new Map(ckm.absByKey);
      for (const r of skillRoots) if (!absByKey.has(r.key)) absByKey.set(r.key, r.absPath);
      return readSkillContent(
        {
          readIndex: (companyId) => readSkillsCatalog(ctx.db, companyId),
          readFile: async (checkoutKey, relPath) => {
            const root = absByKey.get(checkoutKey);
            if (!root) throw new Error(`unknown checkout ${checkoutKey}`);
            const { content, stat } = await readContainedText(root, relPath, DOCS_VIEWER_MAX_BYTES);
            return { content, sizeBytes: stat.sizeBytes, mtime: stat.mtime };
          },
          checkoutResolvable: (checkoutKey) => absByKey.has(checkoutKey),
        },
        str(params.companyId),
        str(params.skillId),
      );
    });
    // --- Teaching tab: a LIVE, file-backed corpus read (COS-2f) ---
    //     No cached table (deferred to COS-3): runs the TeachingSource against a
    //     full-sweep context and folds it on demand. The corpus is workspace-wide
    //     (the `company` repo), so `companyId` is not part of the read.
    ctx.data.register("teaching-overview", async () =>
      readTeachingOverview({
        collectBundle: async () => {
          const context = await makeCollectionContext({
            repoRoots: await readRepoRoots(),
            scopeRepo: null,
            logger: ctx.logger,
          });
          return { collectedAt: context.clock.now(), batches: [await teachingSource.collect(context)] };
        },
        now: () => Date.now(),
      }),
    );

    // --- on-demand refresh (the COS-0g hook + a manual UI refresh both hit this) ---
    ctx.actions.register("refresh-board", async (params) => {
      const companyId = str(params.companyId);
      if (!companyId) throw new Error("refresh-board requires a companyId");
      const scopeRepo = typeof params.scopeRepo === "string" && params.scopeRepo !== "" ? params.scopeRepo : null;
      return deriveForCompany(deps, companyId, scopeRepo ? "hook" : "manual", scopeRepo, randomUUID());
    });

    // --- scheduled full derive: jitter, then enumerate companies + derive each
    //     under the lock (failure-isolated). Orchestration lives in runDeriveBoardJob. ---
    ctx.jobs.register(DERIVE_BOARD_JOB_KEY, async () => {
      await runDeriveBoardJob({
        listCompanies: () => ctx.companies.list(),
        derive: (companyId) => deriveForCompany(deps, companyId, "schedule", null, randomUUID()),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        rng: Math.random,
        logger: ctx.logger,
      });
    });
  },

  async onHealth() {
    return { status: "ok", message: "Company OS cockpit ready (COS-0g triggers + kill-switch)" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
