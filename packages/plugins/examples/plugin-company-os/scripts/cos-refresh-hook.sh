#!/usr/bin/env bash
# cos-refresh-hook.sh — machine-local COS board-refresh dispatcher.
#
# Installed to ~/.claude/hooks/cos-refresh-hook.sh by install-cos-hooks.sh, this
# mirrors the existing managed-hook pattern (graphify-update-unified.sh /
# reviewer-dispatch.sh): the repos' tracked .githooks/post-commit + post-merge
# carry only a 3-line `[ -x "$HOME/.claude/hooks/cos-refresh-hook.sh" ] && ... ||
# true` guard, so the dispatch is completely inert on any machine that has not
# installed this script. ALL the machine-specific behaviour lives here + in the
# untracked config it sources, so nothing machine-specific ever lands in a
# tracked hook file.
#
# Behaviour:
#   * Kill-switch: COS_HOOKS_DISABLED (1/true/yes/on) → immediate no-op.
#   * Sources ~/.config/cos-company-os/config.env for COS_COMPANY_ID,
#     COS_REFRESH_SCRIPT, COS_HOST, COS_PLUGIN_KEY, COS_NODE_BIN.
#   * Resolves the refresh scope from the MAIN checkout of the firing repo
#     (worktree-safe via --git-common-dir), so a juice-bar commit re-scopes only
#     juice-bar; an unresolved scope degrades to a (correct) full sweep.
#   * Fires cos-refresh.mjs fully BACKGROUNDED under a non-blocking `mkdir`
#     lock + a sleep/kill watchdog (stock macOS ships neither `flock` nor
#     `timeout`), so git never waits and a hung host can never wedge the hook.
#     The .mjs also self-bounds via an AbortController.
#   * config.env is `bash -n`-checked, then executed ONCE in a subshell and only
#     the known COS_* keys are imported as exports (so the .mjs env knobs
#     COS_ALLOW_NONLOOPBACK / COS_REFRESH_TIMEOUT_MS work, and nothing else in
#     the file — options, scope, side effects on this shell — can leak). COS_HOST /
#     COS_PLUGIN_KEY also travel as explicit `--host` / `--plugin` args so the
#     wire contract is visible in `ps` and independent of the export path.
#     COS_SCOPE_REPO is UNSET after sourcing: scope comes from the firing repo
#     only, never from config (an exported config value would re-scope every
#     repo's commit). Each dispatch appends `<utc> event=<hook> scope=<repo>` and
#     the child's one-line JSON outcome to refresh.log (no --quiet).
#   * Never fails the hook: every path returns 0.
#   * Known limits (deferred, cannons 2026-08-18): the lock is company-wide and
#     non-queuing, so any hook landing while a dispatch is live (~8s child
#     budget) is dropped — a burst of commits/rebase/amend in ONE repo yields one
#     refresh, and a second repo's commit in that window waits for the next
#     scheduled sweep; stale-lock reclaim is check-then-rm without ownership.
#     Bounded by the watchdog + the server-side per-company derive lock; a
#     queued/owned lock is follow-up work. Callers (tracked .githooks guards):
#     company post-commit + post-merge; juice-bar, arc-scraper, viacava-arts
#     post-commit (no post-merge hook exists in those three).
#   * config.env is the INSTALLER-written key=value file (%q-quoted). It is
#     read defensively (see below) but not adversarially: a file that `exit`s,
#     `set -e`s over a failing command, or otherwise ends the import subshell
#     early yields a silent no-op dispatch (rc 0) — by design, not a bug.
#
# Usage (from a hook): cos-refresh-hook.sh <post-commit|post-merge|manual>

set -u

HOOK_EVENT="${1:-manual}"

# --- kill-switch -------------------------------------------------------------
case "${COS_HOOKS_DISABLED:-}" in
  1 | true | yes | on | TRUE | YES | ON) exit 0 ;;
esac

# --- config ------------------------------------------------------------------
# `set -u` + a hook fired without HOME (some CI/launchd contexts): this is a
# per-user machine-local dispatcher (config + log live under $HOME) — with no
# HOME there is nothing safe to do (a /tmp fallback would be world-writable and
# attacker-predictable — cannons 2026-08-18 claude P2). Exit 0, never error.
[ -n "${HOME:-}" ] || exit 0
COS_CONFIG_FILE="${COS_CONFIG_FILE:-$HOME/.config/cos-company-os/config.env}"
if [ -r "$COS_CONFIG_FILE" ]; then
  # Import config through a SUBSHELL, once, whitelisted (cannons 2026-08-18
  # claude P2 x4): the file is executed exactly one time, in a child shell —
  # so a `set -x`/`set -e`, a trailing non-zero command, or a stray `exit` can
  # neither leak options into this hook nor error it — and ONLY the known
  # COS_* keys are imported (as exports, so the .mjs env knobs work). Anything
  # else the file sets (COS_SCOPE_REPO included) never reaches this shell.
  # `bash -n` first so a syntax error is a silent no-op, not stderr into git.
  bash -n "$COS_CONFIG_FILE" >/dev/null 2>&1 || exit 0
  cos_import="$(
    {
      # shellcheck disable=SC1090
      . "$COS_CONFIG_FILE" >/dev/null 2>&1
      set +exv   # options the file may have flipped stay in THIS subshell and are cleared before export
      for v in COS_COMPANY_ID COS_REFRESH_SCRIPT COS_HOST COS_PLUGIN_KEY COS_NODE_BIN \
               COS_LOG_FILE COS_HOOKS_DISABLED COS_ALLOW_NONLOOPBACK \
               COS_REFRESH_TIMEOUT_MS COS_REFRESH_WATCHDOG_SECS; do
        if [ -n "${!v+x}" ]; then printf 'export %s=%q\n' "$v" "${!v}"; fi
      done
    } 2>/dev/null
  )" || cos_import=""
  # Only well-formed `export COS_X=<%q value>` lines are eval'd: anything else
  # the subshell emitted (a config EXIT trap's echo, stray stdout) is dropped,
  # never executed or leaked to git's stderr (cannons 2026-08-18 claude P1).
  cos_import="$(printf '%s\n' "$cos_import" | grep -E '^export COS_[A-Z_]+=' || true)"
  eval "$cos_import"
fi
# Scope is derived from the FIRING repo below — never from config OR ambient
# env (cos-refresh.mjs falls back to env.COS_SCOPE_REPO when --scope is absent),
# so unset it UNCONDITIONALLY, config or no config (cannons 2026-08-18 codex P2).
unset COS_SCOPE_REPO

# Re-check the kill-switch after sourcing (config may set it persistently).
case "${COS_HOOKS_DISABLED:-}" in
  1 | true | yes | on | TRUE | YES | ON) exit 0 ;;
esac

COMPANY_ID="${COS_COMPANY_ID:-}"
REFRESH_SCRIPT="${COS_REFRESH_SCRIPT:-}"
HOST_URL="${COS_HOST:-}"
PLUGIN_KEY="${COS_PLUGIN_KEY:-}"
NODE_BIN="${COS_NODE_BIN:-node}"
LOG_FILE="${COS_LOG_FILE:-$HOME/.config/cos-company-os/refresh.log}"

# Nothing to do without the essentials — silent no-op (not an error).
[ -n "$COMPANY_ID" ] || exit 0
[ -n "$REFRESH_SCRIPT" ] && [ -f "$REFRESH_SCRIPT" ] || exit 0

# --- resolve the firing repo's MAIN-checkout scope (worktree-safe) -----------
SCOPE_REPO=""
GCD="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -n "$GCD" ]; then
  case "$GCD" in
    /*) : ;;
    *) GCD="$(pwd)/$GCD" ;;
  esac
  MAIN_ROOT="$(cd "$GCD/.." 2>/dev/null && pwd || true)"
  [ -n "$MAIN_ROOT" ] && SCOPE_REPO="$(basename "$MAIN_ROOT")"
fi

# --- non-blocking, watchdog-bounded, backgrounded dispatch -------------------
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
# Logging is best-effort: an unwritable log path must lose the log line, never
# the dispatch (the child's `>>` redirect would otherwise abort the command).
if ! ( : >>"$LOG_FILE" ) 2>/dev/null; then LOG_FILE=/dev/null; fi
# Sanitize the lock key (defensive — the installer already constrains the id).
LOCK_KEY="$(printf '%s' "$COMPANY_ID" | tr -c 'A-Za-z0-9._-' '_')"
# Per-user lock dir (NOT /tmp: a shared sticky /tmp lets another local user
# pre-create the lock and silently disable the hook — cannons 2026-08-18). The
# path is FIXED under $HOME (no override: an ambient override would be rm -rf'd
# by reclaim/cleanup — codex P1); tests isolate via HOME. Parent created here —
# `mkdir` (non-recursive) below must never fail on a missing parent (claude P1).
LOCK_PARENT="$HOME/.config/cos-company-os"
mkdir -p "$LOCK_PARENT" 2>/dev/null || exit 0
LOCK_DIR="$LOCK_PARENT/cos-refresh-${LOCK_KEY}.lock"
WATCHDOG_SECS="${COS_REFRESH_WATCHDOG_SECS:-25}"
# Validate: positive integer, else the 25s default (a garbage value must not
# disable the watchdog or make `sleep` fail).
case "$WATCHDOG_SECS" in
  ''|*[!0-9]*|0*|?????*) WATCHDOG_SECS=25 ;;   # empty, non-digit, leading zero (0/00/08 → octal trap), or >4 digits (bash 3.2 integer wrap — cannons codex P2)
esac
# Bound it: 5s..600s (a huge value would keep the stale-lock threshold — and a
# wedged child — alive for hours). Force base 10 for the comparison.
if [ "$((10#$WATCHDOG_SECS))" -lt 5 ] || [ "$((10#$WATCHDOG_SECS))" -gt 600 ]; then WATCHDOG_SECS=25; fi
# Stale-lock threshold DERIVED from the watchdog (never below it): a lock older
# than watchdog + 60s belongs to a dispatch the watchdog has already killed.
# `find -mmin` is minute-granular, so round up. (cannons 2026-08-18: the fixed
# 2-minute threshold could reclaim a LIVE dispatch when the watchdog was >120s.)
STALE_MIN=$(( (WATCHDOG_SECS + 60 + 59) / 60 ))

(
  # Portable, atomic, non-blocking lock via `mkdir` — no `flock` dependency
  # (stock macOS ships none). Reclaim a stale lock left by a crashed prior
  # dispatch (older than the watchdog window).
  if [ -d "$LOCK_DIR" ] && [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin "+$STALE_MIN" 2>/dev/null)" ]; then
    rm -rf "$LOCK_DIR" 2>/dev/null || true
  fi
  mkdir "$LOCK_DIR" 2>/dev/null || exit 0   # another dispatch holds it → skip (it already captured this state)
  trap 'rm -rf "$LOCK_DIR" 2>/dev/null || true' EXIT

  SCOPE_ARGS=()
  [ -n "$SCOPE_REPO" ] && SCOPE_ARGS=(--scope "$SCOPE_REPO")
  # Configured host / plugin key travel as explicit args (see header); absent →
  # the .mjs defaults apply exactly as before.
  HOST_ARGS=()
  [ -n "$HOST_URL" ] && HOST_ARGS=(--host "$HOST_URL")
  PLUGIN_ARGS=()
  [ -n "$PLUGIN_KEY" ] && PLUGIN_ARGS=(--plugin "$PLUGIN_KEY")

  # Bound the log: keep the newest ~200 lines once it passes 256 KiB (no
  # newsyslog/logrotate covers this path — cannons 2026-08-18 claude P2).
  if [ "$LOG_FILE" != /dev/null ] && [ -f "$LOG_FILE" ] && [ "$(wc -c <"$LOG_FILE" 2>/dev/null || echo 0)" -gt 262144 ]; then
    tail -n 200 "$LOG_FILE" >"$LOG_FILE.tmp" 2>/dev/null && mv -f "$LOG_FILE.tmp" "$LOG_FILE" 2>/dev/null || true
  fi
  # One line per dispatch so refresh.log answers "did the hook fire, for what":
  # the child's own one-line JSON outcome follows (no --quiet: with it the log
  # stayed empty by construction — cannons 2026-08-18 claude P1).
  printf '%s event=%s scope=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HOOK_EVENT" "${SCOPE_REPO:-<full>}" >>"$LOG_FILE" 2>/dev/null || true

  # `${arr[@]+...}` guards the empty-array expansion under `set -u` on bash 3.2.
  "$NODE_BIN" "$REFRESH_SCRIPT" \
    --company "$COMPANY_ID" \
    ${SCOPE_ARGS[@]+"${SCOPE_ARGS[@]}"} \
    ${HOST_ARGS[@]+"${HOST_ARGS[@]}"} \
    ${PLUGIN_ARGS[@]+"${PLUGIN_ARGS[@]}"} \
    >>"$LOG_FILE" 2>&1 &
  CHILD=$!

  # Watchdog: bound a wedged Node even where `timeout` is absent. The .mjs
  # AbortController is the primary ~8s bound; this is the hard backstop.
  # The guard traps TERM: cancelling it kills ITS sleep and exits WITHOUT
  # entering the kill body (a bare kill orphaned the sleep; killing the sleep
  # alone made the guard fall through and TERM a reaped pid — cannons
  # 2026-08-18 claude/codex P2).
  (
    SLP=""
    trap 'kill "${SLP:-}" 2>/dev/null; exit 0' TERM
    sleep "$WATCHDOG_SECS" & SLP=$!
    # A TERM that landed before SLP was set could not kill the sleep; re-check
    # so a fast child never leaves a stray sleep behind (claude P2 race).
    wait "$SLP" 2>/dev/null || exit 0
    kill -TERM "$CHILD" 2>/dev/null; sleep 2; kill -KILL "$CHILD" 2>/dev/null
  ) &
  GUARD=$!

  wait "$CHILD" 2>/dev/null || true
  kill -TERM "$GUARD" 2>/dev/null || true   # child finished first → cancel the watchdog (+ its sleep)
  wait "$GUARD" 2>/dev/null || true
) >/dev/null 2>&1 &

# Detach so git's hook wait returns immediately regardless of the refresh.
disown 2>/dev/null || true
exit 0
