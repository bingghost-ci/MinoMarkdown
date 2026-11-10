#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"
. "$project_dir/scripts/release-common.sh"

case "${1:-}" in
  '') ;;
  --help|-h)
    printf 'Usage: ./install.sh\n'
    printf 'Bump the patch version, build, install to /Applications and relaunch, commit and tag the\n'
    printf 'version, push to origin, save release symbols to Symbols/, then remove build output.\n'
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
symbols_dir="$project_dir/Symbols"
symbols_staging="$project_dir/.Symbols.staging.$$"
symbols_old="$project_dir/.Symbols.old.$$"
version_files='package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock'

work_dir=''
version_changed=false
swapping=false
had_previous=false
installed=false
quit_old_app=false
version_committed=false
warnings=0

warn_later() { warnings=$((warnings + 1)); log_warn "$@"; }

versions_are() {
  for file in $version_files; do
    [ "$(version_of "$file" | sort -u)" = "$1" ] || return 1
  done
}

backup_name() { printf '%s/versions/%s' "$work_dir" "$(printf '%s' "$1" | tr '/' '_')"; }

set_version() {
  old_pattern=$(printf '%s' "$1" | sed 's/\./\\./g')
  sed -i '' -e "s/^  \"version\": \"$old_pattern\",\$/  \"version\": \"$2\",/" package.json src-tauri/tauri.conf.json
  sed -i '' -e "/\"name\": \"mino-markdown\",/{n;s/\"version\": \"$old_pattern\"/\"version\": \"$2\"/;}" package-lock.json
  sed -i '' -e "s/^version = \"$old_pattern\"\$/version = \"$2\"/" src-tauri/Cargo.toml
  sed -i '' -e "/^name = \"mino-markdown\"\$/{n;s/^version = \"$old_pattern\"\$/version = \"$2\"/;}" src-tauri/Cargo.lock
}

# Undoes everything that hasn't been reported as installed, including after Ctrl-C.
cleanup() {
  exit_status=$?
  trap - EXIT INT TERM HUP
  rm -rf "$staged" "$symbols_staging"
  if [ "$installed" = false ]; then
    if [ "$swapping" = true ]; then
      if [ -e "$previous" ]; then
        rm -rf "$target"
        mv "$previous" "$target" && log_warn "Restored the previous app at $target" || log_error "Could not restore the previous app. It is at $previous"
      elif [ "$had_previous" = false ]; then
        rm -rf "$target"
      fi
    fi
    if [ "$version_changed" = true ]; then
      for file in $version_files; do
        cp -p "$(backup_name "$file")" "$file" || log_error "Could not restore $file"
      done
      log_warn "Version restored to $old_version"
    fi
    if [ "$quit_old_app" = true ] && [ -e "$target" ]; then open "$target" || true; fi
  fi
  if [ -e "$symbols_old" ]; then
    if [ -e "$symbols_dir" ]; then rm -rf "$symbols_old"; else mv "$symbols_old" "$symbols_dir" || true; fi
  fi
  if [ -n "$work_dir" ]; then rm -rf "$work_dir"; fi
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
  log_ok 'Previous version has quit'
}

verify_fresh_build() {
  built_version=$(plutil -extract CFBundleShortVersionString raw "$plist") || die 'Could not read the built app version.'
  [ "$built_version" = "$new_version" ] || die "Built app is version $built_version, expected $new_version."
  for file in "$binary" "$plist" "$archive"; do
    [ "$file" -nt "$work_dir/build-started" ] || die "Not produced by this build: $file"
  done
  case " $(lipo -archs "$binary") " in
    *' arm64 '*) ;;
    *) die 'Built app is not arm64.' ;;
  esac
  node scripts/package-manifest.mjs verify || die 'The package does not match its manifest.'
}

commit_tag_and_push() {
  push_command="git push --atomic origin refs/heads/$branch refs/tags/$tag"
  # shellcheck disable=SC2086
  if ! git commit -q --only -m "Bump version to $new_version" -- $version_files; then
    warn_later "Could not commit the version. Run: git commit --only -m 'Bump version to $new_version' -- $version_files && git tag -a $tag -m 'Mino $new_version' && $push_command"
    return
  fi
  version_committed=true
  log_ok "Committed version $new_version"
  if ! git tag -a "$tag" -m "Mino $new_version"; then
    warn_later "Could not create $tag. Run: git tag -a $tag -m 'Mino $new_version' && $push_command"
    return
  fi
  log_ok "Tagged $tag"
  if git push --atomic origin "refs/heads/$branch" "refs/tags/$tag"; then
    log_ok "Pushed $branch and $tag to origin"
  else
    warn_later "Push failed. Push manually with: $push_command"
  fi
}

package_version() { sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "node_modules/$1/package.json" 2>/dev/null | head -n 1; }

write_build_info() {
  printf 'product=Mino\n'
  printf 'version=%s\n' "$new_version"
  printf 'tag=%s\n' "$tag"
  printf 'commit=%s\n' "$(git rev-parse HEAD)"
  printf 'version_committed=%s\n' "$version_committed"
  printf 'branch=%s\n' "$branch"
  printf 'uncommitted_changes_at_build=%s\n' "$dirty_tree"
  printf 'built_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'binary_uuid=%s\n' "$(macho_uuids "$binary" | tr '\n' ' ')"
  printf 'macos=%s\n' "$(sw_vers -productVersion)"
  printf 'architecture=%s\n' "$(uname -m)"
  printf 'rustc=%s\n' "$(rustc -V)"
  printf 'cargo=%s\n' "$(cargo -V)"
  printf 'clang=%s\n' "$(clang --version | head -n 1)"
  printf 'node=%s\n' "$(node -v)"
  printf 'npm=%s\n' "$(npm -v)"
  printf 'tauri_crate=%s\n' "$(sed -n '/^name = "tauri"$/{n;s/^version = "\(.*\)"$/\1/p;}' src-tauri/Cargo.lock)"
  printf 'tauri_cli=%s\n' "$(package_version @tauri-apps/cli)"
  printf 'react=%s\n' "$(package_version react)"
  printf 'milkdown_crepe=%s\n' "$(package_version @milkdown/crepe)"
  printf 'mermaid=%s\n' "$(package_version mermaid)"
  printf 'katex=%s\n' "$(package_version katex)"
}

# Writes to a staging directory first, so a failure leaves the existing backup untouched.
backup_symbols() {
  dsym_matches "$binary" "$dsym" || { log_error "No dSYM matching the executable at $dsym"; return 1; }
  [ -n "$(find "$sourcemap_dir" -name '*.map' -print -quit 2>/dev/null)" ] || { log_error "No source maps at $sourcemap_dir"; return 1; }
  mkdir -p "$symbols_staging/content" || return 1
  # Cargo publishes the dSYM as a link into deps/, so -L copies the real files.
  cp -RL "$dsym" "$symbols_staging/content/mino-markdown.dSYM" || return 1
  cp -R "$sourcemap_dir" "$symbols_staging/content/sourcemaps" || return 1
  ditto -c -k --norsrc "$symbols_staging/content" "$symbols_staging/release-symbols.zip" || return 1
  unzip -tq "$symbols_staging/release-symbols.zip" >/dev/null || return 1
  rm -rf "$symbols_staging/content" || return 1
  write_build_info > "$symbols_staging/build-info.txt" || return 1
  if [ -e "$symbols_dir" ]; then mv "$symbols_dir" "$symbols_old" || return 1; fi
  if ! mv "$symbols_staging" "$symbols_dir"; then
    if [ -e "$symbols_old" ]; then mv "$symbols_old" "$symbols_dir" || true; fi
    return 1
  fi
  rm -rf "$symbols_old" || true
}

remove_build_output() {
  rm -rf "$project_dir/src-tauri/target/debug" "$project_dir/src-tauri/target/release" || return 1
  rm -f "$manifest" "$package_dir"/Mino-*-macos-arm64-unsigned.zip || return 1
}

log_step 'Checking prerequisites'
require_commands git sed ditto unzip plutil lipo dwarfdump osascript open pgrep node npm rustc cargo clang sw_vers
[ -w "$install_dir" ] || die "No write permission for $install_dir."
branch=$(git symbolic-ref --short -q HEAD) || die 'HEAD is detached; check out a branch first.'

# shellcheck disable=SC2086
changed_version_files=$(git status --porcelain -- $version_files)
[ -z "$changed_version_files" ] || die "Version files have uncommitted changes; commit or discard them first:
$changed_version_files"

old_version=$(version_of src-tauri/tauri.conf.json)
printf '%s' "$old_version" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || die "Unsupported version: '$old_version'."
versions_are "$old_version" || die "Version files disagree; each should say $old_version."
new_version="${old_version%.*}.$((${old_version##*.} + 1))"
tag="v$new_version"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then die "Tag $tag already exists."; fi
archive=$(archive_for "$new_version")

dirty_tree=no
if [ -n "$(git status --porcelain)" ]; then
  dirty_tree=yes
  log_warn "The working tree has uncommitted changes. They will be in the app but not in $tag."
fi
log_ok "Branch $branch, version $old_version -> $new_version"

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/mino-install.XXXXXX")
mkdir "$work_dir/versions"
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

log_step "1/5 Setting version $new_version and building"
for file in $version_files; do cp -p "$file" "$(backup_name "$file")"; done
version_changed=true
set_version "$old_version" "$new_version"
versions_are "$new_version" || die 'Could not update every version file.'
log_ok "Updated: $version_files"
touch "$work_dir/build-started"
sleep 1
"$project_dir/build.sh"

log_step '2/5 Verifying and installing'
verify_fresh_build
log_ok "Build verified as version $new_version from this run"
log_info "Staging $target"
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
if open "$target"; then log_ok "Launched Mino $new_version"; else warn_later "Could not launch $target"; fi

log_step "3/5 Committing, tagging, and pushing $tag"
commit_tag_and_push

log_step '4/5 Saving release symbols'
if backup_symbols; then
  log_ok "Symbols saved in $symbols_dir"

  log_step '5/5 Removing build output'
  if remove_build_output; then log_ok 'Removed Cargo debug and release output and the local package'; else warn_later 'Could not remove all build output.'; fi
else
  warn_later 'Symbol backup failed. Build output was kept so the symbols can be recovered; the previous backup is unchanged.'
  log_step '5/5 Skipped build output removal'
fi

log_step "Mino $new_version is installed"
if [ "$warnings" -gt 0 ]; then log_warn "Finished with $warnings warning(s); see above. The install itself succeeded."; fi
