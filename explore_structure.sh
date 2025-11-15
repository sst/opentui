#!/bin/bash
set -euo pipefail

echo "=== Project Structure Analysis ==="
echo "Current working directory: $(pwd)"
echo ""

echo "=== Root package.json analysis ==="
cat package.json

echo ""
echo "=== Core package analysis ==="
cd packages/core
echo "Core package.json:"
cat package.json
echo ""
echo "Core source structure:"
find src -name "*.zig" -o -name "*.ts" | head -20
echo ""

echo "=== Looking for current native bindings ==="
find . -name "*.zig" -o -name "*.c" -o -name "*.h" | head -10

echo ""
echo "=== Checking if there are any existing NAPI files ==="
find . -name "*napi*" -o -name "*node*" | head -10

echo ""
echo "=== Current build scripts ==="
grep -A 10 -B 2 "build\|script" package.json || true

cd ../..