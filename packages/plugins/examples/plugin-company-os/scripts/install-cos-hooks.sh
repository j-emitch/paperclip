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
#   4. Records every touched path + block checksum to a JSON manifest (node-escaped)
#      plus a shell-readable TSV sidecar (so uninstall needs no node).
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

# --- resolve this script's dir (for the sibling scripts + shared lib) ---
SCRIPT_SRC="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_SRC" ]; do
  link="$(readlink "$SCRIPT_SRC")"
  case "$link" in /*) SCRIPT_SRC="$link" ;; *) SCRIPT_SRC="$(dirname "$SCRIPT_SRC")/$link" ;; esac
done
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SRC")" && pwd)"
# shellcheck source=cos-hook-lib.sh
. "$SCRIPT_DIR/cos-hook-lib.sh"

REFRESH_SCRIPT="$SCRIPT_DIR/cos-refresh.mjs"
WRAPPER_SRC="$SCRIPT_DIR/cos-refresh-hook.sh"
HOOK_EVENTS=("post-commit" "post-merge")
DEFAULT_HOST="http://127.0.0.1:3100"
DEFAULT_PLUGIN="lycaon.company-os"
WRAPPER_DEST="$HOME/.claude/hooks/cos-refresh-hook.sh"
CONFIG_DIR="$HOME/.config/cos-company-os"
CONFIG_FILE="$CONFIG_DIR/config.env"
MANIFEST_FILE="$CONFIG_DIR/hooks-manifest.json"
MANIFEST_TSV="$CONFIG_DIR/hooks-manifest.tsv"

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
# companyId is embedded in config + a lockfile name; constrain it to a safe shape.
case "$COMPANY_ID" in
  *[!A-Za-z0-9._-]*)
    echo "install-cos-hooks: --company must match [A-Za-z0-9._-]+ (got: $COMPANY_ID)" >&2
    exit 2
    ;;
esac
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

# --- the generic, machine-agnostic sentinel block (safe to commit) ---
cos_block() {
  local event="$1"
  cat <<BLOCK
$COS_SENTINEL_START
# Company OS cockpit board refresh — additive, non-fatal, opt-in (install-cos-hooks.sh).
# No-op unless the machine-local dispatcher is present; safe to commit, inert elsewhere.
if [ -x "\$HOME/.claude/hooks/cos-refresh-hook.sh" ]; then
    "\$HOME/.claude/hooks/cos-refresh-hook.sh" $event || true
fi
$COS_SENTINEL_END
BLOCK
}

say() { echo "  $*"; }

# Look up a prior manifest's `created` flag for a hookPath (so a reinstall keeps
# created:true and uninstall can still remove a hook the installer first made).
prior_created() {
  local hook_path="$1"
  [ -r "$MANIFEST_TSV" ] || { echo ""; return; }
  # TSV columns: repo \t hookPath \t event \t created \t sha
  awk -F'\t' -v h="$hook_path" '$2==h {print $4; exit}' "$MANIFEST_TSV"
}

echo "install-cos-hooks: COS-0g board-refresh hooks"
echo "  company:   $COMPANY_ID"
echo "  host:      $HOST"
echo "  plugin:    $PLUGIN"
echo "  node:      $NODE_BIN"
echo "  refresh:   $REFRESH_SCRIPT"
[ "$DRY_RUN" = "1" ] && echo "  (dry-run — no files will be written)"

# --- 1. machine-local dispatcher ---
# If the destination is already a GIT-TRACKED file (e.g. ~/.claude/hooks is a
# symlink into a tracked hooks dir such as company/config/hooks), git owns it:
# never overwrite it here (a reinstall must not dirty canonical source; cannons
# 2026-08-18 codex P1). Report drift instead so it is fixed via that repo's PR.
if cos_git_tracked "$WRAPPER_DEST"; then
  if cmp -s "$WRAPPER_SRC" "$WRAPPER_DEST"; then
    say "dispatcher → $WRAPPER_DEST (git-tracked, identical — left to git)"
  else
    say "dispatcher → $WRAPPER_DEST is git-tracked and DIFFERS from $WRAPPER_SRC — NOT overwritten; update it via that repo's PR"
  fi
else
  if [ "$DRY_RUN" = "0" ]; then
    mkdir -p "$(dirname "$WRAPPER_DEST")"
    cp "$WRAPPER_SRC" "$WRAPPER_DEST"
    chmod +x "$WRAPPER_DEST"
  fi
  say "dispatcher → $WRAPPER_DEST"
fi

# --- 2. machine config (shell-quoted via %q so the sourced file can't inject) ---
if [ "$DRY_RUN" = "0" ]; then
  mkdir -p "$CONFIG_DIR"
  umask 077
  {
    printf '# Company OS cockpit hook config — written by install-cos-hooks.sh (%s).\n' "$(cos_iso_now)"
    printf '# Values are shell-quoted (%%q). Set COS_HOOKS_DISABLED=1 to kill the hook without uninstalling.\n'
    printf 'COS_COMPANY_ID=%q\n' "$COMPANY_ID"
    printf 'COS_REFRESH_SCRIPT=%q\n' "$REFRESH_SCRIPT"
    printf 'COS_HOST=%q\n' "$HOST"
    printf 'COS_PLUGIN_KEY=%q\n' "$PLUGIN"
    printf 'COS_NODE_BIN=%q\n' "$NODE_BIN"
  } >"$CONFIG_FILE"
fi
say "config     → $CONFIG_FILE"

# --- 3. per-repo hook install (idempotent, preserve existing, refuse symlinks) ---
# Accumulate TSV manifest rows: repo \t hookPath \t event \t created \t sha
MANIFEST_TSV_ROWS=()

install_one_hook() {
  local repo="$1" hooks_dir="$2" event="$3"
  local hook_path="$hooks_dir/$event"
  local created="false"
  local block; block="$(cos_block "$event")"
  local block_sha; block_sha="$(printf '%s\n' "$block" | cos_sha256)"

  # Symlink-escape guard: never follow a symlinked hook (it could redirect our
  # write outside the repo). Refuse and skip; the operator can clear it first.
  if [ -L "$hook_path" ]; then
    echo "install-cos-hooks: refusing to write through a symlinked hook: $hook_path" >&2
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    say "would install $event → $hook_path"
    MANIFEST_TSV_ROWS+=("$(printf '%s\t%s\t%s\t%s\t%s' "$repo" "$hook_path" "$event" "$created" "$block_sha")")
    return 0
  fi

  mkdir -p "$hooks_dir"
  local tmp; tmp="$(mktemp)"

  if [ -f "$hook_path" ]; then
    # A reinstall keeps the original created flag (so uninstall still removes a
    # hook the installer first created, even though it now exists).
    local prev; prev="$(prior_created "$hook_path")"
    [ "$prev" = "true" ] && created="true"
    # Strip any existing COS block (matched pairs only — non-destructive on a
    # corrupted block), preserving everything else.
    cos_strip_block "$hook_path" "$tmp"
  else
    created="true"
    printf '#!/usr/bin/env bash\n' >"$tmp"
  fi

  # Guarantee a shebang on a file we are about to make executable.
  if ! head -n1 "$tmp" | grep -q '^#!'; then
    { printf '#!/usr/bin/env bash\n'; cat "$tmp"; } >"$tmp.sheb" && mv "$tmp.sheb" "$tmp"
  fi

  # Ensure a trailing newline before appending the block.
  if [ -s "$tmp" ] && [ "$(tail -c1 "$tmp" | wc -l)" -eq 0 ]; then printf '\n' >>"$tmp"; fi
  printf '\n%s\n' "$block" >>"$tmp"

  mv "$tmp" "$hook_path"
  chmod +x "$hook_path"
  local newlabel=""
  [ "$created" = "true" ] && newlabel=" (new)"
  say "installed $event → $hook_path$newlabel"
  MANIFEST_TSV_ROWS+=("$(printf '%s\t%s\t%s\t%s\t%s' "$repo" "$hook_path" "$event" "$created" "$block_sha")")
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
  abs_repo="$(cd "$repo" && pwd -P)"
  hooks_dir="${HOOKS_DIR_OVERRIDE:-$(cos_resolve_hooks_dir "$abs_repo")}"
  echo "repo: $abs_repo  (hooks → $hooks_dir)"

  # Heads-up when the hook file is tracked (managed .githooks) — the block lands
  # in a tracked file and should be committed via the managed-hooks lifecycle.
  for event in "${HOOK_EVENTS[@]}"; do
    if rel="$(git -C "$abs_repo" ls-files --error-unmatch --full-name -- "$hooks_dir/$event" 2>/dev/null)"; then
      [ -n "$rel" ] && say "note: $event is git-tracked ($rel) — commit the added block via your managed-hooks lifecycle"
    fi
    install_one_hook "$abs_repo" "$hooks_dir" "$event"
  done
done

# --- 4. manifests (TSV for shell-only uninstall; JSON via node for tooling) ---
if [ "$DRY_RUN" = "0" ]; then
  : >"$MANIFEST_TSV"
  for row in ${MANIFEST_TSV_ROWS[@]+"${MANIFEST_TSV_ROWS[@]}"}; do
    printf '%s\n' "$row" >>"$MANIFEST_TSV"
  done
  say "manifest   → $MANIFEST_TSV"

  # JSON is convenience-for-tooling; build it with node so every value is escaped.
  if command -v "$NODE_BIN" >/dev/null 2>&1 || [ -x "$NODE_BIN" ]; then
    COS_MF_COMPANY="$COMPANY_ID" COS_MF_HOST="$HOST" COS_MF_PLUGIN="$PLUGIN" \
    COS_MF_WRAPPER="$WRAPPER_DEST" COS_MF_CONFIG="$CONFIG_FILE" COS_MF_REFRESH="$REFRESH_SCRIPT" \
    COS_MF_NOW="$(cos_iso_now)" \
      "$NODE_BIN" -e '
        const fs = require("node:fs");
        const tsv = fs.existsSync(process.argv[1]) ? fs.readFileSync(process.argv[1], "utf8") : "";
        const hooks = tsv.split("\n").filter(Boolean).map((l) => {
          const [repo, hookPath, event, created, blockSha256] = l.split("\t");
          return { repo, hookPath, event, created: created === "true", blockSha256 };
        });
        const m = {
          version: 1,
          installedAt: process.env.COS_MF_NOW,
          companyId: process.env.COS_MF_COMPANY,
          host: process.env.COS_MF_HOST,
          plugin: process.env.COS_MF_PLUGIN,
          globalWrapper: process.env.COS_MF_WRAPPER,
          configFile: process.env.COS_MF_CONFIG,
          refreshScript: process.env.COS_MF_REFRESH,
          hooks,
        };
        fs.writeFileSync(process.argv[2], JSON.stringify(m, null, 2) + "\n");
      ' "$MANIFEST_TSV" "$MANIFEST_FILE" 2>/dev/null && say "manifest   → $MANIFEST_FILE" || say "(skipped JSON manifest — node unavailable; TSV is authoritative)"
  fi
fi

DRY_LABEL=""
[ "$DRY_RUN" = "1" ] && DRY_LABEL=" (dry-run)"
echo ""
echo "Done.$DRY_LABEL"
echo "  Kill-switch: export COS_HOOKS_DISABLED=1   (or set it in $CONFIG_FILE)"
echo "  Uninstall:   $SCRIPT_DIR/uninstall-cos-hooks.sh"
echo "  DB rollback (manual; uninstall does NOT drop the schema):"
echo "    psql \"\$DATABASE_URL\" -c 'DROP SCHEMA plugin_company_os_cc959257d2 CASCADE;'"
