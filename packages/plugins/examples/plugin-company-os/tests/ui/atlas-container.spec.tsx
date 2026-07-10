/**
 * Container-state coverage for the `Atlas` data wrapper. The three pre-data
 * states (cold-cache loading / worker-error retry / no-atlas) each render an
 * explicit, non-crashing panel, and the success path delegates to `BuildAtlasView`.
 * The host hooks are mocked so the wrapper renders under the SSR (node) test env
 * with no bridge — the same guarantee the pure views rely on.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UseBuildAtlasResult } from "../../src/ui/hooks/useBuildAtlas.js";
import { goldenAtlas, emptyAtlas } from "./fixtures/atlas.js";

const hoisted = vi.hoisted(() => ({ result: null as UseBuildAtlasResult | null }));

vi.mock("../../src/ui/hooks/useMediaQuery.js", () => ({ useIsMobile: () => false }));
vi.mock("../../src/ui/hooks/useNow.js", () => ({ useNow: () => Date.parse("2026-06-23T12:00:00.000Z") }));
vi.mock("../../src/ui/hooks/useBuildAtlas.js", () => ({
  useBuildAtlas: (): UseBuildAtlasResult => hoisted.result as UseBuildAtlasResult,
}));
// The Atlas triggers a derive via the shared `refresh-board` action; stub the host bridge.
vi.mock("@paperclipai/plugin-sdk/ui", () => ({
  usePluginAction: () => async () => ({}),
  usePluginData: () => ({ data: null, loading: false, error: null, refresh: () => {} }),
}));

// Imported AFTER the mocks so the wrapper binds the mocked hooks.
import { Atlas } from "../../src/ui/atlas/Atlas.js";
import { setPendingTarget } from "../../src/ui/pending-target-store.js";

function setState(partial: Partial<UseBuildAtlasResult>): void {
  hoisted.result = { buildAtlas: null, loading: false, error: null, refresh: () => {}, ...partial };
}

describe("Atlas container states", () => {
  it("renders a loading panel on a cold cache", () => {
    setState({ loading: true });
    const html = renderToStaticMarkup(<Atlas companyId="c1" />);
    expect(html).toContain("Loading the Build Atlas");
  });

  it("renders a retry panel on a worker error", () => {
    setState({ error: { message: "worker offline" } as unknown as UseBuildAtlasResult["error"] });
    const html = renderToStaticMarkup(<Atlas companyId="c1" />);
    expect(html).toContain("Couldn’t reach the worker");
    expect(html).toContain("worker offline");
    expect(html).toContain("Try again");
  });

  it("renders a no-atlas empty panel when the cache is null", () => {
    setState({});
    const html = renderToStaticMarkup(<Atlas companyId="c1" />);
    expect(html).toContain("No atlas yet");
  });

  it("treats a derived-but-familyless atlas as empty (show the state, not a blank grid)", () => {
    setState({ buildAtlas: emptyAtlas() });
    const html = renderToStaticMarkup(<Atlas companyId="c1" />);
    expect(html).toContain("No atlas yet");
  });

  it("delegates to BuildAtlasView when the atlas is present", () => {
    setState({ buildAtlas: goldenAtlas() });
    const html = renderToStaticMarkup(<Atlas companyId="c1" />);
    expect(html).toContain("Build Atlas");
    expect(html).toContain("Company OS");
    expect(html).toContain("Value Chain"); // lineage rendered
  });

  it("consumes a pending board deep-link into a focused family card (B1)", () => {
    setPendingTarget({ tab: "board", workId: "COS-1" });
    try {
      setState({ buildAtlas: goldenAtlas() });
      const html = renderToStaticMarkup(<Atlas companyId="c1" />);
      expect(html).toContain("data-focused");
    } finally {
      setPendingTarget(null); // never leak a target into other tests
    }
  });

  it("renders the typed miss note for a board target the atlas doesn't host (B1)", () => {
    setPendingTarget({ tab: "board", workId: "NOPE-1" });
    try {
      setState({ buildAtlas: goldenAtlas() });
      const html = renderToStaticMarkup(<Atlas companyId="c1" />);
      expect(html).toContain("isn’t on the atlas");
    } finally {
      setPendingTarget(null);
    }
  });
});
