/**
 * Branch · PR Health UI e2e (Playwright, COS-5e). For each SSR harness document and
 * each viewport: load it in real Chromium, assert ZERO console errors / page errors,
 * assert the tree + PR lifecycle + review verdicts + attention band land, and capture
 * a screenshot. The populated tree is also captured under
 * `prefers-reduced-motion: reduce`. Self-contained — no running host, no auth, no
 * live derive.
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

test.describe("Company OS Branch · PR Health", () => {
  test("populated tab renders the branch tree, PR lifecycle, verdicts + attention band", async ({ page }, testInfo) => {
    await loadAndCheck(
      "branch-pr-desktop",
      async (p) => {
        await expect(p.getByText("Branch · PR Health").first()).toBeVisible();
        await expect(p.getByText("Juice Bar").first()).toBeVisible();
        await expect(p.getByText("dependency").first()).toBeVisible();
        // The attention band lists the at-risk branch. Assert on the region's text
        // (the long branch name is CSS-ellipsis-truncated + folded into the button's
        // accessible name on narrow viewports, so an element-visibility check is flaky).
        await expect(p.getByRole("region", { name: "Branches needing attention" })).toContainText(
          "claude/SSF-04/reconciliation-rehaul",
        );
        await expect(p.getByText("not found on disk").first()).toBeVisible(); // absent repo 0-row
        // COS-5e: PR lifecycle + review verdict + the two health bands.
        await expect(p.getByText("#372").first()).toBeVisible();
        await expect(p.getByText("no-ship").first()).toBeVisible(); // blocking verdict pill (text, not color-only)
        await expect(p.getByText("Needs attention").first()).toBeVisible();
        await expect(p.getByText("Flagged by review").first()).toBeVisible();
        await expect(p.getByText("PRs without a local branch").first()).toBeVisible(); // orphan PR section
        // The branch rows are expandable buttons.
        await expect(p.locator("button[aria-expanded]").first()).toBeAttached();
      },
      page,
      testInfo.project.name,
    );
  });

  test("an expanded branch row reveals its open PR detail + recent commits", async ({ page }, testInfo) => {
    await loadAndCheck(
      "branch-pr-expanded",
      async (p) => {
        await expect(p.getByText("daily-driver cockpit").first()).toBeVisible(); // PR #361 title
        await expect(p.getByText("#361").first()).toBeVisible();
        await expect(p.getByText("§16 reconciliation", { exact: false }).first()).toBeVisible(); // a commit subject
        await expect(p.getByText("f96d4ce", { exact: false }).first()).toBeVisible(); // short sha
      },
      page,
      testInfo.project.name,
    );
  });

  test("populated tab under prefers-reduced-motion has no errors + still renders", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await loadAndCheck(
      "branch-pr-desktop",
      async (p) => {
        await expect(p.getByText("Branch · PR Health").first()).toBeVisible();
      },
      page,
      `${testInfo.project.name}-reduced-motion`,
    );
  });

  test("mobile tab stacks the tree", async ({ page }, testInfo) => {
    await loadAndCheck(
      "branch-pr-mobile",
      async (p) => {
        await expect(p.getByText("claude/SSF-04/reconciliation-rehaul").first()).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });

  test("empty tab explains the configure-roots path", async ({ page }, testInfo) => {
    await loadAndCheck(
      "branch-pr-empty",
      async (p) => {
        await expect(p.getByText("No repositories are configured yet", { exact: false })).toBeVisible();
      },
      page,
      testInfo.project.name,
    );
  });
});
