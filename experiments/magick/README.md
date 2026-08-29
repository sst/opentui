# Magick rendering experiments

This worktree contains separate OpenTUI changes and a Linux GPU-sharing experiment.
The stock-terminal path keeps GPU readback. The GPU-sharing experiment removes the
application-level CPU pixel handoff, but does not present inside a terminal.

Read [RESULTS.md](RESULTS.md) for measurements, verification, branch dependencies,
and the changes recommended for separate pull requests.

## Run the demo

Build from the worktree root:

```sh
bun run build
bun packages/examples/src/magick/demo.ts
bun packages/examples/src/magick/demo.ts --transport=file
bun packages/examples/src/magick/demo.ts --transport=zlib --width=1280 --height=720
```

WASD moves the red wizard. Space pauses the scene. Q quits. Legacy keyboards use
approximate movement pulses. The scene has no combat, authoritative host, or netcode.

The demo uses a two-slot `NativeImagePool`, native BGRA conversion, and an
`ImageRenderable`. OpenTUI owns the HUD, keyboard input, image placement, and output.
Its framebuffer defaults to 640x360, independently of terminal dimensions.

Raw output remains the library default. File output requires a local filesystem
and successful medium and upload-acknowledgement probes. Zlib output uses level 1
and falls back to raw when compression fails or does not reduce the payload.
Neither path changes the scene or its resolution.

## Use the pixel APIs

`NativeImage.fromPixels` accepts RGBA8 or BGRA8, a source stride, and straight or
opaque alpha. Opaque mode writes alpha 255. The source must contain sRGB bytes.
The call copies pixels into native ownership before returning.

```ts
const image = NativeImage.fromPixels(mappedBytes, width, height, {
  stride,
  format: "bgra8",
  alpha: "opaque",
})
```

For repeated frames, create a fixed-size pool:

```ts
const pool = new NativeImagePool({ width, height, capacity: 2 })
const frame = pool.publishPixels(mappedBytes, {
  stride,
  format: "bgra8",
  alpha: "opaque",
})
if (frame) {
  try {
    view.source = frame
    await view.loadPromise
  } finally {
    frame.dispose()
  }
}
```

Publication returns `null` when all slots have readers. It does not allocate another
pixel buffer or queue another frame. Retained images and framebuffer snapshots stay
immutable. New publication handles keep the existing renderer caches correct.
Stop the producer before disposing the pool. Create a new pool to change dimensions.

Keep one GPU adapter per client session. The private adapter now releases its
per-frame native handles, but repeated adapter creation still retains provider
resources. Pool resizing does not require repeated GPU-device creation.
Read [GPU-LIFETIME.md](GPU-LIFETIME.md) for the release ablations and remaining limits.

The example GPU adapter calls its pixel consumer synchronously, before unmapping.
Do not retain its mapped view. Both pixel APIs finish their owned copy during that
callback. The optional pointer-mapping benchmark has the same lifetime requirement.

## Run the measurements

The runner can load Core from another built worktree. Each case uses a fresh process.
The case files retain the local paths used for the recorded run. Replace their
`--core` arguments if you move the checkouts.

The initial matrix used benchmark commit `d2639fd9`. The current harness defaults
to corrected GPU ownership. Use `cases/final.json` for the corrected terminal
checks, or the lifetime diagnostic for explicit release ablations.

```sh
bun packages/examples/src/magick/bench.ts \
  --import=pooled-native --mapping=pointer \
  --frames=300 --warmup=60 --fps=60 --output=trial.json

TMPDIR="$HOME/.cache/tmp/opencode" \
  bun packages/examples/src/magick/matrix.ts \
  --cases=experiments/magick/cases/isolated.json \
  --output=experiments/magick/results/isolated --window-size=660x500
```

Import variants:

| Variant         | Pixel preparation                                     |
| --------------- | ----------------------------------------------------- |
| `baseline`      | JS packing followed by a fresh `NativeImage.fromRgba` |
| `native`        | A fresh native `fromPixels` import                    |
| `pool`          | JS packing followed by `publishRgba`                  |
| `pooled-native` | Native conversion directly into reusable storage      |

`--mapping=view` uses the binding's mapped ArrayBuffer. `--mapping=pointer` wraps
the borrowed native address without the binding's mapped-view detachment path.
Both still copy the GPU texture into a readback buffer.

`--window-size` requires Hyprland. It changes only the runner's new windows, selected
by a unique class. It does not edit desktop or terminal configuration files.
The recorded run uses 660x500 logical pixels on a 2x display.

The old WezTerm build did not map a window in its tested Wayland mode. The runner
uses XWayland and a 12-point font for WezTerm. Ghostty and Kitty use Wayland and
6-point fonts. Each report records actual pixel and cell dimensions.

## Measurement boundaries

- Terminal runs use native stdout, without capturing and forwarding frame bytes.
- Offscreen runs use a non-retaining counting Writable. They include native feed copies, but no terminal work.
- Service time starts at the scene update and ends at a Device Status Report reply.
- The reply measures parser consumption, not presentation or input-to-photon latency.
- CPU submission and readback wall times are not GPU timestamp measurements.
- A terminal resize during measured frames invalidates the run.
- The runner compares first-frame pixel hashes across equal workloads.
- File and zlib fractions record the effective transport, including fallback.
- A cleared file lease is not proof of success if the transport timed out or was cancelled.
- CPU usage includes the client and the selected terminal process, but not the compositor.
- File-descriptor counts are sampled after frames. They do not capture every transient descriptor.
- Raw samples, library hashes, source hashes, and cleanup checks remain in the JSON reports.

## Verification

Build first. Then run the suites sequentially to avoid shared test-port conflicts:

```sh
TMPDIR="$HOME/.cache/tmp/opencode" bun experiments/magick/verify.ts
```

The script runs native, Bun, Node, packed-distribution, GPU, PTY-cleanup, type,
format, and lint checks. Its logs and result index go under `results/verification`.
The GPU and PTY tests are opt-in in ordinary test runs.

For the CPU-only import comparisons, run `bun run bench:image-import` and
`bun run bench:image-pool` from `packages/core`.

## GPU sharing

The separate [GPU-sharing experiment](gpu-sharing/README.md) includes Vulkan-to-EGL
and Vulkan-to-Dawn checks. The [Three producer test](gpu-sharing/THREE.md) renders
the actual arena into shared textures. A separate EGL process samples the output.

```sh
MAGICK_ARENA_MODULE="$PWD/packages/examples/src/magick/arena.ts" \
  make -C experiments/magick/gpu-sharing verify three-verify \
  WEBGPU_NODE_MODULES="$PWD/packages/examples/node_modules"
```

Validation reads a separate reference render and the consumer's sampled image.
A second mode forbids readback calls. Its messages contain metadata and GPU file
descriptors, not CPU pixels. The tests use two slots and explicit GPU fences.

The bridge depends on pinned Bun/Three internals and a checked Dawn binary.
The installed binding has incorrect feature-enum values for the required native
features. The experiment contains a guarded workaround, not a Core workaround.

This is not a Ghostty fork, a Kitty protocol extension, or a production display
backend. It does not prove driver-internal zero-copy, overlapping-frame behavior,
cross-GPU support, or display latency. No SHM image transport was added to Core.
