# Magick Arena

Magick Arena renders a Three.js scene through a two-slot `NativeImagePool` and `ImageRenderable`.
The demo requires Bun and WebGPU. The Node.js example selector lists it as unavailable.

Run the commands below from `packages/examples`.

Run `bun run dev` to open the selector. Select **Magick Arena** under **3D & Physics**.
To filter the list, type `magick`. Escape returns to the selector.

To run the demo without the selector:

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
| C                           | Show GPU, image transport, and renderer diagnostics |
| Backtick or `"`             | Toggle the captured console                         |
| `.`                         | Toggle renderer statistics                          |
| Ctrl+A                      | Log native arena allocation                         |
| Ctrl+G                      | Dump the hit grid                                   |
| Shift+L / Shift+S / Shift+A | Start / stop / use automatic rendering              |
| Escape                      | Return to the selector, or quit in standalone mode  |
| Ctrl+C                      | Quit                                                |
| Q                           | Quit in standalone mode only                        |

Pause stops continuous GPU readbacks, but pending or reset frames can still render.
Diagnostics remain available. Movement stops while the console is open or the terminal
loses focus. Legacy keyboard input uses approximate movement pulses instead of key-release events.

## Rendering

The framebuffer defaults to 640x360 and stays fixed when the terminal resizes. The
status line shows the actual image protocol and Kitty transport. File and zlib modes
can fall back to raw output. `C` shows the requested transport and fallback reason.

The demo reads GPU pixels into CPU memory. File transport sends a temporary file path,
not a shared GPU image.

The private GPU adapter is experimental and uses pinned bun-webgpu internals. It releases
per-frame GPU objects. Repeated GPU renderer creation still has a separate provider issue,
so the selector reuses one renderer across visits. It releases that renderer when the
terminal renderer closes. Each return to the selector releases scene resources, images,
and input listeners.

This scene has no combat, authoritative host, or netcode.

## Tests

If native artifacts are missing or stale, run `bun run build` from the repository root before the tests.

Run `bun test src/magick` for CPU-only tests. Set `GPU_TESTS=1` to include GPU readback tests.
Set `TERMINAL_TESTS=1` for Linux pseudoterminal (PTY) cleanup tests. These tests also require WebGPU.
