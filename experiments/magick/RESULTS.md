# Rendering results and PR handoff

The stock-terminal implementation keeps the GPU readback, but removes redundant
pixel preparation and reuses native pixel storage. File transport and zlib remain
opt-in. OpenTUI still owns image placement, text, input, and terminal output.

The separate GPU experiment passes actual Three output between processes without
an application-level CPU pixel handoff. It is not a terminal display backend.

## Initial terminal measurements

All 132 cases completed, with 52,020 recorded frames. The runs were sequential.
Terminal cases used native stdout and fixed-size windows. Baseline rows below
combine the samples from two runs, rather than averaging their percentiles.
This matrix used benchmark commit `d2639fd9`, before the GPU lifetime correction
described below. Later reruns use the corrected adapter.

These are complete-frame P95 service times in milliseconds, through terminal parser
acknowledgement. They are not visible FPS or presentation latency.

| Terminal          | Framebuffer | Baseline raw | Combined raw | Combined zlib | Combined file |
| ----------------- | ----------- | -----------: | -----------: | ------------: | ------------: |
| Ghostty           | 640x360     |         3.82 |         3.81 |          4.63 |          2.19 |
| Kitty             | 640x360     |         6.20 |         5.19 |          7.10 |          5.66 |
| WezTerm, XWayland | 640x360     |        13.51 |        13.25 |         12.39 |  Raw fallback |
| Ghostty           | 1280x720    |        11.57 |         9.18 |         12.48 |          5.28 |
| Kitty             | 1280x720    |        19.62 |        17.41 |         16.81 |          9.22 |
| WezTerm, XWayland | 1280x720    |        29.96 |        28.30 |         24.30 |  Raw fallback |
| Ghostty           | 1920x1080   |        21.52 |        17.01 |         23.84 |          8.85 |
| Kitty             | 1920x1080   |        39.01 |        34.69 |         29.44 |         13.05 |
| WezTerm, XWayland | 1920x1080   |        57.59 |        53.69 |         44.82 |  Raw fallback |

The 1080p baseline has one run. Combined paths use native conversion into the
image pool and pointer mapping. File uploads account for every measured frame
in the Ghostty and Kitty file cases. WezTerm fails the upload-ACK probe and remains
on raw transport. Its fallback timings remain in the JSON files.

WezTerm does not return the explicit-ID image acknowledgements used by the final
validation checks. Its numbers remain parser-service observations, not validated
image-ingestion or presentation measurements.

File transport is the clearest local improvement at higher resolutions. It is not
always faster at 640x360: Kitty's combined raw path was faster in this run.

## Preparation isolation

The offscreen counting sink removes terminal work without retaining frame bytes.
The table shows mean pixel-preparation time in milliseconds, not whole-frame time.

| Preparation                     | 640x360 | 1280x720 |
| ------------------------------- | ------: | -------: |
| JS packing and fresh `fromRgba` |   0.433 |    1.843 |
| Fresh native `fromPixels`       |   0.154 |    0.713 |
| JS packing and `publishRgba`    |   0.353 |    1.527 |
| Native `publishPixels`          |   0.048 |    0.193 |

Native conversion and storage reuse work best together. The combined preparation
is about nine times faster than the original preparation in these samples.

Pointer mapping removes only a few microseconds of mapped-view overhead in these
stage measurements. Larger differences in whole-frame P95 do not establish that
the mapping change caused them. The demo keeps managed-view mapping as its default.

## Compression counterexample

The native level-1 compressor did not meet the general local-latency hypothesis.
It saved wire bytes, but increased latency in several ordinary arena cases.
The 1280x720 noise cases show the larger problem:

| Terminal          | Combined raw P95 | Zlib attempt P95 | Effective compressed frames |
| ----------------- | ---------------: | ---------------: | --------------------------: |
| Ghostty           |          9.59 ms |         53.19 ms |                          0% |
| Kitty             |         19.35 ms |         61.59 ms |                          0% |
| WezTerm, XWayland |         29.26 ms |         71.78 ms |                          0% |

The raw fallback prevents expanded compressed payloads, but cannot recover the
CPU time spent attempting compression. Do not make this compressor the default
gaming path. Keep it as an explicit bandwidth tradeoff, or develop a faster
compression policy separately. The file-only PR separates the successful local
transport from this experiment.

## Initial soak

The initial file soaks completed 7,200 frames per terminal at 1280x720 over two
minutes. Ghostty P95 was 4.92 ms, and Kitty P95 was 8.73 ms. Neither run had a
service sample above 16.7 ms. Both maintained about 60 completed submissions/s.

Descriptor counts stayed at 21. File leases cleared, and no new temporary files
remained after cleanup in any matrix case. These results establish bounded work
and file backlog, not bounded total process memory.

Client RSS still increased during the initial soak. After startup variation, both
file runs gained about 5 MiB per 20 seconds. The benchmark retains sample records,
but the binding also omits native releases for render passes and command buffers.
The initial soak therefore does not establish a memory plateau.

## GPU lifetime correction

The release ablations isolated the native ownership problem. Each run used fixed
checkpoints rather than retained frame records. The unpaced 1280x720 runs discarded
600 warmup frames and measured 12,000 frames:

| Explicit releases    | Post-GC RSS slope |
| -------------------- | ----------------: |
| Neither              |   3.478 KiB/frame |
| Command buffers only |   2.151 KiB/frame |
| Render passes only   |   1.083 KiB/frame |
| Both                 |  -0.254 KiB/frame |

The paced repeat reproduced 3.630 KiB/frame for the baseline. With both releases,
the first and last measured post-GC checkpoints were 235.836 and 235.840 MiB.
Measured post-GC RSS ranged from 234.836 to 236.148 MiB. The negative fitted slope
reflects allocator variation, not negative allocation.

Each unpaced combined run released all 25,200 render passes and 37,800 command
buffers it created. The helper does not release command encoders twice: the
binding's `finish()` already releases their caller reference. A cached canvas view
also prevents per-frame view-reference growth.

The demo and private adapter now use these releases by default. Core's public APIs
and global prototypes remain unchanged. Read [GPU-LIFETIME.md](GPU-LIFETIME.md) for
the counters, checkpoints, failure tests, and untreated comparisons.

This is not complete provider-lifetime cleanup. Repeated creation/disposal still
increased RSS from 317.25 MiB after ten lifetimes to 760.09 MiB after 100.
Keep one adapter per client. This fixed-lifetime issue remains separate from the
corrected per-frame growth and the bounded Core pixel pool.

## Corrected terminal reruns

Thirteen final cases added 17,100 measured frames. All completed successfully.
The corrected adapter used managed-view mapping, both native releases, and a
cached canvas view. Every Ghostty/Kitty file case also checked its upload acknowledgement.

| Terminal | Framebuffer | Corrected file P95 |
| -------- | ----------- | -----------------: |
| Ghostty  | 640x360     |            2.82 ms |
| Kitty    | 640x360     |            5.47 ms |
| Ghostty  | 1280x720    |            6.35 ms |
| Kitty    | 1280x720    |            9.59 ms |
| Ghostty  | 1920x1080   |            8.86 ms |
| Kitty    | 1920x1080   |           13.00 ms |

The separate two-minute 1280x720 reruns measured 5.45 ms P95 in Ghostty and
8.90 ms in Kitty. Both completed about 60 submissions/s, with no service sample
above 16.7 ms. The shorter Kitty 1080p run had one sample above that budget.

Each corrected soak released all 14,520 passes and 21,780 command buffers, including
warmup. Each created and released one cached canvas view. Pending ownership and
file leases were zero. Descriptor counts stayed at 22, and cleanup left no new files.

These native-stdout runs retain their frame records and do not force GC. Ghostty
RSS averaged 289.40 MiB in the first 60 samples and 297.00 MiB in the last 60.
Kitty averaged 296.83 and 297.15 MiB. Use the fixed-checkpoint ablations, rather
than these retained records alone, to isolate native ownership growth.

The standalone file-only branch passed real Ghostty/Kitty checks at both 640x360
and 1280x720. WezTerm selected raw fallback. [The final index](results/final/index.json)
summarizes the runs. Individual JSON files in [results/final](results/final/) contain
the frame records and ownership counters.

## Independent changes

Each independent topic starts at `202e1e6a`. The `ot-magick` branch combines them
with the benchmark and demo. No branch was pushed and no GitHub PR was opened.

| Topic branch               | Commits to bring in                            | Dependency                                           |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `magick/three-readback`    | `20d29eed`                                     | None                                                 |
| `magick/pixel-import`      | `cad18c0b`                                     | None                                                 |
| `magick/pixel-stream`      | `211b9f96`                                     | None                                                 |
| `magick/kitty-file`        | `b8fc40fa`                                     | None. Recommended file-only topic                    |
| `magick/kitty-transport`   | `b1c71dfa`, `d1a9d07b`                         | Combined experiment, including the slower compressor |
| `magick/frame-admission`   | `44874c39`, `5e1aefea`, `d744b454`, `13d4a46f` | Bring the complete sequence                          |
| `magick/pool-pixels`       | `2b531006` only                                | Pixel import and pixel stream                        |
| `magick/gpu-sharing-spike` | `d64ce1a1`, `17607231`, `05256e9d`, `a07059c5` | Experimental, outside Core                           |
| `magick/gpu-lifetime`      | `31fec757`                                     | Private pixel adapter on the combined example base   |

The combined worktree contains conflict resolutions where the import and pool
changes share native validation and FFI code. Those changes retain both APIs and
their tests. The original independent topic branches remain available.

The file-only topic has one commit directly on the base. Its native, Bun, Node,
build, and distribution checks pass independently. It does not add a zlib mode.

## What changed

`NativeImage.fromPixels` combines BGRA conversion, row packing, and native import.
It preserves straight alpha or forces opaque alpha, according to the explicit option.
The old `fromRgba` API and its behavior remain available.

`NativeImagePool` reuses an allocation only when no publication or snapshot reads it.
Each publication gets a fresh handle. That keeps Kitty, Sixel, PNG, and renderable
invalidation correct without a new revision system. Full pools return `null`.
`publishPixels` combines this reuse with native pixel conversion.

Kitty file mode probes both file access and explicit-ID upload acknowledgements.
It bounds leases to eight files and 64 MiB of payload. The terminal must acknowledge
a file before OpenTUI treats the upload as consumed. Cancellation and timeout do
not count as successful consumption. Raw/PNG fallback preserves display support.

Zlib preparation uses native level 1. Its unpublished output buffer cannot exceed
the raw payload. Failed or unprofitable compression falls back to raw. The limit
is 64 MiB for optional preparation, not total renderer memory.

Early frame admission prevents ordinary feed-backed frames from accumulating
behind a slow Writable. It runs before animation callbacks and composition.
Control output can still complete terminal transitions and shutdown.

The no-supersampling fix requests one mapped range, rather than two overlapping
ranges. GPU tests reproduce the old failure and check both pixel channel orders.

## Backpressure result

A deterministic delayed-Writable test compares the same 1024x256-cell workload.
Thirty-two blocked update ticks produced these results:

| Observation        |          Before |         After |
| ------------------ | --------------: | ------------: |
| Frame callbacks    |              33 |             1 |
| Published frames   |              33 |             1 |
| Peak queued output | 8,986,380 bytes | 272,332 bytes |

The test also checks partial completion, latest-state resume, and unchanged native
chunk capacity during the stall. The bound is one ordinary frame, not a fixed
ceiling on all output. Explicit control writes remain separate.

Independent review exposed cancellation and shutdown cases beyond the initial test.
The complete topic includes regressions for cancelled animation ownership, stale
activation callbacks, final demand-driven updates, and 4,096 pinned output spans.
Captured stdout survives shutdown and mode transitions. Stop cancels old requests
without preventing a later explicit request.

Linux native stdout remains synchronous. This change does not enable the disabled
render thread or move image encoding onto another thread.

## GPU sharing result

Both native consumers passed: Vulkan to EGL and Vulkan to the installed Dawn device.
The second gate uses Three's `WebGPURenderer` as the producer and EGL as the consumer.
It uses the actual arena, not a substitute shader workload.

- Two DMA-BUF image slots, registered once.
- Eight changing frames at 65x33 and 640x360.
- Same-GPU, single-sample, linear RGBA8 images.
- Bidirectional GPU fences and explicit external/foreign ownership transitions.
- A separate private reference render and consumer readback for validation.
- Exact primary-color checks and deliberately stale frames.
- A no-readback mode with independently tested guards.
- Twenty-five checks passed when repeated from this worktree.

The native binary already exports the required Dawn methods. A Dawn fork was not
necessary for the prototype. The installed Bun binding does not expose these
methods and has incorrect feature-enum values. The experiment checks its binary
and JavaScript hashes before using a version-specific workaround.

Three uses its normal intermediate render target and final output triangle. The
final output enters the shared image. Vulkan adds ownership/layout barriers, not
pixel copies. EGL samples that image into its own framebuffer.

Read the [native report](gpu-sharing/README.md), [Three report](gpu-sharing/THREE.md),
[native rerun](results/gpu-native.json), and [Three rerun](results/gpu-three.json).
These tests do not measure presentation, throughput, or input-to-photon latency.
They do not establish driver-internal zero-copy or overlapping-frame correctness.

## GPU service timing

A separate guarded experiment measures steady-state Three/EGL service time without
readback. It uses three fresh process pairs per size, with 60 warmup and 300
measured frames per pair. Percentiles combine all 900 samples for each size.

| Framebuffer |     Mean |      P95 |      P99 |
| ----------- | -------: | -------: | -------: |
| 640x360     | 0.457 ms | 0.597 ms | 1.351 ms |
| 1280x720    | 0.497 ms | 0.636 ms | 1.362 ms |
| 1920x1080   | 0.570 ms | 0.908 ms | 1.525 ms |

The timer starts before the parent grants a frame. It stops after a fence wait
confirms GPU sampling and the return to external ownership. Scene update, rendering,
IPC, ownership bridges, and waits are included. No terminal or compositor participates.

This is a different endpoint from a DSR reply. Do not divide the terminal numbers
by these numbers and call the result a display speedup. The data supports continued
work on a terminal import path, not a claim that a terminal already presents these
frames at this rate.

The [performance report](gpu-sharing/PERFORMANCE.md) retains all 2,700 samples and
the CPU-counter limits. Whole-command CPU includes startup, warmup, and teardown.

## Verification

The combined build passed. Functional checks passed:

| Check                                      | Result                   |
| ------------------------------------------ | ------------------------ |
| Native suite                               | 2,133 passed, 8 skipped  |
| Bun Core suite                             | 5,537 passed, 23 skipped |
| Node 26.7 Core suite                       | 4,794 passed, 6 skipped  |
| Packed Bun/Node distribution               | Passed                   |
| Three NONE GPU regressions                 | 2 passed                 |
| Magick GPU, ownership, wire, and PTY tests | 33 passed                |
| Magick example typecheck                   | Passed                   |
| Shared-image checks                        | 25 passed                |

The package build checks declarations. The Node suite compiles its test sources. Broad checks
of unrelated demo or generated Yoga test sources still report existing errors.
The new example has its own checked TypeScript configuration.

The [verification runner](verify.ts) records commands and logs in
`results/verification`. Terminal cleanup tests cover parser timeout and a report-write
failure. GPU tests check exact channels, padded rows, and failed-consumer cleanup.

## Wire validation

An additional 54 cases check output after timing. The 42 raw/zlib cases, including
fallbacks, compare decoded wire pixels with the retained source image. The decoder
uses Node's independent zlib implementation. These cases then request image acknowledgements.
The 12 effective-file cases check upload-lease acknowledgements, not file contents.

All 36 Ghostty and Kitty cases passed. The 18 WezTerm cases matched the wire pixels
but returned no image acknowledgement. They remain explicitly unvalidated in
[the validation index](results/validation/index.json), rather than counting as successful uploads.
These one-frame checks are not additional performance samples for the tables above.

## Remaining boundaries

- Core has no DMA-BUF terminal protocol or stock-terminal GPU import backend.
- The shared-image bridge uses pinned private interfaces, not a supported public API.
- No Vulkan validation layer was installed for the GPU-sharing tests.
- File mode has no SHM transport and cannot guarantee cleanup after `SIGKILL`.
- No networking, authoritative gameplay, or co-op implementation belongs to this work.
- The measurements do not cover remote SSH frame streaming or mux-aware GPU sharing.
- Presentation feedback and an actual terminal import implementation remain separate work.
