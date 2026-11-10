#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

require_arm64() {
  path=$1
  description=$2
  if [ ! -f "$path" ]; then
    printf '%s missing: %s\n' "$description" "$path" >&2
    exit 1
  fi
  architectures=$(lipo -archs "$path")
  case " $architectures " in
    *' arm64 '*) printf '%s: %s\n' "$description" "$architectures" ;;
    *) printf '%s is not arm64: %s\n' "$description" "$architectures" >&2; exit 1 ;;
  esac
}

if [ "$(uname -m)" != arm64 ]; then
  printf 'Expected Apple Silicon macOS (arm64).\n' >&2
  exit 1
fi

node_arch=$(node -p 'process.platform + "/" + process.arch')
if [ "$node_arch" != darwin/arm64 ]; then
  printf 'Node is not running natively: %s\n' "$node_arch" >&2
  exit 1
fi
printf 'Node: %s\n' "$node_arch"
require_arm64 "$(command -v node)" 'Node executable'

rust_host=$(rustc -vV | sed -n 's/^host: //p')
if [ "$rust_host" != aarch64-apple-darwin ]; then
  printf 'Rust host is not Apple Silicon: %s\n' "$rust_host" >&2
  exit 1
fi
printf 'Rust host: %s\n' "$rust_host"

rust_app="$root_dir/src-tauri/target/debug/mino-markdown"
if [ -f "$rust_app" ]; then
  require_arm64 "$rust_app" 'Mino Rust executable'
else
  printf 'Mino Rust executable: pending build\n'
fi

tauri_native="$root_dir/node_modules/@tauri-apps/cli-darwin-arm64/cli.darwin-arm64.node"
if [ -d "$root_dir/node_modules" ]; then
  require_arm64 "$tauri_native" 'Tauri CLI native module'
else
  printf 'Tauri CLI native module: pending npm installation\n'
fi
