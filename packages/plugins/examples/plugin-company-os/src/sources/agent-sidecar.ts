import type { FreshnessKind } from "../contracts/vocab.js";

export interface AgentSidecarDuty {
  readonly id: string;
  readonly surface: string | null;
}

export interface AgentSidecarAgent {
  readonly name: string | null;
  readonly reportsTo: string | null;
  readonly summary: string | null;
  readonly duties: readonly AgentSidecarDuty[];
  readonly handsOffTo: readonly string[];
  readonly receivesFrom: readonly string[];
}

export type AgentSidecarFreshness =
  | {
      readonly kind: "artifact";
      readonly expectedArtifact: string;
      readonly exclude: readonly string[];
    }
  | {
      readonly kind: "proposal";
      readonly proposalSource: string;
    }
  | {
      readonly kind: "embedded";
    };

export interface AgentSidecarRoutine {
  readonly id: string;
  readonly displayName: string;
  readonly cadence: string;
  readonly ownerAgent: string;
  readonly freshness: AgentSidecarFreshness;
}

export interface AgentSidecar {
  readonly agent: AgentSidecarAgent | null;
  readonly routines: readonly AgentSidecarRoutine[];
}

export interface AgentSidecarParseResult {
  readonly sidecar: AgentSidecar | null;
  readonly errors: readonly string[];
}

export function parseAgentSidecarJson(text: string): AgentSidecarParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { sidecar: null, errors: [`invalid JSON: ${String(err)}`] };
  }
  if (!isRecord(raw)) {
    return { sidecar: null, errors: ["sidecar root must be an object"] };
  }

  const errors: string[] = [];
  const agent = parseAgent(raw.agent, errors);
  const routines = parseRoutines(raw.routines, errors);
  return { sidecar: { agent, routines }, errors };
}

function parseAgent(raw: unknown, errors: string[]): AgentSidecarAgent | null {
  if (raw === undefined) {
    errors.push("missing `agent` object");
    return null;
  }
  if (!isRecord(raw)) {
    errors.push("`agent` must be an object");
    return null;
  }
  return {
    name: stringOrNull(raw.name),
    reportsTo: stringOrNull(raw.reports_to),
    summary: stringOrNull(raw.summary),
    duties: parseDuties(raw.duties, errors),
    handsOffTo: parseAgentRefs(raw.hands_off_to, "hands_off_to", errors),
    receivesFrom: parseAgentRefs(raw.receives_from, "receives_from", errors),
  };
}

function parseDuties(raw: unknown, errors: string[]): AgentSidecarDuty[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push("`agent.duties` must be an array");
    return [];
  }
  const duties: AgentSidecarDuty[] = [];
  raw.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`agent duty ${index} must be an object`);
      return;
    }
    const id = stringOrNull(item.id);
    if (id === null || id === "") {
      errors.push(`agent duty ${index} missing id`);
      return;
    }
    duties.push({ id, surface: stringOrNull(item.surface) });
  });
  return duties;
}

function parseRoutines(raw: unknown, errors: string[]): AgentSidecarRoutine[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push("`routines` must be an array");
    return [];
  }
  const routines: AgentSidecarRoutine[] = [];
  raw.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`routine ${index} must be an object`);
      return;
    }
    const id = stringOrNull(item.id);
    const displayName = stringOrNull(item.display_name);
    const cadence = stringOrNull(item.cadence);
    const ownerAgent = stringOrNull(item.owner_agent);
    const freshness = parseFreshness(item.freshness, `routine ${id ?? index}`, errors);
    if (!id || !displayName || !cadence || !ownerAgent || !freshness) {
      errors.push(`routine ${id ?? index} missing required fields`);
      return;
    }
    routines.push({ id, displayName, cadence, ownerAgent, freshness });
  });
  return routines;
}

function parseFreshness(raw: unknown, label: string, errors: string[]): AgentSidecarFreshness | null {
  if (!isRecord(raw)) {
    errors.push(`${label} freshness must be an object`);
    return null;
  }
  const kind = stringOrNull(raw.kind);
  if (!isFreshnessKind(kind)) {
    errors.push(`${label} freshness has invalid kind`);
    return null;
  }
  if (kind === "artifact") {
    const expectedArtifact = stringOrNull(raw.expected_artifact);
    if (!expectedArtifact) {
      errors.push(`${label} artifact freshness missing expected_artifact`);
      return null;
    }
    return { kind, expectedArtifact, exclude: stringArray(raw.exclude) };
  }
  if (kind === "proposal") {
    const proposalSource = stringOrNull(raw.proposal_source);
    if (!proposalSource) {
      errors.push(`${label} proposal freshness missing proposal_source`);
      return null;
    }
    return { kind, proposalSource };
  }
  return { kind };
}

function isFreshnessKind(value: string | null): value is FreshnessKind {
  return value === "artifact" || value === "proposal" || value === "embedded";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseAgentRefs(raw: unknown, field: "hands_off_to" | "receives_from", errors: string[]): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push(`agent.${field} must be an array`);
    return [];
  }

  const refs: string[] = [];
  raw.forEach((item, index) => {
    if (typeof item !== "string") {
      errors.push(`agent.${field}[${index}] must be a string`);
      return;
    }
    const ref = item.trim();
    if (ref === "") {
      errors.push(`agent.${field}[${index}] must be non-empty`);
      return;
    }
    refs.push(ref);
  });
  return refs;
}
