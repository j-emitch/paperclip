# CLAUDE.md — j-emitch/paperclip FORK (lycaon)

**Fork-only file. Never include it in an upstream PR** (fork guidance leaked into
`AGENTS.md` once and upstream had to strip it — upstream `1e44e5036`, #9935).
Upstream conventions live in `AGENTS.md`; this file adds ONLY what is specific
to this fork. Global `~/.claude/CLAUDE.md` + `company/config/rules/*` already load
in every session — do not duplicate them here.

## What this fork is

- Upstream `paperclipai/paperclip` + the **Company OS cockpit plugin**
  (`packages/plugins/examples/plugin-company-os`) that Joe runs as his
  daily-driver dev-plane surface. Source of truth for the plugin:
  `company/docs/company-os/16-cockpit-plugin.md` (doc-16) — its §4 registry is
  machine-checked (`company/scripts/audit-cos-registry.sh check`); a PR touching
  `src/sources/index.ts`, `src/projections/index.ts` / `derive*.ts`,
  `src/ui/tabs.ts`, `migrations/`, or `src/manifest.ts` updates that block in
  the same change.
- **Trunk is `lycaon`, not `main`/`master`.** PRs base on `lycaon`. `master` is
  a stale upstream mirror. The global pre-push hook only guards `main`/`master`,
  so it does NOT protect `lycaon` — branch + PR discipline is on you.
- Upstream sync: branch `chore/paperclip-upstream-YYYYMMDD` (merge
  `upstream/master`), gate = plugin suite + `tsc` + e2e + **one live derive
  with `derivedAt` advancing** (see below) + `audit-cos-registry.sh check`.
  Cadence: monthly, or before any plugin PR, whichever first (M8 item 3).

## The live server (read before touching `~/projects/paperclip/paperclip`)

- `~/projects/paperclip/paperclip` on `lycaon` IS the running server
  (`127.0.0.1:3100`, launchd `com.lycaon.paperclip-server`,
  `~/.paperclip/start-server.sh`). Treat it as single-tenant + live:
  **never `git checkout` there while the server runs**; do work in a worktree
  (`git worktree add ../<name> -b <branch> origin/lycaon`).
- **Merged is not running.** The server loads the plugin from
  `packages/plugins/examples/plugin-company-os/dist/` — a **gitignored build**.
  After a plugin PR merges: in the live checkout `git pull --ff-only` →
  `COS_TEACHING_TAB_ENABLED=1 pnpm build` in the plugin dir → restart the worker
  (`POST /api/plugins/<pluginId>/disable` then `/enable`) → confirm the next
  `derive-board` tick logs `derived:1` and `POST …/data/board-state
  {"companyId":…}` returns an advancing `derivedAt`. Skipping the rebuild is how
  the cockpit froze for 6 days in Aug 2026 (PR #6).
- Logs: `~/.paperclip/instances/default/logs/launchd-stdout.log`. Plugin id
  `2070fcb7-0bbe-4626-86af-ce5080d5bda1`, key `lycaon.company-os`, company
  `64ce294e-5e04-4cca-8f10-71c9732258b2`.

## Working in the plugin

- Fresh worktree needs `pnpm install --offline --frozen-lockfile` and
  `pnpm --filter @paperclipai/plugin-sdk build` before the plugin suite resolves.
- From the plugin dir: `npx tsc --noEmit` · `pnpm test` (vitest, ~930 cases,
  <10s) · `pnpm build`.
- Read `worker.ts` + `derive.ts` before touching host calls: config reads are
  **company-scoped** on the host — anything running outside a host-issued
  invocation (the scheduled job) must pass `companyId` explicitly.
- Refresh paths: cron `derive-board` (`*/5`) + git-hook fast path
  (`~/.claude/hooks/cos-refresh-hook.sh`, tracked in `company/config/hooks/`,
  config in `~/.config/cos-company-os/config.env`).

## Hooks in this repo

`core.hooksPath` = `~/.claude/hooks` (the global Claude hooks dir → global
`pre-commit` tsc gate, `pre-push` main/master guard). The company git-hooks
(commit-msg lint, cannons pre-push, cos post-commit refresh) are **not**
installed here; to opt in run `bash ~/projects/company/scripts/install-hooks.sh
~/projects/paperclip/paperclip` (sets `core.hooksPath=.githooks`; a Joe
decision — it changes the live checkout's git config).

## Known pre-existing noise

- Root `tsconfig.json` references a missing `packages/adapters/droid-local`
  (upstream sync artifact); the global pre-commit prints it and still passes.
- Manual `POST /api/plugins/<id>/jobs/<jobId>/trigger` returns 400 "already has
  a running execution" (stale `running` run row); use the 5-min tick.
