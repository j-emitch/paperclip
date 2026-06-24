# Company OS cockpit — triggers, hooks & kill-switch (COS-0g)

The board has **two refresh paths**, by design:

1. **The scheduled `derive-board` job** (every 5 minutes, per company, jitter-spread,
   under the atomic cache lock) — **this is the source of truth.** It always runs,
   needs no hooks, and fully re-derives every repo's lanes.
2. **The opt-in git hook fast-path** — a `post-commit`/`post-merge` hook fires
   `cos-refresh.mjs`, which POSTs the worker's `refresh-board` action so a merge
   shows up on the board in *seconds* instead of waiting for the next job tick.
   The hook is a pure latency optimization; if it never fires, the job still keeps
   the board fresh within ≤5 minutes.

Because the hook only *speeds up* something the job already guarantees, every
failure mode degrades gracefully to "job-only refresh" — nothing breaks.

## Pieces

| File | Role |
| --- | --- |
| `cos-refresh.mjs` | Standalone, ~zero-dependency CLI. POSTs `refresh-board` over loopback. Self-bounded by an `AbortController`. Exits 0 for every outcome (never blocks git). |
| `cos-refresh-hook.sh` | Machine-local dispatcher installed to `~/.claude/hooks/`. Applies the kill-switch, a non-blocking `flock`, a backstop `timeout`, resolves the firing repo's scope (worktree-safe), and fires `cos-refresh.mjs` fully backgrounded. |
| `install-cos-hooks.sh` | Idempotent, opt-in installer. Writes the dispatcher + machine config, appends a generic sentinel block to each repo's effective `post-commit`/`post-merge`, records a manifest. |
| `uninstall-cos-hooks.sh` | Strips only the sentinel block (preserving pre-existing hooks), removes installer-created files, deletes config/dispatcher/manifest. |

### Why this shape (managed `core.hooksPath`)

The Lycaon repos use a **managed, version-controlled `core.hooksPath` (`.githooks`)**,
not `.git/hooks/`, and the existing hooks already follow a clean convention: a thin
*tracked* dispatcher that calls machine-local `~/.claude/hooks/*.sh` scripts guarded
by `[ -x ]` (inert where absent) with `|| true` (non-fatal). COS-0g mirrors that exactly.

The sentinel block appended to a tracked hook carries **zero machine specifics**
(company id, host, paths, node binary all live in the machine-local dispatcher +
`~/.config/cos-company-os/config.env`), so the block is safe to commit and is a
complete no-op on any machine that has not run the installer.

## Install (opt-in, per repo)

```bash
# the repo containing CWD:
scripts/install-cos-hooks.sh --company <company-uuid>

# explicit repos (e.g. all four Lycaon checkouts):
scripts/install-cos-hooks.sh --company <uuid> \
  --repo ~/projects/juice-bar \
  --repo ~/projects/arc-scraper \
  --repo ~/projects/company \
  --repo ~/projects/paperclip/paperclip

# preview without writing:
scripts/install-cos-hooks.sh --company <uuid> --dry-run
```

The company UUID for the live host is discoverable via `GET /api/companies`
(the "Lycaon Mile" company). The installer is idempotent — re-running updates the
block in place (never duplicates it).

## Kill-switch

```bash
export COS_HOOKS_DISABLED=1          # instant no-op for the current shell
# …or persist it in the config the dispatcher sources:
echo 'COS_HOOKS_DISABLED=1' >> ~/.config/cos-company-os/config.env
```

The dispatcher and `cos-refresh.mjs` both honor `COS_HOOKS_DISABLED` before any
work, so the hook becomes an immediate no-op without uninstalling.

## Auth dependency & graceful degrade

The tokenless loopback POST works **only** under the host's `local_trusted`
deployment mode (which auto-elevates loopback requests to an implicit
instance-admin). Under `authenticated` mode the POST returns 401/403 and
`cos-refresh.mjs` treats it as a graceful no-op — the board falls back to
job-only refresh. Host down, network error, and timeout all degrade the same way.

## Hardening (reviewed surface)

- **SSRF guard:** `cos-refresh.mjs` refuses any non-loopback host, embedded
  credentials, or non-`http(s)` scheme (the hook is a local fast-path). The
  future cloud seam opts out with `COS_ALLOW_NONLOOPBACK=1`.
- **Injection-safe config:** `config.env` values are written shell-quoted (`%q`),
  so a host/path containing shell metacharacters can never execute when the
  dispatcher sources the file. The company id is constrained to `[A-Za-z0-9._-]+`.
- **Non-destructive strip:** the installer/uninstaller only remove a *matched*
  `>>> … <<<` block; a corrupted block (START with no END) is left intact rather
  than truncating a user's real hook tail.
- **Symlink-escape guard:** the installer refuses to write through a symlinked
  hook file.
- **Portable watchdog:** the dispatcher uses an atomic `mkdir` lock (no `flock`
  dependency) and a `sleep`-based watchdog (no `timeout` dependency), so a wedged
  Node can't leak a process on stock macOS. The `cos-refresh.mjs` AbortController
  is the primary ~8s bound; the watchdog is the hard backstop.
- The shared, security-critical logic (markers, hooks-dir resolution, block
  strip, sha) lives in one sourced `cos-hook-lib.sh` so install + uninstall can't
  drift. Uninstall reads a shell-readable TSV manifest, so it needs no Node.

## Uninstall & rollback

```bash
scripts/uninstall-cos-hooks.sh            # strip blocks + remove machine-local files
scripts/uninstall-cos-hooks.sh --dry-run  # preview
```

Uninstall is non-destructive to your data: it does **not** drop the plugin's DB
cache schema. To fully roll back the plugin's storage (a deliberate, separate
destructive step):

```bash
psql "$DATABASE_URL" -c 'DROP SCHEMA plugin_company_os_cc959257d2 CASCADE;'
```
