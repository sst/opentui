#!/bin/bash
set -e

# OpenTUI Examples Installation Script
# Downloads and runs the latest opentui-examples binary

REPO="sst/opentui"
GITHUB_API="https://api.github.com/repos/$REPO"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default to stable releases
USE_PRERELEASE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --pre|--prerelease)
      USE_PRERELEASE=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --pre, --prerelease    Download the latest pre-release version"
      echo "  -h, --help            Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Error: Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

echo -e "${GREEN}OpenTUI Examples Installer${NC}"
echo "Installing opentui-examples binary..."
echo ""

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"; exit 1 ;;
esac

case "$OS" in
    darwin) OS="darwin" ;;
    linux) OS="linux" ;;
    mingw*|cygwin*|msys*) OS="windows" ;;
    *) echo -e "${RED}Error: Unsupported OS: $OS${NC}"; exit 1 ;;
esac

PLATFORM="${OS}-${ARCH}"
echo "Detected platform: $PLATFORM"

# Find the latest release
echo "Fetching latest release information..."

if [[ "$USE_PRERELEASE" == "true" ]]; then
  echo -e "${YELLOW}Looking for latest pre-release...${NC}"
  # Get all releases and find the first one (which could be a pre-release)
  RELEASE_DATA=$(curl -s "$GITHUB_API/releases" | grep -m 1 '"tag_name"' | cut -d '"' -f 4)
  if [[ -z "$RELEASE_DATA" ]]; then
    echo -e "${RED}Error: Failed to fetch release information${NC}"
    exit 1
  fi
  VERSION="$RELEASE_DATA"
else
  # Get the latest stable release
  RELEASE_DATA=$(curl -s "$GITHUB_API/releases/latest")
  VERSION=$(echo "$RELEASE_DATA" | grep '"tag_name"' | cut -d '"' -f 4)
  if [[ -z "$VERSION" ]]; then
    echo -e "${RED}Error: Failed to fetch latest release information${NC}"
    exit 1
  fi
fi

# Remove 'v' prefix if present
VERSION_NO_V="${VERSION#v}"

echo -e "${BLUE}Version: $VERSION${NC}"

# Construct download URL
ASSET_NAME="opentui-examples-v${VERSION_NO_V}-${PLATFORM}.zip"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/${VERSION}/${ASSET_NAME}"

echo "Download URL: $DOWNLOAD_URL"
echo ""

# Create temporary directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Download the zip file
echo "Downloading $ASSET_NAME..."
if ! curl -L -f -o "$TEMP_DIR/examples.zip" "$DOWNLOAD_URL"; then
  echo -e "${RED}Error: Failed to download examples binary${NC}"
  echo "URL attempted: $DOWNLOAD_URL"
  exit 1
fi

# Unzip to current directory
echo "Extracting to current directory..."
if ! unzip -q -o "$TEMP_DIR/examples.zip" -d .; then
  echo -e "${RED}Error: Failed to extract archive${NC}"
  exit 1
fi

# Make executable (if not on Windows)
if [[ "$OS" != "windows" ]]; then
  if [[ -f "./opentui-examples" ]]; then
    chmod +x ./opentui-examples
    EXEC_NAME="./opentui-examples"
  elif [[ -f "./opentui-examples.exe" ]]; then
    EXEC_NAME="./opentui-examples.exe"
  else
    echo -e "${RED}Error: Executable not found after extraction${NC}"
    ls -la
    exit 1
  fi
else
  EXEC_NAME="./opentui-examples.exe"
fi

echo -e "${GREEN}✓ OpenTUI Examples installed successfully!${NC}"
echo ""
echo "Running examples..."
echo ""

if [ -t 0 ]; then
  exec "$EXEC_NAME"
else
  # stdin is not a TTY (e.g., running via curl | bash)
  # Close the pipe and reconnect all stdio to the terminal
  exec < /dev/tty
  exec > /dev/tty
  exec 2>&1
  exec "$EXEC_NAME"
fi
