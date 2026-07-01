/**
 * `RoutineContractSource` — emits a `RoutineSignal` per report-routine declared
 * in an agent `company-os.json` sidecar. It reads the contract only
 * (id/display_name/cadence/owner_agent/freshness); the last-run join + SLO
 * verdict happen in the RoutineHealth projection against artifacts/proposals.
 */

import { type CollectionContext, type RepoRoot } from "../contracts/collection-context.js";
import type { WorkSignalSource, SignalBatch } from "../contracts/WorkSignalSource.js";
import type { RoutineSignal, Signal, SignalError } from "../contracts/signals.js";
import type { FreshnessKind } from "../contracts/vocab.js";
import { collectPerRepo, readError, type RepoReadResult } from "./_shared.js";
import { parseAgentSidecarJson, type AgentSidecarRoutine } from "./agent-sidecar.js";

export const ROUTINE_CONTRACT_SOURCE_ID = "routine-contract";

/** Where the directive sidecars live (only the company repo matches in practice). */
const SIDECAR_GLOB = "config/paperclip/agents/**/company-os.json";

/**
 * Normalize a routine's `expected_artifact` glob so a flat single-segment match
 * also matches date-bucketed outputs (`<dir>/2026/06-23.md`). The AGENTS blocks
 * declare a single-star tail (one path segment only), but a routine may bucket
 * its output into sub-dirs; rewriting that tail to a recursive cross-segment
 * match makes the artifact join robust to either layout. A glob that is already
 * recursive (double-star anchored) is left untouched (no doubling).
 */
export function normalizeArtifactGlob(glob: string): string {
  return glob.replace(/([^*/])\/\*(\.[A-Za-z0-9]+)?$/, "$1/**/*$2");
}

export const routineContractSource: WorkSignalSource = {
  id: ROUTINE_CONTRACT_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    return collectPerRepo(ROUTINE_CONTRACT_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const files = await c.fs.list(repo.repo, [SIDECAR_GLOB]);
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
      exclude: freshness.exclude,
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
