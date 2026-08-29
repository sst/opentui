import assert from "node:assert/strict"
import { resolve } from "node:path"

assert(process.env.WEBGPU_NODE_MODULES && process.env.MAGICK_ARENA_MODULE, "Explicit arena and dependencies required")
const environment = { ...process.env }
for (const key of [
  "GPU_SHARING_PERF_FRAMES",
  "GPU_SHARING_PERF_WARMUP",
  "GPU_SHARING_PERF_PACE_US",
  "GPU_SHARING_CALIBRATION",
  "GPU_SHARING_THREE_STALE",
  "LD_PRELOAD",
])
  delete environment[key]
const results = []
for (const test of [
  { name: "single-frame-no-warmup", frames: 1, warmup: 0, pace: 0 },
  { name: "paced-frames", frames: 3, warmup: 2, pace: 100000 },
  { name: "reject-missing-guard", frames: 1, warmup: 0, pace: 0, error: "requires the no-readback preload guard" },
  { name: "reject-readback-mode", frames: 1, warmup: 0, pace: 0, error: "requires the no-readback arena" },
]) {
  const command = [
    "timeout",
    "--kill-after=2s",
    "90s",
    ".build/three-sharing",
    "/dev/dri/renderD128",
    "65",
    "33",
    "three-producer.ts",
  ]
  if (test.name !== "reject-readback-mode") command.push("--no-readback")
  const started = performance.now()
  const run = Bun.spawnSync(command, {
    cwd: import.meta.dir,
    env: {
      ...environment,
      GPU_SHARING_PERF_FRAMES: String(test.frames),
      GPU_SHARING_PERF_WARMUP: String(test.warmup),
      GPU_SHARING_PERF_PACE_US: String(test.pace),
      ...(test.name === "reject-missing-guard"
        ? {}
        : { LD_PRELOAD: resolve(import.meta.dir, ".build/no-readback-guard.so") }),
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 95_000,
    killSignal: "SIGKILL",
  })
  const elapsedMs = performance.now() - started
  assert.equal(run.exitCode, test.error ? 1 : 0, run.stderr.toString())
  if (test.error) {
    assert(run.stderr.toString().includes(test.error))
    assert.equal(run.stdout.toString(), "")
    results.push({ name: test.name, status: "pass", expected_failure: test.error })
    continue
  }
  assert.equal(run.stderr.toString(), "")
  const [producer, consumer] = run.stdout
    .toString()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.equal(producer.status, "pass")
  const handles = producer.gpu_handles
  for (const kind of ["encoders", "passes", "commandBuffers"]) {
    assert(handles[`${kind}Created`] > 0)
    assert.equal(handles[`${kind}Released`], handles[`${kind}Created`], `${kind} API references`)
  }
  assert.equal(handles.pendingEncoders + handles.pendingPasses + handles.pendingCommandBuffers, 0)
  assert.equal(consumer.status, "pass")
  assert.equal(consumer.frames, test.frames + test.warmup)
  assert.equal(consumer.performance.frame_service_ns.length, test.frames)
  assert.equal(consumer.performance.warmup_frames, test.warmup)
  assert.equal(consumer.performance.pace_us, test.pace)
  assert.equal(consumer.producer_reference_readbacks, 0)
  assert.equal(consumer.consumer_readbacks, 0)
  assert.equal(producer.canvas_views, Math.min(test.frames + test.warmup, 2))
  assert.equal(producer.canvas_view_requests, test.frames + test.warmup)
  assert(elapsedMs >= ((test.frames + test.warmup - 1) * test.pace) / 1000, "Paced grant interval")
  results.push({
    name: test.name,
    status: "pass",
    elapsed_ms: elapsedMs,
    gpu_handles: handles,
    frame_service_ns: consumer.performance.frame_service_ns,
  })
}
const output = JSON.stringify({ status: "pass", results }, null, 2) + "\n"
await Bun.write(resolve(import.meta.dir, ".build/performance-mode-checks.json"), output)
console.log(output.trimEnd())
