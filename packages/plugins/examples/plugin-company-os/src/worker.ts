import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { DERIVE_BOARD_JOB_KEY, PLUGIN_ID } from "./manifest.js";

/**
 * Company OS cockpit worker — COS-0a scaffold.
 *
 * This phase only proves the worker bridge end-to-end: a single `scaffold-status`
 * data handler the UI reads, plus a no-op handler for the manifest-declared
 * `derive-board` job (a declared scheduled job must have a handler, or it is a
 * dangling declaration the host calls into nothing).
 *
 * COS-0d replaces the no-op with the real per-company `collectAndProject` ->
 * `ctx.db` write under the atomic CAS lock, and registers the
 * `board-state` / `artifact-index` / `routine-health` data handlers + the
 * `refresh-board` action.
 */

export interface ScaffoldStatus {
  ok: true;
  pluginId: string;
  phase: string;
  message: string;
  /** Tabs reserved in the scaffold; lit up by later phases. */
  upcoming: { tab: string; liveIn: string }[];
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    ctx.logger.info(`${PLUGIN_ID} worker setup (COS-0a scaffold)`);

    // Hello-world data handler: lets the scaffold UI confirm the worker RPC
    // bridge is wired before any real projection exists. Removed in COS-0d.
    ctx.data.register("scaffold-status", async (): Promise<ScaffoldStatus> => ({
      ok: true,
      pluginId: PLUGIN_ID,
      phase: "COS-0a - scaffold",
      message:
        "Company OS cockpit scaffold is live. The board, reports, and routines surfaces arrive in COS-0d-0f.",
      upcoming: [
        { tab: "Board", liveIn: "COS-0e" },
        { tab: "Reports", liveIn: "COS-0f" },
        { tab: "Routines", liveIn: "COS-0f" },
        { tab: "Teaching", liveIn: "COS-1" },
        { tab: "Knowledge", liveIn: "COS-2" },
      ],
    }));

    // The manifest declares the `derive-board` scheduled job, so it must have a
    // handler from day one. No-op until COS-0d/0g wire the real derive.
    ctx.jobs.register(DERIVE_BOARD_JOB_KEY, async () => {
      ctx.logger.info(`${DERIVE_BOARD_JOB_KEY}: scaffold no-op tick (real derive lands in COS-0d/0g)`);
    });
  },

  async onHealth() {
    return { status: "ok", message: "Company OS cockpit ready (scaffold)" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
