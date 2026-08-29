# Linux GPU image sharing spike

**Both native gates passed on the RX 7600:** Vulkan compute to EGL/GLES, and Vulkan
compute to the installed `bun-webgpu@0.1.7` Dawn device. Each consumer imports two
DMA-BUF images once, loads their texels on the GPU, and verifies all pixels across
eight alternating frames. Neither process maps a shared image or transports CPU
pixels. `evidence.json` contains the recorded results and failure-path checks.

This is **not Three.js integration, an OpenTUI change, or stock-terminal zero-copy**.
The Dawn consumer calls native APIs on Bun's exposed `GPUDevice.ptr`; it does not
construct a JavaScript `GPUTexture` or attach one to a Three.js material.

## Run

Run commands from this directory. The native test needs `cc`, `make`,
`glslangValidator`, `timeout`, and pkg-config packages `vulkan`, `egl`, `glesv2`,
`gbm`, and `libdrm`.

```sh
make test
timeout --kill-after=2s 30s .build/native-sharing /dev/dri/renderD129 65 33
```

The Dawn test also needs Bun, `curl`, `uv`, and an installed `bun-webgpu@0.1.7`
Linux package. It downloads seven small files from the pinned Dawn revision and
generates the native header with Jinja2. Build outputs, headers, and downloads stay
under the ignored `.build/` directory. It does not build Dawn or OpenTUI.

```sh
make dawn-test WEBGPU_NODE_MODULES=/home/simon/src/magick-proof/node_modules
make verify WEBGPU_NODE_MODULES=/home/simon/src/magick-proof/node_modules
```

`verify` also requires `strace` and writes `.build/evidence.json`. It checks six successful GPU runs, eight
expected failures, and the Bun feature-enum mismatch. The recorded machine uses
`renderD128` for the RX 7600 and `renderD129` for the Ryzen iGPU; the full verification
suite deliberately targets those nodes. The native executable accepts another
render node. Dawn selects the high-performance Vulkan adapter and rejects a
vendor/device mismatch before registration. This is sufficient for these two
different GPUs, not a general identity check for machines with identical GPUs.
For both odd-pitch tests, syscall traces confirm two distinct processes send two
DMA-BUF descriptors and sixteen `anon_inode:sync_file` descriptors through
`SCM_RIGHTS`. The full traces stay in `.build/`; the JSON records their counts.

Use `make clean` before changing `WEBGPU_NODE_MODULES`: the helper links the
selected library by absolute path. The Bun consumer checks the native binary's
SHA-256 before loading it to avoid silently using a different ABI.

## What runs

| Property               | Tested value                                                 |
| ---------------------- | ------------------------------------------------------------ |
| GPU                    | AMD Radeon RX 7600, RADV, Mesa 26.1.7                        |
| Additional native test | Ryzen 7 9800X3D iGPU, same-driver EGL/Vulkan                 |
| Sizes                  | `65x33`, `640x360`, plus native `1x1`                        |
| Format                 | Vulkan `R8G8B8A8_UNORM`, DRM `ABGR8888`, one plane           |
| Modifier               | `DRM_FORMAT_MOD_LINEAR` (`0`)                                |
| Row pitches            | 512 bytes at width 65; 2560 bytes at width 640               |
| Images                 | Two slots, one mip, one layer, one sample                    |
| Transport              | Unix `SOCK_SEQPACKET`, `SCM_RIGHTS`, fixed 64-byte metadata  |
| Registration           | One DMA-BUF descriptor per slot, sent once                   |
| Synchronization        | One acquire and one release `sync_file` descriptor per frame |
| Validation             | Every RGBA channel, tolerance one UNORM step                 |

The Vulkan compute shader writes a pattern from `(x, y, sequence)`, without a CPU
pixel upload. GLES uses `texelFetch` into a separate framebuffer and reads that
framebuffer. Dawn uses WGSL `textureLoad`, writes packed RGBA to a storage buffer,
and maps a separate readback buffer. The odd width checks pitch handling. Changing
the sequence changes every frame, so a stale image fails validation.

The producer releases queue-family ownership before exporting its semaphore as a
`sync_file`. EGL imports that fence and enqueues `eglWaitSyncKHR`, then exports its
own native fence after sampling. Dawn uses `ImportSharedFence`, `BeginAccess`, and
`EndAccess`. The producer imports each returned fence into a temporary Vulkan
semaphore and waits on it before reusing the slot. EGL uses `FOREIGN` ownership;
Dawn's DMA-BUF implementation uses `EXTERNAL`. Dawn returns layout pair `(5, 5)`
(`SHADER_READ_ONLY_OPTIMAL`), while EGL returns `(1, 1)` (`GENERAL`). The producer
matches the returned pair before transitioning the image for its next write.

## Bun ABI finding

The installed binary exports `wgpuDeviceImportSharedTextureMemory`,
`wgpuDeviceImportSharedFence`, all shared-texture access methods, and fence export.
The JavaScript package does not bind them. It also has shifted feature enum values:

| Native header feature       | Value     | Bun 0.1.7 name encoding that value        |
| --------------------------- | --------- | ----------------------------------------- |
| `SharedTextureMemoryDmaBuf` | `0x50022` | `shared-texture-memory-a-hardware-buffer` |
| `SharedFenceSyncFD`         | `0x5002a` | `shared-fence-vk-semaphore-opaque-fd`     |

The experiment requests those two version-specific aliases, then verifies the
actual native features with `wgpuDeviceHasFeature` before importing anything.
Requesting the correctly spelled public features fails with
`TypeError: Invalid feature required: shared-fence-sync-fd`. Reproduce that check:

```sh
WEBGPU_NODE_MODULES=/home/simon/src/magick-proof/node_modules \
  timeout --kill-after=2s 15s bun dawn-consumer.ts --probe-enums
```

The header comes from Dawn revision
`d18e21db186c42c073a90f91bdea0cc438b1924d`, the build pinned by
[`bun-webgpu` v0.1.7's downloader](https://github.com/kommander/bun-webgpu/blob/v0.1.7/dawn/download_artifacts.ts).
The recorded binary SHA-256 is
`3190c3777f2c07fcf6a0640833cbf5d0cde859dc53aed6d9083946d093198788`.

## Limits and cleanup

Scheduling is **serialized validation**, not a latency, overlap, or throughput
measurement. Readback blocks the validation consumer before its acknowledgement.
The producer also uses bounded host fence waits to reuse command buffers and to
drain the final release fences. Cross-API acquisition itself uses GPU fences, not
a CPU-wait fallback. Removing readback and adding a display/compositor consumer
remain separate work.

The spike tests only same-GPU linear RGBA8 images. It does not test tiled or
compressed modifiers, BGRA, MSAA, resizing, multiple readers, GPU reset, or
cross-GPU sharing. No Vulkan validation layer was installed on this machine;
the Dawn helper checks validation error scopes and all returned access statuses.
Driver-internal copies are not instrumented. The no-CPU-pixel-handoff result
comes from the implemented transport and its successful sampled readbacks.

IPC and Vulkan fence waits have five-second bounds. The producer has a 25-second
alarm; its child has a 20-second alarm and a parent-death kill signal. Commands
also have an outer timeout. Successful runs explicitly release shared images,
fences, queues, and validation resources. Bun owns its adapter and instance until exit.
Fatal errors terminate the owning process; the kernel reclaims its handles and
GPU allocations. The producer kills and reaps its child on failure. This is an
isolated process experiment, not an embeddable library with recoverable errors.

The suite confirms that disconnected and stalled consumers are reaped. It also
injects a stale GPU pattern with `GPU_SHARING_BAD_PATTERN=1` and checks that both
consumers reject it, rather than accepting a successful import as proof of
correct rendering. No terminal or system configuration changes are needed.
