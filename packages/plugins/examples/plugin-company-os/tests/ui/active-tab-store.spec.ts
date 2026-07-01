/**
 * `active-tab-store` persistence + legacy normalization (COS-1h). The store reads
 * its initial tab from `localStorage` at module-init, so each case re-imports the
 * module fresh (`vi.resetModules`) against a stubbed storage. We never render —
 * only call `setActiveTab` — so there's no React instance to duplicate; the
 * initial value is observed through the store's own early-return-on-no-change
 * contract: setting the tab it already holds must NOT write.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "cos.activeTab";

function makeFakeStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: vi.fn((k: string): string | null => (map.has(k) ? (map.get(k) as string) : null)),
    setItem: vi.fn((k: string, v: string): void => {
      map.set(k, v);
    }),
    removeItem: vi.fn((k: string): void => {
      map.delete(k);
    }),
    clear: vi.fn((): void => map.clear()),
  };
}

async function loadStore(storage: unknown) {
  vi.resetModules();
  vi.stubGlobal("localStorage", storage);
  return import("../../src/ui/active-tab-store.js");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("active-tab-store persistence", () => {
  it("defaults to Home when nothing is persisted", async () => {
    const storage = makeFakeStorage();
    const { setActiveTab } = await loadStore(storage);
    setActiveTab("home"); // already Home -> no-op, proving the initial value
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("normalizes a persisted legacy `reports` key forward to `docs` on load", async () => {
    const storage = makeFakeStorage({ [KEY]: "reports" });
    const { setActiveTab } = await loadStore(storage);
    setActiveTab("docs"); // initial normalized reports->docs -> no-op
    expect(storage.setItem).not.toHaveBeenCalled();
    setActiveTab("board"); // now a real change
    expect(storage.setItem).toHaveBeenCalledWith(KEY, "board");
  });

  it("loads a persisted valid key as-is", async () => {
    const storage = makeFakeStorage({ [KEY]: "source" });
    const { setActiveTab } = await loadStore(storage);
    setActiveTab("source"); // already source -> no-op
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("falls back to Home for an unknown persisted key", async () => {
    const storage = makeFakeStorage({ [KEY]: "totally-bogus" });
    const { setActiveTab } = await loadStore(storage);
    setActiveTab("home"); // unknown normalized to home -> no-op
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("persists a tab change to localStorage", async () => {
    const storage = makeFakeStorage();
    const { setActiveTab } = await loadStore(storage);
    setActiveTab("skills");
    expect(storage.setItem).toHaveBeenCalledWith(KEY, "skills");
  });

  it("is SSR-safe: no `localStorage` degrades to Home without throwing", async () => {
    const mod = await loadStore(undefined);
    expect(() => mod.setActiveTab("source")).not.toThrow();
  });

  it("survives a throwing storage (privacy mode) by degrading to Home", async () => {
    const storage = makeFakeStorage();
    storage.getItem.mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    const { setActiveTab } = await loadStore(storage);
    // init caught the throw -> Home; setting Home is a no-op, and setItem (also
    // guarded) never throws even if it were to reject.
    expect(() => setActiveTab("home")).not.toThrow();
  });
});
