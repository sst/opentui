#!/usr/bin/env bash
# Run a TypeScript file with Node.js.
# Usage: ./run-node.sh src/examples/simple-layout-example.ts
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node \
  --experimental-transform-types \
  --import="${SCRIPT_DIR}/../packages/core/src/compat/nodejs/registerResolveJs.ts" \
  --import="${SCRIPT_DIR}/../packages/core/src/compat/nodejs/registerBun.ts" \
  "$@"
