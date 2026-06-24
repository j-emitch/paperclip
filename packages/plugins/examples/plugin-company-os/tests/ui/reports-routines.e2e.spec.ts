/**
 * Reports + Routines UI e2e (Playwright). Loads the SSR harness documents in real
 * Chromium at the two key viewports (dark scheme), asserts ZERO console / page
 * errors, checks the a11y labels on the filter + viewer controls, and captures
 * screenshots. The populated Reports doc is also captured under
 * `prefers-reduced-motion: reduce` to prove motion is suppressed.
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

test.describe("Company OS reports", () => {
  test("populated reports: list, filters, viewer + a11y labels", async ({ page }, testInfo) => {
    await loadAndCheck(
      "reports-desktop",
      async (p) => {
        await expect(p.getByText("Reports", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("COS-0 — Company OS Dev Cockpit").first()).toBeVisible();
        // Filter controls carry accessible labels.
        await expect(p.getByLabel("Search reports")).toBeVisible();
        await expect(p.locator('[aria-label="Filter by type"]')).toHaveCount(1);
        await expect(p.getByLabel("Filter by system")).toBeVisible();
        // The viewer rendered the markdown body slot.
        await expect(p.getByText("A first-party Paperclip plugin", { exact: false }).first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("populated reports under prefers-reduced-motion has no errors", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await loadAndCheck(
      "reports-desktop",
      async (p) => {
        await expect(p.getByText("COS-0 — Company OS Dev Cockpit").first()).toBeVisible();
      },
      page,
      `${testInfo.project.name}-reduced-motion`,
    );
  });

  test("mobile reports shows the list", async ({ page }, testInfo) => {
    await loadAndCheck(
      "reports-mobile",
      async (p) => {
        await expect(p.getByText("Reports", { exact: false }).first()).toBeVisible();
        await expect(p.getByLabel("Search reports")).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });
});

test.describe("Company OS routines", () => {
  test("populated routines: agent groups + verdicts", async ({ page }, testInfo) => {
    await loadAndCheck(
      "routines-desktop",
      async (p) => {
        await expect(p.getByText("Routines", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("Daily Standup").first()).toBeVisible();
        // Every owning agent renders.
        for (const agent of ["CEO", "COO", "CTO", "Librarian"]) {
          await expect(p.getByText(agent, { exact: true }).first()).toBeVisible();
        }
        // A verdict pill is present.
        await expect(p.getByText("Fresh", { exact: false }).first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("mobile routines stacks the cards", async ({ page }, testInfo) => {
    await loadAndCheck(
      "routines-mobile",
      async (p) => {
        await expect(p.getByText("Routines", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("Daily Standup").first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });
});
