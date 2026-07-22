# libwebp

Pinned to libwebp 1.6.0 from the official release archive.

Archive SHA-256:
`e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564`.

Only decoder sources, the supported x64/ARM64 decoder DSP paths, and their
transitive headers and utilities are vendored. `encode.h` and `mux_types.h`
remain because upstream decoder-common sources include them. Encoders, muxers,
demuxers, build-system files, tools, examples, and animation utilities are
excluded. See `COPYING` and `PATENTS`.
