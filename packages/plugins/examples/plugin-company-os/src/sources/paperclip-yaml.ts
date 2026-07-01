export interface PaperclipAgentIdentity {
  readonly slug: string;
  readonly role: string | null;
  readonly capabilities: string | null;
  readonly model: string | null;
  readonly budgetMonthlyCents: number | null;
  readonly canCreateAgents: boolean;
  readonly maxTurnsPerRun: number | null;
  readonly heartbeatIntervalSec: number | null;
}

export interface PaperclipAgentsParseResult {
  readonly agents: readonly PaperclipAgentIdentity[];
  readonly errors: readonly string[];
}

interface MutableIdentity {
  role: string | null;
  capabilities: string | null;
  model: string | null;
  budgetMonthlyCents: number | null;
  canCreateAgents: boolean;
  maxTurnsPerRun: number | null;
  heartbeatIntervalSec: number | null;
}

export function parsePaperclipAgentsYaml(text: string): PaperclipAgentsParseResult {
  const identities = new Map<string, MutableIdentity>();
  const pathByIndent = new Map<number, string>();
  const errors: string[] = [];
  let inAgents = false;
  let currentSlug: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (indent === 0) {
      inAgents = line === "agents:";
      currentSlug = null;
      pathByIndent.clear();
      continue;
    }
    if (!inAgents) continue;

    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;

    const key = kv[1];
    const rawValue = kv[2];
    for (const existingIndent of [...pathByIndent.keys()]) {
      if (existingIndent >= indent) pathByIndent.delete(existingIndent);
    }

    if (indent === 2 && rawValue.trim() === "") {
      currentSlug = key;
      identities.set(key, {
        role: null,
        capabilities: null,
        model: null,
        budgetMonthlyCents: null,
        canCreateAgents: false,
        maxTurnsPerRun: null,
        heartbeatIntervalSec: null,
      });
      pathByIndent.set(indent, key);
      continue;
    }

    if (currentSlug === null) continue;
    const identity = identities.get(currentSlug);
    if (!identity) {
      errors.push(`agent ${currentSlug} was not initialized`);
      continue;
    }

    if (rawValue.trim() === "") {
      pathByIndent.set(indent, key);
      continue;
    }

    const parentPath = [...pathByIndent.entries()]
      .filter(([level]) => level > 2 && level < indent)
      .sort(([a], [b]) => a - b)
      .map(([, part]) => part);
    assignIdentityValue(identity, [...parentPath, key].join("."), parseScalar(rawValue));
  }

  return {
    agents: [...identities.entries()].map(([slug, identity]) => ({ slug, ...identity })),
    errors,
  };
}

function assignIdentityValue(identity: MutableIdentity, path: string, value: string | number | boolean): void {
  if (path === "role" && typeof value === "string") {
    identity.role = value;
  } else if (path === "capabilities" && typeof value === "string") {
    identity.capabilities = value;
  } else if (path === "adapter.config.model" && typeof value === "string") {
    identity.model = value;
  } else if (path === "adapter.config.maxTurnsPerRun" && typeof value === "number") {
    identity.maxTurnsPerRun = value;
  } else if (path === "runtime.heartbeat.intervalSec" && typeof value === "number") {
    identity.heartbeatIntervalSec = value;
  } else if (path === "permissions.canCreateAgents" && typeof value === "boolean") {
    identity.canCreateAgents = value;
  } else if (path === "budgetMonthlyCents" && typeof value === "number") {
    identity.budgetMonthlyCents = value;
  }
}

function parseScalar(value: string): string | number | boolean {
  const cleaned = stripComment(value).trim();
  if (cleaned === "true") return true;
  if (cleaned === "false") return false;
  if (/^-?\d+$/.test(cleaned)) return Number.parseInt(cleaned, 10);
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    return cleaned.slice(1, -1);
  }
  return cleaned;
}

function stripComment(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1);
    return end === -1 ? trimmed : trimmed.slice(0, end + 1);
  }
  const commentStart = trimmed.search(/\s#/);
  return commentStart === -1 ? trimmed : trimmed.slice(0, commentStart).trimEnd();
}
