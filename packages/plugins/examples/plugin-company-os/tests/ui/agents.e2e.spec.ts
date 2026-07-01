/**
 * Agents cockpit e2e (Playwright). Loads the SSR harness documents in real
 * Chromium at the two key viewports (dark scheme), asserts ZERO console / page
 * errors, checks the constellation a11y label + the roster / coordination /
 * diagnostics regions, and captures screenshots. The populated doc is also
 * captured under `prefers-reduced-motion: reduce` to prove the heartbeat pulse +
 * entrance motion are suppressed.
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
) {
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

test.describe("Company OS agents cockpit", () => {
  test("populated: masthead, constellation, roster, coordination, diagnostics", async ({ page }, testInfo) => {
    await loadAndCheck(
      "agents-desktop",
      async (p) => {
        await expect(p.getByText("Agents", { exact: true }).first()).toBeVisible();
        // The org constellation renders as a labelled SVG.
        await expect(p.locator('[aria-label*="org constellation"]')).toHaveCount(1);
        // Every agent renders in the roster.
        for (const agent of ["CEO", "COO", "CTO", "Librarian"]) {
          await expect(p.getByText(agent, { exact: true }).first()).toBeVisible();
        }
        // Health rollups across the four states.
        await expect(p.getByText("Fresh", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("Missing", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("Stale", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("Duties only", { exact: false }).first()).toBeVisible();
        // Identity chips + coordination + diagnostics.
        await expect(p.getByText("creates agents", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("company/docs", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("Diagnostics", { exact: true }).first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("populated under prefers-reduced-motion has no errors", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await loadAndCheck(
      "agents-desktop",
      async (p) => {
        await expect(p.getByText("Agents", { exact: true }).first()).toBeVisible();
        await expect(p.locator('[aria-label*="org constellation"]')).toHaveCount(1);
      },
      page,
      `${testInfo.project.name}-reduced-motion`,
    );
  });

  test("mobile: cockpit reflows and the roster stacks", async ({ page }, testInfo) => {
    await loadAndCheck(
      "agents-mobile",
      async (p) => {
        await expect(p.getByText("Agents", { exact: true }).first()).toBeVisible();
        await expect(p.getByText("CEO", { exact: true }).first()).toBeVisible();
        await expect(p.getByText("Librarian", { exact: true }).first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("selected agent focuses the constellation", async ({ page }, testInfo) => {
    await loadAndCheck(
      "agents-selected",
      async (p) => {
        await expect(p.locator('[data-selected-agent="cto"]')).toHaveCount(1);
      },
      page,
      testInfo.project.name,
    );
  });

  test("empty company shows explicit all-clear zero-states", async ({ page }, testInfo) => {
    await loadAndCheck(
      "agents-empty",
      async (p) => {
        await expect(p.getByText("No agents", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("All systems nominal", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("No duty overlaps", { exact: false }).first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });
});
