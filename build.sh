#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

case "${1:-}" in
  '') ;;
  --help|-h)
    printf 'Usage: ./build.sh\n'
    printf 'Remove the previous package, then rebuild, archive, and verify MinoMarkdown.app.\n'
    exit 0
    ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac

exec "$project_dir/start.sh" --build-only
