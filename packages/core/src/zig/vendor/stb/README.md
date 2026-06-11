# stb_image_resize2

Pinned to commit `904aa67e1e2d1dec92959df63e700b166d5c1022`, version 2.18.

Upstream source SHA-256 before the local alignment fix:
`173e654634f6ccaad98f603e686ea212eec1fe8ea6d2a5e5e8056efa10ae3880`

The scalar coefficient-copy macros use `memcpy` locally. The upstream casts can
perform unaligned `uint64_t` loads when coefficient rows are only 4-byte aligned,
which is undefined behavior and traps under Zig's safety checks on Apple Silicon.
