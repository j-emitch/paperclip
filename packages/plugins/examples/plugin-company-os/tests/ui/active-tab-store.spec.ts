/**
 * `active-tab-store` persistence + legacy normalization (COS-1h, hardened per the
 * marathon-end review). The store is hydration-safe: it does NOT read storage at
 * import/render scope (server render + first client render both start at Home);
 * the persisted tab is adopted once, client-side, via `hydratePersistedTab`. Each
 * case re-imports the module fresh (`vi.resetModules`) against a stubbed storage.
 * We never render — only call the store fns — so there's no React instance to
 * duplicate; the active value is observed through the store's own
 * early-return-on-no-change contract: setting the tab it already holds must NOT
 * write, and a real change persists.
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
  it("does NOT read storage at import — starts at Home even with a persisted value", async () => {
    const storage = makeFakeStorage({ [KEY]: "source" });
    const { setActiveTab } = await loadStore(storage);
    expect(storage.getItem).not.toHaveBeenCalled(); // SSR/hydration-safe: no import-time read
    setActiveTab("home"); // still Home -> no-op, proving the pre-hydration value
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("hydratePersistedTab adopts a persisted valid key", async () => {
    const storage = makeFakeStorage({ [KEY]: "source" });
    const { setActiveTab, hydratePersistedTab } = await loadStore(storage);
    hydratePersistedTab();
    expect(storage.setItem).toHaveBeenCalledWith(KEY, "source"); // adopted
    setActiveTab("source"); // already source -> no further write
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("hydratePersistedTab normalizes a legacy `reports` key forward to `docs`", async () => {
    const storage = makeFakeStorage({ [KEY]: "reports" });
    const { hydratePersistedTab } = await loadStore(storage);
    hydratePersistedTab();
    expect(storage.setItem).toHaveBeenCalledWith(KEY, "docs");
  });

  it("hydratePersistedTab falls back to Home for an unknown persisted key", async () => {
    const storage = makeFakeStorage({ [KEY]: "totally-bogus" });
    const { setActiveTab, hydratePersistedTab } = await loadStore(storage);
    hydratePersistedTab(); // unknown -> home; home is already active -> no write
    expect(storage.setItem).not.toHaveBeenCalled();
    setActiveTab("home");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("hydratePersistedTab runs only once (idempotent)", async () => {
    const storage = makeFakeStorage({ [KEY]: "source" });
    const { hydratePersistedTab } = await loadStore(storage);
    hydratePersistedTab();
    storage.getItem.mockClear();
    hydratePersistedTab(); // second call is a no-op
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("persists a tab change to localStorage", async () => {
    const storage = makeFakeStorage();
    const { setActiveTab } = await loadStore(storage);
    setActiveTab("skills");
    expect(storage.setItem).toHaveBeenCalledWith(KEY, "skills");
  });

  it("is SSR-safe: no `localStorage` degrades to Home without throwing", async () => {
    const mod = await loadStore(undefined);
    expect(() => mod.hydratePersistedTab()).not.toThrow();
    expect(() => mod.setActiveTab("source")).not.toThrow();
  });

  it("survives a throwing storage (sandboxed iframe / private mode) by degrading to Home", async () => {
    const storage = makeFakeStorage();
    storage.getItem.mockImplementation(() => {
      throw new Error("SecurityError: storage access denied");
    });
    const { hydratePersistedTab, setActiveTab } = await loadStore(storage);
    expect(() => hydratePersistedTab()).not.toThrow(); // read throw caught -> Home
    expect(() => setActiveTab("home")).not.toThrow();
  });
});
