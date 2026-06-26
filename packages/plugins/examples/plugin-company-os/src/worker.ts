import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { randomUUID } from "node:crypto";
import { DERIVE_BOARD_JOB_KEY, PLUGIN_ID } from "./manifest.js";
import { makeCollectionContext } from "./runtime/makeCollectionContext.js";
import { absByKeyFromRoots, readContainedText } from "./runtime/workspace-fs.js";
import { buildCheckoutKeyMap } from "./runtime/checkout-keys.js";
import { deriveForCompany, type DeriveDeps } from "./derive.js";
import { runDeriveBoardJob } from "./derive-job.js";
import {
  readArtifactIndex,
  readBoardState,
  readDocIndex,
  readGitState,
  readOrientation,
  readRoutineHealth,
} from "./db/cache.js";
import { DOCS_VIEWER_MAX_BYTES, readReportContent } from "./report-content-read.js";
import { readDocContent } from "./doc-content-read.js";
import { projectGroupV1Schema, resolveTaxonomy, type ProjectGroupV1 } from "./contracts/projects.js";

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

    const deps: DeriveDeps = {
      db: ctx.db,
      makeContext: async (scopeRepo) =>
        makeCollectionContext({ repoRoots: await readRepoRoots(), scopeRepo, logger: ctx.logger }),
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
