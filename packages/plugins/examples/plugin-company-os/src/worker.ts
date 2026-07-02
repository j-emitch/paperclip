import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { randomUUID } from "node:crypto";
import { DERIVE_BOARD_JOB_KEY, PLUGIN_ID } from "./manifest.js";
import { makeCollectionContext } from "./runtime/makeCollectionContext.js";
import { absByKeyFromRoots, readContainedText } from "./runtime/workspace-fs.js";
import { deriveForCompany, type DeriveDeps } from "./derive.js";
import { runDeriveBoardJob } from "./derive-job.js";
import { readArtifactIndex, readBoardState, readRoutineHealth } from "./db/cache.js";
import { DOCS_VIEWER_MAX_BYTES, readReportContent } from "./report-content-read.js";
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

    const deps: DeriveDeps = {
      db: ctx.db,
      makeContext: async (scopeRepo) =>
        makeCollectionContext({ repoRoots: await readRepoRoots(), scopeRepo, logger: ctx.logger }),
      now: () => Date.now(),
      logger: ctx.logger,
    };

    // --- read-side data handlers (the UI's usePluginData reads these) ---
    ctx.data.register("board-state", async (params) => readBoardState(ctx.db, str(params.companyId)));
    ctx.data.register("artifact-index", async (params) => readArtifactIndex(ctx.db, str(params.companyId)));
    ctx.data.register("routine-health", async (params) => readRoutineHealth(ctx.db, str(params.companyId)));

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
