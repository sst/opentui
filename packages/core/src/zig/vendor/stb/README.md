# stb_image_resize2

Pinned to commit `904aa67e1e2d1dec92959df63e700b166d5c1022`, version 2.18.

Upstream source SHA-256 before the local alignment fix:
`173e654634f6ccaad98f603e686ea212eec1fe8ea6d2a5e5e8056efa10ae3880`

The scalar coefficient-copy macros use `memcpy` locally. The upstream casts can
perform unaligned `uint64_t` loads when coefficient rows are only 4-byte aligned,
which is undefined behavior and traps under Zig's safety checks on Apple Silicon.

`stb_image.h` is pinned to commit
`f0569113c93ad095470c54bf34a17b36646bbbb5`, version 2.30, and compiled with
only its JPEG decoder enabled. SHA-256:
`594c2fe35d49488b4382dbfaec8f98366defca819d916ac95becf3e75f4200b3`.

`STBI_STRICT_JPEG` is an OpenTUI-local extension that rejects streams when
decoding needs synthetic zero bits after reaching a marker or end of input.
