#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"
. "$project_dir/scripts/release-common.sh"

case "${1:-}" in
  '') ;;
  --build-only) exec "$project_dir/build.sh" ;;
  --help|-h)
    printf 'Usage: ./start.sh [--build-only]\n'
    printf 'Build the local Apple Silicon app and open it for testing.\n'
    exit 0
    ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac

require_commands open
if pgrep -x mino-markdown >/dev/null 2>&1; then
  die 'Mino is already running. Quit it, then run ./start.sh again to test the new build.'
fi

"$project_dir/build.sh"

log_step 'Opening Mino for local testing'
open "$app"
