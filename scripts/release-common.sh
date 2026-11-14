# Shared by build.sh, clean.sh, install.sh and start.sh. Expects $project_dir to be set and the caller to have changed into it.

release_dir="$project_dir/src-tauri/target/release"
bundle_dir="$release_dir/bundle"
app="$bundle_dir/macos/Mino.app"
binary="$app/Contents/MacOS/mino-markdown"
plist="$app/Contents/Info.plist"
release_binary="$release_dir/mino-markdown"
dsym="$release_dir/mino-markdown.dSYM"
sourcemap_dir="$release_dir/sourcemaps"
package_dir="$project_dir/dist-package"
manifest="$package_dir/manifest.json"

if [ -t 1 ]; then
  color_step=$(printf '\033[1;36m'); color_ok=$(printf '\033[32m'); color_warn=$(printf '\033[33m'); color_error=$(printf '\033[31m'); color_off=$(printf '\033[0m')
else
  color_step=''; color_ok=''; color_warn=''; color_error=''; color_off=''
fi

log_stamp() { date '+%H:%M:%S'; }
log_step() { printf '\n%s[%s] ==> %s%s\n' "$color_step" "$(log_stamp)" "$*" "$color_off"; }
log_info() { printf '[%s]     %s\n' "$(log_stamp)" "$*"; }
log_ok() { printf '%s[%s]  OK %s%s\n' "$color_ok" "$(log_stamp)" "$*" "$color_off"; }
log_warn() { printf '%s[%s] WARN %s%s\n' "$color_warn" "$(log_stamp)" "$*" "$color_off" >&2; }
log_error() { printf '%s[%s] ERROR %s%s\n' "$color_error" "$(log_stamp)" "$*" "$color_off" >&2; }
die() { log_error "$*"; exit 1; }

require_commands() {
  for required in "$@"; do
    command -v "$required" >/dev/null 2>&1 || die "Missing required command: $required"
  done
}

# Prints every version recorded for this project in one file. package-lock.json has two.
version_of() {
  case $1 in
    package-lock.json) sed -n '/"name": "mino-markdown",/{n;s/.*"version": "\([^"]*\)",.*/\1/p;}' "$1" ;;
    src-tauri/Cargo.lock) sed -n '/^name = "mino-markdown"$/{n;s/^version = "\(.*\)"$/\1/p;}' "$1" ;;
    src-tauri/Cargo.toml) sed -n 's/^version = "\([^"]*\)"$/\1/p' "$1" ;;
    *) sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "$1" ;;
  esac
}

archive_for() { printf '%s/Mino-%s-macos-arm64-unsigned.zip' "$package_dir" "$1"; }

macho_uuids() { dwarfdump --uuid "$1" 2>/dev/null | awk '{print $2}' | sort; }

# True when the dSYM really describes this binary.
dsym_matches() {
  [ -d "$2" ] || return 1
  binary_ids=$(macho_uuids "$1")
  [ -n "$binary_ids" ] && [ "$binary_ids" = "$(macho_uuids "$2")" ]
}
