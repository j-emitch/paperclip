/**
 * Teaching tab UI e2e (Playwright), COS-2f. For each SSR harness document + each
 * viewport: load it in Chromium, assert ZERO console/page errors, assert the key
 * content + a11y group labels, and screenshot. The stalled-loop board is also
 * loaded under `prefers-reduced-motion: reduce` to prove the critical-pulse is
 * suppressed. No running host — the view renders from inline styles + scoped CSS.
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

test.describe("Company OS teaching tab", () => {
  test("stalled loop shows the critical headline, backlog, and the corpus + a11y filters", async ({ page }, testInfo) => {
    await loadAndCheck(
      "teaching-desktop",
      async (p) => {
        await expect(p.getByText("Loop stalled")).toBeVisible();
        await expect(p.getByText("199", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("Codex agentic invocation").first()).toBeVisible();
        await expect(p.getByText("Backlog", { exact: false }).first()).toBeVisible();
        await expect(p.getByText("Synthesis", { exact: false }).first()).toBeVisible();
        // faceted filter groups are labelled
        await expect(p.locator('[aria-label="Filter by audience"]')).toHaveCount(1);
        await expect(p.locator('[aria-label="Filter by publish state"]')).toHaveCount(1);
      },
      page,
      testInfo.project.name,
    );
  });

  test("stalled loop under prefers-reduced-motion has no errors + still renders", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await loadAndCheck(
      "teaching-desktop",
      async (p) => {
        await expect(p.getByText("Loop stalled")).toBeVisible();
      },
      page,
      `${testInfo.project.name}-reduced-motion`,
    );
  });

  test("mobile stacks the loop cards + corpus", async ({ page }, testInfo) => {
    await loadAndCheck(
      "teaching-mobile",
      async (p) => {
        await expect(p.getByText("Teaching").first()).toBeVisible();
        await expect(p.getByText("Codex agentic invocation").first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("healthy loop reads as OK + caught up", async ({ page }, testInfo) => {
    await loadAndCheck(
      "teaching-healthy",
      async (p) => {
        await expect(p.getByText("Loop healthy")).toBeVisible();
        await expect(p.getByText("All caught up")).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });
});
