/**
 * In-memory `CollectionContext` fixtures. The entire point of the COS-0c seam:
 * every source is testable with canned git/gh output + an in-memory filesystem
 * and ZERO Node/host dependency. These helpers build that context.
 */

import type {
  Clock,
  CollectionContext,
  GhRunner,
  GitRunner,
  RepoRoot,
  SignalLogger,
  SubprocessResult,
  WorkspaceFileStat,
  WorkspaceReader,
} from "../../src/contracts/collection-context.js";
import type { RegistryEntry, RegistryLoadResult, RegistryLoader } from "../../src/contracts/registry.js";
import { matchesAnyGlob } from "../../src/sources/glob.js";

export const FIXED_NOW = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z
export const fixedClock: Clock = { now: () => FIXED_NOW };
export const silentLogger: SignalLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** Convenience subprocess result builders. */
export const proc = {
  ok: (stdout: string): SubprocessResult => ({ stdout, stderr: "", code: 0, timedOut: false }),
  fail: (code: number, stderr = ""): SubprocessResult => ({ stdout: "", stderr, code, timedOut: false }),
  timeout: (): SubprocessResult => ({ stdout: "", stderr: "timed out", code: null, timedOut: true }),
  unauth: (): SubprocessResult => ({ stdout: "", stderr: "gh auth: not logged into any GitHub hosts", code: 1, timedOut: false }),
  rateLimited: (): SubprocessResult => ({ stdout: "", stderr: "API rate limit exceeded", code: 1, timedOut: false }),
};

/** A simple deterministic content hash for fixtures (NOT cryptographic). */
export function fixtureHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `h${input.length}_${h.toString(16)}`;
}

/** One in-memory file. */
export interface FixtureFile {
  readonly content: string;
  readonly mtime?: string;
  readonly sizeBytes?: number;
  readonly isSymlink?: boolean;
}

/** repo key → (relPath → file). */
export type FixtureFs = Record<string, Record<string, FixtureFile>>;

/** A git/gh responder: maps `(repo, args)` to a result. */
export type ProcResponder = (repo: string, args: readonly string[]) => SubprocessResult;

export interface FixtureOptions {
  repos?: RepoRoot[];
  scopeRepo?: string | null;
  git?: ProcResponder;
  gh?: ProcResponder;
  files?: FixtureFs;
  registry?: RegistryEntry[] | (() => Promise<RegistryLoadResult>);
}

const DEFAULT_REPOS: RepoRoot[] = [
  { repo: "juice-bar", available: true },
  { repo: "company", available: true },
  { repo: "arc-scraper", available: true },
];

function makeFs(files: FixtureFs): WorkspaceReader {
  const statOf = (repo: string, relPath: string): WorkspaceFileStat | null => {
    const f = files[repo]?.[relPath];
    if (!f) return null;
    return {
      relPath,
      sizeBytes: f.sizeBytes ?? f.content.length,
      mtime: f.mtime ?? "2026-06-20T00:00:00.000Z",
      isSymlink: f.isSymlink ?? false,
    };
  };
  return {
    async list(repo, globs) {
      const repoFiles = files[repo] ?? {};
      return Object.keys(repoFiles)
        .filter((rel) => matchesAnyGlob(rel, globs))
        .sort()
        .map((rel) => statOf(repo, rel)!);
    },
    async readText(repo, relPath) {
      const f = files[repo]?.[relPath];
      if (!f) throw new Error(`fixture: no file ${repo}:${relPath}`);
      return f.content;
    },
    async stat(repo, relPath) {
      return statOf(repo, relPath);
    },
  };
}

/** Build a fixture `CollectionContext` from canned inputs. */
export function makeFixtureContext(opts: FixtureOptions = {}): CollectionContext {
  const git: GitRunner = { run: async (repo, args) => (opts.git ?? (() => proc.ok("")))(repo, args) };
  const gh: GhRunner = { run: async (repo, args) => (opts.gh ?? (() => proc.ok("[]")))(repo, args) };
  const registry: RegistryLoader = {
    load: async () => {
      if (typeof opts.registry === "function") return opts.registry();
      return { entries: opts.registry ?? [], errors: [] };
    },
  };
  return {
    repos: opts.repos ?? DEFAULT_REPOS,
    scopeRepo: opts.scopeRepo ?? null,
    git,
    gh,
    fs: makeFs(opts.files ?? {}),
    clock: fixedClock,
    logger: silentLogger,
    registry,
    hash: fixtureHash,
  };
}

/** Build a git responder from a `{ "<argv joined>" : result }` table (prefix match). */
export function gitTable(table: Record<string, SubprocessResult>): ProcResponder {
  return (_repo, args) => {
    const key = args.join(" ");
    for (const [pattern, result] of Object.entries(table)) {
      if (key.startsWith(pattern)) return result;
    }
    return proc.ok("");
  };
}
