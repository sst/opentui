#!/bin/bash
set -e

# OpenTUI System Installation Script
# Installs OpenTUI headers and libraries system-wide

REPO="sst/opentui"
RELEASE_URL="https://github.com/$REPO/releases/latest/download"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}OpenTUI System Installer${NC}"
echo "Installing OpenTUI headers and libraries..."

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
    x86_64|amd64) ARCH="x86_64" ;;
    arm64|aarch64) ARCH="aarch64" ;;
    *) echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"; exit 1 ;;
esac

case "$OS" in
    darwin) OS="macos" ;;
    linux) OS="linux" ;;
    mingw*|cygwin*|msys*) OS="windows" ;;
    *) echo -e "${RED}Error: Unsupported OS: $OS${NC}"; exit 1 ;;
esac

PLATFORM="${ARCH}-${OS}"
echo "Detected platform: $PLATFORM"

# Determine installation paths
if [[ "$OS" == "macos" ]]; then
    INCLUDE_DIR="/opt/homebrew/include"
    LIB_DIR="/opt/homebrew/lib"
    if [[ ! -d "$INCLUDE_DIR" ]]; then
        INCLUDE_DIR="/usr/local/include"
        LIB_DIR="/usr/local/lib"
    fi
else
    INCLUDE_DIR="/usr/local/include"
    LIB_DIR="/usr/local/lib"
fi

echo "Installation paths:"
echo "  Headers: $INCLUDE_DIR"
echo "  Libraries: $LIB_DIR"

# Check for sudo if needed
if [[ ! -w "$INCLUDE_DIR" ]] || [[ ! -w "$LIB_DIR" ]]; then
    if [[ $EUID -ne 0 ]]; then
        echo -e "${YELLOW}Administrator privileges required for system installation${NC}"
        echo "Please run with sudo or as administrator"
        exit 1
    fi
fi

# Create temporary directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "Downloading assets..."

# Download header file
echo "  - opentui.h"
curl -L -o "$TEMP_DIR/opentui.h" "$RELEASE_URL/opentui.h" || {
    echo -e "${RED}Error: Failed to download header file${NC}"
    exit 1
}

# Download library for current platform
case "$OS" in
    macos)
        LIB_FILE="libopentui.dylib"
        ASSET_NAME="libopentui-$PLATFORM.dylib"
        ;;
    linux)
        LIB_FILE="libopentui.so"
        ASSET_NAME="libopentui-$PLATFORM.so"
        ;;
    windows)
        LIB_FILE="opentui.dll"
        ASSET_NAME="opentui-$PLATFORM.dll"
        ;;
esac

echo "  - $ASSET_NAME"
curl -L -o "$TEMP_DIR/$LIB_FILE" "$RELEASE_URL/$ASSET_NAME" || {
    echo -e "${RED}Error: Failed to download library for $PLATFORM${NC}"
    exit 1
}

# Install files
echo "Installing files..."

echo "  - Installing header to $INCLUDE_DIR/opentui.h"
cp "$TEMP_DIR/opentui.h" "$INCLUDE_DIR/opentui.h" || {
    echo -e "${RED}Error: Failed to install header file${NC}"
    exit 1
}

echo "  - Installing library to $LIB_DIR/$LIB_FILE"
cp "$TEMP_DIR/$LIB_FILE" "$LIB_DIR/$LIB_FILE" || {
    echo -e "${RED}Error: Failed to install library file${NC}"
    exit 1
}

# Set permissions
chmod 644 "$INCLUDE_DIR/opentui.h"
chmod 755 "$LIB_DIR/$LIB_FILE"

# Install pkg-config file
PKG_CONFIG_DIR="/usr/local/lib/pkgconfig"
if [[ "$OS" == "macos" ]] && [[ -d "/opt/homebrew/lib/pkgconfig" ]]; then
    PKG_CONFIG_DIR="/opt/homebrew/lib/pkgconfig"
fi

echo "  - Installing pkg-config file to $PKG_CONFIG_DIR/opentui.pc"
mkdir -p "$PKG_CONFIG_DIR"

# Download and install pkg-config template
curl -L -o "$TEMP_DIR/opentui.pc.in" "$RELEASE_URL/opentui.pc.in" || {
    echo -e "${YELLOW}Warning: Could not download pkg-config template${NC}"
}

if [[ -f "$TEMP_DIR/opentui.pc.in" ]]; then
    sed "s|@PREFIX@|${INCLUDE_DIR%/include}|g; s|@VERSION@|latest|g" "$TEMP_DIR/opentui.pc.in" > "$PKG_CONFIG_DIR/opentui.pc"
    chmod 644 "$PKG_CONFIG_DIR/opentui.pc"
fi

# Update library cache on Linux
if [[ "$OS" == "linux" ]]; then
    echo "Updating library cache..."
    ldconfig 2>/dev/null || true
fi

echo -e "${GREEN}✓ OpenTUI installed successfully!${NC}"
echo ""
echo "You can now use OpenTUI in your Go projects:"
echo "  go get github.com/dnakov/opentui/packages/go"
echo ""
echo "To uninstall:"
echo "  sudo rm $INCLUDE_DIR/opentui.h $LIB_DIR/$LIB_FILE"