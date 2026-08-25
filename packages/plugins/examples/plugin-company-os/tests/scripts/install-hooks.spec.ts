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
import { basename, join } from "node:path";

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

describe("git-tracked dispatcher is owned by git (cannons 2026-08-18 codex P1)", () => {
  // ~/.claude/hooks may be a symlink into a TRACKED hooks dir (company/config/hooks).
  // A reinstall must not overwrite it and an uninstall must not delete it.
  function trackedHome(): { home: string; dest: string; hooksRepo: string } {
    const home = tmp("cos-tracked-home-");
    const hooksRepo = initRepo(); // stands in for company/ (config/hooks tracked)
    mkdirSync(join(hooksRepo, "config", "hooks"), { recursive: true });
    const dest = join(hooksRepo, "config", "hooks", "cos-refresh-hook.sh");
    writeFileSync(dest, "#!/usr/bin/env bash\n# TRACKED SENTINEL — owned by git\nexit 0\n");
    chmodSync(dest, 0o755);
    const env = { ...process.env, HOME: home };
    execFileSync("git", ["-C", hooksRepo, "add", "config/hooks/cos-refresh-hook.sh"], { env });
    execFileSync("git", ["-C", hooksRepo, "commit", "-q", "-m", "track dispatcher"], { env });
    mkdirSync(join(home, ".claude"), { recursive: true });
    symlinkSync(join(hooksRepo, "config", "hooks"), join(home, ".claude", "hooks"));
    return { home, dest, hooksRepo };
  }

  it("install leaves a git-tracked (differing) dispatcher untouched and says so", () => {
    const { home, dest, hooksRepo } = trackedHome();
    const repo = initRepo();
    const r = sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN], { HOME: home });
    expect(r.code).toBe(0);
    expect(readFileSync(dest, "utf8")).toContain("TRACKED SENTINEL");
    expect(r.out).toMatch(/git-tracked/);
    // The tracked repo stays clean — no dirt from a reinstall.
    const status = execFileSync("git", ["-C", hooksRepo, "status", "--porcelain", "--", "config/hooks"], { encoding: "utf8" });
    expect(status.trim()).toBe("");
  });

  it("uninstall keeps a git-tracked dispatcher (removes only its own config/manifest)", () => {
    const { home, dest, hooksRepo } = trackedHome();
    const repo = initRepo();
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN], { HOME: home });
    const r = sh(UNINSTALL, [], { HOME: home });
    expect(r.code).toBe(0);
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(join(home, ".config", "cos-company-os", "config.env"))).toBe(false);
    const status = execFileSync("git", ["-C", hooksRepo, "status", "--porcelain", "--", "config/hooks"], { encoding: "utf8" });
    expect(status.trim()).toBe("");
  });

  it("an UNtracked dispatcher is still installed/removed as before", () => {
    const home = tmp("cos-untracked-home-");
    const repo = initRepo();
    sh(INSTALL, ["--company", COMPANY, "--repo", repo, "--node", NODE_BIN], { HOME: home });
    const dest = join(home, ".claude", "hooks", "cos-refresh-hook.sh");
    expect(existsSync(dest)).toBe(true);
    sh(UNINSTALL, [], { HOME: home });
    expect(existsSync(dest)).toBe(false);
  });
});

describe("cos-refresh-hook.sh passes configured host + plugin to the child (cannons 2026-08-18 codex P1)", () => {
  it("COS_HOST / COS_PLUGIN_KEY reach the child via ENV, never argv (plugin key stays out of the process table)", () => {
    const home = tmp("cos-argv-home-");
    const cfgDir = join(home, ".config", "cos-company-os");
    mkdirSync(cfgDir, { recursive: true });
    const argvFile = join(home, "ARGV");
    const envFile = join(home, "ENV");
    const shim = join(home, "shim.sh");
    writeFileSync(shim, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argvFile}"\nprintf '%s\\n' "HOST=\${COS_HOST:-unset}" "KEY=\${COS_PLUGIN_KEY:-unset}" > "${envFile}"\n`);
    chmodSync(shim, 0o755);
    writeFileSync(
      join(cfgDir, "config.env"),
      `COS_COMPANY_ID="${COMPANY}"\nCOS_REFRESH_SCRIPT="${shim}"\nCOS_NODE_BIN="bash"\nCOS_HOST="http://127.0.0.1:4242"\nCOS_PLUGIN_KEY="acme.cockpit"\n`,
    );
    const repo = initRepo();
    execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit`], {
      env: { ...process.env, HOME: home, TMPDIR: home },
    });
    const end = Date.now() + 10_000;
    while (!(existsSync(argvFile) && existsSync(envFile)) && Date.now() < end) execFileSync("sleep", ["0.05"]);
    const argv = readFileSync(argvFile, "utf8").split("\n");
    expect(argv).toContain("--company");
    expect(argv).not.toContain("--host");
    expect(argv).not.toContain("--plugin");
    expect(argv.some((a) => a.includes("acme.cockpit"))).toBe(false);
    const envLines = readFileSync(envFile, "utf8").split("\n");
    expect(envLines).toContain("HOST=http://127.0.0.1:4242");
    expect(envLines).toContain("KEY=acme.cockpit");
  });

  it("config.env assignments are EXPORTED to the child (env-only knobs like COS_ALLOW_NONLOOPBACK)", () => {
    const home = tmp("cos-env-home-");
    const cfgDir = join(home, ".config", "cos-company-os");
    mkdirSync(cfgDir, { recursive: true });
    const envFile = join(home, "ENV");
    const shim = join(home, "shim.sh");
    writeFileSync(shim, `#!/usr/bin/env bash\nprintf '%s\\n' "NONLOOP=\${COS_ALLOW_NONLOOPBACK:-unset}" "TMO=\${COS_REFRESH_TIMEOUT_MS:-unset}" > "${envFile}"\n`);
    chmodSync(shim, 0o755);
    writeFileSync(
      join(cfgDir, "config.env"),
      `COS_COMPANY_ID="${COMPANY}"\nCOS_REFRESH_SCRIPT="${shim}"\nCOS_NODE_BIN="bash"\nCOS_ALLOW_NONLOOPBACK=1\nCOS_REFRESH_TIMEOUT_MS=1234\nCOS_REFRESH_WATCHDOG_SECS=garbage\n`,
    );
    const repo = initRepo();
    // COS_REFRESH_WATCHDOG_SECS=garbage must be tolerated (falls back to 25s), not break the dispatch.
    execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit`], {
      env: { ...process.env, HOME: home, TMPDIR: home },
    });
    const end = Date.now() + 10_000;
    while (!existsSync(envFile) && Date.now() < end) execFileSync("sleep", ["0.05"]);
    const lines = readFileSync(envFile, "utf8").split("\n");
    expect(lines).toContain("NONLOOP=1");
    expect(lines).toContain("TMO=1234");
  });

  it("refresh.log records the dispatch line + the child's outcome (no --quiet); COS_SCOPE_REPO in config is ignored; '08' watchdog tolerated", () => {
    const home = tmp("cos-log-home-");
    const cfgDir = join(home, ".config", "cos-company-os");
    mkdirSync(cfgDir, { recursive: true });
    const argvFile = join(home, "ARGV");
    const shim = join(home, "shim.sh");
    writeFileSync(shim, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argvFile}"\necho '{"outcome":"probe-ok"}'\n`);
    chmodSync(shim, 0o755);
    writeFileSync(
      join(cfgDir, "config.env"),
      `COS_COMPANY_ID="${COMPANY}"\nCOS_REFRESH_SCRIPT="${shim}"\nCOS_NODE_BIN="bash"\nCOS_SCOPE_REPO="evil-scope"\nCOS_REFRESH_WATCHDOG_SECS=08\n`,
    );
    const repo = initRepo();
    const out = execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit 2>&1; echo "rc=$?"`], {
      env: { ...process.env, HOME: home, TMPDIR: home },
      encoding: "utf8",
    });
    expect(out.trim().endsWith("rc=0")).toBe(true);
    expect(out).not.toMatch(/value too great|octal/); // the 08 octal trap is closed
    const end = Date.now() + 10_000;
    while (!existsSync(argvFile) && Date.now() < end) execFileSync("sleep", ["0.05"]);
    const argv = readFileSync(argvFile, "utf8").split("\n");
    expect(argv).not.toContain("--quiet");
    // scope comes from the firing repo (its main-checkout basename), never from config
    expect(argv[argv.indexOf("--scope") + 1]).toBe(basename(repo));
    const logFile = join(cfgDir, "refresh.log");
    const logEnd = Date.now() + 10_000;
    while ((!existsSync(logFile) || !readFileSync(logFile, "utf8").includes("probe-ok")) && Date.now() < logEnd) execFileSync("sleep", ["0.05"]);
    const log = readFileSync(logFile, "utf8");
    expect(log).toMatch(/Z event=post-commit scope=/);
    expect(log).toContain('{"outcome":"probe-ok"}');
  });

  it("a broken config.env (syntax error / exit 1) → rc 0, no dispatch, nothing on stderr", () => {
    for (const bad of ["COS_COMPANY_ID=\"unterminated\n", "exit 1\n"]) {
      const home = tmp("cos-badcfg-home-");
      const cfgDir = join(home, ".config", "cos-company-os");
      mkdirSync(cfgDir, { recursive: true });
      const marker = join(home, "MARKER");
      const shim = join(home, "shim.sh");
      writeFileSync(shim, `#!/usr/bin/env bash\ntouch "${marker}"\n`);
      chmodSync(shim, 0o755);
      writeFileSync(join(cfgDir, "config.env"), `COS_COMPANY_ID="${COMPANY}"\nCOS_REFRESH_SCRIPT="${shim}"\nCOS_NODE_BIN="bash"\n${bad}`);
      const repo = initRepo();
      const out = execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit 2>&1; echo "rc=$?"`], {
        env: { ...process.env, HOME: home, TMPDIR: home },
        encoding: "utf8",
      });
      expect(out.trim()).toBe("rc=0");
      execFileSync("sleep", ["0.3"]);
      expect(existsSync(marker)).toBe(false);
    }
  });

  it("config.env runs ONCE, in a subshell: `set -x` cannot leak to stderr, a trailing false still dispatches, side effects run once", () => {
    const home = tmp("cos-cfgonce-home-");
    const cfgDir = join(home, ".config", "cos-company-os");
    mkdirSync(cfgDir, { recursive: true });
    const marker = join(home, "MARKER");
    const counter = join(home, "COUNT");
    const shim = join(home, "shim.sh");
    writeFileSync(shim, `#!/usr/bin/env bash\ntouch "${marker}"\n`);
    chmodSync(shim, 0o755);
    writeFileSync(
      join(cfgDir, "config.env"),
      `set -x\nCOS_COMPANY_ID="${COMPANY}"\nCOS_REFRESH_SCRIPT="${shim}"\nCOS_NODE_BIN="bash"\necho x >> "${counter}"\n[ -n "\${NOPE:-}" ] && COS_HOST=http://127.0.0.1:1\n`,
    );
    const repo = initRepo();
    const out = execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit 2>&1; echo "rc=$?"`], {
      env: { ...process.env, HOME: home, TMPDIR: home },
      encoding: "utf8",
    });
    expect(out.trim()).toBe("rc=0"); // no `set -x` trace on stderr, no error
    const end = Date.now() + 10_000;
    while (!existsSync(marker) && Date.now() < end) execFileSync("sleep", ["0.05"]);
    expect(existsSync(marker)).toBe(true); // trailing-false config still dispatches
    expect(readFileSync(counter, "utf8").split("\n").filter(Boolean).length).toBe(1); // executed once
  });

  it("a config EXIT trap's output is neither eval'd nor leaked; lock parent dir is created even when the log lives elsewhere", () => {
    const home = tmp("cos-trap-home-");
    const cfgDir = join(home, ".config", "cos-company-os");
    mkdirSync(cfgDir, { recursive: true });
    const marker = join(home, "MARKER");
    const shim = join(home, "shim.sh");
    writeFileSync(shim, `#!/usr/bin/env bash\ntouch "${marker}"\n`);
    chmodSync(shim, 0o755);
    const elsewhere = join(home, "elsewhere"); mkdirSync(elsewhere);
    // Config points the log OUTSIDE ~/.config/cos-company-os, then we delete that
    // dir: the lock parent must still be created by the dispatcher itself.
    writeFileSync(join(cfgDir, "config.env"), `COS_COMPANY_ID="${COMPANY}"\nCOS_REFRESH_SCRIPT="${shim}"\nCOS_NODE_BIN="bash"\nCOS_LOG_FILE="${join(elsewhere, "r.log")}"\ntrap "echo cleaning-up-temp-files" EXIT\n`);
    const cfgCopy = join(home, "config.copy"); writeFileSync(cfgCopy, readFileSync(join(cfgDir, "config.env")));
    rmSync(cfgDir, { recursive: true, force: true });
    const repo = initRepo();
    const out = execFileSync("bash", ["-c", `cd "${repo}" && COS_CONFIG_FILE="${cfgCopy}" bash "${DISPATCHER}" post-commit 2>&1; echo "rc=$?"`], {
      env: { ...process.env, HOME: home, TMPDIR: home },
      encoding: "utf8",
    });
    expect(out.trim()).toBe("rc=0"); // no "cleaning-up-temp-files" on stderr/stdout
    const end = Date.now() + 10_000;
    while (!existsSync(marker) && Date.now() < end) execFileSync("sleep", ["0.05"]);
    expect(existsSync(marker)).toBe(true); // dispatched despite missing lock parent + relocated log
  });

  it("an unwritable log path loses the log line, never the dispatch", () => {
    const home = tmp("cos-nolog-home-");
    const cfgDir = join(home, ".config", "cos-company-os");
    mkdirSync(cfgDir, { recursive: true });
    const marker = join(home, "MARKER");
    const shim = join(home, "shim.sh");
    writeFileSync(shim, `#!/usr/bin/env bash\ntouch "${marker}"\n`);
    chmodSync(shim, 0o755);
    const ro = join(home, "ro"); mkdirSync(ro); chmodSync(ro, 0o500);
    writeFileSync(join(cfgDir, "config.env"), `COS_COMPANY_ID="${COMPANY}"\nCOS_REFRESH_SCRIPT="${shim}"\nCOS_NODE_BIN="bash"\nCOS_LOG_FILE="${join(ro, "refresh.log")}"\n`);
    const repo = initRepo();
    execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit`], { env: { ...process.env, HOME: home, TMPDIR: home } });
    const end = Date.now() + 10_000;
    while (!existsSync(marker) && Date.now() < end) execFileSync("sleep", ["0.05"]);
    expect(existsSync(marker)).toBe(true);
  });

  it("the watchdog actually terminates a wedged child (perl alarm path)", () => {
    const home = tmp("cos-wedge-home-");
    const cfgDir = join(home, ".config", "cos-company-os");
    mkdirSync(cfgDir, { recursive: true });
    const done = join(home, "DONE");
    const tag = `cos-wedge-${process.pid}`;
    const shim = join(home, "shim.sh");
    // A child that would run 40s; the watchdog (5s) must kill it long before.
    writeFileSync(shim, `#!/usr/bin/env bash\nexec -a ${tag} sleep 40\ntouch "${done}"\n`);
    chmodSync(shim, 0o755);
    writeFileSync(join(cfgDir, "config.env"), `COS_COMPANY_ID="${COMPANY}"\nCOS_REFRESH_SCRIPT="${shim}"\nCOS_NODE_BIN="bash"\nCOS_REFRESH_WATCHDOG_SECS=5\n`);
    const repo = initRepo();
    execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit`], { env: { ...process.env, HOME: home, TMPDIR: home } });
    execFileSync("sleep", ["1"]);
    const before = execFileSync("ps", ["-axo", "command"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    expect(before.includes(tag)).toBe(true); // it started
    execFileSync("sleep", ["7"]);
    const after = execFileSync("ps", ["-axo", "command"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    expect(after.includes(tag)).toBe(false); // watchdog killed it
    expect(existsSync(done)).toBe(false);
  }, 20_000);

  it("cancelling the watchdog reaps its sleep (no orphan per dispatch)", () => {
    const home = tmp("cos-orphan-home-");
    const cfgDir = join(home, ".config", "cos-company-os");
    mkdirSync(cfgDir, { recursive: true });
    const shim = join(home, "shim.sh");
    writeFileSync(shim, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(shim, 0o755);
    // A distinctive watchdog length so the orphan (if any) is identifiable in ps.
    writeFileSync(join(cfgDir, "config.env"), `COS_COMPANY_ID="${COMPANY}"\nCOS_REFRESH_SCRIPT="${shim}"\nCOS_NODE_BIN="bash"\nCOS_REFRESH_WATCHDOG_SECS=577\n`);
    const repo = initRepo();
    execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit`], { env: { ...process.env, HOME: home, TMPDIR: home } });
    execFileSync("sleep", ["1"]);
    const ps = execFileSync("ps", ["-axo", "command"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    expect(ps.split("\n").filter((l) => /^sleep 577$/.test(l.trim())).length).toBe(0);
  });

  it("ambient COS_SCOPE_REPO never reaches the child even with NO config file (env-provided essentials)", () => {
    const home = tmp("cos-ambient-home-");
    const envFile = join(home, "ENV");
    const shim = join(home, "shim.sh");
    writeFileSync(shim, `#!/usr/bin/env bash\nprintf '%s\\n' "SCOPE=\${COS_SCOPE_REPO:-unset}" > "${envFile}"\n`);
    chmodSync(shim, 0o755);
    const repo = initRepo();
    execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit`], {
      env: { ...process.env, HOME: home, TMPDIR: home, COS_COMPANY_ID: COMPANY, COS_REFRESH_SCRIPT: shim, COS_NODE_BIN: "bash", COS_SCOPE_REPO: "evil-scope" },
    });
    const end = Date.now() + 10_000;
    while (!existsSync(envFile) && Date.now() < end) execFileSync("sleep", ["0.05"]);
    expect(readFileSync(envFile, "utf8").trim()).toBe("SCOPE=unset");
  });

  it("an unresolvable node binary → rc 0, no dispatch, one observable log line (perl exec would swallow it)", () => {
    const home = tmp("cos-nonode-home-");
    const cfgDir = join(home, ".config", "cos-company-os");
    mkdirSync(cfgDir, { recursive: true });
    const marker = join(home, "MARKER");
    const shim = join(home, "shim.sh");
    writeFileSync(shim, `#!/usr/bin/env bash\ntouch "${marker}"\n`);
    chmodSync(shim, 0o755);
    writeFileSync(join(cfgDir, "config.env"), `COS_COMPANY_ID="${COMPANY}"\nCOS_REFRESH_SCRIPT="${shim}"\nCOS_NODE_BIN="/nonexistent/node-bin"\n`);
    const repo = initRepo();
    const out = execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit 2>&1; echo "rc=$?"`], {
      env: { ...process.env, HOME: home, TMPDIR: home },
      encoding: "utf8",
    });
    expect(out.trim()).toBe("rc=0");
    execFileSync("sleep", ["0.4"]);
    expect(existsSync(marker)).toBe(false);
    const log = readFileSync(join(cfgDir, "refresh.log"), "utf8");
    expect(log).toContain("node binary not found: /nonexistent/node-bin");
  });

  it("no HOME + no COS_CONFIG_FILE → exits 0 silently (set -u safe)", () => {
    const repo = initRepo();
    const env = { ...process.env } as Record<string, string | undefined>;
    delete env.HOME;
    delete env.COS_CONFIG_FILE;
    const r = execFileSync("bash", ["-c", `cd "${repo}" && bash "${DISPATCHER}" post-commit; echo "rc=$?"`], {
      env: env as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    expect(r.trim()).toBe("rc=0");
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
      // TMPDIR must be per-test: the dispatcher's mkdir-lock lives under $TMPDIR keyed
      // only by company id, so a shared TMPDIR lets a PRIOR run's still-held lock make
      // this dispatch legitimately skip (mkdir || exit 0) — the flake seen 2026-07-06.
      env: { ...process.env, HOME: home, TMPDIR: home },
    });
    expect(waitFor(() => existsSync(marker))).toBe(true);
  });

  it("COS_HOOKS_DISABLED=1 → no dispatch (marker never appears)", () => {
    const { home, marker } = dispatcherHome();
    const repo = initRepo();
    execFileSync("bash", ["-c", `cd "${repo}" && HOME="${home}" COS_HOOKS_DISABLED=1 bash "${DISPATCHER}" post-commit`], {
      env: { ...process.env, HOME: home, TMPDIR: home, COS_HOOKS_DISABLED: "1" },
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
