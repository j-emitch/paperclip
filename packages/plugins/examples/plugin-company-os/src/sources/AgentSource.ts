/**
 * `AgentSource` — emits one `AgentSignal` per configured Company OS agent by
 * joining `.paperclip.yaml` identity fields with each agent's sidecar metadata.
 * It is deliberately read-only and no-throw: missing/malformed sidecars produce
 * stale identity-only signals instead of blanking the cockpit.
 */

import { freshnessFromErrors, signalError, type CollectionContext, type RepoRoot } from "../contracts/collection-context.js";
import type { WorkSignalSource, SignalBatch } from "../contracts/WorkSignalSource.js";
import type { AgentSignal, Signal, SignalError } from "../contracts/signals.js";
import type { OwnerAgent } from "../contracts/vocab.js";
import { collectPerRepo, readError, type RepoReadResult } from "./_shared.js";
import { parseAgentSidecarJson, type AgentSidecar } from "./agent-sidecar.js";
import { parsePaperclipAgentsYaml, type PaperclipAgentIdentity } from "./paperclip-yaml.js";

export const AGENT_SOURCE_ID = "agent";

const PAPERCLIP_CONFIG_PATH = "config/paperclip/.paperclip.yaml";
const SIDECAR_GLOB = "config/paperclip/agents/**/company-os.json";

type AgentSlug = "ceo" | "coo" | "cto" | "librarian";

const AGENT_ORDER: readonly AgentSlug[] = ["ceo", "coo", "cto", "librarian"];

export const agentSource: WorkSignalSource = {
  id: AGENT_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    return collectPerRepo(AGENT_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const configStat = await c.fs.stat(repo.repo, PAPERCLIP_CONFIG_PATH);
      if (!configStat) return { signals: [], errors: [] };

      let yamlText: string;
      try {
        yamlText = await c.fs.readText(repo.repo, PAPERCLIP_CONFIG_PATH);
      } catch (err) {
        return { signals: [], errors: [readError(PAPERCLIP_CONFIG_PATH, err)] };
      }

      const parsedConfig = parsePaperclipAgentsYaml(yamlText);
      const errors: SignalError[] = parsedConfig.errors.map((e) =>
        signalError("parse_error", `${PAPERCLIP_CONFIG_PATH}: ${e}`),
      );
      const identityErrors = new Map<string, SignalError[]>();
      for (const error of parsedConfig.agentErrors) {
        const bucket = identityErrors.get(error.slug) ?? [];
        bucket.push(signalError("parse_error", `${PAPERCLIP_CONFIG_PATH}: ${error.message}`));
        identityErrors.set(error.slug, bucket);
      }
      const identities = new Map(parsedConfig.agents.map((identity) => [identity.slug, identity]));
      const sidecars = await readSidecars(repo, c, errors);
      const signals: Signal[] = [];

      for (const slug of AGENT_ORDER) {
        const identity = identities.get(slug);
        if (!identity) continue;
        const sidecarPath = sidecarPathFor(slug);
        const sidecarResult = sidecars.get(sidecarPath);
        const signalErrors: SignalError[] = [...(identityErrors.get(identity.slug) ?? [])];
        let sidecar: AgentSidecar | null = null;

        if (!sidecarResult) {
          signalErrors.push(signalError("not_found", `missing sidecar: ${sidecarPath}`));
        } else if (!sidecarResult.sidecar) {
          for (const error of sidecarResult.errors) {
            signalErrors.push(signalError("parse_error", `${sidecarPath}: ${error}`));
          }
        } else {
          for (const error of sidecarResult.errors) {
            signalErrors.push(signalError("parse_error", `${sidecarPath}: ${error}`));
          }
          sidecar = sidecarResult.sidecar;
        }

        errors.push(...signalErrors);
        signals.push(agentSignal(repo, identity, sidecar, signalErrors));
      }

      return { signals, errors };
    });
  },
};

interface SidecarRead {
  readonly sidecar: AgentSidecar | null;
  readonly errors: readonly string[];
}

async function readSidecars(
  repo: RepoRoot,
  ctx: CollectionContext,
  errors: SignalError[],
): Promise<Map<string, SidecarRead>> {
  const out = new Map<string, SidecarRead>();
  const files = await ctx.fs.list(repo.repo, [SIDECAR_GLOB]);
  for (const file of files) {
    let text: string;
    try {
      text = await ctx.fs.readText(repo.repo, file.relPath);
    } catch (err) {
      errors.push(readError(file.relPath, err));
      continue;
    }
    out.set(file.relPath, parseAgentSidecarJson(text));
  }
  return out;
}

function agentSignal(
  repo: RepoRoot,
  identity: PaperclipAgentIdentity,
  sidecar: AgentSidecar | null,
  errors: readonly SignalError[],
): AgentSignal {
  const agent = sidecar?.agent ?? null;
  return {
    kind: "agent",
    source: AGENT_SOURCE_ID,
    repo: repo.repo,
    path: agent ? sidecarPathFor(identity.slug) : PAPERCLIP_CONFIG_PATH,
    confidence: "high",
    freshness: freshnessFromErrors(errors),
    errors,
    agentKey: identity.slug,
    displayName: displayNameForSlug(identity.slug),
    role: identity.role ?? identity.slug,
    model: identity.model ?? "unknown",
    reportsTo: mapOptionalAgentRef(agent?.reportsTo ?? null),
    budgetMonthlyCents: identity.budgetMonthlyCents,
    canCreateAgents: identity.canCreateAgents,
    maxTurnsPerRun: identity.maxTurnsPerRun,
    heartbeatIntervalSec: identity.heartbeatIntervalSec,
    summary: agent?.summary ?? identity.capabilities,
    duties: agent?.duties ?? [],
    handsOffTo: (agent?.handsOffTo ?? []).map(mapAgentRef),
    receivesFrom: (agent?.receivesFrom ?? []).map(mapAgentRef),
  };
}

function sidecarPathFor(slug: string): string {
  return `config/paperclip/agents/${slug}/company-os.json`;
}

function displayNameForSlug(slug: string): OwnerAgent {
  if (slug === "ceo") return "CEO";
  if (slug === "coo") return "COO";
  if (slug === "cto") return "CTO";
  return "Librarian";
}

function mapOptionalAgentRef(value: string | null): string | null {
  return value === null ? null : mapAgentRef(value);
}

function mapAgentRef(value: string): string {
  if (value === "ceo") return "CEO";
  if (value === "coo") return "COO";
  if (value === "cto") return "CTO";
  if (value === "librarian") return "Librarian";
  return value;
}
