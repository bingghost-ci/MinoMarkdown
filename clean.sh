#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"
. "$project_dir/scripts/release-common.sh"

remove_deps=false
dry_run=false
for arg in "$@"; do
  case "$arg" in
    --deps) remove_deps=true ;;
    --dry-run|-n) dry_run=true ;;
    --help|-h)
      printf 'Usage: ./clean.sh [--deps] [--dry-run]\n\n'
      printf 'Remove everything the builds and tests produce:\n'
      printf '  dist, dist-package (ZIP and manifest), src-tauri/target (debug and release builds,\n'
      printf '  Mino.app, dSYM, source maps and Cargo caches), the generated Tauri schemas, the Vite cache,\n'
      printf '  release symbols left in Symbols/ by older versions of install.sh,\n'
      printf '  and mino-* folders that tests left in the temporary directories (older than an hour).\n\n'
      printf '  --deps      also remove node_modules (run npm ci before the next build)\n'
      printf '  --dry-run   list what would be removed and remove nothing\n'
      exit 0
      ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

# Only a copy started from this project's build output loses its files; /Applications is never touched.
for pid in $(pgrep -x mino-markdown 2>/dev/null || true); do
  case "$(ps -o comm= -p "$pid" 2>/dev/null)" in
    "$project_dir"/*) log_warn "A Mino started from this project's build output is running (PID $pid); quit it after cleaning." ;;
  esac
done

removed=0
remove() {
  [ -e "$1" ] || return 0
  size=$(du -sh "$1" 2>/dev/null | awk '{print $1}')
  if $dry_run; then
    log_info "Would remove $1 ($size)"
  else
    rm -rf "$1"
    log_info "Removed $1 ($size)"
  fi
  removed=$((removed + 1))
}

# Every path is relative to the project and listed in .gitignore; nothing tracked by Git is removed.
log_step 'Removing build output'
for target in dist dist-package src-tauri/target src-tauri/gen/schemas node_modules/.vite node_modules/.vite-temp; do
  remove "$target"
done
remove Symbols
for staged in .Symbols.*; do remove "$staged"; done
if $remove_deps; then remove node_modules; fi

# Rust tests, perf-baseline.mjs and interrupted PDF exports create mino-* folders in the temporary directory and some are left behind.
# Only the current user's folders untouched for an hour are removed, so a running test or an export
# in progress (the app writes mino-pdf-* there) keeps its files.
log_step 'Removing leftover test folders'
temp_dirs=$(printf '%s\n%s\n' "${TMPDIR:-/tmp}" /tmp | sed 's:/*$::' | sort -u)
for temp in $temp_dirs; do
  [ -d "$temp" ] || continue
  # mino-markdown is the app's own WebKit folder, not a test leftover.
  for leftover in $(find "$temp" -mindepth 1 -maxdepth 1 -name 'mino-*' ! -name 'mino-markdown' -user "$(id -u)" -mmin +60 2>/dev/null); do
    remove "$leftover"
  done
done

if [ "$removed" -eq 0 ]; then
  log_ok 'Nothing to remove'
elif $dry_run; then
  log_ok "Would remove $removed item(s)"
else
  log_ok "Removed $removed item(s)"
fi
$remove_deps || [ ! -d node_modules ] || log_info 'Kept node_modules/ (use --deps to remove it too)'
$remove_deps && ! $dry_run && log_info 'Run npm ci --no-audit --no-fund before the next build.'
log_info 'The next build compiles all Rust dependencies again.'
