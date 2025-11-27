#!/bin/bash

set -e 

LINK_REACT=false
LINK_SOLID=false
LINK_DIST=false
COPY_MODE=false
LINK_SUBDEPS=false
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
        --subdeps)
            LINK_SUBDEPS=true
            shift
            ;;
        *)
            TARGET_ROOT="$1"
            shift
            ;;
    esac
done

if [ -z "$TARGET_ROOT" ]; then
    echo "Usage: $0 <target-project-root> [--react] [--solid] [--dist] [--copy] [--subdeps]"
    echo "Example: $0 /path/to/your/project"
    echo "Example: $0 /path/to/your/project --solid"
    echo "Example: $0 /path/to/your/project --react --dist"
    echo "Example: $0 /path/to/your/project --dist --copy"
    echo "Example: $0 /path/to/your/project --solid --subdeps"
    echo ""
    echo "By default, only @opentui/core is linked."
    echo "Options:"
    echo "  --react    Also link @opentui/react"
    echo "  --solid    Also link @opentui/solid and solid-js"
    echo "  --dist     Link dist directories instead of source packages"
    echo "  --copy     Copy dist directories instead of symlinking (requires --dist)"
    echo "  --subdeps  Find and link packages that depend on opentui (e.g., opentui-spinner)"
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

# Link yoga-layout when not in copy mode to ensure version consistency
if [ "$COPY_MODE" = false ]; then
    remove_if_exists "$NODE_MODULES_DIR/yoga-layout"
    if [ -d "$OPENTUI_ROOT/node_modules/yoga-layout" ]; then
        ln -s "$OPENTUI_ROOT/node_modules/yoga-layout" "$NODE_MODULES_DIR/yoga-layout"
        echo "✓ Linked yoga-layout"
    elif [ -d "$OPENTUI_ROOT/packages/core/node_modules/yoga-layout" ]; then
        ln -s "$OPENTUI_ROOT/packages/core/node_modules/yoga-layout" "$NODE_MODULES_DIR/yoga-layout"
        echo "✓ Linked yoga-layout (from packages/core/node_modules)"
    else
        echo "Warning: yoga-layout not found in OpenTUI node_modules"
    fi
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

    # Only link react, react-dom, and react-reconciler when not in copy mode
    if [ "$COPY_MODE" = false ]; then
        # Link react
        remove_if_exists "$NODE_MODULES_DIR/react"
        if [ -d "$OPENTUI_ROOT/node_modules/react" ]; then
            ln -s "$OPENTUI_ROOT/node_modules/react" "$NODE_MODULES_DIR/react"
            echo "✓ Linked react"
        elif [ -d "$OPENTUI_ROOT/packages/react/node_modules/react" ]; then
            ln -s "$OPENTUI_ROOT/packages/react/node_modules/react" "$NODE_MODULES_DIR/react"
            echo "✓ Linked react (from packages/react/node_modules)"
        else
            echo "Warning: react not found in OpenTUI node_modules"
        fi

        # Link react-dom
        remove_if_exists "$NODE_MODULES_DIR/react-dom"
        if [ -d "$OPENTUI_ROOT/node_modules/react-dom" ]; then
            ln -s "$OPENTUI_ROOT/node_modules/react-dom" "$NODE_MODULES_DIR/react-dom"
            echo "✓ Linked react-dom"
        elif [ -d "$OPENTUI_ROOT/packages/react/node_modules/react-dom" ]; then
            ln -s "$OPENTUI_ROOT/packages/react/node_modules/react-dom" "$NODE_MODULES_DIR/react-dom"
            echo "✓ Linked react-dom (from packages/react/node_modules)"
        else
            echo "Warning: react-dom not found in OpenTUI node_modules"
        fi

        # Link react-reconciler
        remove_if_exists "$NODE_MODULES_DIR/react-reconciler"
        if [ -d "$OPENTUI_ROOT/node_modules/react-reconciler" ]; then
            ln -s "$OPENTUI_ROOT/node_modules/react-reconciler" "$NODE_MODULES_DIR/react-reconciler"
            echo "✓ Linked react-reconciler"
        elif [ -d "$OPENTUI_ROOT/packages/react/node_modules/react-reconciler" ]; then
            ln -s "$OPENTUI_ROOT/packages/react/node_modules/react-reconciler" "$NODE_MODULES_DIR/react-reconciler"
            echo "✓ Linked react-reconciler (from packages/react/node_modules)"
        else
            echo "Warning: react-reconciler not found in OpenTUI node_modules"
        fi
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

# Link subdependencies if requested
if [ "$LINK_SUBDEPS" = true ]; then
    echo
    echo "Discovering packages that depend on opentui..."
    
    # Function to find packages with opentui dependencies in bun.lock
    find_opentui_dependents_in_lockfile() {
        if [ ! -f "$TARGET_ROOT/bun.lock" ]; then
            return
        fi
        
        # Find packages that have peerDependencies or dependencies on @opentui packages
        # Bun.lock format has package entries with dependencies/peerDependencies on same line
        grep '@opentui/' "$TARGET_ROOT/bun.lock" | grep -E '(peer)?[Dd]ependencies' | sed 's/^[[:space:]]*"\([^"]*\)".*/\1/' | grep -v '^@opentui' | grep -v '^\$' | grep -v '^#' | grep -v dependencies | grep -v ':' | sort -u || true
    }
    
    # Function to find packages with opentui dependencies in package.json files
    find_opentui_dependents_in_packages() {
        if [ ! -d "$TARGET_ROOT/packages" ]; then
            return
        fi
        
        find "$TARGET_ROOT/packages" -name "package.json" -type f 2>/dev/null | while read -r pkg_json; do
            if grep -q '@opentui' "$pkg_json" 2>/dev/null; then
                grep -m1 '"name"' "$pkg_json" | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' | grep -v '@opentui' || true
            fi
        done | sort -u
    }
    
    # Function to link opentui packages in a specific location
    link_opentui_in_location() {
        local location_path="$1"
        local location_desc="$2"
        
        if [ ! -d "$location_path" ]; then
            return 0
        fi
        
        local linked_any=false
        
        # Link @opentui/core if it exists
        if [ -d "$location_path/@opentui/core" ] || [ -L "$location_path/@opentui/core" ]; then
            remove_if_exists "$location_path/@opentui/core"
            CORE_PATH="$OPENTUI_ROOT/packages/core$SUFFIX"
            if [ -d "$CORE_PATH" ]; then
                mkdir -p "$location_path/@opentui"
                ln -s "$CORE_PATH" "$location_path/@opentui/core"
                echo "    ✓ Linked @opentui/core in $location_desc"
                linked_any=true
            fi
        fi
        
        # Link @opentui/react if it exists
        if [ -d "$location_path/@opentui/react" ] || [ -L "$location_path/@opentui/react" ]; then
            remove_if_exists "$location_path/@opentui/react"
            REACT_PATH="$OPENTUI_ROOT/packages/react$SUFFIX"
            if [ -d "$REACT_PATH" ]; then
                mkdir -p "$location_path/@opentui"
                ln -s "$REACT_PATH" "$location_path/@opentui/react"
                echo "    ✓ Linked @opentui/react in $location_desc"
                linked_any=true
            fi
        fi
        
        # Link @opentui/solid if it exists
        if [ -d "$location_path/@opentui/solid" ] || [ -L "$location_path/@opentui/solid" ]; then
            remove_if_exists "$location_path/@opentui/solid"
            SOLID_PATH="$OPENTUI_ROOT/packages/solid$SUFFIX"
            if [ -d "$SOLID_PATH" ]; then
                mkdir -p "$location_path/@opentui"
                ln -s "$SOLID_PATH" "$location_path/@opentui/solid"
                echo "    ✓ Linked @opentui/solid in $location_desc"
                linked_any=true
            fi
        fi
        
        return 0
    }
    
    # Collect all packages that depend on opentui
    dependents_lockfile=$(find_opentui_dependents_in_lockfile)
    dependents_packages=$(find_opentui_dependents_in_packages)
    dependents=$(echo -e "$dependents_lockfile\n$dependents_packages" | grep -v '^$' | sort -u)
    
    if [ -z "$dependents" ]; then
        echo "No packages found that depend on opentui"
    else
        echo "Found packages that depend on opentui:"
        echo "$dependents" | sed 's/^/  - /'
        echo
        
        # For each dependent package, find where it's installed and link subdeps
        for pkg in $dependents; do
            echo "  Processing $pkg..."
            
            # Check in workspace packages' node_modules
            if [ -d "$TARGET_ROOT/packages" ]; then
                find "$TARGET_ROOT/packages" -type d -name "node_modules" 2>/dev/null | while read -r pkg_node_modules; do
                    if [ -d "$pkg_node_modules/$pkg/node_modules" ]; then
                        workspace_pkg_name=$(basename "$(dirname "$pkg_node_modules")")
                        link_opentui_in_location "$pkg_node_modules/$pkg/node_modules" "$pkg (in workspace: $workspace_pkg_name)"
                    fi
                done
            fi
            
            # Check in bun's cache directories
            if [ -d "$NODE_MODULES_DIR/.bun" ]; then
                find "$NODE_MODULES_DIR/.bun" -type d -maxdepth 1 -name "*$pkg@*" 2>/dev/null | while read -r bun_pkg_cache; do
                    # Bun stores packages as: .bun/package@version/node_modules/@opentui/...
                    if [ -d "$bun_pkg_cache/node_modules" ]; then
                        link_opentui_in_location "$bun_pkg_cache/node_modules" "$pkg (bun cache: $(basename "$bun_pkg_cache"))"
                    fi
                done
            fi
        done
    fi
fi

echo
echo "OpenTUI development linking complete!"
