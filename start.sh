#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"
. "$project_dir/scripts/release-common.sh"

case "${1:-}" in
  --help|-h)
    printf 'Usage: ./start.sh [-- <tauri dev options>]\n'
    printf 'Start Mino for development and debugging: Vite on 127.0.0.1:1420 with hot reload,\n'
    printf 'and a debug build of the app that rebuilds when Rust code changes. Stop it with Ctrl-C.\n'
    printf 'Installs npm dependencies first when they are missing. The debug build stays in\n'
    printf 'src-tauri/target/debug until ./clean.sh removes it.\n'
    exit 0
    ;;
  --) shift ;;
  '') ;;
  *) printf 'Unknown option: %s (pass Tauri options after --)\n' "$1" >&2; exit 2 ;;
esac

require_commands npm node rustc cargo lsof
dev_port=1420

log_step 'Checking dependencies'
if [ -x node_modules/.bin/tauri ]; then
  log_info 'npm dependencies are present'
else
  log_info 'Installing npm dependencies from package-lock.json'
  npm ci --no-audit --no-fund
fi

log_step 'Checking the Apple Silicon toolchain'
npm run --silent archcheck

if lsof -nP -iTCP:"$dev_port" -sTCP:LISTEN >/dev/null 2>&1; then
  die "Port $dev_port is already in use, probably by another ./start.sh or npm run dev. Stop it first."
fi
if pgrep -x mino-markdown >/dev/null 2>&1; then
  log_warn 'Another Mino is running. Both use the same settings, drafts and recent files.'
fi

log_step 'Starting Mino in development mode (Ctrl-C to stop)'
exec npm run tauri -- dev "$@"
