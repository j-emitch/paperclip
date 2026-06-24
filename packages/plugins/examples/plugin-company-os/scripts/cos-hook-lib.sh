#!/usr/bin/env bash
# cos-hook-lib.sh — shared helpers sourced by install-cos-hooks.sh +
# uninstall-cos-hooks.sh. Centralizes the security-critical sentinel markers,
# the hooks-dir resolution, and the block-strip so the two scripts can never
# drift on the load-bearing logic. Pure functions; no top-level side effects.

# The sentinel markers that fence the COS block in a hook file. Changing these
# is a breaking change (old blocks become unstrippable) — don't.
COS_SENTINEL_START="# >>> cos-company-os >>>"
COS_SENTINEL_END="# <<< cos-company-os <<<"

# Resolve the EFFECTIVE, PHYSICAL hooks dir for a repo: honor core.hooksPath
# (relative → repo-root-relative; absolute kept), else the git common dir's
# hooks. `pwd -P` collapses symlinks so containment checks see real paths.
cos_resolve_hooks_dir() {
  local repo="$1" hp gd dir
  hp="$(git -C "$repo" config --get core.hooksPath 2>/dev/null || true)"
  if [ -n "$hp" ]; then
    case "$hp" in /*) dir="$hp" ;; *) dir="$(cd "$repo" && pwd -P)/$hp" ;; esac
  else
    gd="$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null || echo ".git")"
    case "$gd" in /*) dir="$gd/hooks" ;; *) dir="$(cd "$repo" && pwd -P)/$gd/hooks" ;; esac
  fi
  echo "$dir"
}

# True if a COS sentinel START marker is present in $1.
cos_block_present() {
  [ -f "$1" ] && grep -qF "$COS_SENTINEL_START" "$1"
}

# Strip EVERY matched COS block (START…END pair) from $1, writing the result to
# $2. NON-DESTRUCTIVE on a malformed block: if a START is seen with no matching
# END before EOF, the buffered lines are emitted verbatim rather than dropped —
# so a hand-corrupted or partially-overwritten hook never loses its real tail.
cos_strip_block() {
  local src="$1" out="$2"
  awk -v s="$COS_SENTINEL_START" -v e="$COS_SENTINEL_END" '
    BEGIN { inblk = 0; buf = "" }
    {
      if (!inblk && index($0, s)) { inblk = 1; buf = $0 ORS; next }
      if (inblk) {
        buf = buf $0 ORS
        if (index($0, e)) { inblk = 0; buf = "" }   # matched pair → drop the whole block
        next
      }
      print
    }
    END { if (inblk && buf != "") printf "%s", buf }  # unterminated → restore verbatim (no data loss)
  ' "$src" >"$out"
}

cos_sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else echo "nohash"; fi
}

cos_iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
