/**
 * `useAgentSystem` — the Agents cockpit data seam. Reads the worker's
 * `agent-system` handler (validated, version-gated cache row). Type-only
 * contract import keeps the browser bundle zod-free.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { AgentSystemV1 } from "../../contracts/index.js";

export interface UseAgentSystemResult {
  agentSystem: AgentSystemV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useAgentSystem(companyId: string | null): UseAgentSystemResult {
  const { data, loading, error, refresh } = usePluginData<AgentSystemV1>("agent-system", {
    companyId: companyId ?? "",
  });
  return { agentSystem: data, loading, error, refresh };
}
