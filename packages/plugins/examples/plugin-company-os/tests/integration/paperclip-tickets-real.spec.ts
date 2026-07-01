/**
 * Real-file integration (codex-P5): parse a SAMPLE of the ACTUAL exported
 * `reports/paperclip/tickets/*.md` through the real `PaperclipTicketSource` +
 * `makeCollectionContext` fs walker, guarding against exporter↔parser frontmatter
 * drift that the synthetic fixture can't catch. The sample is copied into a
 * throwaway git repo named `company` (the source keys on repo="company"), so the
 * test is path-robust and survives the source branch's worktree being removed.
 *
 * Skips (never fails) when no exported tickets carrying the 5c `origin_kind`
 * frontmatter are found on this machine — the re-export is a local mutation.
 */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { makeCollectionContext } from "../../src/runtime/makeCollectionContext.js";
import { paperclipTicketSource } from "../../src/sources/PaperclipTicketSource.js";
import { isTicketSignal } from "../../src/contracts/signals.js";
import { silentLogger } from "../fixtures/context.js";

const execFileAsync = promisify(execFile);
const REL = "reports/paperclip/tickets";

/** Candidate locations of the re-exported tickets (worktree first, then main). */
const CANDIDATES = [
  path.join(homedir(), "projects/company/.claude/worktrees/cos-COS-5", REL),
  path.join(homedir(), "projects/company", REL),
];

async function findRealTicketsDir(): Promise<string | null> {
  for (const dir of CANDIDATES) {
    if (!existsSync(dir)) continue;
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    for (const f of files.slice(0, 40)) {
      if ((await readFile(path.join(dir, f), "utf-8")).includes("\norigin_kind:")) return dir;
    }
  }
  return null;
}

let tmpParent: string | null = null;
afterAll(async () => {
  if (tmpParent) await rm(tmpParent, { recursive: true, force: true });
});

describe("PaperclipTicketSource — real exported files", () => {
  it("parses a sample of the actual exports into valid TicketSignals (exporter↔parser parity)", async () => {
    const realDir = await findRealTicketsDir();
    if (!realDir) {
      console.warn("[skip] no exported tickets with origin_kind frontmatter found — run scripts/export_tickets.py");
      return;
    }

    // Copy up to 30 real top-level files into a throwaway git repo keyed `company`.
    tmpParent = await mkdtemp(path.join(tmpdir(), "cos-tickets-real-"));
    const companyRoot = path.join(tmpParent, "company");
    const dest = path.join(companyRoot, REL);
    await mkdir(dest, { recursive: true });
    await execFileAsync("git", ["init", "-q"], { cwd: companyRoot });
    const sample = (await readdir(realDir)).filter((f) => f.endsWith(".md")).slice(0, 30);
    for (const f of sample) await cp(path.join(realDir, f), path.join(dest, f));

    const ctx = await makeCollectionContext({ repoRoots: [companyRoot], scopeRepo: null, logger: silentLogger });
    const batch = await paperclipTicketSource.collect(ctx);
    const tickets = batch.signals.filter(isTicketSignal);

    expect(tickets.length).toBe(sample.length); // every sampled file parsed
    expect(batch.repoFreshness[0]?.freshness).toBe("live"); // no parse/read degrade
    for (const t of tickets) {
      expect(t.identifier).toMatch(/^[A-Z]{2,}-\d+/); // real identifier shape
      expect(typeof t.originKind).toBe("string");
      expect(t.originKind.length).toBeGreaterThan(0); // the load-bearing 5c field is present
      expect(Array.isArray(t.referencedFamilies)).toBe(true);
    }
    // The corpus is dominated by these three origins — at least one must appear.
    const origins = new Set(tickets.map((t) => t.originKind));
    expect([...origins].some((o) => ["manual", "routine_execution", "issue_productivity_review"].includes(o))).toBe(true);
  });
});
