#!/bin/bash

set -e 

LINK_REACT=false
LINK_SOLID=false
LINK_DIST=false
COPY_MODE=false
TARGET_ROOT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --react)
            LINK_REACT=true
            shift
            ;;
        --solid)
            LINK_SOLID=true
            shift
            ;;
        --dist)
            LINK_DIST=true
            shift
            ;;
        --copy)
            COPY_MODE=true
            shift
            ;;
        *)
            TARGET_ROOT="$1"
            shift
            ;;
    esac
done

if [ -z "$TARGET_ROOT" ]; then
    echo "Usage: $0 <target-project-root> [--react] [--solid] [--dist] [--copy]"
    echo "Example: $0 /path/to/your/project"
    echo "Example: $0 /path/to/your/project --solid"
    echo "Example: $0 /path/to/your/project --react --dist"
    echo "Example: $0 /path/to/your/project --dist --copy"
    echo ""
    echo "By default, only @opentui/core is linked."
    echo "Options:"
    echo "  --react   Also link @opentui/react"
    echo "  --solid   Also link @opentui/solid and solid-js"
    echo "  --dist    Link dist directories instead of source packages"
    echo "  --copy    Copy dist directories instead of symlinking (requires --dist)"
    exit 1
fi

if [ "$COPY_MODE" = true ] && [ "$LINK_DIST" = false ]; then
    echo "Error: --copy requires --dist to be specified"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENTUI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_MODULES_DIR="$TARGET_ROOT/node_modules"

if [ ! -d "$TARGET_ROOT" ]; then
    echo "Error: Target project root directory does not exist: $TARGET_ROOT"
    exit 1
fi

if [ ! -d "$NODE_MODULES_DIR" ]; then
    echo "Error: node_modules directory does not exist: $NODE_MODULES_DIR"
    echo "Please run 'bun install' or 'npm install' in the target project first."
    exit 1
fi

echo "Linking OpenTUI packages from: $OPENTUI_ROOT"
echo "To node_modules in: $NODE_MODULES_DIR"
echo

remove_if_exists() {
    local path="$1"
    if [ -e "$path" ]; then
        echo "Removing existing: $path"
        rm -rf "$path"
    fi
}

link_or_copy() {
    local source_path="$1"
    local target_path="$2"
    local package_name="$3"
    
    if [ "$COPY_MODE" = true ]; then
        cp -r "$source_path" "$target_path"
        echo "✓ Copied $package_name"
    else
        ln -s "$source_path" "$target_path"
        echo "✓ Linked $package_name"
    fi
}

mkdir -p "$NODE_MODULES_DIR/@opentui"

# Determine path suffix and message
if [ "$LINK_DIST" = true ]; then
    SUFFIX="/dist"
    if [ "$COPY_MODE" = true ]; then
        echo "Copying dist directories..."
    else
        echo "Creating symbolic links (using dist directories)..."
    fi
else
    SUFFIX=""
    echo "Creating symbolic links..."
fi

# Always link core
remove_if_exists "$NODE_MODULES_DIR/@opentui/core"
CORE_PATH="$OPENTUI_ROOT/packages/core$SUFFIX"
if [ -d "$CORE_PATH" ]; then
    link_or_copy "$CORE_PATH" "$NODE_MODULES_DIR/@opentui/core" "@opentui/core"
else
    echo "Warning: $CORE_PATH not found"
fi

# Link React if requested
if [ "$LINK_REACT" = true ]; then
    remove_if_exists "$NODE_MODULES_DIR/@opentui/react"
    REACT_PATH="$OPENTUI_ROOT/packages/react$SUFFIX"
    if [ -d "$REACT_PATH" ]; then
        link_or_copy "$REACT_PATH" "$NODE_MODULES_DIR/@opentui/react" "@opentui/react"
    else
        echo "Warning: $REACT_PATH not found"
    fi
fi

# Link Solid and solid-js if requested
if [ "$LINK_SOLID" = true ]; then
    remove_if_exists "$NODE_MODULES_DIR/@opentui/solid"
    SOLID_PATH="$OPENTUI_ROOT/packages/solid$SUFFIX"
    if [ -d "$SOLID_PATH" ]; then
        link_or_copy "$SOLID_PATH" "$NODE_MODULES_DIR/@opentui/solid" "@opentui/solid"
    else
        echo "Warning: $SOLID_PATH not found"
    fi

    # Only link solid-js when not in copy mode
    if [ "$COPY_MODE" = false ]; then
        remove_if_exists "$NODE_MODULES_DIR/solid-js"
        if [ -d "$OPENTUI_ROOT/node_modules/solid-js" ]; then
            ln -s "$OPENTUI_ROOT/node_modules/solid-js" "$NODE_MODULES_DIR/solid-js"
            echo "✓ Linked solid-js"
        elif [ -d "$OPENTUI_ROOT/packages/solid/node_modules/solid-js" ]; then
            ln -s "$OPENTUI_ROOT/packages/solid/node_modules/solid-js" "$NODE_MODULES_DIR/solid-js"
            echo "✓ Linked solid-js (from packages/solid/node_modules)"
        else
            echo "Warning: solid-js not found in OpenTUI node_modules"
        fi
    fi
fi

echo
echo "OpenTUI development linking complete!"