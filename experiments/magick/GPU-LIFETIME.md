# GPU lifetime experiment

The 1280x720 native-stdout soak reportedly adds about 5 MiB of client RSS every
20 seconds. File descriptors stay at 21, with no files pending. This experiment
tests whether unreleased native WebGPU references explain that growth.

**The private adapter now releases passes and command buffers by default.** The
serial measurements below reproduce the reported growth and remove it with both
releases. The normal demo and benchmark also use the one-entry canvas-view cache.

## Measured results

The runs used Bun 1.3.14-canary.1, `bun-webgpu` 0.1.7, and Three 0.177.0 on an
AMD Radeon RX 7600 with Mesa 26.1.7. Every GPU diagnostic ran in a fresh process,
serially, with `TRACE_WEBGPU=false` and `WGPU_DEBUG_FFI=false`.

The primary ablations selected modes explicitly before the default changed. The
default-path GPU tests and benchmark smoke test ran after that change. Source
hashes in each report distinguish these versions of the helper.

The four release modes rendered 600 warmup frames and 12,000 measured frames at
1280x720, without pacing. Each retained 28 checkpoints, not per-frame records.
The canvas policy was identical in all four cases. These are least-squares RSS
slopes across the ten post-GC measured checkpoints, excluding initialization and
the warmup checkpoint:

| Mode                                                              | RSS KiB/frame | Passes created/released | Command buffers created/released |
| ----------------------------------------------------------------- | ------------: | ----------------------: | -------------------------------: |
| [Baseline](results/gpu-lifetime/baseline.json)                    |         3.478 |              25,200 / 0 |                       37,800 / 0 |
| [Command buffers only](results/gpu-lifetime/command-buffers.json) |         2.151 |              25,200 / 0 |                  37,800 / 37,800 |
| [Passes only](results/gpu-lifetime/passes.json)                   |         1.083 |         25,200 / 25,200 |                       37,800 / 0 |
| [Combined](results/gpu-lifetime/combined.json)                    |        -0.254 |         25,200 / 25,200 |                  37,800 / 37,800 |

All four runs created and released 37,800 command encoders and one cached canvas
view. Pending ownership was zero after disposal. All four sparse pixel checksums
were `4282484`. These checksums detect workload differences, not complete pixel equality.
The real-color tests below check output bytes separately.

A [60 FPS baseline](results/gpu-lifetime/baseline-60fps.json) and
[60 FPS combined run](results/gpu-lifetime/combined-60fps.json) each took 130.18
seconds, including 600 warmup frames and 7,200 measured frames:

| Mode     | RSS at first/last measured post-GC checkpoint | RSS KiB/frame | JSC heap at first/last checkpoint |
| -------- | --------------------------------------------: | ------------: | --------------------------------: |
| Baseline |                         240.629 / 263.879 MiB |         3.630 |                13.491 / 9.989 MiB |
| Combined |                         235.836 / 235.840 MiB |        -0.011 |               13.505 / 10.003 MiB |

Each paced run created 15,600 passes and 23,400 command buffers. Combined released
all of them. Baseline released neither kind. Both checksums were `2651680`, and
both held 19 file descriptors after initialization. The baseline grows while the
post-GC JavaScript heap decreases. This is not retained sample-record growth.

The [uncached baseline](results/gpu-lifetime/untreated.json) measured 3.437 KiB/frame.
The [uncached combined run](results/gpu-lifetime/combined-uncached.json) measured
-0.213 KiB/frame. Both created 12,600 canvas views without releasing them. Thus,
canvas caching is not responsible for removing this allocation slope. It prevents
reference growth that the pass/buffer fix does not address.

The negative slopes reflect heap and allocator changes during these finite runs.
They do not mean negative allocation cost or prove an unlimited-duration bound.
The records include both pre-GC and post-GC memory, forced-GC counts, and durations.

## Verification

- The root `bun run build` passed.
- `GPU_TESTS=1 TERMINAL_TESTS=1 TRACE_WEBGPU=false WGPU_DEBUG_FFI=false bun test packages/examples/src/magick` passed all 26 tests.
- The example TypeScript check passed with `packages/examples/src/magick/tsconfig.json`.
- Root `bun run fmt:check` and `bun run lint` passed.
- The GPU tests checked red/green pixels, background color, padded rows, and native image import for both mapping modes and all release modes.
- Each GPU test rendered 120 repeated frames with failed consumers every 17 frames. Tests also checked busy/disposed rejection and repeated disposal.
- The ownership tests checked 1,000 frames per mode, native release ordering, abandoned work, end/finish/submit failures, and the 64-handle limit.
- The [trace refusal](results/gpu-lifetime/trace-refused.json) exited with status 1, recorded `TRACE_WEBGPU=true`, and created no GPU renderer.
- The [default benchmark smoke test](results/gpu-lifetime/bench-default.json) used combined releases and cached views through native pixel import and Core output.

The benchmark smoke test completed 150 frames, including warmup, with 300 balanced
passes, 450 balanced command buffers, and one balanced canvas view. It left no new
temporary files. Its retained records are a short integration check, not RSS evidence.

The first GPU test attempt failed because the packaged Core artifact lacked
`imageCreateFromPixels`. The root build replaced it with this worktree's artifact.
Dependency installation required `bun install --no-save --ignore-scripts` because
the existing lockfile failed the frozen-install check. Neither package metadata
nor the lockfile changed.

## Ownership changes

The private pixel adapter owns its device. Its helper changes only that device,
its queue, its command encoders, its render passes, and its current canvas texture.
It does not change global prototypes or public Core APIs.

The examples pin `bun-webgpu` 0.1.7 and Three 0.177.0. The adapter checks the device
implementation and required release methods. Re-audit this helper before changing
either dependency. These methods are not browser WebGPU APIs.

Source inspection of the installed `bun-webgpu/index.js` gives these pairs:

| Creation                 | Native release       | Current provider behavior                                |
| ------------------------ | -------------------- | -------------------------------------------------------- |
| `beginRenderPass()`      | `pass.destroy()`     | `end()` calls End, not Release                           |
| `encoder.finish()`       | `buffer._destroy()`  | `queue.submit()` does not release the caller's reference |
| `createCommandEncoder()` | `encoder._destroy()` | `finish()` already calls this method                     |
| `texture.createView()`   | `view.destroy()`     | No finalizer releases the owned reference                |

The helper never releases an encoder twice after `finish()`. It releases unfinished
encoders, abandoned passes, and unsubmitted buffers on failure. Successful frames
use the selected release mode. Baseline modes intentionally leave their selected
API references unreleased, without retaining the JavaScript wrappers.

| Release mode      | Release ended passes | Release submitted command buffers |
| ----------------- | -------------------- | --------------------------------- |
| `baseline`        | No                   | No                                |
| `command-buffers` | No                   | Yes                               |
| `passes`          | Yes                  | No                                |
| `combined`        | Yes                  | Yes                               |

The helper keeps scalar counters and at most 64 pending handles. A successful
arena frame is expected to create two passes and three command buffers. The GPU
tests check those counts after initialization. Counters measure calls that return
from the binding, not native allocation sizes. The binding catches release errors.

The default canvas cache holds one default view. It releases that view on texture
replacement or disposal. Three's reusable offscreen and depth views remain untouched.
The mock canvas supplies a stable current texture here. Dawn can cache identical
native views, so a missing view release can increase references without allocating
a new native view each frame.

## Compare the modes

Run each case in a fresh process from the worktree root:

```sh
for mode in baseline command-buffers passes combined; do
  timeout 300s bun packages/examples/src/magick/gpu-lifetime-diagnostic.ts \
    --release="$mode" --canvas-view=cached --mapping=pointer \
    --width=1280 --height=720 --warmup=600 --frames=12000 --fps=0 \
    --output="experiments/magick/results/gpu-lifetime/repeat-$mode.json"
done
```

Keep the canvas policy identical across all four cases to isolate pass and buffer
releases. Use `--canvas-view=baseline` for the original view behavior. The diagnostic
defaults to cached views and baseline releases. The adapter, benchmark, and normal
demo default to combined releases and cached views. The diagnostic does not import
Core or send terminal output.

Also record the untreated baseline in a separate process:

```sh
timeout 300s bun packages/examples/src/magick/gpu-lifetime-diagnostic.ts \
  --release=baseline --canvas-view=baseline \
  --warmup=600 --frames=12000 --fps=0 \
  --output=experiments/magick/results/gpu-lifetime/untreated.json
```

It retains at most 28 fixed checkpoints, not a record for each frame. Each checkpoint
records RSS, JavaScript heap sizes, object counts, file descriptors, and ownership
counts. `--gc=checkpoints` records memory before and after each explicit `Bun.gc(true)`
call, including its duration. Use `--gc=none` for a comparison without forced GC.
The report does not count automatic garbage collections.

Frames are limited to 18,000, warmup to 600, and particles to 4,096. The RSS safety
limit defaults to 2 GiB. The diagnostic checks it at most 60 frames apart and at
lifetime boundaries. This is a sampled stop condition, not a hard native-memory cap.
The external timeout bounds a stalled GPU call. Checkpoint collection also allocates
temporary objects, but it does not retain `heapStats().objectTypeCounts`.

The diagnostic refuses `TRACE_WEBGPU=true` and `WGPU_DEBUG_FFI=true` before importing
the GPU adapter. Its report records the supplied values, including refusal errors.
Do not enable tracing to count objects: that trace retains its own call history.
The source hashes identify the exact experimental code, including uncommitted edits.

Run the focused tests before the measurements:

```sh
bun test packages/examples/src/magick/gpu-lifetime.test.ts
GPU_TESTS=1 bun test packages/examples/src/magick/pixel-renderer.test.ts
```

## Separate lifecycle growth

Use a fresh process to test repeated creation and disposal:

```sh
timeout 180s bun packages/examples/src/magick/gpu-lifetime-diagnostic.ts \
  --workload=create-dispose --release=combined --canvas-view=cached \
  --width=65 --height=33 --cycles=100 --frames-per-cycle=1 --fps=0 \
  --output=experiments/magick/results/gpu-lifetime/repeat-create-dispose.json
```

This mode limits the run to 100 lifetimes and 60 frames per lifetime. A value of zero
for `--frames-per-cycle` tests initialization without drawing. Its counters sum all
disposed lifetimes. Run the four release modes separately if lifecycle growth appears.

The [combined lifecycle run](results/gpu-lifetime/create-dispose.json) completed
100 lifetimes. It balanced all 200 passes, 300 command buffers, 300 encoders, and
100 cached views. Nevertheless, post-GC RSS rose from 317.25 MiB after ten lifetimes
to 760.09 MiB after final disposal. The final JSC heap was 21.89 MiB, with 554
protected objects. A [baseline lifecycle run](results/gpu-lifetime/create-dispose-baseline.json)
also grew substantially. Repeated adapter creation still has unresolved lifetime
growth. Reuse one adapter for a stable scene instead of creating one per frame.

`bench.ts` also accepts `--gpu-release` and `--canvas-view` for later native-stdout
checks. That benchmark still retains frame records. Use this fixed-checkpoint
diagnostic first. A sample-only workload can measure record overhead separately.

## Remaining gaps

This change does not manage all native GPU resources. The following gaps remain:

- The adapter's native reference is not released by the existing pixel adapter.
- `GPUDevice.destroy()` calls DeviceDestroy, not DeviceRelease. Device callback lifetimes also need a separate audit.
- `GPUTexture.destroy()` calls TextureDestroy, not TextureRelease.
- The mock canvas creates a second texture that `unconfigure()` does not destroy.
- Offscreen/depth views, shader modules, pipelines, bind groups, layouts, and samplers retain their existing provider/Three ownership behavior.
- Compute passes, render bundles, resizing, and arbitrary scenes are outside this experiment's ownership tests.
- The process-global WebGPU instance remains alive across adapter lifetimes.

These are fixed-lifetime concerns for this stable arena. The lifecycle measurements
show that balancing per-frame references does not fix repeated creation/disposal.
A balanced pass/buffer report cannot establish complete GPU cleanup.
