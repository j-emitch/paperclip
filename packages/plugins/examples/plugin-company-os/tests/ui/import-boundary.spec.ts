/**
 * Import-boundary guard (COS-0e), AST-based so it can't be fooled by `../` depth,
 * mixed type/value named imports, or dynamic `import()`. The browser UI bundle
 * (`src/ui/**`) may import ONLY:
 *   - bare: `react`, `react/jsx-runtime`, `react-dom` (+ subpaths), `@paperclipai/plugin-sdk/ui`
 *   - type-only from the contract surface (`src/contracts/**`) — NEVER a value import
 *     (a value import would drag zod + the SDK main entry into the browser bundle)
 *   - other `src/ui/**` modules
 * Anything else — the SDK main entry, node builtins, arbitrary packages, the
 * worker-side pipeline (sources/projections/db/derive/runtime/worker/collect),
 * or a value/dynamic import of contracts — is a violation.
 */

import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../..");
const srcRoot = join(pkgRoot, "src");
const uiRoot = join(srcRoot, "ui");
const contractsRoot = join(srcRoot, "contracts");
// The plugin manifest module holds browser-safe route/id constants the page links to
// (COMPANY_OS_ROUTE). It pulls no worker/node code (proven by the UI bundle build).
const manifestFile = join(srcRoot, "manifest");

/** Bare specifiers the UI bundle is allowed to import (exact or `<pkg>/...` subpath). */
const ALLOWED_BARE = ["react", "react-dom", "@paperclipai/plugin-sdk/ui"];

function isAllowedBare(spec: string): boolean {
  return ALLOWED_BARE.some((pkg) => spec === pkg || spec.startsWith(pkg + "/"));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

function resolveRel(fromFile: string, spec: string): string {
  return resolve(dirname(fromFile), spec).replace(/\.js$/, "");
}

function underDir(absNoExt: string, dir: string): boolean {
  return absNoExt === dir || absNoExt.startsWith(dir + "/") || absNoExt.startsWith(dir + "\\");
}

interface Violation {
  file: string;
  spec: string;
  why: string;
}

/** Inspect one source file's imports/exports/dynamic-imports against the boundary. */
function violationsIn(file: string): Violation[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = relative(pkgRoot, file);
  const out: Violation[] = [];

  const checkSpec = (spec: string, typeOnly: boolean) => {
    if (spec.startsWith(".")) {
      const abs = resolveRel(file, spec);
      if (underDir(abs, uiRoot)) return; // sibling UI module — fine
      if (abs === manifestFile) return; // browser-safe route/id constants
      if (underDir(abs, contractsRoot)) {
        if (!typeOnly) out.push({ file: rel, spec, why: "value import from the contract surface (must be `import type`)" });
        return;
      }
      out.push({ file: rel, spec, why: "relative import escapes src/ui and the contract surface (worker-side code)" });
      return;
    }
    if (!isAllowedBare(spec)) out.push({ file: rel, spec, why: "bare specifier not on the UI allowlist" });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      // type-only iff the whole clause is `import type`, OR every named binding is `type`-qualified
      // AND there is no default/namespace value binding.
      let typeOnly = false;
      if (!clause) {
        typeOnly = false; // bare side-effect import is a value import
      } else if (clause.isTypeOnly) {
        typeOnly = true;
      } else if (!clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        typeOnly = clause.namedBindings.elements.every((e) => e.isTypeOnly);
      }
      checkSpec(node.moduleSpecifier.text, typeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      checkSpec(node.moduleSpecifier.text, node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      const spec = arg && ts.isStringLiteral(arg) ? arg.text : "<dynamic>";
      out.push({ file: rel, spec, why: "dynamic import() is not allowed in the UI bundle" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("UI import boundary (AST)", () => {
  const files = walk(uiRoot);

  it("finds the UI source tree", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no src/ui/** module imports outside the allowed surface", () => {
    const violations = files.flatMap(violationsIn);
    const report = violations.map((v) => `${v.file} → "${v.spec}" (${v.why})`).join("\n");
    expect(violations, `forbidden UI imports:\n${report}`).toEqual([]);
  });

  it("the SDK is only ever imported via the /ui subpath (never the main entry)", () => {
    const sdk = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => l.includes("@paperclipai/plugin-sdk"))
        .map((l) => l.trim()),
    );
    expect(sdk.length).toBeGreaterThan(0); // sanity: the UI does use the SDK
    expect(sdk.every((l) => l.includes("@paperclipai/plugin-sdk/ui"))).toBe(true);
  });

  it("contract imports in the UI are all type-only (no zod/runtime in the browser bundle)", () => {
    // Spot-prove the rule has teeth: useBoard imports BoardStateV1 as a type.
    const useBoard = readFileSync(join(uiRoot, "hooks", "useBoard.ts"), "utf8");
    expect(useBoard).toMatch(/import type\b[^;]*BoardStateV1[^;]*from\s*["'][^"']*contracts/);
  });
});
