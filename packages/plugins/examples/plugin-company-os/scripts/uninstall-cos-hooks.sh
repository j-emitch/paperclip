#!/usr/bin/env bash
# uninstall-cos-hooks.sh — cleanly reverse install-cos-hooks.sh.
#
# Strips ONLY the sentinel-bounded COS block from each installed hook (preserving
# any pre-existing content), removes a hook FILE only if the installer created it
# and it is now empty, and removes the machine-local dispatcher + config +
# manifest. Idempotent + non-fatal. Then prints the manual DB rollback note
# (uninstall does NOT drop the plugin schema — that is a deliberate, separate
# destructive step).
#
# Usage: uninstall-cos-hooks.sh [--repo <path> ...] [--keep-config] [--dry-run]
#
# With no --repo it relies on the install manifest; --repo cleans extra repos too.

set -euo pipefail

SENTINEL_START="# >>> cos-company-os >>>"
SENTINEL_END="# <<< cos-company-os <<<"
HOOK_EVENTS=("post-commit" "post-merge")
WRAPPER_DEST="$HOME/.claude/hooks/cos-refresh-hook.sh"
CONFIG_DIR="$HOME/.config/cos-company-os"
CONFIG_FILE="$CONFIG_DIR/config.env"
MANIFEST_FILE="$CONFIG_DIR/hooks-manifest.json"

KEEP_CONFIG=0
DRY_RUN=0
REPOS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPOS+=("${2:-}"); shift 2 ;;
    --repo=*) REPOS+=("${1#*=}"); shift ;;
    --keep-config) KEEP_CONFIG=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) echo "Usage: uninstall-cos-hooks.sh [--repo <path> ...] [--keep-config] [--dry-run]"; exit 0 ;;
    *) echo "uninstall-cos-hooks: unknown argument: $1" >&2; exit 1 ;;
  esac
done

say() { echo "  $*"; }

resolve_hooks_dir() {
  local repo="$1" hp
  hp="$(git -C "$repo" config --get core.hooksPath 2>/dev/null || true)"
  if [ -n "$hp" ]; then
    case "$hp" in /*) echo "$hp" ;; *) echo "$(cd "$repo" && pwd)/$hp" ;; esac
  else
    local gd; gd="$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null || echo ".git")"
    case "$gd" in /*) echo "$gd/hooks" ;; *) echo "$(cd "$repo" && pwd)/$gd/hooks" ;; esac
  fi
}

# Collect "hookPath<TAB>created" rows from the manifest (created defaults false).
manifest_rows() {
  [ -r "$MANIFEST_FILE" ] || return 0
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("node:fs");
      try {
        const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        for (const h of m.hooks ?? []) process.stdout.write(`${h.hookPath}\t${h.created ? "true" : "false"}\n`);
      } catch { /* unreadable manifest → nothing to do */ }
    ' "$MANIFEST_FILE"
  fi
}

# A hook file is "ours to delete" only if the installer created it AND, after the
# block is stripped, nothing but a shebang/blank lines remain.
only_shebang_left() {
  local f="$1"
  awk 'NF && $0 !~ /^#!/{found=1} END{exit found?1:0}' "$f"
}

strip_block() {
  local hook_path="$1" created="$2"
  [ -f "$hook_path" ] || return 0
  if ! grep -qF "$SENTINEL_START" "$hook_path"; then
    return 0 # no COS block here
  fi
  if [ "$DRY_RUN" = "1" ]; then
    say "would strip COS block from $hook_path"
    return 0
  fi
  local tmp; tmp="$(mktemp)"
  awk -v s="$SENTINEL_START" -v e="$SENTINEL_END" \
    'index($0,s){skip=1} !skip{print} index($0,e){skip=0}' "$hook_path" >"$tmp"
  if [ "$created" = "true" ] && only_shebang_left "$tmp"; then
    rm -f "$hook_path" "$tmp"
    say "removed installer-created $hook_path"
  else
    mv "$tmp" "$hook_path"
    chmod +x "$hook_path"
    say "stripped COS block from $hook_path (preserved existing hook)"
  fi
}

echo "uninstall-cos-hooks: removing COS-0g board-refresh hooks"
[ "$DRY_RUN" = "1" ] && echo "  (dry-run — no files will be written)"

# 1. Manifest-recorded hooks.
while IFS=$'\t' read -r hook_path created; do
  [ -n "$hook_path" ] && strip_block "$hook_path" "$created"
done < <(manifest_rows)

# 2. Any extra repos passed explicitly (treat as not-created → never delete file).
for repo in ${REPOS[@]+"${REPOS[@]}"}; do
  [ -d "$repo" ] || continue
  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || continue
  hooks_dir="$(resolve_hooks_dir "$(cd "$repo" && pwd)")"
  for event in "${HOOK_EVENTS[@]}"; do
    strip_block "$hooks_dir/$event" "false"
  done
done

# 3. Machine-local artifacts.
if [ "$KEEP_CONFIG" = "0" ]; then
  for f in "$WRAPPER_DEST" "$CONFIG_FILE" "$MANIFEST_FILE"; do
    if [ -e "$f" ]; then
      [ "$DRY_RUN" = "1" ] && say "would remove $f" || { rm -f "$f"; say "removed $f"; }
    fi
  done
else
  say "kept config + dispatcher (--keep-config)"
fi

DRY_LABEL=""
[ "$DRY_RUN" = "1" ] && DRY_LABEL=" (dry-run)"
echo ""
echo "Done.$DRY_LABEL"
echo "  The plugin DB cache schema is intentionally NOT dropped. To fully roll back:"
echo "    psql \"\$DATABASE_URL\" -c 'DROP SCHEMA plugin_company_os_cc959257d2 CASCADE;'"
