/**
 * Drift guard for the UI-side canonical agent order. `ui/shared/agent-order`
 * deliberately RE-DECLARES `OWNER_AGENT_ORDER` rather than value-importing the
 * contract's `OWNER_AGENTS`: the browser import-boundary forbids a UI value-import
 * of `src/contracts/**` — even the zod-free `vocab` — so the tuple can't be shared
 * at runtime (see tests/ui/import-boundary.spec.ts). This test is the seam that
 * keeps the two copies from silently diverging: a test file is NOT the browser
 * bundle, so it MAY value-import both and assert they stay byte-identical (codex B).
 */

import { describe, expect, it } from "vitest";
import { OWNER_AGENTS } from "../../src/contracts/vocab.js";
import { OWNER_AGENT_ORDER, agentRank } from "../../src/ui/shared/agent-order.js";

describe("agent-order", () => {
  it("the UI order matches the contract OWNER_AGENTS tuple exactly (no drift)", () => {
    expect([...OWNER_AGENT_ORDER]).toEqual([...OWNER_AGENTS]);
  });

  it("ranks each agent by its canonical position; an unknown agent sorts last", () => {
    OWNER_AGENT_ORDER.forEach((name, i) => expect(agentRank(name)).toBe(i));
    expect(agentRank("Nobody")).toBe(OWNER_AGENT_ORDER.length);
  });
});
