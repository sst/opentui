#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 INPUT OUTPUT" >&2
  exit 1
fi

input=$1
output=$2

command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
[[ -f "$input" ]] || { echo "Input does not exist: $input" >&2; exit 1; }
mkdir -p "$(dirname "$output")"

# Landing videos are muted and displayed inside a 5:4 frame. Preserve each
# source aspect ratio; the page supplies any unused frame area.
ffmpeg -hide_banner -loglevel warning -y \
  -i "$input" \
  -map 0:v:0 -an -sn -dn \
  -vf "scale=960:768:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30" \
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p \
  -profile:v high -level 4.0 -movflags +faststart \
  -metadata title= -metadata comment= -metadata encoder= \
  "$output"
