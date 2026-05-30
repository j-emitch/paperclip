/**
 * One-time data migration: opt cwd-pinned heartbeat agents into per-run git
 * worktree isolation.
 *
 * Background: heartbeat agents (e.g. the Librarian, CEO) run on a daily timer.
 * When their `adapter_config.cwd` is hardwired to a shared git checkout, the
 * process adapter executes directly in that checkout, parking it on a branch and
 * corrupting its git cache-tree across runs.
 *
 * The runtime heartbeat path now auto-isolates such runs (see
 * `resolveHeartbeatWorktreeIsolation` in
 * server/src/services/execution-workspace-policy.ts), so this migration is NOT
 * required for correctness — it normalizes the *persisted* agent config so the
 * intent is visible in the DB and the management UI rather than only inferred at
 * run time.
 *
 * Scope: agents whose `runtime_config.heartbeat` is set AND whose
 * `adapter_config.cwd` is a non-empty string AND that have no explicit
 * `git_worktree` workspace strategy. Idempotent — re-running is a no-op once the
 * strategy is present.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/migrate-heartbeat-worktree-isolation.ts          # dry run
 *   DATABASE_URL=... tsx scripts/migrate-heartbeat-worktree-isolation.ts --apply  # persist
 */
import { eq } from "drizzle-orm";
import { agents, createDb } from "@paperclipai/db";
import { resolveHeartbeatWorktreeIsolation } from "../server/src/services/execution-workspace-policy.js";

/** Minimal CLI logger — writes directly to stdout/stderr (no console.*). */
function out(line: string) {
  process.stdout.write(`${line}\n`);
}
function err(line: string) {
  process.stderr.write(`${line}\n`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    err("DATABASE_URL is required");
    process.exit(1);
  }

  const apply = process.argv.includes("--apply");
  const db = createDb(dbUrl);

  const allAgents = await db.select().from(agents);
  let changedAgents = 0;

  for (const agent of allAgents) {
    const runtimeConfig = asRecord(agent.runtimeConfig);
    const adapterConfig = asRecord(agent.adapterConfig);
    if (!runtimeConfig || !adapterConfig) continue;
    // Only heartbeat (timer) agents are in scope.
    if (asRecord(runtimeConfig.heartbeat) === null) continue;

    // Reuse the runtime decision helper so the migration and the live heartbeat
    // path stay in lockstep. A heartbeat agent has no managed project workspace
    // of its own, so the worktree is provisioned off the pinned cwd.
    const isolation = resolveHeartbeatWorktreeIsolation({
      adapterConfig,
      resolvedWorkspaceSource: "agent_home",
      hasProjectWorkspace: false,
    });
    if (!isolation) continue;

    changedAgents += 1;
    out(
      `${apply ? "Updating" : "Would update"} agent ${agent.id} (${agent.name}) — ` +
        `pinned cwd ${String(adapterConfig.cwd)} → git_worktree isolation`,
    );

    if (apply) {
      await db
        .update(agents)
        .set({
          adapterConfig: isolation.config,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));
    }
  }

  if (!apply) {
    out(`Dry run: ${changedAgents} heartbeat agent(s) would be updated`);
    out("Re-run with --apply to persist changes");
    process.exit(0);
  }

  out(`Updated ${changedAgents} heartbeat agent(s)`);
  process.exit(0);
}

void main();
