#!/usr/bin/env bash
# Asserts a Linux libopentui.so requires no GLIBC symbols above MAX.
# Usage: check-glibc-floor.sh <path-to-libopentui.so> <max-version>
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <path-to-libopentui.so> <max-glibc-version>" >&2
  exit 2
fi

SO="$1"
MAX="$2"

if [ ! -f "$SO" ]; then
  echo "❌ File not found: $SO" >&2
  exit 1
fi

found=$(readelf -V "$SO" | grep -oE 'GLIBC_[0-9]+(\.[0-9]+)+' | sort -uV)

echo "Required GLIBC symbol versions in $SO:"
echo "$found" | sed 's/^/  /'

over=$(echo "$found" | awk -F_ -v max="$MAX" '
  {
    n = split($2, v, ".")
    m = split(max, mv, ".")
    for (i = 1; i <= n; i++) {
      a = v[i] + 0
      b = (i <= m) ? mv[i] + 0 : 0
      if (a > b) { print $0; next }
      if (a < b) next
    }
  }')

if [ -n "$over" ]; then
  echo ""
  echo "❌ Found GLIBC symbols above floor $MAX:"
  echo "$over" | sed 's/^/  /'
  exit 1
fi

echo ""
echo "✅ All required symbols <= GLIBC_$MAX"
