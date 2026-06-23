/**
 * Playwright global setup — regenerates the SSR harness artifacts via vitest
 * (which resolves the source's NodeNext `.js` import specifiers correctly) right
 * before the e2e run, so the screenshots always reflect the current components.
 * Pure node:child_process here — no React import — so this file needs no JSX
 * transform of its own.
 */

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default function globalSetup(): void {
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  execFileSync("pnpm", ["vitest", "run", "--config", "./vitest.config.ts", "tests/ui/harness/emit-artifacts.spec.ts"], {
    cwd: pkgRoot,
    stdio: "inherit",
  });
}
