#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"
. "$project_dir/scripts/release-common.sh"

case "${1:-}" in
  '') ;;
  --help|-h)
    printf 'Usage: ./install.sh\n'
    printf 'Build the release app with ./build.sh, install it to /Applications (replacing the\n'
    printf 'installed copy), open it, then remove all build output with ./clean.sh.\n'
    printf 'Does not change the version, commit, tag or push. npm dependencies are kept.\n'
    exit 0
    ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac

install_dir=/Applications
target="$install_dir/Mino.app"
staged="$install_dir/.Mino.app.installing.$$"
previous="$install_dir/.Mino.app.previous.$$"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
bundle_id=app.mino.markdown
quit_timeout_seconds=120

build_marker=''
swapping=false
had_previous=false
installed=false
quit_old_app=false
warnings=0

warn_later() { warnings=$((warnings + 1)); log_warn "$@"; }

# Puts the previous app back when the install did not finish, including after Ctrl-C.
cleanup() {
  exit_status=$?
  trap - EXIT INT TERM HUP
  rm -rf "$staged"
  if [ "$installed" = false ]; then
    if [ "$swapping" = true ]; then
      if [ -e "$previous" ]; then
        rm -rf "$target"
        mv "$previous" "$target" && log_warn "Restored the previous app at $target" || log_error "Could not restore the previous app. It is at $previous"
      elif [ "$had_previous" = false ]; then
        rm -rf "$target"
      fi
    fi
    if [ "$quit_old_app" = true ] && [ -e "$target" ]; then open "$target" || true; fi
  fi
  if [ -n "$build_marker" ]; then rm -f "$build_marker"; fi
  exit "$exit_status"
}

# Asks the app to quit normally so it can prompt for unsaved documents. It is never killed.
quit_running_app() {
  pgrep -x mino-markdown >/dev/null 2>&1 || return 0
  log_info 'Mino is running; asking it to quit. Save or discard any open documents when prompted.'
  quit_old_app=true
  waited=0
  while pgrep -x mino-markdown >/dev/null 2>&1; do
    [ "$waited" -lt "$quit_timeout_seconds" ] || die "Mino did not quit within $quit_timeout_seconds seconds. The installed app was not changed."
    if [ $((waited % 15)) -eq 0 ]; then osascript -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1 || true; fi
    sleep 1
    waited=$((waited + 1))
  done
  log_ok 'The running Mino has quit'
}

verify_fresh_build() {
  built_version=$(plutil -extract CFBundleShortVersionString raw "$plist") || die 'Could not read the built app version.'
  [ "$built_version" = "$version" ] || die "Built app is version $built_version, expected $version."
  for file in "$binary" "$plist"; do
    [ "$file" -nt "$build_marker" ] || die "Not produced by this build: $file"
  done
  case " $(lipo -archs "$binary") " in
    *' arm64 '*) ;;
    *) die 'Built app is not arm64.' ;;
  esac
  node scripts/package-manifest.mjs verify || die 'The package does not match its manifest.'
}

log_step 'Checking prerequisites'
require_commands ditto plutil lipo osascript open pgrep node
[ -w "$install_dir" ] || die "No write permission for $install_dir."
version=$(version_of src-tauri/tauri.conf.json)
[ -n "$version" ] || die 'Could not read the version from src-tauri/tauri.conf.json.'
log_ok "Installing Mino $version"

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

log_step '1/4 Building the release app'
build_marker=$(mktemp "${TMPDIR:-/tmp}/mino-install.XXXXXX")
sleep 1
"$project_dir/build.sh"
verify_fresh_build
log_ok "Build verified as version $version from this run"

log_step "2/4 Installing to $target"
ditto "$app" "$staged"
quit_running_app
if [ -e "$target" ]; then had_previous=true; fi
swapping=true
if [ "$had_previous" = true ]; then mv "$target" "$previous"; fi
mv "$staged" "$target"
installed=true
log_ok "Installed: $target"
rm -rf "$previous" || warn_later "Could not remove the old copy at $previous"
touch "$target" || true
"$lsregister" -f "$target" || warn_later 'Could not refresh Launch Services.'

log_step '3/4 Opening Mino'
if open "$target"; then log_ok "Opened Mino $version"; else warn_later "Could not open $target"; fi

log_step '4/4 Removing build output'
"$project_dir/clean.sh" || warn_later 'Could not remove all build output; run ./clean.sh again.'

log_step "Mino $version is installed"
if [ "$warnings" -gt 0 ]; then log_warn "Finished with $warnings warning(s); see above. The install itself succeeded."; fi
