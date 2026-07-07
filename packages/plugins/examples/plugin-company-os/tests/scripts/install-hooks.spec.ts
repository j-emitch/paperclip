/**
 * `install-cos-hooks.sh` / `uninstall-cos-hooks.sh` / `cos-refresh-hook.sh` —
 * real-bash integration tests against throwaway git repos in a temp HOME.
 *
 * These assert the load-bearing safety properties of the COS-0g hook installer:
 *  - idempotency (run twice → exactly one sentinel block),
 *  - preservation of a pre-existing hook's content,
 *  - the runtime kill-switch (`COS_HOOKS_DISABLED`) truly no-ops the dispatcher,
 *  - NON-FATAL: an installed hook (even one whose dispatch fails) never blocks
 *    `git commit`,
 *  - clean uninstall (strip only the block; remove installer-created files).
 *
 * HOME is redirected to a temp dir for every spawned process so the installer's
 * `~/.claude/hooks` dispatcher + `~/.config/cos-company-os` artifacts never touch
 * the real home.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  chmodSync,
  symlinkSync,
  lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS_DIR = fileURLToPath(new URL("../../scripts/", import.meta.url));
const INSTALL = join(SCRIPTS_DIR, "install-cos-hooks.sh");
const UNINSTALL = join(SCRIPTS_DIR, "uninstall-cos-hooks.sh");
const DISPATCHER = join(SCRIPTS_DIR, "cos-refresh-hook.sh");
const SENTINEL_START = "# >>> cos-company-os >>>";
const COMPANY = "64ce294e-5e04-4cca-8f10-71c9732258b2";
const NODE_BIN = process.execPath;

let HOME = "";
const roots: string[] = [];

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  roots.push(d);
  return d;
}

/** A throwaway git repo configured for non-interactive commits. */
function initRepo(): string {
  const repo = tmp("cos-repo-");
  const env = { ...process.env, HOME };
  execFileSync("git", ["init", "-q", repo], { env });
  execFileSync("git", ["-C", repo, "config", "user.email", "t@t.test"], { env });
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"], { env });
  execFileSync("git", ["-C", repo, "config", "commit.gpgsign", "false"], { env });
  return repo;
}

function sh(script: string, args: string[], extraEnv: Record<string, string> = {}): { code: number; out: string } {
  try {
    const out = execFileSync("bash", [script, ...args], {
      env: { ...process.env, HOME, ...extraEnv },
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const countBlocks = (content: string): number => content.split(SENTINEL_START).length - 1;

beforeAll(() => {
  HOME = tmp("cos-home-");
});
afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

describe("install-cos-hooks.sh", () => {
  it("installs an executable post-commit + post-merge with exactly one sentinel block", () => {
    const repo = initRepo();
    const hooksDir = join(repo, ".git", "hooks");
    const r = sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]);
    expect(r.code).toBe(0);

    for (const event of ["post-commit", "post-merge"]) {
      const hook = join(hooksDir, event);
      expect(existsSync(hook)).toBe(true);
      const content = readFileSync(hook, "utf8");
      expect(countBlocks(content)).toBe(1);
      expect(content).toContain(`cos-refresh-hook.sh" ${event} || true`);
    }
    // The machine-local dispatcher + config landed in the temp HOME, not real ~.
    expect(existsSync(join(HOME, ".claude", "hooks", "cos-refresh-hook.sh"))).toBe(true);
    expect(existsSync(join(HOME, ".config", "cos-company-os", "config.env"))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(HOME, ".config", "cos-company-os", "hooks-manifest.json"), "utf8"));
    expect(manifest.companyId).toBe(COMPANY);
    expect(manifest.hooks.length).toBe(2);
    expect(manifest.hooks[0].blockSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent — running twice leaves exactly one block", () => {
    const repo = initRepo();
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]);
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]);
    const content = readFileSync(join(repo, ".git", "hooks", "post-commit"), "utf8");
    expect(countBlocks(content)).toBe(1);
  });

  it("preserves a pre-existing hook's content", () => {
    const repo = initRepo();
    const hook = join(repo, ".git", "hooks", "post-commit");
    writeFileSync(hook, "#!/bin/bash\necho EXISTING_HOOK_RAN\n");
    chmodSync(hook, 0o755);

    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]);
    const content = readFileSync(hook, "utf8");
    expect(content).toContain("echo EXISTING_HOOK_RAN");
    expect(countBlocks(content)).toBe(1);
    // Re-running still preserves the pre-existing line and keeps one block.
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]);
    const content2 = readFileSync(hook, "utf8");
    expect(content2).toContain("echo EXISTING_HOOK_RAN");
    expect(countBlocks(content2)).toBe(1);
  });

  it("honors core.hooksPath (managed .githooks)", () => {
    const repo = initRepo();
    mkdirSync(join(repo, ".githooks"));
    execFileSync("git", ["-C", repo, "config", "core.hooksPath", ".githooks"], { env: { ...process.env, HOME } });
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]);
    expect(existsSync(join(repo, ".githooks", "post-commit"))).toBe(true);
    // Must NOT have written into .git/hooks when hooksPath is set.
    expect(existsSync(join(repo, ".git", "hooks", "post-commit"))).toBe(false);
  });

  it("--dry-run writes nothing", () => {
    const repo = initRepo();
    const r = sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN, "--dry-run"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(repo, ".git", "hooks", "post-commit"))).toBe(false);
  });

  it("requires --company and rejects an unsafe company id", () => {
    const repo = initRepo();
    const missing = sh(INSTALL, ["--repo", repo]);
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain("--company");

    const unsafe = sh(INSTALL, ["--company", "a; rm -rf /", "--repo", repo, "--node", NODE_BIN]);
    expect(unsafe.code).not.toBe(0);
  });

  it("refuses to write through a symlinked hook (symlink-escape guard)", () => {
    const repo = initRepo();
    const hooksDir = join(repo, ".git", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    const outsideDir = tmp("cos-outside-");
    const target = join(outsideDir, "evil-target");
    writeFileSync(target, "#!/bin/bash\necho ORIGINAL_TARGET\n");
    symlinkSync(target, join(hooksDir, "post-commit"));

    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]);
    // The hook stays a symlink (not replaced) and the outside target is untouched.
    expect(lstatSync(join(hooksDir, "post-commit")).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).not.toContain("cos-company-os");
  });

  it("config.env is injection-safe even with shell metacharacters in --host", () => {
    const repo = initRepo();
    const home = tmp("cos-inj-home-");
    const marker = join(home, "PWNED");
    const evil = `http://127.0.0.1:3100"; touch ${marker}; echo "`;
    execFileSync("bash", [INSTALL, "--company", COMPANY, "--repo", repo, "--node", NODE_BIN, "--host", evil], {
      env: { ...process.env, HOME: home },
    });
    // Sourcing the generated config must assign the literal, not execute the payload.
    const out = execFileSync(
      "bash",
      ["-c", `. "${join(home, ".config/cos-company-os/config.env")}"; printf '%s' "$COS_HOST"`],
      { env: { ...process.env, HOME: home }, encoding: "utf8" },
    );
    expect(existsSync(marker)).toBe(false);
    expect(out).toBe(evil);
  });

  it("writes a shell-readable TSV manifest with checksums", () => {
    const repo = initRepo();
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]);
    const tsv = readFileSync(join(HOME, ".config", "cos-company-os", "hooks-manifest.tsv"), "utf8").trim();
    const rows = tsv.split("\n");
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const cols = row.split("\t");
      expect(cols.length).toBe(5); // repo, hookPath, event, created, sha
      expect(cols[4]).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("non-fatal commit integration", () => {
  it("an installed hook pointed at a dead host never blocks git commit", () => {
    const repo = initRepo();
    // Closed port → cos-refresh.mjs degrades to host_down (graceful no-op).
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN, "--host", "http://127.0.0.1:1"]);

    writeFileSync(join(repo, "a.txt"), "hi");
    const env = { ...process.env, HOME };
    execFileSync("git", ["-C", repo, "add", "a.txt"], { env });
    // Should NOT throw — a non-zero would mean the hook blocked the commit.
    expect(() => execFileSync("git", ["-C", repo, "commit", "-q", "-m", "test"], { env, encoding: "utf8" })).not.toThrow();
  });

  it("a dispatch whose node binary fails still never blocks the commit", () => {
    const repo = initRepo();
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", "/usr/bin/false"]);
    writeFileSync(join(repo, "b.txt"), "hi");
    const env = { ...process.env, HOME };
    execFileSync("git", ["-C", repo, "add", "b.txt"], { env });
    expect(() => execFileSync("git", ["-C", repo, "commit", "-q", "-m", "b"], { env })).not.toThrow();
  });
});

describe("cos-refresh-hook.sh dispatcher kill-switch", () => {
  // Point the dispatcher at a marker-touching shim instead of the real CLI, so we
  // can deterministically observe whether it dispatched.
  function dispatcherHome(): { home: string; marker: string } {
    const home = tmp("cos-disp-home-");
    const cfgDir = join(home, ".config", "cos-company-os");
    mkdirSync(cfgDir, { recursive: true });
    const marker = join(home, "MARKER");
    const shim = join(home, "shim.sh");
    writeFileSync(shim, `#!/usr/bin/env bash\ntouch "${marker}"\n`);
    chmodSync(shim, 0o755);
    writeFileSync(
      join(cfgDir, "config.env"),
      `COS_COMPANY_ID="${COMPANY}"\nCOS_REFRESH_SCRIPT="${shim}"\nCOS_NODE_BIN="bash"\nCOS_HOST="http://127.0.0.1:1"\n`,
    );
    return { home, marker };
  }

  // 10s ceiling: the dispatcher backgrounds the shim behind an mkdir-lock, and under
  // full-suite parallel load the 2s budget flaked (seen at COS activation 2026-07-06).
  // The poll returns as soon as the marker lands, so the ceiling costs nothing when healthy.
  const waitFor = (pred: () => boolean, ms = 10_000): boolean => {
    const end = Date.now() + ms;
    // Busy-wait via execFileSync sleep so the backgrounded dispatch can land.
    while (Date.now() < end) {
      if (pred()) return true;
      try {
        execFileSync("sleep", ["0.05"]);
      } catch {
        /* ignore */
      }
    }
    return pred();
  };

  it("dispatches (touches the marker) when enabled", () => {
    const { home, marker } = dispatcherHome();
    const repo = initRepo();
    // Run the dispatcher from inside the repo so its git-scope resolution works;
    // it backgrounds the shim, so poll for the marker.
    execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit`], {
      env: { ...process.env, HOME: home },
    });
    expect(waitFor(() => existsSync(marker))).toBe(true);
  });

  it("COS_HOOKS_DISABLED=1 → no dispatch (marker never appears)", () => {
    const { home, marker } = dispatcherHome();
    const repo = initRepo();
    execFileSync("bash", ["-c", `cd "${repo}" && HOME="${home}" COS_HOOKS_DISABLED=1 bash "${DISPATCHER}" post-commit`], {
      env: { ...process.env, HOME: home, COS_HOOKS_DISABLED: "1" },
    });
    // Give any (erroneous) background dispatch a chance, then assert it stayed off.
    execFileSync("sleep", ["0.3"]);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("uninstall-cos-hooks.sh", () => {
  it("strips the block, preserves a pre-existing hook, removes an installer-created hook", () => {
    // Repo A: pre-existing hook → must be preserved after uninstall.
    const repoA = initRepo();
    const hookA = join(repoA, ".git", "hooks", "post-commit");
    writeFileSync(hookA, "#!/bin/bash\necho KEEP_ME\n");
    chmodSync(hookA, 0o755);
    sh(INSTALL, ["--company", COMPANY, "--repo", repoA, "--node", NODE_BIN]);

    sh(UNINSTALL, []);

    const aContent = readFileSync(hookA, "utf8");
    expect(aContent).toContain("echo KEEP_ME");
    expect(countBlocks(aContent)).toBe(0);

    // Machine-local artifacts removed.
    expect(existsSync(join(HOME, ".claude", "hooks", "cos-refresh-hook.sh"))).toBe(false);
    expect(existsSync(join(HOME, ".config", "cos-company-os", "config.env"))).toBe(false);
  });

  it("removes a hook file the installer itself created (no pre-existing content)", () => {
    const repo = initRepo();
    const hook = join(repo, ".git", "hooks", "post-merge");
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]);
    expect(existsSync(hook)).toBe(true);
    sh(UNINSTALL, []);
    // Installer-created + now-empty → fully removed.
    expect(existsSync(hook)).toBe(false);
  });

  it("keeps created:true across a reinstall so uninstall still removes the file", () => {
    const repo = initRepo();
    const hook = join(repo, ".git", "hooks", "post-commit");
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]); // creates it
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]); // reinstall (file now exists)
    sh(UNINSTALL, []);
    expect(existsSync(hook)).toBe(false);
  });

  it("falls back to the JSON manifest when the TSV sidecar is absent (cross-version uninstall)", () => {
    const repo = initRepo();
    const hook = join(repo, ".git", "hooks", "post-commit");
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN]);
    // Simulate a manifest written before the TSV sidecar existed.
    rmSync(join(HOME, ".config", "cos-company-os", "hooks-manifest.tsv"));
    expect(existsSync(join(HOME, ".config", "cos-company-os", "hooks-manifest.json"))).toBe(true);
    sh(UNINSTALL, []);
    // The JSON fallback still found + removed the installer-created hook.
    expect(existsSync(hook)).toBe(false);
  });

  it("is NON-DESTRUCTIVE on a corrupted block (START present, END missing → tail preserved)", () => {
    const repo = initRepo();
    const hook = join(repo, ".git", "hooks", "post-commit");
    // A damaged hook: a START marker, no END, then real user content after.
    writeFileSync(hook, `#!/bin/bash\n${SENTINEL_START}\nstray cos line\nIMPORTANT_USER_TAIL\n`);
    chmodSync(hook, 0o755);
    sh(UNINSTALL, ["--repo", repo]);
    // The strip refuses to drop an unterminated block → the user's tail survives.
    expect(readFileSync(hook, "utf8")).toContain("IMPORTANT_USER_TAIL");
  });
});
