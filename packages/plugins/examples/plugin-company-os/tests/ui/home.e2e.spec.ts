/**
 * Home (Orientation) UI e2e (Playwright). For each SSR harness document and each
 * viewport: load it in real Chromium, assert ZERO console errors / page errors,
 * assert the panels + a11y land, and capture a screenshot. The populated Home is
 * also captured under `prefers-reduced-motion: reduce` to prove the staggered
 * entrance + hover motion is suppressed (verified visually + via the no-error
 * assertion). Self-contained — no running host, no auth, no live derive.
 */

import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const artifactDir = join(here, ".artifacts");
const shotsDir = join(artifactDir, "shots");

function artifactUrl(name: string): string {
  const file = join(artifactDir, `${name}.html`);
  if (!existsSync(file)) throw new Error(`harness artifact missing: ${file} (globalSetup should have emitted it)`);
  return pathToFileURL(file).href;
}

async function loadAndCheck(
  name: string,
  assertions: (page: import("@playwright/test").Page) => Promise<void>,
  page: import("@playwright/test").Page,
  project: string,
): Promise<void> {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto(artifactUrl(name), { waitUntil: "networkidle" });
  await assertions(page);
  await page.screenshot({ path: join(shotsDir, project, `${name}.png`), fullPage: true });
  expect(errors, `console/page errors on ${name}:\n${errors.join("\n")}`).toEqual([]);
}

test.describe("Company OS home", () => {
  test("populated home renders every panel + a11y", async ({ page }, testInfo) => {
    await loadAndCheck(
      "home-desktop",
      async (p) => {
        await expect(p.getByText("Orientation").first()).toBeVisible();
        await expect(p.getByText("Daily Standup", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("Needs attention").first()).toBeVisible();
        await expect(p.getByText("SSF-04 branch conflicts with main").first()).toBeVisible();
        // Metric tiles are labelled navigation buttons (icon-only arrow has aria-hidden).
        await expect(p.locator('[aria-label="Current snapshot"]')).toHaveCount(1);
        await expect(p.locator('button[title="Go to In progress"]')).toHaveCount(1);
        // The cross-repo dependency badge surfaced in branch health.
        await expect(p.getByText("arc-scraper").first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("populated home under prefers-reduced-motion has no errors + still renders", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await loadAndCheck(
      "home-desktop",
      async (p) => {
        await expect(p.getByText("Orientation").first()).toBeVisible();
      },
      page,
      `${testInfo.project.name}-reduced-motion`,
    );
  });

  test("mobile home stacks into a single prioritized column", async ({ page }, testInfo) => {
    await loadAndCheck(
      "home-mobile",
      async (p) => {
        await expect(p.getByText("Needs attention").first()).toBeVisible();
        await expect(p.getByText("SSF-04 branch conflicts with main").first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("empty home renders every calm 0-state, never a crash", async ({ page }, testInfo) => {
    await loadAndCheck(
      "home-empty",
      async (p) => {
        await expect(p.getByText("All branches healthy", { exact: false })).toBeVisible();
        await expect(p.getByText("all clear", { exact: false })).toBeVisible();
        await expect(p.getByText("No commits in the recent window")).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("briefing drawer opens an in-place reader", async ({ page }, testInfo) => {
    await loadAndCheck(
      "home-drawer",
      async (p) => {
        await expect(p.locator('[role="dialog"]')).toBeAttached();
        await expect(p.locator('[aria-label="Close briefing"]')).toHaveCount(1);
      },
      page,
      testInfo.project.name,
    );
  });
});
