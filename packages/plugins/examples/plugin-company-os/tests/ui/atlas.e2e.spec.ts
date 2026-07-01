/**
 * Build Atlas UI e2e (Playwright) — Board-parity depth for the surface that
 * replaces it. For each SSR harness document and each viewport: load it in
 * Chromium, assert ZERO console/page errors, assert the a11y labels on the
 * icon-only controls + focusable lineage nodes, and capture a screenshot. The
 * populated atlas is also captured under `prefers-reduced-motion: reduce` to prove
 * motion is suppressed, and mobile to prove the grid reflows.
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

test.describe("Company OS Build Atlas", () => {
  test("populated atlas renders masthead, legend, families, lineage + a11y controls", async ({ page }, testInfo) => {
    await loadAndCheck(
      "atlas-desktop",
      async (p) => {
        await expect(p.getByText("Build Atlas").first()).toBeVisible();
        await expect(p.getByText("Company OS", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("Spec → Plan → Build → Prod").first()).toBeVisible();
        await expect(p.getByText("Value Chain").first()).toBeVisible();
        await expect(p.getByText("Second Brain").first()).toBeVisible();
        // Icon-only control carries an aria-label.
        await expect(p.locator('[aria-label="Refresh the atlas"]')).toHaveCount(1);
        // The generic-prefix anti-pattern marker + a focusable lineage node.
        await expect(p.locator('[aria-label*="generic prefix"]').first()).toBeAttached();
        await expect(p.locator('[aria-label*="pseudo-sink"]').first()).toBeAttached();
      },
      page,
      testInfo.project.name,
    );
  });

  test("populated atlas under prefers-reduced-motion has no errors + still renders", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await loadAndCheck(
      "atlas-desktop",
      async (p) => {
        await expect(p.getByText("Company OS", { exact: false }).first()).toBeVisible();
      },
      page,
      `${testInfo.project.name}-reduced-motion`,
    );
  });

  test("populated mobile atlas reflows to a single column", async ({ page }, testInfo) => {
    await loadAndCheck(
      "atlas-mobile",
      async (p) => {
        await expect(p.getByText("Build Atlas").first()).toBeVisible();
        await expect(p.getByText("Company OS", { exact: false }).first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("stale atlas shows the stale freshness badge", async ({ page }, testInfo) => {
    await loadAndCheck(
      "atlas-stale",
      async (p) => {
        await expect(p.locator('[aria-label^="Atlas is stale"]')).toBeAttached();
      },
      page,
      testInfo.project.name,
    );
  });

  test("empty atlas explains the auto-fill + offers a derive", async ({ page }, testInfo) => {
    await loadAndCheck(
      "atlas-empty",
      async (p) => {
        await expect(p.getByText("No atlas yet")).toBeVisible();
        await expect(p.getByText("Refresh")).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("expanded family reveals its builds, tickets, and lineage tags", async ({ page }, testInfo) => {
    await loadAndCheck(
      "atlas-expanded",
      async (p) => {
        await expect(p.getByText("Builds").first()).toBeVisible();
        await expect(p.getByText("COS-0").first()).toBeVisible();
        await expect(p.getByText("Tickets").first()).toBeVisible();
        await expect(p.getByText("LYC-100").first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });
});
