/**
 * `HooksSource` (COS-11) — per-repo hook-install/parity state: `core.hooksPath`,
 * a byte-diff of the repo's `.githooks/*` against the canonical company set,
 * the GATE_SUITES roster, guardrails-log activity (via the §3.3b allowlisted
 * reader), and the repo's newest cannons-runs line (the pre-push gate's REAL
 * receipt — verified 2026-07-09: guardrails.ndjson carries hook activity
 * (typecheck/classifier/reviewer/tripwires) but NO pre-push rows, so the gate
 * outcome honestly comes from the provenance log instead).
 *
 * Read-only + degrade-never-throw: every failed read nulls its field and
 * records a degraded error; the Gates band renders "unknown", never a crash.
 */

import { signalError, type CollectionContext } from "../contracts/collection-context.js";
import type { WorkSignalSource, SignalBatch } from "../contracts/WorkSignalSource.js";
import type { HooksSignal, SignalError } from "../contracts/signals.js";
import {
  CANONICAL_HOOKS_GLOB,
  GATES_BUDGET_MS,
  GATES_COMPANY_REPO,
  HOOK_TESTS_REL,
  LEDGER_TAIL_BYTES,
  REPO_HOOKS_GLOB,
  completeTailLines,
  parseCannonsRunLine,
  parseGateSuites,
  type CannonsRunRow,
} from "../contracts/gates.js";
import { collectPerRepo, readError, type RepoReadResult } from "./_shared.js";

export const HOOKS_SOURCE_ID = "hooks";

/** Canonical hook contents + gate suites, read ONCE per collect (not per repo). */
interface CanonicalState {
  /** hook name → content; null = company repo unreadable this run. */
  readonly hooks: ReadonlyMap<string, string> | null;
  readonly gateSuites: readonly string[];
}

async function readCanonical(ctx: CollectionContext): Promise<CanonicalState> {
  const company = ctx.repos.find((r) => r.repo === GATES_COMPANY_REPO);
  if (!company || !company.available) return { hooks: null, gateSuites: [] };
  const hooks = new Map<string, string>();
  try {
    const stats = await ctx.fs.list(GATES_COMPANY_REPO, [CANONICAL_HOOKS_GLOB]);
    for (const st of stats) {
      const name = st.relPath.split("/").pop() ?? st.relPath;
      hooks.set(name, await ctx.fs.readText(GATES_COMPANY_REPO, st.relPath));
    }
  } catch {
    return { hooks: null, gateSuites: [] };
  }
  let gateSuites: string[] = [];
  try {
    gateSuites = parseGateSuites(await ctx.fs.readText(GATES_COMPANY_REPO, HOOK_TESTS_REL));
  } catch {
    /* roster unreadable — [] renders honestly */
  }
  return { hooks, gateSuites };
}

/** Newest cannons-runs row per repo, read ONCE per collect via the allowlisted tail. */
async function readGateRuns(ctx: CollectionContext): Promise<ReadonlyMap<string, CannonsRunRow>> {
  const byRepo = new Map<string, CannonsRunRow>();
  const tail = await ctx.logs?.readAllowlistedTail({ log: "cannons_runs" }, LEDGER_TAIL_BYTES);
  if (!tail) return byRepo;
  for (const line of completeTailLines(tail.text, tail.truncated)) {
    const row = parseCannonsRunLine(line);
    if (row) byRepo.set(row.repo, row); // later lines win — the file is append-only
  }
  return byRepo;
}

/** Minimal guardrails-row parse ({t, hook} is all this source lifts). */
function guardrailActivity(text: string, truncated: boolean): { lastAt: string | null; kinds: string[] } {
  let lastAt: string | null = null;
  const kinds = new Set<string>();
  for (const line of completeTailLines(text, truncated)) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof raw !== "object" || raw === null) continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.t === "string" && (lastAt === null || o.t > lastAt)) lastAt = o.t;
    if (typeof o.hook === "string") kinds.add(o.hook);
  }
  return { lastAt, kinds: [...kinds].sort() };
}

export const hooksSource: WorkSignalSource = {
  id: HOOKS_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    // Shared reads resolved lazily ONCE, then reused by every repo's reader.
    let canonicalP: Promise<CanonicalState> | null = null;
    let gateRunsP: Promise<ReadonlyMap<string, CannonsRunRow>> | null = null;
    const canonical = () => (canonicalP ??= readCanonical(ctx));
    const gateRuns = () => (gateRunsP ??= readGateRuns(ctx));
    const startMs = ctx.clock.now();

    return collectPerRepo(HOOKS_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      // GATES_BUDGET_MS backstop: repos past the budget are skipped with a
      // degraded error (stale badge + diagnostic), never a silent green row.
      if (c.clock.now() - startMs > GATES_BUDGET_MS) {
        return {
          signals: [],
          errors: [signalError("subprocess_timeout", `gates budget exhausted before ${repo.repo} hooks read`)],
        };
      }
      const errors: SignalError[] = [];

      // core.hooksPath (exit 1 + empty stdout = unset — a normal state, not an error).
      const cfg = await c.git.run(repo.repo, ["config", "--get", "core.hooksPath"]);
      const hooksPathValue = cfg.code === 0 && cfg.stdout.trim() !== "" ? cfg.stdout.trim() : null;
      if (cfg.timedOut) errors.push(signalError("subprocess_failed", `git config core.hooksPath timed out in ${repo.repo}`));

      // Parity byte-diff vs canonical.
      const canon = await canonical();
      let parity: HooksSignal["parity"] = "unknown";
      const driftedHooks: string[] = [];
      if (canon.hooks !== null) {
        try {
          const stats = await c.fs.list(repo.repo, [REPO_HOOKS_GLOB]);
          const mine = new Map<string, string>();
          for (const st of stats) {
            const name = st.relPath.split("/").pop() ?? st.relPath;
            mine.set(name, await c.fs.readText(repo.repo, st.relPath));
          }
          if (mine.size === 0) {
            parity = "missing";
            driftedHooks.push(...canon.hooks.keys());
          } else {
            for (const [name, content] of canon.hooks) {
              if (mine.get(name) !== content) driftedHooks.push(name);
            }
            parity = driftedHooks.length === 0 ? "in_sync" : "drifted";
          }
        } catch (e) {
          errors.push(readError(`${repo.repo}/.githooks`, e));
        }
      }

      // Guardrails activity (allowlisted tail; absence NORMAL).
      let lastGuardrailAt: string | null = null;
      let guardrailHookKinds: string[] = [];
      const tail = await c.logs?.readAllowlistedTail({ log: "repo_guardrails", repoKey: repo.repo }, LEDGER_TAIL_BYTES);
      if (tail) {
        const act = guardrailActivity(tail.text, tail.truncated);
        lastGuardrailAt = act.lastAt;
        guardrailHookKinds = act.kinds;
      }

      const run = (await gateRuns()).get(repo.repo) ?? null;
      const signal: HooksSignal = {
        kind: "hooks",
        source: HOOKS_SOURCE_ID,
        repo: repo.repo,
        confidence: "high",
        freshness: errors.some((e) => e.degraded) ? "stale" : "live",
        errors,
        hooksPathValue,
        parity,
        driftedHooks: driftedHooks.sort(),
        gateSuites: canon.gateSuites,
        lastGuardrailAt,
        guardrailHookKinds,
        lastGateRun: run ? { runId: run.runId, sha8: run.sha8, verdict: run.verdict, at: run.at } : null,
      };
      return { signals: [signal], errors };
    });
  },
};
