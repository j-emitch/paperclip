import { describe, expect, it } from "vitest";
import { dispatchLedgerSource } from "../../src/sources/DispatchLedgerSource.js";
import { isDispatchLedgerSignal, type DispatchLedgerSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext } from "../fixtures/context.js";

const CANNONS = [
  "111-1-1 aaaaaaaa ship juice-bar 2026-07-01T00:00:00Z reports/review-cannons/a.md",
  "222-2-2 bbbbbbbb no-ship paperclip 2026-07-09T00:00:00Z",
].join("\n");

const CODEX = [
  '{"t":"2026-07-08T00:00:00Z","consumer":"cannons-session","repo":"paperclip","success":true,"latency_ms":90000,"model":"gpt-5.6-sol"}',
  '{"t":"2026-07-09T00:00:00Z","consumer":"reviewer","repo":"juice-bar","success":false,"model":"gpt-5.6-sol"}',
].join("\n");

describe("DispatchLedgerSource", () => {
  it("emits exactly one signal per EXISTING ledger, with lane-exclusive row fields", async () => {
    const ctx = makeFixtureContext({ logs: { cannons_runs: CANNONS, codex_invocations: CODEX } });
    const batch = await dispatchLedgerSource.collect(ctx);
    const sigs = batch.signals.filter(isDispatchLedgerSignal) as DispatchLedgerSignal[];
    expect(sigs.map((s) => s.ledger).sort()).toEqual(["cannons_runs", "codex_invocations"]);

    const cannons = sigs.find((s) => s.ledger === "cannons_runs")!;
    expect(cannons.cannonsRuns).toHaveLength(2);
    expect(cannons.codexRows).toBeUndefined();
    expect(cannons.cannonsRuns![0]).toEqual({
      runId: "111-1-1",
      sha8: "aaaaaaaa",
      verdict: "ship",
      repo: "juice-bar",
      at: "2026-07-01T00:00:00Z",
      reportPath: "reports/review-cannons/a.md",
    });
    expect(cannons.cannonsRuns![1].reportPath).toBeNull();
    expect(cannons.truncated).toBe(false);
    expect(cannons.repo).toBe("company");

    const codex = sigs.find((s) => s.ledger === "codex_invocations")!;
    expect(codex.codexRows).toHaveLength(2);
    expect(codex.cannonsRuns).toBeUndefined();
    expect(codex.codexRows![1]).toEqual({
      t: "2026-07-09T00:00:00Z",
      consumer: "reviewer",
      repo: "juice-bar",
      success: false,
      model: "gpt-5.6-sol",
    });
  });

  it("truncated tail: drops the first (possibly partial) line and flags truncated", async () => {
    const ctx = makeFixtureContext({
      logs: {
        cannons_runs: { content: `hip juice-bar 2026-06-01T00:00:00Z\n${CANNONS}`, truncated: true, mtime: "2026-07-09T12:00:00.000Z" },
      },
    });
    const batch = await dispatchLedgerSource.collect(ctx);
    const sig = batch.signals.filter(isDispatchLedgerSignal)[0] as DispatchLedgerSignal;
    expect(sig.truncated).toBe(true);
    expect(sig.logMtime).toBe("2026-07-09T12:00:00.000Z");
    // The partial first line is gone; only the 2 complete rows survive.
    expect(sig.cannonsRuns).toHaveLength(2);
    expect(sig.cannonsRuns![0].runId).toBe("111-1-1");
  });

  it("malformed rows are dropped, never thrown (bad sha8, bad timestamp, non-json codex rows)", async () => {
    const ctx = makeFixtureContext({
      logs: {
        cannons_runs: ["not enough fields", "111-1-1 ZZZZZZZZ ship repo notadate", CANNONS.split("\n")[0]].join("\n"),
        codex_invocations: ['{"nope":true}', "garbage", CODEX.split("\n")[0]].join("\n"),
      },
    });
    const batch = await dispatchLedgerSource.collect(ctx);
    const sigs = batch.signals.filter(isDispatchLedgerSignal) as DispatchLedgerSignal[];
    expect(sigs.find((s) => s.ledger === "cannons_runs")!.cannonsRuns).toHaveLength(1);
    expect(sigs.find((s) => s.ledger === "codex_invocations")!.codexRows).toHaveLength(1);
  });

  it("absent ledgers (fresh machine): no signals, no errors — absence is NORMAL", async () => {
    const batch = await dispatchLedgerSource.collect(makeFixtureContext({ logs: {} }));
    expect(batch.signals).toHaveLength(0);
    expect(batch.repoFreshness).toHaveLength(0);
  });

  it("emits nothing on a scoped refresh that doesn't touch company", async () => {
    const ctx = makeFixtureContext({ scopeRepo: "juice-bar", logs: { cannons_runs: CANNONS } });
    const batch = await dispatchLedgerSource.collect(ctx);
    expect(batch.signals).toHaveLength(0);
  });
});
