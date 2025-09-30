#!/bin/bash

set -e 

LINK_REACT=false
LINK_SOLID=false
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
        *)
            TARGET_ROOT="$1"
            shift
            ;;
    esac
done

if [ -z "$TARGET_ROOT" ]; then
    echo "Usage: $0 <target-project-root> [--react] [--solid]"
    echo "Example: $0 /path/to/your/project"
    echo "Example: $0 /path/to/your/project --solid"
    echo "Example: $0 /path/to/your/project --react"
    echo ""
    echo "By default, only @opentui/core is linked."
    echo "Options:"
    echo "  --react   Also link @opentui/react"
    echo "  --solid   Also link @opentui/solid and solid-js"
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

mkdir -p "$NODE_MODULES_DIR/@opentui"

echo "Creating symbolic links..."

# Always link core
remove_if_exists "$NODE_MODULES_DIR/@opentui/core"
if [ -d "$OPENTUI_ROOT/packages/core" ]; then
    ln -s "$OPENTUI_ROOT/packages/core" "$NODE_MODULES_DIR/@opentui/core"
    echo "✓ Linked @opentui/core"
else
    echo "Warning: $OPENTUI_ROOT/packages/core not found"
fi

# Link React if requested
if [ "$LINK_REACT" = true ]; then
    remove_if_exists "$NODE_MODULES_DIR/@opentui/react"
    if [ -d "$OPENTUI_ROOT/packages/react" ]; then
        ln -s "$OPENTUI_ROOT/packages/react" "$NODE_MODULES_DIR/@opentui/react"
        echo "✓ Linked @opentui/react"
    else
        echo "Warning: $OPENTUI_ROOT/packages/react not found"
    fi
fi

# Link Solid and solid-js if requested
if [ "$LINK_SOLID" = true ]; then
    remove_if_exists "$NODE_MODULES_DIR/@opentui/solid"
    if [ -d "$OPENTUI_ROOT/packages/solid" ]; then
        ln -s "$OPENTUI_ROOT/packages/solid" "$NODE_MODULES_DIR/@opentui/solid"
        echo "✓ Linked @opentui/solid"
    else
        echo "Warning: $OPENTUI_ROOT/packages/solid not found"
    fi

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

echo
echo "OpenTUI development linking complete!"