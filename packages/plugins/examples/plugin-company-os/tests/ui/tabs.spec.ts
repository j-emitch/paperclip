/**
 * Tab taxonomy + `normalizeTabKey` guards (COS-1h IA reorg). These pin the
 * reorg so it can't silently regress: Home is the default landing, the old
 * `reports` key is fully gone (renamed to `docs`), the display order is the
 * live-surfaces-then-placeholders flow, the icon map stays 1:1 with the tab
 * list, and any legacy/unknown persisted key resolves forward instead of onto a
 * dead tab.
 */

import { describe, expect, it } from "vitest";
import {
  COMPANY_OS_TABS,
  DEFAULT_TAB_KEY,
  isCompanyOsTabKey,
  normalizeTabKey,
  type CompanyOsTabKey,
} from "../../src/ui/tabs.js";
import { TAB_ICONS } from "../../src/ui/icons.js";

const EXPECTED_ORDER: readonly CompanyOsTabKey[] = [
  "home",
  "atlas",
  "source",
  "docs",
  "agents",
  "skills",
  "teaching",
  "knowledge",
  "hygiene",
];

describe("tab taxonomy", () => {
  it("lands on Home by default (COS-1h)", () => {
    expect(DEFAULT_TAB_KEY).toBe("home");
    expect(isCompanyOsTabKey(DEFAULT_TAB_KEY)).toBe(true);
  });

  it("renders in the reordered daily-driver flow", () => {
    expect(COMPANY_OS_TABS.map((t) => t.key)).toEqual(EXPECTED_ORDER);
  });

  it("has fully retired the `reports` key in favour of `docs`", () => {
    const keys = COMPANY_OS_TABS.map((t) => t.key);
    expect(keys).not.toContain("reports" as CompanyOsTabKey);
    expect(keys).toContain("docs");
    const docs = COMPANY_OS_TABS.find((t) => t.key === "docs");
    expect(docs?.label).toBe("Docs");
    expect(isCompanyOsTabKey("reports")).toBe(false);
  });

  it("has fully retired the `routines` key in favour of `agents` (COS-1R)", () => {
    const keys = COMPANY_OS_TABS.map((t) => t.key);
    expect(keys).not.toContain("routines" as CompanyOsTabKey);
    expect(keys).toContain("agents");
    const agents = COMPANY_OS_TABS.find((t) => t.key === "agents");
    expect(agents?.label).toBe("Agents");
    expect(isCompanyOsTabKey("routines")).toBe(false);
  });

  it("has fully retired the `board` key in favour of `atlas` (COS-5d)", () => {
    const keys = COMPANY_OS_TABS.map((t) => t.key);
    expect(keys).not.toContain("board" as CompanyOsTabKey);
    expect(keys).toContain("atlas");
    const atlas = COMPANY_OS_TABS.find((t) => t.key === "atlas");
    expect(atlas?.label).toBe("Atlas");
    expect(atlas?.liveIn).toBe("COS-5d");
    expect(isCompanyOsTabKey("board")).toBe(false);
  });

  it("orders every live surface ahead of every placeholder", () => {
    const firstPlaceholder = COMPANY_OS_TABS.findIndex((t) => t.placeholder);
    const lastLive = [...COMPANY_OS_TABS].map((t, i) => ({ t, i })).filter(({ t }) => !t.placeholder).at(-1)?.i ?? -1;
    expect(lastLive).toBeLessThan(firstPlaceholder);
  });

  it("keeps the icon map 1:1 with the tab list (no orphan or missing icon)", () => {
    const tabKeys = [...COMPANY_OS_TABS.map((t) => t.key)].sort();
    const iconKeys = Object.keys(TAB_ICONS).sort();
    expect(iconKeys).toEqual(tabKeys);
    for (const tab of COMPANY_OS_TABS) expect(typeof TAB_ICONS[tab.key]).toBe("function");
  });

  it("gives each tab a non-empty label + description + liveIn", () => {
    for (const tab of COMPANY_OS_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.description.length).toBeGreaterThan(0);
      expect(tab.liveIn).toMatch(/^COS-\d/);
    }
  });
});

describe("normalizeTabKey", () => {
  it("maps the legacy `reports` key forward to `docs`", () => {
    expect(normalizeTabKey("reports")).toBe("docs");
  });

  it("maps the legacy `routines` key forward to `agents`", () => {
    expect(normalizeTabKey("routines")).toBe("agents");
  });

  it("maps the legacy `board` key forward to `atlas` (COS-5d)", () => {
    expect(normalizeTabKey("board")).toBe("atlas");
  });

  it("passes every current tab key through unchanged", () => {
    for (const key of EXPECTED_ORDER) expect(normalizeTabKey(key)).toBe(key);
  });

  it("falls back to the default landing tab for anything unrecognized", () => {
    for (const bogus of ["", "nope", "REPORTS", "doc", "Home", "  ", "board "]) {
      expect(normalizeTabKey(bogus)).toBe(DEFAULT_TAB_KEY);
    }
  });
});
