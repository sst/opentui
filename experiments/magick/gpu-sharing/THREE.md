# Three.js producer gate

**The actual Magick arena passes the shared-image gate.** Three.js
`WebGPURenderer` renders into two imported DMA-BUF textures. A separate EGL/GLES
process samples those textures. Eight changing frames pass at both `65x33` and
`640x360` on the RX 7600 with RADV Mesa 26.1.7.

This extends the native gate in `d64ce1a1` without changing OpenTUI, Three.js, Bun,
the arena module, or terminal configuration. It is a headless feasibility test,
not a terminal presentation implementation or an overlay.

## Run

From this directory, using the dependencies described in [README.md](README.md):

```sh
MAGICK_ARENA_MODULE=/home/simon/src/wt/ot-magick/packages/examples/src/magick/arena.ts \
  make three-verify WEBGPU_NODE_MODULES=/home/simon/src/wt/ot-magick/packages/examples/node_modules
```

`three-verify` builds the small native helpers, runs ten checks, and writes
`.build/three-evidence.json`. `three-evidence.json` is the committed snapshot.
The original fifteen native checks still run with `make verify` and the original
`WEBGPU_NODE_MODULES` path. `evidence.json` remains the original gate's historical
snapshot, rather than being overwritten with the follow-up's source hashes.

For one no-readback run after building:

```sh
MAGICK_ARENA_MODULE=/home/simon/src/wt/ot-magick/packages/examples/src/magick/arena.ts \
WEBGPU_NODE_MODULES=/home/simon/src/wt/ot-magick/packages/examples/node_modules \
LD_PRELOAD="$PWD/.build/no-readback-guard.so" \
  timeout --kill-after=2s 60s .build/three-sharing \
  /dev/dri/renderD128 640 360 three-producer.ts --no-readback
```

The module path is required, not guessed. You can select the original
`/home/simon/src/magick-proof/src/arena.ts` with its `node_modules` directory instead.
Three resolves from the selected arena's dependencies. The output records the
arena's content hash, checkout HEAD, scene counts, Three revision and renderer
hash, and Bun JavaScript/native hashes. The content hash is authoritative if the
selected source has uncommitted changes. The producer rejects a source change
during a run. Clean the build when changing dependency directories.
The metadata `git rev-parse` call has a two-second timeout and sends `SIGKILL`
to that direct subprocess on expiry. This is not arbitrary descendant-tree control.

## Performance mode

The [recorded serial matrix](PERFORMANCE.md) covers three guarded runs per size
at 640x360, 1280x720, and 1920x1080, retaining every measured frame duration.

The opt-in performance mode is separate from the unchanged eight-frame correctness
runs. It uses the actual arena, two shared slots, and the no-readback guard. After
building and when a GPU run is authorized:

```sh
MAGICK_ARENA_MODULE=/home/simon/src/wt/ot-magick/packages/examples/src/magick/arena.ts \
  make three-perf WEBGPU_NODE_MODULES=/home/simon/src/wt/ot-magick/packages/examples/node_modules
```

The target defaults to 60 warmup frames and 300 measured frames at `640x360`.
For another size, invoke `three-sharing` directly with `--no-readback` and the same
module/dependency/guard environment shown above, plus `GPU_SHARING_PERF_FRAMES`.

| Environment variable       | Meaning                                                 | Bounds / default               |
| -------------------------- | ------------------------------------------------------- | ------------------------------ |
| `GPU_SHARING_PERF_FRAMES`  | Enables performance mode and selects measured frames    | 1..10000; target default 300   |
| `GPU_SHARING_PERF_WARMUP`  | Discarded warmup frames                                 | 0..1000; default 60            |
| `GPU_SHARING_PERF_PACE_US` | Minimum interval between parent grants, in microseconds | 0..100000; default 0 (unpaced) |

Warmup or pacing without `GPU_SHARING_PERF_FRAMES` is rejected. Performance mode
also rejects readback, calibration, stale-frame injection, or a missing preload
guard. For example, `GPU_SHARING_PERF_PACE_US=16667` requests a roughly 60 Hz grant
interval. A slow frame causes no catch-up burst; the next deadline starts from
the previous actual grant. Pacing sleep occurs before the timer starts.

For every frame, the parent samples `CLOCK_MONOTONIC` immediately before sending
the grant, including the grant's poll/send cost. After Three submits its output,
EGL samples it, and the return bridge submits its ownership release, the parent
explicitly calls `vkWaitForFences` on that final bridge submission. The wait has
the existing five-second bound. The parent stops the timer after the wait returns.
Warmup uses the same wait, so no warmup GPU work remains at the measurement boundary.

This completion means that EGL's GPU sampling finished and the return bridge
finished releasing the image to `EXTERNAL` ownership for a future producer grant.
It includes CPU scheduling, IPC, Three submission, GPU work, ownership bridges,
and the host fence wait. It is not just a queue-submission duration. It does not
wait for the producer to receive another grant, display presentation, or a terminal
reply, and it must not be compared directly to DSR latency.

The parent result contains every measured duration in `performance.frame_service_ns`
in frame order, along with its mean, counts, pacing, completion description,
device/driver UUIDs, and driver version description. The producer retains arena, Three, and library hashes and
adds experiment source hashes. Warmup samples are discarded. The timing array is
bounded to 80 KB, draw statistics are aggregated, and performance mode reuses two
canvas views instead of retaining one view per frame. Timing samples are printed
only after the run, and no CPU pixel readback or pixel transport is added.

The parent watchdog allows 60 seconds for service/startup plus the full configured
pacing budget; the producer's alarm is five seconds shorter. `three-perf` also has
a 1200-second outer timeout. Counts remain bounded even when unpaced. The
`three-options-test` target checks parser boundaries through `--perf-options`, an
early-exit path that neither initializes a GPU nor forks the producer.

## Tested workload

The recorded arena source SHA-256 is
`b40602f6611847d09aadaef3632e9cba5aac83174a8f932ffb21e4ed3263de98`.
It contains four wizards, 324 floor tiles, six obstacles, 32 enemies, and 512
particles: 28 meshes and 15,472 triangles. Each shared render records 29 draw calls
and 15,473 triangles, including Three's final output triangle. Frames advance by
0.625 seconds. Every arena frame has a different validation digest.

The GPU image is single-sample, single-plane `rgba8unorm` / DRM `ABGR8888`, with
`DRM_FORMAT_MOD_LINEAR`. The shared textures allow `RenderAttachment | CopySrc`.
At width 65 the allocation has a 512-byte row pitch, not a tightly packed 260-byte
row. At width 640 the pitch is 2560 bytes.

## Handoff

1. The native parent allocates two Vulkan images and imports them into EGL. It
   registers their DMA-BUF descriptors with the Bun child once using `SCM_RIGHTS`.
2. The child imports `SharedTextureMemory`, creates render-attachment textures,
   and wraps their native pointers as borrowed Bun `GPUTexture` objects.
3. A small canvas context returns the acquired shared texture to Three. The
   normal `WebGPURenderer.render(arena.scene, arena.camera)` call produces its
   output there. There is no CPU pixel upload or CPU copy into the shared image.
4. Dawn `EndAccess` returns a `sync_file` and layout pair `(2, 2)`,
   `COLOR_ATTACHMENT_OPTIMAL`. The child sends the fence and fixed metadata.
5. The parent waits on that fence in a Vulkan submission, acquires `EXTERNAL`
   ownership, transitions to `GENERAL`, and releases to EGL's `FOREIGN` family.
   EGL waits on the exported fence and samples with `texelFetch` into its own FBO.
6. EGL exports a release fence. The Vulkan bridge acquires `FOREIGN`, releases
   `EXTERNAL`, and returns a new acquire fence before the child reuses that slot.

The Vulkan bridge records only ownership/layout barriers. It never draws,
dispatches, copies pixels, or maps shared memory. In the eight-frame gate, two initial transitions plus two
per frame make 18 bridge submissions. Syscall traces confirm two processes, two
DMA-BUF registrations, and sixteen cross-process `sync_file` transfers. All
transport messages are 64 bytes. No CPU pixel array crosses the socket.

## Validation

Validation renders each frame once into a separate private reference texture and
once into the shared render attachment. Only the reference texture and EGL's
sampled FBO are read back. Both sides compute FNV-1a-64 over every RGBA byte,
excluding row padding. The producer sends only the reference digest, not pixels.
The consumer requires the digest to match and successive arena frames to change.
This is a hash comparison, not a cryptographic or mathematical proof of equality.

Eight checks cover both sizes in four modes: arena validation, no-readback,
exact primary-color calibration, and stale-frame injection. Calibration checks
every pixel against exact red, green, blue, and white RGBA values in addition to
the reference hash. The stale test renders time step two into the shared image
while the reference is at step three; both sizes fail at sequence three with
`Three arena digest mismatch`.

No-readback mode creates no reference texture or readback buffer and never calls
`glReadPixels` or `wgpuBufferMapAsync`. A test-only preload guard aborts if either
entrypoint is reached. Two additional checks deliberately invoke each readback
path and confirm that the guard blocks it. The guarded no-readback runs still
render and GPU-sample all eight frames, but correctly report zero validated
hashes and zero readbacks. JavaScript `MAP_READ` buffer allocation is forbidden
in both modes; only the validation helper can allocate its reference buffer.

## Experimental ABI

The Bun JavaScript and native binary hashes are checked before loading. The
helper's linked Dawn path must match the library loaded by Bun. The
native feature-enum workaround from the original gate remains necessary. The
bridge checks the private `GPUTextureImpl` constructor shape before creating
borrowed wrappers. Their `destroy()` method rejects attempts to destroy memory
owned by the native helper. Texture views have a bounded pool and explicit
release after the final GPU drain.

Three r177 normally selects BGRA for an unsigned-byte canvas. This experiment
overrides `getPreferredCanvasFormat` on this renderer instance to return RGBA.
The canvas checks the device, format, usage, and alpha configuration. This is a
pinned private-API bridge, not a proposed public core API or general Bun binding.

The recorded correctness evidence uses a serial two-slot handshake, not a performance result. Host Vulkan
fence waits protect command-buffer reuse; cross-process image acquisition uses
GPU fences. IPC, callbacks, and fence waits are bounded. Parent and child alarms,
an outer timeout, parent-death signaling, and failure-time kill/reap bound the
process lifetime. Successful runs explicitly release shared images, views,
fences, validation resources, and the renderer. Fatal errors terminate the owning
process so the kernel reclaims its resources.

This does not test tiled modifiers, MSAA, resize, cross-GPU sharing, presentation,
or an OpenTUI/terminal integration. No Vulkan validation layer was installed;
Dawn validation scopes and access-operation statuses are checked. No real
terminal window or performance run is part of the recorded correctness gate.
