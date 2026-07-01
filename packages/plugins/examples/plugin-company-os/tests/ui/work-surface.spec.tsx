/**
 * `WorkSurface` fallback-flag coverage (COS-5d-b) — the kill-switch is a TESTED
 * flag, not a promise. Flag off (the shipped default) renders the Build Atlas;
 * flag on renders the retained Board. Both surfaces are mocked to their cold-cache
 * loading state, so the distinct loading copy identifies which one rendered
 * without needing a live bridge.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UseBuildAtlasResult } from "../../src/ui/hooks/useBuildAtlas.js";
import type { UseBoardResult } from "../../src/ui/hooks/useBoard.js";

vi.mock("../../src/ui/hooks/useMediaQuery.js", () => ({ useIsMobile: () => false }));
vi.mock("../../src/ui/hooks/useNow.js", () => ({ useNow: () => Date.parse("2026-06-23T12:00:00.000Z") }));
vi.mock("../../src/ui/hooks/useBuildAtlas.js", () => ({
  useBuildAtlas: (): UseBuildAtlasResult => ({ buildAtlas: null, loading: true, error: null, refresh: () => {} }),
}));
vi.mock("../../src/ui/hooks/useBoard.js", () => ({
  useBoard: (): UseBoardResult => ({ board: null, loading: true, error: null, refresh: () => {} }),
}));
vi.mock("@paperclipai/plugin-sdk/ui", () => ({
  usePluginAction: () => async () => ({}),
  usePluginData: () => ({ data: null, loading: false, error: null, refresh: () => {} }),
}));

// Imported AFTER the mocks so both surfaces bind the mocked hooks.
import { WorkSurface } from "../../src/ui/work-surface.js";
import { COS_ATLAS_FALLBACK } from "../../src/ui/atlas-fallback.js";

describe("WorkSurface — Atlas/Board kill-switch", () => {
  it("ships with the fallback OFF (Atlas is the primary surface)", () => {
    expect(COS_ATLAS_FALLBACK).toBe(false);
  });

  it("renders the Build Atlas when the flag is off", () => {
    const html = renderToStaticMarkup(<WorkSurface companyId="c1" fallback={false} />);
    expect(html).toContain("Loading the Build Atlas");
    expect(html).not.toContain("Loading the board");
  });

  it("renders the retained Board when the flag is on (one-flip kill-switch, no revert)", () => {
    const html = renderToStaticMarkup(<WorkSurface companyId="c1" fallback={true} />);
    expect(html).toContain("Loading the board");
    expect(html).not.toContain("Loading the Build Atlas");
  });

  it("defaults to the module-level flag when no prop is passed", () => {
    const html = renderToStaticMarkup(<WorkSurface companyId="c1" />);
    // COS_ATLAS_FALLBACK is false → the Atlas renders.
    expect(html).toContain("Loading the Build Atlas");
  });
});
