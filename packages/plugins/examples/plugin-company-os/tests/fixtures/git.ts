/**
 * Argv-keyed git runner stub for the BranchSource golden tests. Builds a
 * `CollectionContext` whose `git.run(repo, args)` returns canned `SubprocessResult`s
 * by inspecting the argv — so a source is tested against deterministic git output
 * with zero host/Node deps. Helpers construct the exact `for-each-ref` /
 * `worktree list --porcelain` / `--shortstat log` byte formats the parsers expect.
 */

import type { CollectionContext, SubprocessResult, Clock } from "../../src/contracts/collection-context.js";

const US = "\x1f";
const RS = "\x1e";

export const OK = (stdout = ""): SubprocessResult => ({ stdout, stderr: "", code: 0, timedOut: false });
export const FAIL = (stderr = "", code = 128): SubprocessResult => ({ stdout: "", stderr, code, timedOut: false });

/** Build one `for-each-ref --format=FOR_EACH_REF_FORMAT` stream. */
export function forEachRef(rows: ReadonlyArray<readonly [branch: string, sha: string, date: string]>): string {
  return rows.map(([b, s, d]) => `${b}${US}${s}${US}${d}`).join("\n");
}

/** Build one `worktree list --porcelain` block. */
export function worktreeBlock(path: string, head: string, branch: string | null): string {
  const lines = [`worktree ${path}`, `HEAD ${head}`];
  lines.push(branch === null ? "detached" : `branch refs/heads/${branch}`);
  return lines.join("\n");
}

export function worktreeList(blocks: readonly string[]): string {
  return blocks.join("\n\n");
}

export interface FixtureCommit {
  readonly sha: string;
  readonly subject: string;
  readonly author: string;
  readonly date: string;
  /** Raw `--shortstat` summary line, e.g. "3 files changed, 40 insertions(+), 5 deletions(-)". */
  readonly shortstat?: string;
}

/** Build one `log --shortstat --format=BRANCH_LOG_FORMAT` stream. */
export function branchLog(commits: readonly FixtureCommit[]): string {
  return commits
    .map((c) => `${RS}${c.sha}${US}${c.subject}${US}${c.author}${US}${c.date}${c.shortstat ? `\n ${c.shortstat}` : ""}`)
    .join("\n");
}

/** A clock that advances `step` ms on every read (to exercise the per-repo budget). */
export function advancingClock(start: number, step: number): Clock {
  let t = start;
  return {
    now() {
      const v = t;
      t += step;
      return v;
    },
  };
}

export interface GitFixtureOpts {
  readonly repos?: ReadonlyArray<{ repo: string; available: boolean }>;
  readonly scopeRepo?: string | null;
  readonly handler: (repo: string, args: readonly string[]) => SubprocessResult;
  readonly now?: number;
  readonly clock?: Clock;
}

export function gitFixtureContext(opts: GitFixtureOpts): CollectionContext {
  const repos = opts.repos ?? [{ repo: "juice-bar", available: true }];
  const clock: Clock = opts.clock ?? { now: () => opts.now ?? 1_700_000_000_000 };
  const notUsed = (): never => {
    throw new Error("runner must not be touched by this fixture");
  };
  return {
    repos,
    worktrees: [],
    scopeRepo: opts.scopeRepo ?? null,
    git: { run: (repo, args) => Promise.resolve(opts.handler(repo, args)) },
    gh: { run: notUsed },
    fs: { list: async () => [], readText: async () => "", readTextHead: async () => "", stat: async () => null },
    clock,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registry: { load: async () => ({ entries: [], errors: [] }) },
    lineage: { load: async () => ({ data: null, errors: [] }) },
    hash: (input: string) => `stub:${input.length}`,
  };
}

/** Match helper: does the argv contain a token (or a token with a given prefix)? */
export function hasArg(args: readonly string[], token: string): boolean {
  return args.includes(token);
}

export function argvStartsWith(args: readonly string[], verb: string): boolean {
  return args[0] === verb;
}
