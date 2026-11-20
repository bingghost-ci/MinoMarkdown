#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"
. "$project_dir/scripts/release-common.sh"

case "${1:-}" in
  '') ;;
  --help|-h)
    printf 'Usage: ./build.sh\n'
    printf 'Remove previous build output, then build, archive, and verify Mino.app.\n'
    printf 'Does not change the version. Dependencies and Cargo caches are kept.\n'
    exit 0
    ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac

require_commands npm node rustc cargo lipo ditto unzip plutil dwarfdump
require_version
archive=$(archive_for "$version")
log_info "Building Mino $version"

log_step 'Removing previous build output'
rm -rf "$bundle_dir" "$dsym" "$sourcemap_dir" "$project_dir/dist"
rm -f "$release_binary" "$manifest" "$package_dir"/Mino-*-macos-arm64-unsigned.zip
log_ok 'Previous build output removed; dependencies and Cargo caches kept'

ensure_toolchain

log_step 'Compiling the release app'
# --locked makes Cargo stop instead of changing Cargo.lock.
MINO_SOURCEMAP_DIR="$sourcemap_dir" npm run tauri -- build --bundles app --no-sign -- --locked
[ -f "$binary" ] || die "Build finished without the expected executable: $binary"
log_ok "Built $app"

log_step 'Checking the app'
case " $(lipo -archs "$binary") " in
  *' arm64 '*) log_ok 'Executable is arm64' ;;
  *) die 'Built app is not arm64.' ;;
esac
[ -z "$(find "$app" -name '*.dSYM' -print -quit)" ] || die 'The app bundle contains a dSYM.'
[ -z "$(find "$project_dir/dist" -name '*.map' -print -quit)" ] || die 'dist contains source maps, which would ship inside the app.'
log_ok 'No debug symbols or source maps in the release package'
if dsym_matches "$binary" "$dsym"; then log_ok "Symbols match the executable: $dsym"; else log_warn "No matching dSYM at $dsym"; fi
[ -n "$(find "$sourcemap_dir" -name '*.map' -print -quit 2>/dev/null)" ] && log_ok "Source maps: $sourcemap_dir" || log_warn "No source maps at $sourcemap_dir"

log_step 'Packaging'
mkdir -p "$package_dir"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
node scripts/package-manifest.mjs write
node scripts/package-manifest.mjs verify
log_ok "Package: $archive"

log_step "Build of Mino $version finished"
