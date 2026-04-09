#!/usr/bin/env bash
# Run a TypeScript file with Node.js using the opentui compat shim.
# Usage: ./run-node.sh src/examples/simple-layout-example.ts
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export OPENTUI_NODE_COMPAT=1
exec node \
  --experimental-transform-types \
  "--import=${SCRIPT_DIR}/../packages/core/src/nodejs/compat.ts" \
  "$@"
