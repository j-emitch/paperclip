import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { randomUUID } from "node:crypto";
import { DERIVE_BOARD_JOB_KEY, PLUGIN_ID } from "./manifest.js";
import { makeCollectionContext } from "./runtime/makeCollectionContext.js";
import { deriveForCompany, type DeriveDeps } from "./derive.js";
import { readArtifactIndex, readBoardState, readRoutineHealth } from "./db/cache.js";

/**
 * Company OS cockpit worker — COS-0d.
 *
 * Registers the read-side data handlers (board-state / artifact-index /
 * routine-health), the `refresh-board` action (on-demand full or scoped derive),
 * and the real `derive-board` scheduled job (per-company, under the atomic cache
 * lock). The deterministic pipeline — collect → scoped-merge → collectAndProject
 * → cache — lives in `deriveForCompany`; this file is just the SDK wiring.
 *
 * (`scaffold-status` is retained so the COS-0a/0b UI keeps rendering until the
 * board UI lands in COS-0e, then it is removed.)
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

    // --- on-demand refresh (the COS-0g hook + a manual UI refresh both hit this) ---
    ctx.actions.register("refresh-board", async (params) => {
      const companyId = str(params.companyId);
      if (!companyId) throw new Error("refresh-board requires a companyId");
      const scopeRepo = typeof params.scopeRepo === "string" && params.scopeRepo !== "" ? params.scopeRepo : null;
      return deriveForCompany(deps, companyId, scopeRepo ? "hook" : "manual", scopeRepo, randomUUID());
    });

    // --- scheduled full derive: enumerate companies, derive each under the lock ---
    ctx.jobs.register(DERIVE_BOARD_JOB_KEY, async () => {
      const companies = await ctx.companies.list();
      ctx.logger.info(`${DERIVE_BOARD_JOB_KEY}: deriving ${companies.length} compan${companies.length === 1 ? "y" : "ies"}`);
      for (const company of companies) {
        const result = await deriveForCompany(deps, company.id, "schedule", null, randomUUID());
        if (!result.ok) ctx.logger.warn(`derive failed for ${company.id}`, { error: result.error });
      }
    });

    // Retained scaffold bridge — removed in COS-0e when the board UI replaces it.
    ctx.data.register("scaffold-status", async () => ({
      ok: true,
      pluginId: PLUGIN_ID,
      phase: "COS-0d - derive pipeline",
      message: "Collection + projection + cache live. The Kanban UI arrives in COS-0e.",
      upcoming: [
        { tab: "Board", liveIn: "COS-0e" },
        { tab: "Reports", liveIn: "COS-0f" },
        { tab: "Routines", liveIn: "COS-0f" },
      ],
    }));
  },

  async onHealth() {
    return { status: "ok", message: "Company OS cockpit ready (COS-0d derive)" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
