/**
 * `RoutineContractSource` — emits a `RoutineSignal` per report-routine declared
 * in an agent `company-os.json` sidecar. It reads the contract only
 * (id/display_name/cadence/owner_agent/freshness); the last-run join + SLO
 * verdict happen in the RoutineHealth projection against artifacts/proposals.
 *
 * Sidecars are the COS-1R source of truth. During activation sequencing, a live
 * company checkout may still have only the legacy AGENTS.md `company_os:` block;
 * when a sidecar is absent for that agent, we fall back to that block so routine
 * health never blanks before the sidecar doc branch lands.
 */

import { type CollectionContext, type RepoRoot } from "../contracts/collection-context.js";
import type { WorkSignalSource, SignalBatch } from "../contracts/WorkSignalSource.js";
import type { RoutineSignal, Signal, SignalError } from "../contracts/signals.js";
import type { FreshnessKind } from "../contracts/vocab.js";
import { collectPerRepo, readError, type RepoReadResult } from "./_shared.js";
import { parseAgentSidecarJson, type AgentSidecarRoutine } from "./agent-sidecar.js";
import { extractCompanyOsYaml, parseCompanyOsBlock, type ParsedRoutine } from "./parse.js";

export const ROUTINE_CONTRACT_SOURCE_ID = "routine-contract";

/** Where the directive sidecars live (only the company repo matches in practice). */
const SIDECAR_GLOB = "config/paperclip/agents/**/company-os.json";
const AGENTS_GLOB = "config/paperclip/agents/**/AGENTS.md";

/**
 * Normalize a routine's `expected_artifact` glob so a flat single-segment match
 * also matches date-bucketed outputs (`<dir>/2026/06-23.md`). The AGENTS blocks
 * declare a single-star tail (one path segment only), but a routine may bucket
 * its output into sub-dirs; rewriting that tail to a recursive cross-segment
 * match makes the artifact join robust to either layout. A glob that is already
 * recursive (double-star anchored) is left untouched (no doubling).
 */
export function normalizeArtifactGlob(glob: string): string {
  const slash = glob.lastIndexOf("/");
  if (slash === -1) return glob;
  const dir = glob.slice(0, slash);
  const tail = glob.slice(slash + 1);
  if (!tail.includes("*") || tail.includes("**") || dir.includes("**")) return glob;
  return `${dir}/**/${tail}`;
}

export const routineContractSource: WorkSignalSource = {
  id: ROUTINE_CONTRACT_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    return collectPerRepo(ROUTINE_CONTRACT_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const files = await c.fs.list(repo.repo, [SIDECAR_GLOB]);
      const sidecarAgents = new Set(files.map((file) => agentSlugFromPath(file.relPath)).filter((slug): slug is string => slug !== null));
      const signals: Signal[] = [];
      const errors: SignalError[] = [];
      for (const file of files) {
        let text: string;
        try {
          text = await c.fs.readText(repo.repo, file.relPath);
        } catch (err) {
          errors.push(readError(file.relPath, err));
          continue;
        }
        const parsed = parseAgentSidecarJson(text);
        for (const e of parsed.errors) {
          errors.push({ code: "parse_error", message: `${file.relPath}: ${e}`, degraded: true });
        }
        for (const r of parsed.sidecar?.routines ?? []) {
          signals.push(routineSignal(repo, file.relPath, r));
        }
      }
      const legacyFiles = await c.fs.list(repo.repo, [AGENTS_GLOB]);
      for (const file of legacyFiles) {
        const slug = agentSlugFromPath(file.relPath);
        if (slug !== null && sidecarAgents.has(slug)) continue;
        let text: string;
        try {
          text = await c.fs.readText(repo.repo, file.relPath);
        } catch (err) {
          errors.push(readError(file.relPath, err));
          continue;
        }
        const yaml = extractCompanyOsYaml(text);
        if (!yaml) continue;
        const block = parseCompanyOsBlock(yaml);
        for (const e of block.errors) {
          errors.push({ code: "parse_error", message: `${file.relPath}: ${e}`, degraded: true });
        }
        for (const r of block.routines) {
          signals.push(legacyRoutineSignal(repo, file.relPath, r));
        }
      }
      return { signals, errors };
    });
  },
};

function routineSignal(repo: RepoRoot, relPath: string, routine: AgentSidecarRoutine): RoutineSignal {
  const freshnessFields = fieldsForFreshness(routine.freshness);
  const signal: RoutineSignal = {
    kind: "routine",
    source: ROUTINE_CONTRACT_SOURCE_ID,
    repo: repo.repo,
    path: relPath,
    confidence: "high",
    freshness: "live",
    errors: [],
    routineKey: routine.id,
    displayName: routine.displayName,
    ownerAgent: routine.ownerAgent,
    cadence: routine.cadence,
    ...freshnessFields,
  };
  return signal;
}

function fieldsForFreshness(freshness: AgentSidecarRoutine["freshness"]): {
  readonly expectedArtifactGlob: string;
  readonly freshnessKind: FreshnessKind;
  readonly proposalSource?: string;
  readonly exclude?: readonly string[];
} {
  if (freshness.kind === "artifact") {
    return {
      freshnessKind: "artifact",
      expectedArtifactGlob: normalizeArtifactGlob(freshness.expectedArtifact),
      exclude: freshness.exclude.map(normalizeArtifactGlob),
    };
  }
  if (freshness.kind === "proposal") {
    return {
      freshnessKind: "proposal",
      expectedArtifactGlob: freshness.proposalSource,
      proposalSource: freshness.proposalSource,
    };
  }
  return {
    freshnessKind: "embedded",
    expectedArtifactGlob: "",
  };
}

function legacyRoutineSignal(repo: RepoRoot, relPath: string, routine: ParsedRoutine): RoutineSignal {
  return {
    kind: "routine",
    source: ROUTINE_CONTRACT_SOURCE_ID,
    repo: repo.repo,
    path: relPath,
    confidence: "high",
    freshness: "live",
    errors: [],
    routineKey: routine.id,
    displayName: routine.display_name,
    ownerAgent: routine.owner_agent,
    cadence: routine.cadence,
    expectedArtifactGlob: normalizeArtifactGlob(routine.expected_artifact),
    freshnessKind: "artifact",
  };
}

function agentSlugFromPath(relPath: string): string | null {
  const match = /^config\/paperclip\/agents\/([^/]+)\//.exec(relPath);
  return match?.[1] ?? null;
}
