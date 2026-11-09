#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

case "${1:-}" in
  '') ;;
  --help|-h)
    printf 'Usage: ./install.sh\n'
    printf 'Rebuild MinoMarkdown.app and install it to /Applications, replacing any existing copy.\n'
    exit 0
    ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac

install_dir=/Applications
built_app="$project_dir/src-tauri/target/release/bundle/macos/MinoMarkdown.app"
target="$install_dir/MinoMarkdown.app"
staged="$install_dir/.MinoMarkdown.app.installing.$$"
previous="$install_dir/.MinoMarkdown.app.previous.$$"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

# Never quit the app from here: open windows may hold unsaved documents.
require_app_not_running() {
  if pgrep -x mino-markdown >/dev/null 2>&1; then
    printf 'MinoMarkdown is running. Quit it, then run ./install.sh again.\n' >&2
    exit 1
  fi
}

require_app_not_running
if [ ! -w "$install_dir" ]; then
  printf 'No write permission for %s.\n' "$install_dir" >&2
  exit 1
fi

"$project_dir/build.sh"

# The build takes minutes, so the app may have been opened in the meantime.
require_app_not_running

# Restores the old app if the swap below is interrupted or fails.
cleanup() {
  rm -rf "$staged"
  if [ -e "$previous" ] && [ ! -e "$target" ]; then
    mv "$previous" "$target"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

printf 'Installing to %s...\n' "$target"
ditto "$built_app" "$staged"
if [ -e "$target" ]; then
  mv "$target" "$previous"
fi
mv "$staged" "$target"
rm -rf "$previous"

# Refreshes the Finder icon and file associations; the install is valid without it.
touch "$target"
"$lsregister" -f "$target" || printf 'Warning: could not refresh Launch Services.\n' >&2

printf 'Installed: %s\n' "$target"
