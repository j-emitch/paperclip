/**
 * Emits the SSR harness documents to `tests/ui/.artifacts/` (gitignored) so the
 * Playwright e2e can load each board state in a real browser. Also acts as a
 * smoke test that every harness document renders to substantial markup without
 * throwing.
 */

import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { harnessDocs } from "./render-doc.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ARTIFACT_DIR = join(here, "..", ".artifacts");

describe("harness artifact emit", () => {
  it("renders + writes every board-state document", () => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const docs = harnessDocs();
    expect(docs.length).toBeGreaterThanOrEqual(6);
    for (const doc of docs) {
      expect(doc.html.length).toBeGreaterThan(400);
      expect(doc.html).toContain("<!doctype html>");
      writeFileSync(join(ARTIFACT_DIR, `${doc.name}.html`), doc.html, "utf8");
    }
  });
});
