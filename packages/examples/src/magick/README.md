# Magick Arena

A Three.js arena rendered through a two-slot `NativeImagePool` and `ImageRenderable`.
The demo requires Bun and WebGPU. The Node.js example selector lists it as unavailable.

From `packages/examples`, run `bun run dev` and select **Magick Arena** under
**3D & Physics**, or type `magick` to filter the list. Escape returns to the selector.

For a standalone session:

```sh
bun run dev:magick
bun run dev:magick --transport=file
bun run dev:magick --transport=zlib --width=1280 --height=720
```

## Controls

| Key                         | Action                                              |
| --------------------------- | --------------------------------------------------- |
| WASD                        | Move the red wizard                                 |
| Space                       | Pause or resume the scene                           |
| R                           | Reset time and player position                      |
| C                           | Open GPU, image transport, and renderer diagnostics |
| Backtick or `"`             | Toggle the captured console                         |
| `.`                         | Toggle renderer statistics                          |
| Ctrl+A                      | Log native arena allocation                         |
| Ctrl+G                      | Dump the hit grid                                   |
| Shift+L / Shift+S / Shift+A | Start / stop / use automatic rendering              |
| Escape                      | Return to the selector, or quit in standalone mode  |
| Ctrl+C                      | Quit                                                |
| Q                           | Quit in standalone mode only                        |

Pause stops GPU readbacks but leaves diagnostics available. Movement stops while the
console is open or the terminal loses focus. Legacy keyboards use approximate movement
pulses instead of key-release events.

The framebuffer defaults to 640x360 and stays fixed when the terminal resizes. The
status line shows the actual image protocol and Kitty transport. File and zlib modes
can fall back to raw output. `C` shows the requested transport and fallback reason.

The private GPU adapter remains experimental and uses pinned bun-webgpu internals.
The selector reuses one GPU renderer across visits and releases it when the terminal
renderer closes. Scene resources, images, and input listeners are released on each return.
This scene has no combat, authoritative host, or netcode.

## Tests

Run `bun test src/magick` for CPU-only tests. Set `GPU_TESTS=1` for GPU readback tests
and `TERMINAL_TESTS=1` for Linux PTY cleanup tests. Build native artifacts from the
repository root with `bun run build` first if they are missing or stale.
