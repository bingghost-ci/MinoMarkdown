#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"

case "${1:-}" in
  '') build_only=false ;;
  --build-only) build_only=true ;;
  --help|-h)
    printf 'Usage: ./start.sh [--build-only]\n'
    printf 'Build the local Apple Silicon app and open it for testing.\n'
    exit 0
    ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac

for required in npm node rustc cargo lipo ditto unzip plutil; do
  if ! command -v "$required" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$required" >&2
    exit 1
  fi
done

if [ "$build_only" = false ]; then
  if ! command -v open >/dev/null 2>&1; then
    printf 'Missing required command: open\n' >&2
    exit 1
  fi
  if pgrep -x mino-markdown >/dev/null 2>&1; then
    printf 'MinoMarkdown is already running. Quit it, then run ./start.sh again to test the new build.\n' >&2
    exit 1
  fi
fi

if [ ! -x node_modules/.bin/tauri ]; then
  printf 'Installing locked npm dependencies...\n'
  npm ci --no-audit --no-fund
fi

printf 'Checking Apple Silicon toolchain...\n'
npm run archcheck

app="$project_dir/src-tauri/target/release/bundle/macos/MinoMarkdown.app"
binary="$app/Contents/MacOS/mino-markdown"
archive="$project_dir/dist-package/MinoMarkdown-0.1.0-macos-arm64-unsigned.zip"
printf 'Removing previous generated app and package...\n'
rm -rf "$app"
rm -f "$project_dir/src-tauri/target/release/mino-markdown" "$archive" "$project_dir/dist-package/manifest.json"

printf 'Building MinoMarkdown.app...\n'
npm run tauri -- build --bundles app --no-sign

if [ ! -f "$binary" ]; then
  printf 'Build finished without the expected app executable: %s\n' "$binary" >&2
  exit 1
fi
case " $(lipo -archs "$binary") " in
  *' arm64 '*) ;;
  *) printf 'Built app is not arm64: %s\n' "$binary" >&2; exit 1 ;;
esac

printf 'Built arm64 app: %s\n' "$app"
mkdir -p "$project_dir/dist-package"
printf 'Packaging and verifying local test archive...\n'
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
node scripts/package-manifest.mjs write
node scripts/package-manifest.mjs verify

if [ "$build_only" = true ]; then
  exit 0
fi

printf 'Opening MinoMarkdown for local testing...\n'
open "$app"
