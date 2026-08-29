#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
# bun-webgpu v0.1.7's download_artifacts.ts pins this Dawn build.
revision=d18e21db186c42c073a90f91bdea0cc438b1924d
root=.build/dawn
for file in src/dawn/dawn.json generator/dawn_json_generator.py generator/generator_lib.py \
    generator/templates/api.h generator/templates/dawn/wire/client/api.h \
    generator/templates/dawn_proc_table.h generator/templates/BSD_LICENSE; do
    mkdir -p -- "$root/$(dirname -- "$file")"
    curl --fail --location --silent --show-error --max-time 30 \
        "https://raw.githubusercontent.com/kommander/dawn/$revision/$file" -o "$root/$file"
done
UV_CACHE_DIR="$root/uv-cache" uv run --no-project --with jinja2==3.1.6 \
    python "$root/generator/dawn_json_generator.py" --dawn-json "$root/src/dawn/dawn.json" \
    --targets headers --template-dir "$root/generator/templates" --output-dir "$root/generated"
