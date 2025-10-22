#!/usr/bin/env bash

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}OpenTUI Snapshot Version Generator${NC}"
echo "===================================="
echo ""

# Get the short commit SHA (8 characters)
COMMIT_SHA=$(git rev-parse --short=8 HEAD)

# Generate snapshot version: 0.0.0-YYYYMMDD-COMMITHASH
VERSION="0.0.0-$(date +%Y%m%d)-${COMMIT_SHA}"

echo -e "${GREEN}Generated snapshot version: ${VERSION}${NC}"
echo ""

# Check if there are uncommitted changes
if [[ -n $(git status -s) ]]; then
  echo -e "${YELLOW}WARNING: You have uncommitted changes${NC}"
  echo "It's recommended to commit your changes before creating a snapshot."
  echo ""
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# Update package versions
echo -e "${BLUE}Updating package versions...${NC}"
bun run prepare-release "$VERSION"

echo ""
echo -e "${GREEN}Snapshot version prepared!${NC}"
