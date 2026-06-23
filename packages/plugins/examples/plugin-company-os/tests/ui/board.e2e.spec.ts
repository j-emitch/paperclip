/**
 * Board UI e2e (Playwright). For each SSR harness document and each viewport:
 * load it in Chromium, assert ZERO console errors / page errors, assert the
 * a11y labels on icon-only controls are present, and capture a screenshot. The
 * populated board is also captured under `prefers-reduced-motion: reduce` to
 * prove motion is suppressed (verified visually + via the no-error assertion).
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

async function loadAndCheck(name: string, assertions: (page: import("@playwright/test").Page) => Promise<void>, page: import("@playwright/test").Page, project: string) {
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

test.describe("Company OS board", () => {
  test("populated board renders lanes, chips, controls + a11y labels", async ({ page }, testInfo) => {
    await loadAndCheck(
      "populated-desktop",
      async (p) => {
        await expect(p.getByText("Coaching", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("COS-0", { exact: false }).first()).toBeVisible();
        // Icon-only controls carry aria-labels.
        await expect(p.locator('[aria-label$="all lanes"]')).toHaveCount(1);
        await expect(p.locator('[aria-label="Refresh the board"]')).toHaveCount(1);
        await expect(p.locator('[aria-label*="generic prefix"]').first()).toBeAttached();
        // The cross-repo badge surfaced.
        await expect(p.getByText("arc-scraper").first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("populated board under prefers-reduced-motion has no errors + still renders", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await loadAndCheck(
      "populated-desktop",
      async (p) => {
        await expect(p.getByText("COS-0", { exact: false }).first()).toBeVisible();
      },
      page,
      `${testInfo.project.name}-reduced-motion`,
    );
  });

  test("populated mobile board stacks columns", async ({ page }, testInfo) => {
    await loadAndCheck(
      "populated-mobile",
      async (p) => {
        await expect(p.getByText("Next up", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("MTP-04").first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("stale board shows the stale freshness badge", async ({ page }, testInfo) => {
    await loadAndCheck(
      "stale",
      async (p) => {
        await expect(p.locator('[aria-label^="Board is stale"]')).toBeAttached();
      },
      page,
      testInfo.project.name,
    );
  });

  test("empty board explains the auto-fill + offers a derive", async ({ page }, testInfo) => {
    await loadAndCheck(
      "empty",
      async (p) => {
        await expect(p.getByText("No work on the board yet")).toBeVisible();
        await expect(p.getByText("Derive now")).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("loading state has a labelled spinner", async ({ page }, testInfo) => {
    await loadAndCheck(
      "loading",
      async (p) => {
        await expect(p.locator('[aria-label="Loading"]')).toBeAttached();
      },
      page,
      testInfo.project.name,
    );
  });

  test("error state shows the message + retry", async ({ page }, testInfo) => {
    await loadAndCheck(
      "error",
      async (p) => {
        await expect(p.getByText("Couldn’t reach the worker")).toBeVisible();
        await expect(p.getByText("Try again")).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });
});
