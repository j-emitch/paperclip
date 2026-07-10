import { describe, expect, it } from "vitest";
import { hooksSource } from "../../src/sources/HooksSource.js";
import { isHooksSignal, type HooksSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext, proc, type FixtureFs } from "../fixtures/context.js";

const CANONICAL_PRE_PUSH = "#!/bin/sh\n# canonical pre-push v3\nexit 0\n";
const CANONICAL_COMMIT_MSG = "#!/bin/sh\n# canonical commit-msg v3\nexit 0\n";
const HOOK_TESTS = 'set -euo pipefail\nGATE_SUITES="${COH_GATE_SUITES-test-coh-footguns.sh test-pre-push.sh}"\n';

/** Company repo carrying the canonical hooks + gate-suite roster. */
function companyFiles(): FixtureFs[string] {
  return {
    ".githooks/pre-push": { content: CANONICAL_PRE_PUSH },
    ".githooks/commit-msg": { content: CANONICAL_COMMIT_MSG },
    "scripts/run-hook-tests.sh": { content: HOOK_TESTS },
  };
}

const CANNONS_TAIL = [
  "111-1-1 aaaaaaaa ship juice-bar 2026-07-01T00:00:00Z reports/review-cannons/a.md",
  "222-2-2 bbbbbbbb no-ship juice-bar 2026-07-08T00:00:00Z",
  "333-3-3 cccccccc ship company 2026-07-09T00:00:00Z",
].join("\n");

describe("HooksSource", () => {
  it("in_sync repo: parity, gate suites, hooksPath, guardrail activity, and the repo's newest gate run", async () => {
    const ctx = makeFixtureContext({
      repos: [
        { repo: "juice-bar", available: true },
        { repo: "company", available: true },
      ],
      files: {
        company: companyFiles(),
        "juice-bar": {
          ".githooks/pre-push": { content: CANONICAL_PRE_PUSH },
          ".githooks/commit-msg": { content: CANONICAL_COMMIT_MSG },
        },
      },
      git: (_repo, args) => (args.join(" ") === "config --get core.hooksPath" ? proc.ok("~/.claude/hooks\n") : proc.ok("")),
      logs: {
        cannons_runs: CANNONS_TAIL,
        "repo_guardrails:juice-bar": [
          '{"t":"2026-07-08T10:00:00Z","hook":"typecheck","repo":"juice-bar"}',
          '{"t":"2026-07-09T11:00:00Z","hook":"tripwires","repo":"juice-bar"}',
        ].join("\n"),
      },
    });
    const batch = await hooksSource.collect(ctx);
    const jb = batch.signals.filter(isHooksSignal).find((s) => s.repo === "juice-bar") as HooksSignal;
    expect(jb.parity).toBe("in_sync");
    expect(jb.driftedHooks).toEqual([]);
    expect(jb.hooksPathValue).toBe("~/.claude/hooks");
    expect(jb.gateSuites).toEqual(["test-coh-footguns.sh", "test-pre-push.sh"]);
    expect(jb.lastGuardrailAt).toBe("2026-07-09T11:00:00Z");
    expect(jb.guardrailHookKinds).toEqual(["tripwires", "typecheck"]);
    // Newest cannons line for juice-bar wins (append-order), not the ship one.
    expect(jb.lastGateRun).toEqual({ runId: "222-2-2", sha8: "bbbbbbbb", verdict: "no-ship", at: "2026-07-08T00:00:00Z" });
  });

  it("drifted vs missing: names the differing hooks; a hookless repo lists the whole canonical set", async () => {
    const ctx = makeFixtureContext({
      repos: [
        { repo: "juice-bar", available: true },
        { repo: "arc-scraper", available: true },
        { repo: "company", available: true },
      ],
      files: {
        company: companyFiles(),
        "juice-bar": {
          ".githooks/pre-push": { content: "#!/bin/sh\n# OLD pre-push v1\nexit 0\n" },
          ".githooks/commit-msg": { content: CANONICAL_COMMIT_MSG },
        },
        "arc-scraper": {},
      },
    });
    const batch = await hooksSource.collect(ctx);
    const byRepo = new Map(batch.signals.filter(isHooksSignal).map((s) => [s.repo, s]));
    expect(byRepo.get("juice-bar")?.parity).toBe("drifted");
    expect(byRepo.get("juice-bar")?.driftedHooks).toEqual(["pre-push"]);
    expect(byRepo.get("arc-scraper")?.parity).toBe("missing");
    expect(byRepo.get("arc-scraper")?.driftedHooks).toEqual(["commit-msg", "pre-push"]);
  });

  it("company unavailable: parity unknown, no fabricated drift, source still emits", async () => {
    const ctx = makeFixtureContext({
      repos: [
        { repo: "juice-bar", available: true },
        { repo: "company", available: false },
      ],
      files: { "juice-bar": { ".githooks/pre-push": { content: CANONICAL_PRE_PUSH } } },
    });
    const batch = await hooksSource.collect(ctx);
    const jb = batch.signals.filter(isHooksSignal).find((s) => s.repo === "juice-bar") as HooksSignal;
    expect(jb.parity).toBe("unknown");
    expect(jb.driftedHooks).toEqual([]);
    expect(jb.gateSuites).toEqual([]);
  });

  it("no logs at all: guardrail fields null/[], lastGateRun null (absence is NORMAL)", async () => {
    const ctx = makeFixtureContext({
      repos: [
        { repo: "juice-bar", available: true },
        { repo: "company", available: true },
      ],
      files: { company: companyFiles(), "juice-bar": { ".githooks/pre-push": { content: CANONICAL_PRE_PUSH } } },
    });
    const batch = await hooksSource.collect(ctx);
    const jb = batch.signals.filter(isHooksSignal).find((s) => s.repo === "juice-bar") as HooksSignal;
    expect(jb.lastGuardrailAt).toBeNull();
    expect(jb.guardrailHookKinds).toEqual([]);
    expect(jb.lastGateRun).toBeNull();
    expect(batch.repoFreshness.find((f) => f.repo === "juice-bar")?.freshness).toBe("live");
  });
});
