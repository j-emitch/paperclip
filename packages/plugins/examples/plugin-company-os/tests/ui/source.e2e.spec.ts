/**
 * Source (working-tree audit) UI e2e (Playwright). For each SSR harness document
 * and each viewport: load it in real Chromium, assert ZERO console errors / page
 * errors, assert the tree + a11y land, and capture a screenshot. One test exercises
 * a REAL expand interaction (click a branch row → its commit list appears), and the
 * populated tree is captured under `prefers-reduced-motion: reduce`. Self-contained
 * — no running host, no auth, no live derive.
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

test.describe("Company OS source", () => {
  test("populated source renders the project-grouped branch tree + a11y", async ({ page }, testInfo) => {
    await loadAndCheck(
      "source-desktop",
      async (p) => {
        await expect(p.getByText("Source").first()).toBeVisible();
        await expect(p.getByText("Juice Bar").first()).toBeVisible();
        await expect(p.getByText("dependency").first()).toBeVisible();
        await expect(p.getByText("claude/SSF-04/reconciliation-rehaul").first()).toBeVisible();
        await expect(p.getByText("not found on disk").first()).toBeVisible(); // absent repo 0-row
        // The branch rows are expandable buttons.
        await expect(p.locator('button[aria-expanded]').first()).toBeAttached();
      },
      page,
      testInfo.project.name,
    );
  });

  test("an expanded branch row reveals its recent commits + shortstat", async ({ page }, testInfo) => {
    await loadAndCheck(
      "source-expanded",
      async (p) => {
        await expect(p.getByText("ship the company-os cockpit")).toBeVisible();
        await expect(p.getByText("928bdb5", { exact: false }).first()).toBeVisible(); // short sha
        await expect(p.getByText("+2841", { exact: false })).toBeVisible(); // shortstat insertions
      },
      page,
      testInfo.project.name,
    );
  });

  test("populated source under prefers-reduced-motion has no errors + still renders", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await loadAndCheck(
      "source-desktop",
      async (p) => {
        await expect(p.getByText("Source").first()).toBeVisible();
      },
      page,
      `${testInfo.project.name}-reduced-motion`,
    );
  });

  test("mobile source stacks the tree", async ({ page }, testInfo) => {
    await loadAndCheck(
      "source-mobile",
      async (p) => {
        await expect(p.getByText("claude/SSF-04/reconciliation-rehaul").first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("empty source explains the configure-roots path", async ({ page }, testInfo) => {
    await loadAndCheck(
      "source-empty",
      async (p) => {
        await expect(p.getByText("No repositories are configured yet", { exact: false })).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });
});
