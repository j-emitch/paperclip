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
#   * Passes COS_HOST / COS_PLUGIN_KEY from config.env to the child EXPLICITLY
#     (`--host` / `--plugin`): the sourced assignments are not exported, so a
#     custom host or plugin key would otherwise silently fall back to the .mjs
#     defaults (cannons 2026-08-18 codex P1).
#   * Never fails the hook: every path returns 0.
#
# Usage (from a hook): cos-refresh-hook.sh <post-commit|post-merge|manual>

set -u

HOOK_EVENT="${1:-manual}"

# --- kill-switch -------------------------------------------------------------
case "${COS_HOOKS_DISABLED:-}" in
  1 | true | yes | on | TRUE | YES | ON) exit 0 ;;
esac

# --- config ------------------------------------------------------------------
COS_CONFIG_FILE="${COS_CONFIG_FILE:-$HOME/.config/cos-company-os/config.env}"
if [ -r "$COS_CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  . "$COS_CONFIG_FILE"
fi

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
# Sanitize the lock key (defensive — the installer already constrains the id).
LOCK_KEY="$(printf '%s' "$COMPANY_ID" | tr -c 'A-Za-z0-9._-' '_')"
LOCK_DIR="${TMPDIR:-/tmp}/cos-refresh-${LOCK_KEY}.lock"
WATCHDOG_SECS="${COS_REFRESH_WATCHDOG_SECS:-25}"

(
  # Portable, atomic, non-blocking lock via `mkdir` — no `flock` dependency
  # (stock macOS ships none). Reclaim a stale lock left by a crashed prior
  # dispatch (older than the watchdog window).
  if [ -d "$LOCK_DIR" ] && [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +2 2>/dev/null)" ]; then
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

  # `${arr[@]+...}` guards the empty-array expansion under `set -u` on bash 3.2.
  "$NODE_BIN" "$REFRESH_SCRIPT" \
    --company "$COMPANY_ID" \
    ${SCOPE_ARGS[@]+"${SCOPE_ARGS[@]}"} \
    ${HOST_ARGS[@]+"${HOST_ARGS[@]}"} \
    ${PLUGIN_ARGS[@]+"${PLUGIN_ARGS[@]}"} \
    --quiet \
    >>"$LOG_FILE" 2>&1 &
  CHILD=$!

  # Watchdog: bound a wedged Node even where `timeout` is absent. The .mjs
  # AbortController is the primary ~8s bound; this is the hard backstop.
  ( sleep "$WATCHDOG_SECS"; kill -TERM "$CHILD" 2>/dev/null; sleep 2; kill -KILL "$CHILD" 2>/dev/null ) &
  GUARD=$!

  wait "$CHILD" 2>/dev/null || true
  kill "$GUARD" 2>/dev/null || true   # child finished first → cancel the watchdog
  wait "$GUARD" 2>/dev/null || true
) >/dev/null 2>&1 &

# Detach so git's hook wait returns immediately regardless of the refresh.
disown 2>/dev/null || true
exit 0
