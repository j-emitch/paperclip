#!/usr/bin/env bash
# companyos-local-ci.sh - the local-to-main quality gate for the CompanyOS cockpit
# (packages/plugins/examples/plugin-company-os).
#
# CompanyOS is a solo, internal surface. To hold it to the SAME code + UI standard
# as the other products without burning GitHub Actions minutes, its changes ship
# via a numbered PR + admin-merge to `lycaon` (the branch the cockpit runs from),
# gated LOCALLY by this script instead of by pr.yml. It mirrors the plugin-relevant
# *code* gates pr.yml enforces - typecheck, tests, build - scoped to the plugin so
# the loop is fast, and adds a home-path token scan.
#
# NOT mirrored (deliberately): pr.yml's `policy` job (lockfile integrity,
# release-package-map, docker-deps-stage) and the release-time e2e/docker/release
# jobs. Those matter for dependency / manifest / release changes, not plugin-internal
# UI work - if you touch package.json / deps or release wiring, use the normal
# PR + CI path for that change instead. (The token scan is an extra local check,
# not itself a pr.yml gate.)
#
# UI-touching changes ALSO require the visual-excellence three-way browser verify
# (desktop + mobile + reduced-motion, screenshot evidence). This script cannot run
# a browser, so it PROMPTS for that evidence rather than pretending to check it -
# see packages/plugins/examples/plugin-company-os/CONTRIBUTING.md for the full contract.
#
# Usage:
#   scripts/companyos-local-ci.sh          # plugin-scoped code gates (fast, default)
#   scripts/companyos-local-ci.sh --full   # also run the full-workspace gaps + tests
#
# Exits non-zero if any gate fails. Modelled on juice-bar's scripts/local-ci.sh.
set -uo pipefail

PLUGIN="@paperclipai/plugin-company-os"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || { echo "cannot cd to repo root"; exit 2; }

# Per-run temp log (mktemp, not a fixed /tmp name) so concurrent runs never clobber
# and there is no predictable-name symlink footgun. Cleaned on exit.
STEP_LOG="$(mktemp -t companyos-ci-step.XXXXXX)" || { echo "mktemp failed"; exit 2; }
trap 'rm -f "$STEP_LOG"' EXIT

FULL=0
case "${1:-}" in
  --full) FULL=1 ;;
  "") ;;
  *) echo "unknown arg: $1 (use --full or no args)"; exit 2 ;;
esac

fail=0
step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '    [PASS] %s\n' "$1"; }
bad()  { printf '    [FAIL] %s\n' "$1"; fail=1; }

run() { # run <label> <cmd...>
  local label="$1"; shift
  step "$label"
  if "$@" > "$STEP_LOG" 2>&1; then
    ok "$label"
  else
    bad "$label"
    tail -25 "$STEP_LOG" | sed 's/^/      /'
  fi
}

echo "CompanyOS local-CI :: plugin=$PLUGIN$([ "$FULL" = 1 ] && echo ' + full workspace')"
echo "repo=$ROOT  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

# --- Shared policy gates (cheap) ---
run "forbidden-token scan"        pnpm run check:tokens
run "no-git-push guard"           node scripts/check-no-git-push.mjs

# --- CompanyOS plugin code gates (mirror pr.yml, scoped for speed) ---
run "typecheck (plugin)"          pnpm --filter "$PLUGIN" typecheck
run "tests (plugin)"              pnpm --filter "$PLUGIN" test
run "build (plugin)"              pnpm --filter "$PLUGIN" build

# --- Optional full-workspace parity (slower; use before a broad change) ---
if [ "$FULL" = 1 ]; then
  run "typecheck:build-gaps (workspace)" pnpm run typecheck:build-gaps
  run "tests (workspace)"                pnpm run test:run
fi

echo ""
if [ "$fail" = 0 ]; then
  printf 'CompanyOS local-CI PASSED - ready for a numbered PR + admin-merge to lycaon.\n'
  echo "REMINDER: if this change touches UI, attach the desktop + mobile + reduced-motion"
  echo "browser evidence to the PR before merging (visual-excellence gate)."
  exit 0
else
  printf 'CompanyOS local-CI FAILED - fix the gate(s) above before opening a PR.\n'
  exit 1
fi
