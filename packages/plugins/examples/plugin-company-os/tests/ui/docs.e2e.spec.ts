/**
 * Docs (project → type → doc tree) UI e2e (Playwright). For each SSR harness
 * document and each viewport: load it in real Chromium, assert ZERO console
 * errors / page errors, assert the tree + a11y + the Dogfood-#2 render, and
 * capture a screenshot. The populated tree is also captured under
 * `prefers-reduced-motion: reduce`. Self-contained — no running host, no auth,
 * no live derive.
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

test.describe("Company OS docs", () => {
  test("populated docs renders the project → type → doc tree + the dogfood spec", async ({ page }, testInfo) => {
    await loadAndCheck(
      "docs-desktop",
      async (p) => {
        await expect(p.getByText("Docs").first()).toBeVisible();
        await expect(p.getByText("Company").first()).toBeVisible();
        await expect(p.getByText("Specs").first()).toBeVisible();
        await expect(p.getByText("Plans").first()).toBeVisible();
        // Dogfood-#2: this COS-1 spec, surfaced from its worktree, in place.
        await expect(p.getByText("COS-1 — Orientation Home").first()).toBeVisible();
        await expect(p.getByText("worktree: cos-COS-1 @ docs/COS-1").first()).toBeVisible();
        // Doc rows are buttons.
        await expect(p.locator('button[title="COS-1 — Orientation Home"]')).toBeAttached();
      },
      page,
      testInfo.project.name,
    );
  });

  test("an open doc shows the index-derived type pill + the rendered body", async ({ page }, testInfo) => {
    await loadAndCheck(
      "docs-selected",
      async (p) => {
        await expect(p.getByText("A first-party Paperclip plugin", { exact: false }).first()).toBeVisible(); // markdown body
        await expect(p.locator('[aria-current="true"]').first()).toBeAttached(); // selected row
      },
      page,
      testInfo.project.name,
    );
  });

  test("populated docs under prefers-reduced-motion has no errors + still renders", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await loadAndCheck(
      "docs-desktop",
      async (p) => {
        await expect(p.getByText("Docs").first()).toBeVisible();
      },
      page,
      `${testInfo.project.name}-reduced-motion`,
    );
  });

  test("mobile docs stacks the tree", async ({ page }, testInfo) => {
    await loadAndCheck(
      "docs-mobile",
      async (p) => {
        await expect(p.getByText("COS-1 — Orientation Home").first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("empty docs explains the index-on-derive path", async ({ page }, testInfo) => {
    await loadAndCheck(
      "docs-empty",
      async (p) => {
        await expect(p.getByText("No documents indexed yet", { exact: false })).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });
});
