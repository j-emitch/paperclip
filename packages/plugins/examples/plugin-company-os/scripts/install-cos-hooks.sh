#!/usr/bin/env bash
# install-cos-hooks.sh — opt-in, idempotent installer for the COS-0g board-refresh git hooks.
#
# These repos use a managed, version-controlled `core.hooksPath` (.githooks),
# NOT `.git/hooks/`, and the existing hooks follow a clean pattern: a thin
# *tracked* dispatcher that calls machine-local `~/.claude/hooks/*.sh` scripts
# guarded by `[ -x ]` (inert where absent) with `|| true` (non-fatal). This
# installer mirrors that pattern exactly rather than fighting core.hooksPath:
#
#   1. Installs the machine-local dispatcher  ~/.claude/hooks/cos-refresh-hook.sh
#   2. Writes machine config                  ~/.config/cos-company-os/config.env
#   3. Appends a generic, sentinel-bounded 3-line guard to each repo's effective
#      post-commit + post-merge hook (preserving any existing content). The block
#      carries ZERO machine specifics (those live in the dispatcher + config), so
#      it is safe to commit and a complete no-op on machines without the dispatcher.
#   4. Records every touched path + block checksum to a manifest for clean uninstall.
#
# Idempotent (re-run → exactly one block per hook), non-fatal (the installed hook
# can never block a commit/merge), reversible (uninstall-cos-hooks.sh), and
# opt-in (running this script IS the deliberate per-repo enable; the runtime
# kill-switch is COS_HOOKS_DISABLED=1).
#
# Usage:
#   install-cos-hooks.sh --company <uuid> [--repo <path> ...] [--host <url>]
#                        [--plugin <key>] [--node <path>] [--hooks-dir <dir>] [--dry-run]
#
# With no --repo, the git repo containing the current directory is the target.

set -euo pipefail

SENTINEL_START="# >>> cos-company-os >>>"
SENTINEL_END="# <<< cos-company-os <<<"
HOOK_EVENTS=("post-commit" "post-merge")
DEFAULT_HOST="http://127.0.0.1:3100"
DEFAULT_PLUGIN="lycaon.company-os"
WRAPPER_DEST="$HOME/.claude/hooks/cos-refresh-hook.sh"
CONFIG_DIR="$HOME/.config/cos-company-os"
CONFIG_FILE="$CONFIG_DIR/config.env"
MANIFEST_FILE="$CONFIG_DIR/hooks-manifest.json"

# --- resolve this script's dir (for the sibling cos-refresh.mjs / hook source) ---
SCRIPT_SRC="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_SRC" ]; do
  link="$(readlink "$SCRIPT_SRC")"
  case "$link" in /*) SCRIPT_SRC="$link" ;; *) SCRIPT_SRC="$(dirname "$SCRIPT_SRC")/$link" ;; esac
done
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SRC")" && pwd)"
REFRESH_SCRIPT="$SCRIPT_DIR/cos-refresh.mjs"
WRAPPER_SRC="$SCRIPT_DIR/cos-refresh-hook.sh"

# --- args ---
COMPANY_ID=""
HOST="$DEFAULT_HOST"
PLUGIN="$DEFAULT_PLUGIN"
NODE_BIN=""
HOOKS_DIR_OVERRIDE=""
DRY_RUN=0
REPOS=()

usage() {
  sed -n '2,40p' "$SCRIPT_SRC" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --company) COMPANY_ID="${2:-}"; shift 2 ;;
    --company=*) COMPANY_ID="${1#*=}"; shift ;;
    --repo) REPOS+=("${2:-}"); shift 2 ;;
    --repo=*) REPOS+=("${1#*=}"); shift ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --host=*) HOST="${1#*=}"; shift ;;
    --plugin) PLUGIN="${2:-}"; shift 2 ;;
    --plugin=*) PLUGIN="${1#*=}"; shift ;;
    --node) NODE_BIN="${2:-}"; shift 2 ;;
    --node=*) NODE_BIN="${1#*=}"; shift ;;
    --hooks-dir) HOOKS_DIR_OVERRIDE="${2:-}"; shift 2 ;;
    --hooks-dir=*) HOOKS_DIR_OVERRIDE="${1#*=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage 0 ;;
    *) echo "install-cos-hooks: unknown argument: $1" >&2; usage 1 ;;
  esac
done

if [ -z "$COMPANY_ID" ]; then
  echo "install-cos-hooks: --company <uuid> is required" >&2
  exit 2
fi
if [ ! -f "$REFRESH_SCRIPT" ]; then
  echo "install-cos-hooks: cannot find cos-refresh.mjs at $REFRESH_SCRIPT" >&2
  exit 2
fi
if [ ! -f "$WRAPPER_SRC" ]; then
  echo "install-cos-hooks: cannot find cos-refresh-hook.sh at $WRAPPER_SRC" >&2
  exit 2
fi

# Default target: the repo containing CWD.
if [ "${#REPOS[@]}" -eq 0 ]; then
  if top="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    REPOS=("$top")
  else
    echo "install-cos-hooks: no --repo given and CWD is not inside a git repo" >&2
    exit 2
  fi
fi

# Resolve node: explicit flag > PATH node > leave literal "node" for runtime PATH.
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || echo node)"
fi

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else echo "nohash"; fi
}

iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# --- the generic, machine-agnostic sentinel block (safe to commit) ---
cos_block() {
  local event="$1"
  cat <<BLOCK
$SENTINEL_START
# Company OS cockpit board refresh — additive, non-fatal, opt-in (install-cos-hooks.sh).
# No-op unless the machine-local dispatcher is present; safe to commit, inert elsewhere.
if [ -x "\$HOME/.claude/hooks/cos-refresh-hook.sh" ]; then
    "\$HOME/.claude/hooks/cos-refresh-hook.sh" $event || true
fi
$SENTINEL_END
BLOCK
}

resolve_hooks_dir() {
  local repo="$1"
  local hp
  hp="$(git -C "$repo" config --get core.hooksPath 2>/dev/null || true)"
  if [ -n "$hp" ]; then
    case "$hp" in /*) echo "$hp" ;; *) echo "$(cd "$repo" && pwd)/$hp" ;; esac
  else
    local gd
    gd="$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null || echo ".git")"
    case "$gd" in /*) echo "$gd/hooks" ;; *) echo "$(cd "$repo" && pwd)/$gd/hooks" ;; esac
  fi
}

say() { echo "  $*"; }

echo "install-cos-hooks: COS-0g board-refresh hooks"
echo "  company:   $COMPANY_ID"
echo "  host:      $HOST"
echo "  plugin:    $PLUGIN"
echo "  node:      $NODE_BIN"
echo "  refresh:   $REFRESH_SCRIPT"
[ "$DRY_RUN" = "1" ] && echo "  (dry-run — no files will be written)"

# --- 1. machine-local dispatcher ---
if [ "$DRY_RUN" = "0" ]; then
  mkdir -p "$(dirname "$WRAPPER_DEST")"
  cp "$WRAPPER_SRC" "$WRAPPER_DEST"
  chmod +x "$WRAPPER_DEST"
fi
say "dispatcher → $WRAPPER_DEST"

# --- 2. machine config ---
if [ "$DRY_RUN" = "0" ]; then
  mkdir -p "$CONFIG_DIR"
  umask 077
  cat >"$CONFIG_FILE" <<CONF
# Company OS cockpit hook config — written by install-cos-hooks.sh ($(iso_now)).
# Edit COS_HOOKS_DISABLED=1 here (or export it) to kill the hook without uninstalling.
COS_COMPANY_ID="$COMPANY_ID"
COS_REFRESH_SCRIPT="$REFRESH_SCRIPT"
COS_HOST="$HOST"
COS_PLUGIN_KEY="$PLUGIN"
COS_NODE_BIN="$NODE_BIN"
CONF
fi
say "config     → $CONFIG_FILE"

# --- 3. per-repo hook install (idempotent, preserve existing) ---
MANIFEST_ENTRIES=()

install_one_hook() {
  local repo="$1" hooks_dir="$2" event="$3"
  local hook_path="$hooks_dir/$event"
  local created="false"
  local block; block="$(cos_block "$event")"
  local block_sha; block_sha="$(printf '%s\n' "$block" | sha256)"

  if [ "$DRY_RUN" = "1" ]; then
    say "would install $event → $hook_path"
    MANIFEST_ENTRIES+=("$(manifest_entry "$repo" "$hook_path" "$event" "$created" "$block_sha")")
    return 0
  fi

  mkdir -p "$hooks_dir"
  local tmp; tmp="$(mktemp)"

  if [ -f "$hook_path" ]; then
    # Strip any existing COS block (inclusive), preserving everything else.
    awk -v s="$SENTINEL_START" -v e="$SENTINEL_END" \
      'index($0,s){skip=1} !skip{print} index($0,e){skip=0}' "$hook_path" >"$tmp"
  else
    created="true"
    printf '#!/usr/bin/env bash\n' >"$tmp"
  fi

  # Guarantee a shebang on a file we are about to make executable.
  if ! head -n1 "$tmp" | grep -q '^#!'; then
    { printf '#!/usr/bin/env bash\n'; cat "$tmp"; } >"$tmp.sheb" && mv "$tmp.sheb" "$tmp"
  fi

  # Ensure a trailing newline before appending the block.
  [ -s "$tmp" ] && [ "$(tail -c1 "$tmp" | wc -l)" -eq 0 ] && printf '\n' >>"$tmp"
  printf '\n%s\n' "$block" >>"$tmp"

  mv "$tmp" "$hook_path"
  chmod +x "$hook_path"
  say "installed $event → $hook_path${created:+ (new)}"
  MANIFEST_ENTRIES+=("$(manifest_entry "$repo" "$hook_path" "$event" "$created" "$block_sha")")
}

manifest_entry() {
  printf '{"repo":"%s","hookPath":"%s","event":"%s","created":%s,"blockSha256":"%s","installedAt":"%s"}' \
    "$1" "$2" "$3" "$4" "$5" "$(iso_now)"
}

for repo in "${REPOS[@]}"; do
  if [ ! -d "$repo" ]; then
    echo "install-cos-hooks: skipping non-existent repo: $repo" >&2
    continue
  fi
  if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    echo "install-cos-hooks: skipping non-git path: $repo" >&2
    continue
  fi
  abs_repo="$(cd "$repo" && pwd)"
  hooks_dir="${HOOKS_DIR_OVERRIDE:-$(resolve_hooks_dir "$abs_repo")}"
  echo "repo: $abs_repo  (hooks → $hooks_dir)"

  # Heads-up when the hook file is tracked (managed .githooks) — the block lands
  # in a tracked file and should be committed via the managed-hooks lifecycle.
  for event in "${HOOK_EVENTS[@]}"; do
    rel=""
    if rel="$(git -C "$abs_repo" ls-files --error-unmatch --full-name -- "$hooks_dir/$event" 2>/dev/null)"; then
      [ -n "$rel" ] && say "note: $event is git-tracked ($rel) — commit the added block via your managed-hooks lifecycle"
    fi
    install_one_hook "$abs_repo" "$hooks_dir" "$event"
  done
done

# --- 4. manifest ---
if [ "$DRY_RUN" = "0" ]; then
  {
    printf '{"version":1,"installedAt":"%s","companyId":"%s","host":"%s","plugin":"%s",' \
      "$(iso_now)" "$COMPANY_ID" "$HOST" "$PLUGIN"
    printf '"globalWrapper":"%s","configFile":"%s","refreshScript":"%s","hooks":[' \
      "$WRAPPER_DEST" "$CONFIG_FILE" "$REFRESH_SCRIPT"
    first=1
    for e in ${MANIFEST_ENTRIES[@]+"${MANIFEST_ENTRIES[@]}"}; do
      [ "$first" = "1" ] || printf ','
      printf '%s' "$e"; first=0
    done
    printf ']}\n'
  } >"$MANIFEST_FILE"
  say "manifest   → $MANIFEST_FILE"
fi

DRY_LABEL=""
[ "$DRY_RUN" = "1" ] && DRY_LABEL=" (dry-run)"
echo ""
echo "Done.$DRY_LABEL"
echo "  Kill-switch: export COS_HOOKS_DISABLED=1   (or set it in $CONFIG_FILE)"
echo "  Uninstall:   $SCRIPT_DIR/uninstall-cos-hooks.sh"
echo "  DB rollback (manual; uninstall does NOT drop the schema):"
echo "    psql \"\$DATABASE_URL\" -c 'DROP SCHEMA plugin_company_os_cc959257d2 CASCADE;'"
