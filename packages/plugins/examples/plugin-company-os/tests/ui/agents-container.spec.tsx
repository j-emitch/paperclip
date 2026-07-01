/**
 * Container-state coverage for the `Agents` data wrapper. The three pre-data
 * states (cold-cache loading / worker-error retry / no-agents) each render an
 * explicit, non-crashing panel, and the success path delegates to `AgentsView`.
 * The host hooks are mocked so the wrapper renders under the SSR (node) test env
 * with no bridge — the same guarantee the pure views rely on.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UseAgentSystemResult } from "../../src/ui/hooks/useAgentSystem.js";
import { goldenAgentSystem } from "./fixtures/agents.js";

const hoisted = vi.hoisted(() => ({ result: null as UseAgentSystemResult | null }));

vi.mock("../../src/ui/hooks/useMediaQuery.js", () => ({ useIsMobile: () => false }));
vi.mock("../../src/ui/hooks/useNow.js", () => ({ useNow: () => Date.parse("2026-06-23T12:00:00.000Z") }));
vi.mock("../../src/ui/hooks/useAgentSystem.js", () => ({
  useAgentSystem: (): UseAgentSystemResult => hoisted.result as UseAgentSystemResult,
}));

// Imported AFTER the mocks so the wrapper binds the mocked hooks.
import { Agents } from "../../src/ui/agents/Agents.js";

function setState(partial: Partial<UseAgentSystemResult>): void {
  hoisted.result = { agentSystem: null, loading: false, error: null, refresh: () => {}, ...partial };
}

describe("Agents container states", () => {
  it("renders a loading panel on a cold cache", () => {
    setState({ loading: true });
    const html = renderToStaticMarkup(<Agents companyId="c1" />);
    expect(html).toContain("Loading the agent workforce");
  });

  it("renders a retry panel on a worker error", () => {
    setState({ error: { message: "worker offline" } as unknown as UseAgentSystemResult["error"] });
    const html = renderToStaticMarkup(<Agents companyId="c1" />);
    expect(html).toContain("Couldn’t reach the worker");
    expect(html).toContain("worker offline");
    expect(html).toContain("Try again");
  });

  it("renders a calm no-agents panel when the system is empty", () => {
    setState({});
    const html = renderToStaticMarkup(<Agents companyId="c1" />);
    expect(html).toContain("No agent system yet");
  });

  it("delegates to AgentsView when the agent system is present", () => {
    setState({ agentSystem: goldenAgentSystem() });
    const html = renderToStaticMarkup(<Agents companyId="c1" />);
    expect(html).toContain("Agents");
    expect(html).toContain("Librarian");
    expect(html).toContain("org constellation");
  });
});
