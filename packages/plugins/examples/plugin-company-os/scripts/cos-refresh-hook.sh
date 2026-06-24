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
#   * Fires cos-refresh.mjs fully BACKGROUNDED under a non-blocking flock + a
#     hard `timeout` (when available), so git never waits and a hung host can
#     never wedge the hook. The .mjs also self-bounds via an AbortController.
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

# --- non-blocking, time-boxed, backgrounded dispatch -------------------------
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
LOCK_FILE="${TMPDIR:-/tmp}/cos-refresh-${COMPANY_ID}.lock"

# Pick a timeout wrapper if one exists (macOS ships neither by default; the .mjs
# AbortController is the primary bound, this is the backstop for a wedged node).
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout 20"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout 20"
fi

(
  # Non-blocking lock: if a refresh for this company is already in flight, skip
  # rather than queue — the in-flight one already captures this commit's state.
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_FILE" || exit 0
    flock -n 9 || exit 0
  fi

  SCOPE_ARGS=()
  [ -n "$SCOPE_REPO" ] && SCOPE_ARGS=(--scope "$SCOPE_REPO")

  # shellcheck disable=SC2086
  # `${arr[@]+...}` guards the empty-array expansion under `set -u` on bash 3.2 (macOS default).
  $TIMEOUT_BIN "$NODE_BIN" "$REFRESH_SCRIPT" \
    --company "$COMPANY_ID" \
    ${SCOPE_ARGS[@]+"${SCOPE_ARGS[@]}"} \
    --quiet \
    >>"$LOG_FILE" 2>&1 || true
) >/dev/null 2>&1 &

# Detach so git's hook wait returns immediately regardless of the refresh.
disown 2>/dev/null || true
exit 0
