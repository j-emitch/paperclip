/**
 * Import-boundary guard (COS-0e): `src/ui/**` may import contract TYPES, the SDK
 * UI subpath, React, and its own UI modules — and NOTHING else. It must never
 * reach the worker-side pipeline (sources / collect / projections / db / derive /
 * runtime / worker) or Node builtins, because the UI bundle ships to the browser.
 * Each forbidden relative import is resolved to an absolute path and checked
 * against the worker-only roots, so the test can't be fooled by `../` depth.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../..");
const srcRoot = join(pkgRoot, "src");
const uiRoot = join(srcRoot, "ui");

/** Worker-only roots the UI must never import (resolved-path prefixes under src/). */
const FORBIDDEN_SRC_ROOTS = [
  join(srcRoot, "sources"),
  join(srcRoot, "projections"),
  join(srcRoot, "db"),
  join(srcRoot, "runtime"),
  join(srcRoot, "collect.ts"),
  join(srcRoot, "collect-and-project.ts"),
  join(srcRoot, "derive.ts"),
  join(srcRoot, "worker.ts"),
];

/** Bare specifiers the UI must never import. */
const FORBIDDEN_BARE = [
  /^node:/,
  /^(fs|path|child_process|crypto|os|http|https|net|stream)$/,
  // The SDK main entry pulls Node (dev-server/testing); the UI uses the /ui subpath only.
  /^@paperclipai\/plugin-sdk$/,
  /^@paperclipai\/plugin-sdk\/(bundlers|testing|dev-server)$/,
];

const IMPORT_RE = /(?:import|export)\b[^'"`]*?from\s*["'`]([^"'`]+)["'`]|import\s*["'`]([^"'`]+)["'`]/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

function specifiersOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

/** Resolve a relative specifier (with the build's `.js` suffix) to its src `.ts(x)` path. */
function resolveRelative(fromFile: string, spec: string): string {
  const base = resolve(dirname(fromFile), spec);
  return base.replace(/\.js$/, "");
}

function hitsForbiddenRoot(resolvedNoExt: string): boolean {
  return FORBIDDEN_SRC_ROOTS.some((root) => {
    const rootNoExt = root.replace(/\.ts$/, "");
    return resolvedNoExt === rootNoExt || resolvedNoExt.startsWith(rootNoExt + "/") || resolvedNoExt.startsWith(rootNoExt + "\\");
  });
}

describe("UI import boundary", () => {
  const files = walk(uiRoot);

  it("finds the UI source tree", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it("no src/ui/** module imports worker-side code or Node builtins", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const spec of specifiersOf(file)) {
        const rel = relative(pkgRoot, file);
        if (spec.startsWith(".")) {
          if (hitsForbiddenRoot(resolveRelative(file, spec))) {
            violations.push(`${rel} → ${spec}`);
          }
        } else if (FORBIDDEN_BARE.some((re) => re.test(spec))) {
          violations.push(`${rel} → ${spec}`);
        }
      }
    }
    expect(violations, `forbidden UI imports:\n${violations.join("\n")}`).toEqual([]);
  });

  it("the SDK is only ever imported via the /ui subpath", () => {
    const sdkImports = files.flatMap((f) => specifiersOf(f).filter((s) => s.includes("@paperclipai/plugin-sdk")));
    expect(sdkImports.length).toBeGreaterThan(0); // sanity: the UI does use the SDK
    expect(sdkImports.every((s) => s === "@paperclipai/plugin-sdk/ui")).toBe(true);
  });
});
