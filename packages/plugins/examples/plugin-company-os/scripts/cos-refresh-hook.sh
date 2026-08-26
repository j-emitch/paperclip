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
#   * Imports ~/.config/cos-company-os/config.env for COS_COMPANY_ID,
#     COS_REFRESH_SCRIPT, COS_HOST, COS_PLUGIN_KEY, COS_NODE_BIN under a bounded
#     whitelist-only subshell.
#   * Resolves the refresh scope from the MAIN checkout of the firing repo
#     (worktree-safe via --git-common-dir), so a juice-bar commit re-scopes only
#     juice-bar; an unresolved scope degrades to a (correct) full sweep.
#   * Fires cos-refresh.mjs fully BACKGROUNDED under a non-blocking `mkdir`
#     lock + a `perl alarm` watchdog (stock macOS ships neither `flock` nor
#     `timeout`; trap-guard fallback without perl), so git never waits and a
#     hung host can never wedge the hook.
#     The .mjs also self-bounds via an AbortController.
#   * config.env is `bash -n`-checked, then executed ONCE in a subshell; only
#     the known COS_* keys come back, as NUL-delimited name/value pairs read
#     with `read -d ''` and exported (no eval, no parsing of values as shell),
#     so the .mjs env knobs COS_ALLOW_NONLOOPBACK / COS_REFRESH_TIMEOUT_MS work
#     and nothing else in the file (options, scope, output, side effects on
#     this shell) can leak. The import is watchdog-bounded and fails closed when
#     it does not finish. COS_HOST /
#     COS_PLUGIN_KEY reach the child ONLY via that exported env (never argv, so
#     the key is not in the process table). COS_SCOPE_REPO is UNSET after sourcing: scope comes from the firing repo
#     only, never from config (an exported config value would re-scope every
#     repo's commit). Each dispatch appends `<utc> event=<hook> scope=<repo>` and
#     the child's one-line JSON outcome to refresh.log (no --quiet).
#   * Never fails the hook: every path returns 0.
#   * Known limits (deferred, cannons 2026-08-18): the lock is company-wide and
#     non-queuing, so any hook landing while a dispatch is live (~8s child
#     budget) is dropped — a burst of commits/rebase/amend in ONE repo yields one
#     refresh, and a second repo's commit in that window waits for the next
#     scheduled sweep. Stale-lock reclaim checks the recorded holder PID before
#     the hard age ceiling; the remaining check-then-remove TOCTOU is accepted
#     for this single-user machine-local lock. Bounded by the watchdog + the
#     server-side per-company derive lock. Callers (tracked .githooks guards):
#     company post-commit + post-merge; juice-bar, arc-scraper, viacava-arts
#     post-commit (no post-merge hook exists in those three).
#   * config.env is the INSTALLER-written key=value file (%q-quoted). It is
#     read defensively (see below) but not adversarially: a file that `exit`s,
#     `set -e`s over a failing command, or otherwise ends the import subshell
#     early fails closed to an observable unconfigured no-op (rc 0).
#
# Usage (from a hook): cos-refresh-hook.sh <post-commit|post-merge|manual>

# An exported SHELLOPTS can enable xtrace before this fresh Bash reads line 1.
# Disable it before touching config, then remove inherited trace destinations
# and the export attribute where Bash's readonly SHELLOPTS permits it.
case ":${SHELLOPTS:-}:" in *:xtrace:*) set +x ;; esac
set +x
unset BASH_XTRACEFD 2>/dev/null || true
unset SHELLOPTS 2>/dev/null || export -n SHELLOPTS 2>/dev/null || true

set -u

# Run a command in its own process group, returning its real exit status. The
# alarm supervisor kills the whole group so descendants cannot survive a
# timed-out dispatcher. POSIX::setpgid is available in stock macOS Perl.
cos_perl_watchdog() {
  command perl -MPOSIX -e '
    my $timeout = shift @ARGV;
    my $pid = fork();
    exit 125 unless defined $pid;
    if ($pid == 0) {
      exit 125 if POSIX::setpgid(0, 0) == -1;
      exec @ARGV;
      exit 127;
    }
    local $SIG{ALRM} = sub {
      kill "TERM", -$pid;
      select undef, undef, undef, 0.25;
      kill "KILL", -$pid;
      waitpid($pid, 0);
      exit 124;
    };
    alarm $timeout;
    waitpid($pid, 0);
    alarm 0;
    my $status = $?;
    exit(($status & 127) ? 128 + ($status & 127) : $status >> 8);
  ' "$@"
}

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
  # `bash -n` first so a syntax error becomes an unconfigured no-op, not stderr
  # into git. The import gets five seconds and executes the file exactly once.
  COS_CONFIG_IMPORT_OK=0
  if command bash -n "$COS_CONFIG_FILE" >/dev/null 2>&1; then
    cos_emit_config() {
      # shellcheck disable=SC1090
      . "$1" >/dev/null 2>&1
      set +exv
      for v in COS_COMPANY_ID COS_REFRESH_SCRIPT COS_HOST COS_PLUGIN_KEY COS_NODE_BIN \
               COS_LOG_FILE COS_HOOKS_DISABLED COS_ALLOW_NONLOOPBACK \
               COS_REFRESH_TIMEOUT_MS COS_REFRESH_WATCHDOG_SECS; do
        case "${!v+x}" in (x) command printf '%s\0%s\0' "$v" "${!v}" ;; esac
      done
      command printf '%s\0%s\0' __COS_CONFIG_IMPORT_OK__ 1
    }
    export -f cos_emit_config
    # NO eval anywhere: the child emits NUL-delimited name/value pairs, and the
    # parent imports only the known names. Values are never parsed as shell.
    while IFS= read -r -d '' cos_name && IFS= read -r -d '' cos_value; do
      case "$cos_name" in
        COS_COMPANY_ID|COS_REFRESH_SCRIPT|COS_HOST|COS_PLUGIN_KEY|COS_NODE_BIN|COS_LOG_FILE|COS_HOOKS_DISABLED|COS_ALLOW_NONLOOPBACK|COS_REFRESH_TIMEOUT_MS|COS_REFRESH_WATCHDOG_SECS)
          export "$cos_name=$cos_value" ;;
        __COS_CONFIG_IMPORT_OK__)
          [ "$cos_value" = 1 ] && COS_CONFIG_IMPORT_OK=1 ;;
      esac
    done < <(
      if command -v perl >/dev/null 2>&1; then
        cos_perl_watchdog 5 bash -c 'cos_emit_config "$1"' cos-config-import "$COS_CONFIG_FILE" 2>/dev/null
      else
        command bash -c 'cos_emit_config "$1"' cos-config-import "$COS_CONFIG_FILE" 2>/dev/null &
        COS_IMPORT_PID=$!
        (
          SLP=""
          trap 'kill "${SLP:-}" 2>/dev/null; exit 0' TERM
          sleep 5 & SLP=$!
          wait "$SLP" 2>/dev/null || exit 0
          COS_IMPORT_KIDS="$(pgrep -P "$COS_IMPORT_PID" 2>/dev/null || true)"
          [ -n "$COS_IMPORT_KIDS" ] && kill -TERM $COS_IMPORT_KIDS 2>/dev/null || true
          kill -TERM "$COS_IMPORT_PID" 2>/dev/null || true
          sleep 1
          [ -n "$COS_IMPORT_KIDS" ] && kill -KILL $COS_IMPORT_KIDS 2>/dev/null || true
          kill -KILL "$COS_IMPORT_PID" 2>/dev/null || true
        ) >/dev/null 2>&1 &
        COS_IMPORT_GUARD=$!
        wait "$COS_IMPORT_PID" 2>/dev/null
        COS_IMPORT_RC=$?
        kill -TERM "$COS_IMPORT_GUARD" 2>/dev/null || true
        wait "$COS_IMPORT_GUARD" 2>/dev/null || true
        exit "$COS_IMPORT_RC"
      fi
    )
    unset -f cos_emit_config
  fi
  if [ "$COS_CONFIG_IMPORT_OK" -ne 1 ]; then
    for cos_name in COS_COMPANY_ID COS_REFRESH_SCRIPT COS_HOST COS_PLUGIN_KEY COS_NODE_BIN \
                    COS_LOG_FILE COS_HOOKS_DISABLED COS_ALLOW_NONLOOPBACK \
                    COS_REFRESH_TIMEOUT_MS COS_REFRESH_WATCHDOG_SECS; do
      unset "$cos_name"
    done
  fi
  unset COS_CONFIG_IMPORT_OK cos_name cos_value
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
NODE_BIN="${COS_NODE_BIN:-node}"
DEFAULT_LOG_FILE="$HOME/.config/cos-company-os/refresh.log"
LOG_FILE="${COS_LOG_FILE:-$DEFAULT_LOG_FILE}"

# Logging and default-path rotation happen before every observable gate. This
# also bounds lines accrued while the dispatcher remains unconfigured.
command mkdir -p "$(command dirname "$LOG_FILE")" 2>/dev/null || true
if ! ( : >>"$LOG_FILE" ) 2>/dev/null; then LOG_FILE=/dev/null; fi
if [ "$LOG_FILE" = "$DEFAULT_LOG_FILE" ] && [ -f "$LOG_FILE" ] && [ "$(command wc -c <"$LOG_FILE" 2>/dev/null || echo 0)" -gt 262144 ]; then
  command tail -n 200 "$LOG_FILE" >"$LOG_FILE.tmp" 2>/dev/null && command mv -f "$LOG_FILE.tmp" "$LOG_FILE" 2>/dev/null || true
fi

# --- resolve the firing repo's MAIN-checkout scope (worktree-safe) -----------
SCOPE_REPO=""
GCD="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -n "$GCD" ]; then
  case "$GCD" in
    /*) : ;;
    *) GCD="$(pwd)/$GCD" ;;
  esac
  MAIN_ROOT="$(cd "$GCD/.." 2>/dev/null && pwd || true)"
  [ -n "$MAIN_ROOT" ] && SCOPE_REPO="$(basename "$MAIN_ROOT" 2>/dev/null)"
fi

cos_log_outcome() {
  command printf '%s event=%s scope=%s outcome=%s%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HOOK_EVENT" "${SCOPE_REPO:-<full>}" "$1" "${2:-}" \
    >>"$LOG_FILE" 2>/dev/null || true
}

# Gate essentials before probing Node so every decided no-op has one line.
if [ -z "$COMPANY_ID" ]; then
  cos_log_outcome unconfigured " reason=company-id"
  exit 0
fi
if [ -z "$REFRESH_SCRIPT" ] || [ ! -f "$REFRESH_SCRIPT" ]; then
  cos_log_outcome unconfigured " reason=refresh-script"
  exit 0
fi
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  cos_log_outcome node-not-found " node binary not found: $NODE_BIN - dispatch skipped"
  exit 0
fi

# --- non-blocking, watchdog-bounded, backgrounded dispatch -------------------
# Sanitize the lock key (defensive — the installer already constrains the id).
LOCK_KEY="$(command printf '%s' "$COMPANY_ID" | tr -c 'A-Za-z0-9._-' '_' 2>/dev/null)"
[ -n "$LOCK_KEY" ] || LOCK_KEY="default"
# Per-user lock dir (NOT /tmp: a shared sticky /tmp lets another local user
# pre-create the lock and silently disable the hook — cannons 2026-08-18). The
# path is FIXED under $HOME (no override: an ambient override would be rm -rf'd
# by reclaim/cleanup — codex P1); tests isolate via HOME. Parent created here —
# `mkdir` (non-recursive) below must never fail on a missing parent (claude P1).
LOCK_PARENT="$HOME/.config/cos-company-os"
if ! mkdir -p "$LOCK_PARENT" 2>/dev/null; then
  cos_log_outcome lock-parent-fail
  exit 0
fi
LOCK_DIR="$LOCK_PARENT/cos-refresh-${LOCK_KEY}.lock"
WATCHDOG_SECS="${COS_REFRESH_WATCHDOG_SECS:-25}"
# Validate: positive integer, else the 25s default (a garbage value must not
# disable the watchdog or make `sleep` fail).
case "$WATCHDOG_SECS" in
  ''|*[!0-9]*|0*|?????*) WATCHDOG_SECS=25 ;;   # empty, non-digit, leading zero, or 5+ characters before arithmetic expansion
esac
# Bound it: 5s..600s (a huge value would keep the stale-lock threshold — and a
# wedged child — alive for hours). Force base 10 for the comparison.
if [ "$((10#$WATCHDOG_SECS))" -lt 5 ] || [ "$((10#$WATCHDOG_SECS))" -gt 600 ]; then WATCHDOG_SECS=25; fi
# The age check is a hard ceiling, not the normal reclaim signal. Before it,
# only a recorded dead PID is reclaimable. `find -mmin` is minute-granular, so
# round watchdog + 60s up. A live holder can still cross the ceiling between
# the ownership check and removal; accepted TOCTOU on a single-user machine.
HARD_STALE_MIN=$(( (WATCHDOG_SECS + 60 + 59) / 60 ))

(
  # Portable, atomic, non-blocking lock via `mkdir` — no `flock` dependency
  # (stock macOS ships none). Reclaim when the recorded holder is dead, or when
  # the lock crosses the hard ceiling even if PID reuse obscures ownership.
  if [ -d "$LOCK_DIR" ]; then
    LOCK_PID=""
    if [ -r "$LOCK_DIR/pid" ]; then IFS= read -r LOCK_PID <"$LOCK_DIR/pid" || true; fi
    case "$LOCK_PID" in ''|*[!0-9]*|0) LOCK_PID="" ;; esac
    LOCK_OWNER_DEAD=0
    if [ -n "$LOCK_PID" ] && ! kill -0 "$LOCK_PID" 2>/dev/null; then LOCK_OWNER_DEAD=1; fi
    LOCK_HARD_STALE=0
    if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin "+$HARD_STALE_MIN" 2>/dev/null)" ]; then LOCK_HARD_STALE=1; fi
    if [ "$LOCK_OWNER_DEAD" -eq 1 ] || [ "$LOCK_HARD_STALE" -eq 1 ]; then
      rm -rf "$LOCK_DIR" 2>/dev/null || true
    fi
  fi
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    if [ -e "$LOCK_DIR" ] && [ ! -d "$LOCK_DIR" ]; then
      cos_log_outcome lock-path-file
      rm -f "$LOCK_DIR" 2>/dev/null || true
      if ! mkdir "$LOCK_DIR" 2>/dev/null; then
        cos_log_outcome lock-busy
        exit 0
      fi
    else
      cos_log_outcome lock-busy
      exit 0
    fi
  fi
  # Bash 3.2 keeps $$ fixed across a (...) subshell. A directly launched child
  # sees the real subshell PID as PPID, which is the holder identity we need.
  if ! command sh -c 'command printf "%s\n" "$PPID"' >"$LOCK_DIR/pid" 2>/dev/null; then
    cos_log_outcome lock-pid-fail
    rm -rf "$LOCK_DIR" 2>/dev/null || true
    exit 0
  fi
  trap 'rm -rf "$LOCK_DIR" 2>/dev/null || true' EXIT

  SCOPE_ARGS=()
  [ -n "$SCOPE_REPO" ] && SCOPE_ARGS=(--scope "$SCOPE_REPO")
  # COS_HOST / COS_PLUGIN_KEY reach the child via the exported env (whitelisted
  # import above) — NOT as argv, so the plugin key never sits in the process
  # table (cannons 2026-08-18 claude P2).

  # One line per dispatch so refresh.log answers "did the hook fire, for what":
  # the child's own one-line JSON outcome follows (no --quiet: with it the log
  # stayed empty by construction — cannons 2026-08-18 claude P1).
  command printf '%s event=%s scope=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HOOK_EVENT" "${SCOPE_REPO:-<full>}" >>"$LOG_FILE" 2>/dev/null || true

  # `${arr[@]+...}` guards the empty-array expansion under `set -u` on bash 3.2.
  # Preferred watchdog: a Perl supervisor puts the child in its own process
  # group and kills that group on alarm. Fallback: kill the child plus its
  # direct children discovered through pgrep -P.
  GUARD=""
  if command -v perl >/dev/null 2>&1; then
    cos_perl_watchdog "$WATCHDOG_SECS" \
      "$NODE_BIN" "$REFRESH_SCRIPT" \
      --company "$COMPANY_ID" \
      ${SCOPE_ARGS[@]+"${SCOPE_ARGS[@]}"} \
      >>"$LOG_FILE" 2>&1 &
    CHILD=$!
  else
    "$NODE_BIN" "$REFRESH_SCRIPT" \
      --company "$COMPANY_ID" \
      ${SCOPE_ARGS[@]+"${SCOPE_ARGS[@]}"} \
      >>"$LOG_FILE" 2>&1 &
    CHILD=$!
    (
      SLP=""
      trap 'kill "${SLP:-}" 2>/dev/null; exit 0' TERM
      sleep "$WATCHDOG_SECS" & SLP=$!
      wait "$SLP" 2>/dev/null || exit 0
      CHILD_KIDS="$(pgrep -P "$CHILD" 2>/dev/null || true)"
      [ -n "$CHILD_KIDS" ] && kill -TERM $CHILD_KIDS 2>/dev/null || true
      kill -TERM "$CHILD" 2>/dev/null || true
      sleep 2
      [ -n "$CHILD_KIDS" ] && kill -KILL $CHILD_KIDS 2>/dev/null || true
      kill -KILL "$CHILD" 2>/dev/null || true
    ) &
    GUARD=$!
  fi

  wait "$CHILD" 2>/dev/null
  CHILD_RC=$?
  if [ -n "$GUARD" ]; then
    kill -TERM "$GUARD" 2>/dev/null || true   # fallback guard only: cancel it (+ its sleep)
    wait "$GUARD" 2>/dev/null || true
  fi
  if [ "$CHILD_RC" -ne 0 ]; then
    cos_log_outcome exec-fail " rc=$CHILD_RC"
  fi
) >/dev/null 2>&1 &

# Detach so git's hook wait returns immediately regardless of the refresh.
disown 2>/dev/null || true
exit 0
