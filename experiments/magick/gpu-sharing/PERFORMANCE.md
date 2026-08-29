# Guarded Three/EGL service time

Measured on August 29, 2026, with the RX 7600, RADV Mesa 26.1.7, and Ryzen 7
9800X3D. The host ran Linux `7.1.8-arch1-3`, Bun revision
`0d9b296af33f2b851fcbf4df3e9ec89751734ba4`, and Three r177.

All nine runs passed. Each size used three fresh process pairs, run serially,
with 60 discarded warmup frames and 300 measured frames per run. Pacing was zero.
The readback guard was enabled in both GPU processes. No tracing or other agent
benchmark overlapped the matrix; normal desktop background activity remained.

## Results

Service durations are in milliseconds. Percentiles use nearest rank over all
900 retained measured frames at each size. No samples were removed.

| Size      | Mean  | p50   | p95   | p99   | Maximum |
| --------- | ----- | ----- | ----- | ----- | ------- |
| 640x360   | 0.457 | 0.406 | 0.597 | 1.351 | 4.268   |
| 1280x720  | 0.497 | 0.444 | 0.636 | 1.362 | 4.239   |
| 1920x1080 | 0.570 | 0.512 | 0.908 | 1.525 | 3.913   |

| Size      | Run 1 mean | Run 2 mean | Run 3 mean | Whole-command CPU |
| --------- | ---------- | ---------- | ---------- | ----------------- |
| 640x360   | 0.447      | 0.473      | 0.452      | 163.7 to 164.4%   |
| 1280x720  | 0.499      | 0.497      | 0.496      | 157.8 to 159.2%   |
| 1920x1080 | 0.575      | 0.561      | 0.573      | 148.7 to 150.9%   |

**CPU is not a steady-state-only counter.** Bash's command timer records user
and system CPU time for the command and its reaped children, including startup,
metadata collection, warmup, measured frames, and teardown. The percentage is
`100 * (user + system) / wall`, where 100% means one CPU core. Startup can use
several threads. Timer values have millisecond resolution. Raw wall/user/system
values are retained for each run; the percentage must not be interpreted as
measured-interval CPU utilization.

## Timing boundary

The parent starts `CLOCK_MONOTONIC` immediately before polling/sending the frame
grant. It stops after an explicit, five-second-bounded `vkWaitForFences` returns
for the final ownership-bridge submission. That submission waits for EGL's
native sampling fence, acquires `FOREIGN` ownership, and releases the image to
`EXTERNAL` ownership for a future producer grant.

This is serial, completed-GPU-service time: CPU scene update and submission,
process wakeups, IPC, GPU rendering and sampling, both ownership bridges, FD
handling, and host waits are included. Every warmup frame uses the same completion
wait. No CPU readback occurs in a timed run. Each run registers two images once,
transfers 720 cross-process fences, and performs 722 ownership-bridge submissions.

The endpoint is **not terminal or display presentation**. It does not wait for
scanout, a compositor, or a terminal reply. A DSR reply is a different completion
boundary, so these numbers are not an equivalent DSR-latency comparison. They
are short-run observations, not a claim about sustained presentation throughput.

## Evidence and checks

[`three-performance.json`](three-performance.json) retains all 2,700 measured
durations in frame order, per-run summaries, CPU counters, source and native
library hashes, arena version, device/driver UUIDs, and driver description. The
arena SHA-256 is
`b40602f6611847d09aadaef3632e9cba5aac83174a8f932ffb21e4ed3263de98`.
It uses 512 particles and records 29 draw calls and 15,473 triangles per shared
frame, including Three's output triangle. The two canvas views are reused.

The 15 original native checks and 10 original Three checks passed before the
matrix. All 16 option-boundary cases passed. Additional checks passed for one
frame with no warmup, paced grants, missing-guard rejection, and readback-mode
rejection. Separate eight-frame arena/reference hash comparisons also passed at
1280x720 and 1920x1080. Those validation readbacks are not part of the timing data.

The report includes the check results and larger-size reference hashes. Raw
stdout, stderr, and individual run records remain under ignored `.build/` paths.
No binaries, driver caches, or generated headers are committed. No Vulkan
validation layer was installed; Dawn error scopes and access statuses were checked.

## Reproduce

From this directory, first run the original correctness and option checks:

```sh
make verify WEBGPU_NODE_MODULES=/home/simon/src/magick-proof/node_modules
MAGICK_ARENA_MODULE=/home/simon/src/wt/ot-magick/packages/examples/src/magick/arena.ts \
  make three-verify three-options-test \
  WEBGPU_NODE_MODULES=/home/simon/src/wt/ot-magick/packages/examples/node_modules
```

Then run the serial matrix while other benchmarks are stopped:

```sh
WEBGPU_NODE_MODULES=/home/simon/src/wt/ot-magick/packages/examples/node_modules \
MAGICK_ARENA_MODULE=/home/simon/src/wt/ot-magick/packages/examples/src/magick/arena.ts \
  bun measure-three.ts .build/three-performance.json
```

`measure-three.ts` fixes the matrix to three runs at each requested size and
sets the guard, warmup, frame count, and unpaced mode explicitly. It saves raw
records before asserting success, so failures keep their diagnostics. CPU timing
uses Bash's built-in `time`; an external GNU `time` installation is not required.
For the additional mode checks, run `verify-three-performance.ts` with the same
module/dependency environment. See [THREE.md](THREE.md) for single-run options
and the pinned experimental texture-wrapper and canvas hooks.
