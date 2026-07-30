# stb_image_resize2

Pinned to commit `904aa67e1e2d1dec92959df63e700b166d5c1022`, version 2.18.

Upstream source SHA-256 before the local alignment fix:
`173e654634f6ccaad98f603e686ea212eec1fe8ea6d2a5e5e8056efa10ae3880`

Patched SHA-256: `3cfc10a3aa7287fa1f1360df360b22e63b2e3426965d7696f8b5c273bc810d55`.

The scalar coefficient-copy macros use `memcpy` locally. The upstream casts can
perform unaligned `uint64_t` loads when coefficient rows are only 4-byte aligned,
which is undefined behavior and traps under Zig's safety checks on Apple Silicon.

## sRGB table pointer bias

`stb_image_resize2.h` biases `fp32_to_srgb8_tab4` by 912 elements at its three
SIMD lookup sites, then uses exponent-derived indexes to address the original
104-entry table. This is the upstream idiom discussed in
[`nothings/stb#1616`](https://github.com/nothings/stb/issues/1616). It does not
perform a physical read outside the table, but forming a pointer before the
array is outside the strict C array model and Zig's C bounds instrumentation
aborts when that path executes.

OpenTUI isolates the implementation in `image-resize-shim.c` and passes
`-fno-sanitize=bounds` for that translation unit. The existing
`area resize upscales tiny sources exactly` native test exercises the actual
SIMD sRGB path and verifies every output pixel. Review of the exception also
established that only the bounds suppression is necessary: the test passes with
pointer-overflow instrumentation enabled and fails when bounds instrumentation
is enabled.

This exception is accepted for now. It is not a known out-of-bounds memory
access, does not produce incorrect resize output in the covered path, and does
not compromise this branch's correctness. Treat it as low-priority sanitizer
and strict-C cleanup, not as a release blocker.

To close the exception permanently:

1. Add a reproducible patch under `patches/` that keeps the table pointer at
   `fp32_to_srgb8_tab4` and rolls the 912-element bias into the integer lookup
   indexes at all three SIMD sites.
2. Apply that patch from `../update.sh` and update the patched SHA-256 recorded
   here and in the updater.
3. Remove the resize translation unit's bounds sanitizer suppression from
   `build.zig`.
4. Run `area resize upscales tiny sources exactly` with normal bounds
   instrumentation, then run `bun run test:native` and `bun run build:native`.

`stb_image.h` is pinned to commit
`f0569113c93ad095470c54bf34a17b36646bbbb5`, version 2.30, and compiled with
only its JPEG decoder enabled. SHA-256:
`594c2fe35d49488b4382dbfaec8f98366defca819d916ac95becf3e75f4200b3`.

Patched SHA-256: `1657895e86c730668cc5af6d3c8ae8f80b67c64f2ade81c44c40cee70fba555e`.

`STBI_STRICT_JPEG` is an OpenTUI-local extension that rejects streams when
decoding needs synthetic zero bits after reaching a marker or end of input.

The exact local changes are in `patches/`. Update with `bun run vendor:update:images` from `packages/core`; see `../README.md`.
