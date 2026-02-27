#!/usr/bin/env bash
# Build script for the OpenTUI Rust native core.
#
# Usage:
#   ./build.sh              # Build for current platform (debug)
#   ./build.sh --release    # Build for current platform (release)
#   ./build.sh --all        # Cross-compile for all supported targets (release)
#
# Supported cross-compilation targets (matching the original Zig build):
#   - x86_64-unknown-linux-gnu
#   - aarch64-unknown-linux-gnu
#   - x86_64-apple-darwin
#   - aarch64-apple-darwin
#   - x86_64-pc-windows-gnu
#   - aarch64-pc-windows-gnu

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Map Rust targets to output directory names (matching Zig convention)
declare -A TARGET_MAP=(
    ["x86_64-unknown-linux-gnu"]="x86_64-linux"
    ["aarch64-unknown-linux-gnu"]="aarch64-linux"
    ["x86_64-apple-darwin"]="x86_64-macos"
    ["aarch64-apple-darwin"]="aarch64-macos"
    ["x86_64-pc-windows-gnu"]="x86_64-windows"
    ["aarch64-pc-windows-gnu"]="aarch64-windows"
)

# Library filename per OS
lib_filename() {
    local target="$1"
    case "$target" in
        *-linux-*)   echo "libopentui.so" ;;
        *-apple-*)   echo "libopentui.dylib" ;;
        *-windows-*) echo "opentui.dll" ;;
    esac
}

build_target() {
    local target="$1"
    local profile="${2:-release}"
    local profile_flag=""
    local profile_dir="$profile"

    if [[ "$profile" == "release" ]]; then
        profile_flag="--release"
        profile_dir="release"
    else
        profile_dir="debug"
    fi

    echo "Building for $target ($profile)..."
    cargo build $profile_flag --target "$target"

    local lib_name
    lib_name="$(lib_filename "$target")"
    local out_name="${TARGET_MAP[$target]}"
    local out_dir="$SCRIPT_DIR/lib/$out_name"
    mkdir -p "$out_dir"

    local src="$SCRIPT_DIR/target/$target/$profile_dir/$lib_name"
    if [[ -f "$src" ]]; then
        cp "$src" "$out_dir/$lib_name"
        echo "  -> lib/$out_name/$lib_name"
    else
        echo "  WARNING: $src not found"
    fi
}

build_native() {
    local profile="${1:-debug}"
    local profile_flag=""
    local profile_dir="$profile"

    if [[ "$profile" == "release" ]]; then
        profile_flag="--release"
        profile_dir="release"
    else
        profile_dir="debug"
    fi

    echo "Building for current platform ($profile)..."
    cargo build $profile_flag

    # Copy to lib/ directory
    local out_dir="$SCRIPT_DIR/lib/native"
    mkdir -p "$out_dir"

    for ext in so dylib dll; do
        local src
        for src in "$SCRIPT_DIR/target/$profile_dir"/libopentui.$ext "$SCRIPT_DIR/target/$profile_dir"/opentui.$ext; do
            if [[ -f "$src" ]]; then
                cp "$src" "$out_dir/"
                echo "  -> lib/native/$(basename "$src")"
            fi
        done
    done
}

case "${1:-}" in
    --release)
        build_native release
        ;;
    --all)
        for target in "${!TARGET_MAP[@]}"; do
            build_target "$target" release || echo "  SKIP: $target (toolchain not installed)"
        done
        ;;
    --help|-h)
        head -16 "$0" | tail -14
        ;;
    *)
        build_native debug
        ;;
esac

echo "Done."
