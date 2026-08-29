import assert from "node:assert/strict"
import { resolve } from "node:path"

const instrumentation = {
  TRACE_WEBGPU: process.env.TRACE_WEBGPU === "true",
  WGPU_DEBUG_FFI: process.env.WGPU_DEBUG_FFI === "true",
}
for (const [key, enabled] of Object.entries(instrumentation)) {
  assert(!enabled, `Refusing ${key}=true for performance measurements`)
}
assert(process.env.WEBGPU_NODE_MODULES && process.env.MAGICK_ARENA_MODULE, "Explicit arena and dependencies required")
const cwd = import.meta.dir
const sizes = [
  [640, 360],
  [1280, 720],
  [1920, 1080],
] as const
const environment = { ...process.env }
for (const key of ["GPU_SHARING_THREE_STALE", "GPU_SHARING_CALIBRATION", "GPU_SHARING_BAD_PATTERN"]) {
  delete environment[key]
}
const runs: any[] = []
const cpuScope =
  "Bash command timer: timeout, native parent, and reaped producer; startup, warmup, frames, and teardown"
const timerFormat = '{"type":"process-time","wall_seconds":%3R,"user_seconds":%3U,"system_seconds":%3S}'
const hash = async (path: string) =>
  new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex")
const harnessHash = await hash(import.meta.path)

function summary(samples: number[]) {
  const sorted = samples.toSorted((a, b) => a - b)
  const percentile = (p: number) => sorted[Math.ceil(p * sorted.length) - 1]! / 1e6
  return {
    samples: samples.length,
    mean_ms: samples.reduce((sum, value) => sum + value, 0) / samples.length / 1e6,
    min_ms: sorted[0]! / 1e6,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    p99_ms: percentile(0.99),
    max_ms: sorted.at(-1)! / 1e6,
  }
}

// The fixed matrix runs synchronously: no profiling, tracing, or second GPU run overlaps it.
for (const [width, height] of sizes) {
  for (let iteration = 1; iteration <= 3; iteration++) {
    const name = `${width}x${height}-${iteration}`
    const command = [
      "timeout",
      "--kill-after=2s",
      "90s",
      ".build/three-sharing",
      "/dev/dri/renderD128",
      String(width),
      String(height),
      "three-producer.ts",
      "--no-readback",
    ]
    const startedAt = new Date().toISOString()
    const processResult = Bun.spawnSync(["bash", "-c", 'time "$@"', "three-performance", ...command], {
      cwd,
      env: {
        ...environment,
        GPU_SHARING_PERF_FRAMES: "300",
        GPU_SHARING_PERF_WARMUP: "60",
        GPU_SHARING_PERF_PACE_US: "0",
        LD_PRELOAD: resolve(cwd, ".build/no-readback-guard.so"),
        LC_ALL: "C",
        TIMEFORMAT: timerFormat,
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 95_000,
      killSignal: "SIGKILL",
    })
    // Preserve diagnostics before asserting, including for a failed run.
    await Bun.write(resolve(cwd, `.build/performance-${name}.stdout`), processResult.stdout)
    await Bun.write(resolve(cwd, `.build/performance-${name}.stderr`), processResult.stderr)
    assert.equal(processResult.exitCode, 0, `${name}: ${processResult.stderr.toString()}`)
    const records = processResult.stdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.equal(records.length, 2)
    const [producer, consumer] = records
    assert.equal(producer.type, "three-producer")
    assert.equal(producer.status, "pass")
    assert.equal(consumer.status, "pass")
    assert.equal(producer.mode, "performance")
    assert.equal(consumer.mode, "performance")
    assert.equal(producer.shared_render_calls, 360)
    assert.equal(consumer.frames, 360)
    assert.equal(consumer.width, width)
    assert.equal(consumer.height, height)
    assert.equal(consumer.slots, 2)
    assert.equal(producer.canvas_views, 2)
    assert.equal(producer.canvas_view_requests, 360)
    const handles = producer.gpu_handles
    for (const kind of ["encoders", "passes", "commandBuffers"]) {
      assert(handles[`${kind}Created`] > 0)
      assert.equal(handles[`${kind}Released`], handles[`${kind}Created`], `${kind} API references`)
    }
    assert.equal(handles.pendingEncoders + handles.pendingPasses + handles.pendingCommandBuffers, 0)
    assert.equal(producer.reference_render_calls, 0)
    assert.equal(consumer.producer_reference_readbacks, 0)
    assert.equal(consumer.consumer_readbacks, 0)
    assert.equal(consumer.cpu_pixel_transport_bytes, 0)
    assert.equal(consumer.bridge_pixel_copy_commands, 0)
    assert.equal(consumer.shared_image_cpu_maps, 0)
    assert.equal(consumer.image_fd_registrations, 2)
    assert.equal(consumer.cross_process_fence_transfers, 720)
    assert.equal(consumer.ownership_bridge_submissions, 722)
    assert.equal(consumer.performance.warmup_frames, 60)
    assert.equal(consumer.performance.measured_frames, 300)
    assert.equal(consumer.performance.pace_us, 0)
    assert.equal(consumer.performance.pacing_included, false)
    const samples: number[] = consumer.performance.frame_service_ns
    assert.equal(samples.length, 300)
    assert(samples.every((value) => Number.isSafeInteger(value) && value > 0))
    const stats = summary(samples)
    assert(Math.abs(stats.mean_ms * 1e6 - consumer.performance.mean_service_ns) < 0.001)
    const cpu = JSON.parse(processResult.stderr.toString().trim())
    assert.equal(cpu.type, "process-time", "Only the command timer may write stderr in a successful run")
    assert(cpu.wall_seconds > 0 && cpu.user_seconds >= 0 && cpu.system_seconds >= 0)
    if (runs.length) {
      assert.equal(producer.arena_source_sha256, runs[0].producer.arena_source_sha256)
      assert.deepEqual(producer.source_sha256, runs[0].producer.source_sha256)
      assert.equal(producer.native_library_sha256, runs[0].producer.native_library_sha256)
      assert.equal(consumer.performance.device_uuid, runs[0].consumer.performance.device_uuid)
      assert.equal(consumer.performance.driver_uuid, runs[0].consumer.performance.driver_uuid)
    }
    const result = {
      name,
      started_at: startedAt,
      iteration,
      command,
      producer,
      consumer,
      summary: stats,
      process_cpu: {
        ...cpu,
        one_core_percent: ((cpu.user_seconds + cpu.system_seconds) / cpu.wall_seconds) * 100,
        scope: cpuScope,
        timer_resolution_ms: 1,
      },
    }
    runs.push(result)
    await Bun.write(resolve(cwd, `.build/performance-${name}.json`), JSON.stringify(result, null, 2) + "\n")
    console.error(JSON.stringify({ name, ...stats, whole_run_cpu_percent: result.process_cpu.one_core_percent }))
  }
}

assert.equal(await hash(import.meta.path), harnessHash, "Measurement harness changed during the matrix")
const packages = ["vulkan", "egl", "glesv2", "gbm", "libdrm"]
const versions = Bun.spawnSync(["pkg-config", "--modversion", ...packages])
assert.equal(versions.exitCode, 0)
const result = {
  status: "pass",
  recorded_at: new Date().toISOString(),
  serial: true,
  tracing: false,
  webgpu_instrumentation: instrumentation,
  measured_frames_per_run: 300,
  warmup_frames_per_run: 60,
  runs_per_size: 3,
  pace_us: 0,
  harness_sha256: harnessHash,
  bun_version: Bun.version,
  bun_revision: Bun.revision,
  package_versions: Object.fromEntries(
    packages.map((name, index) => [name, versions.stdout.toString().trim().split("\n")[index]]),
  ),
  percentile_method: "nearest rank",
  cpu_scope: cpuScope,
  timing_start: "Parent CLOCK_MONOTONIC immediately before grant poll/send",
  timing_end: "Parent returns from bounded wait for the return bridge fence after EGL sampling and EXTERNAL release",
  limitations: [
    "Headless serial service time, not terminal or display presentation",
    "Completion is not equivalent to a DSR reply; no DSR comparison is made",
    "CPU counters cover the whole command, not only the measured frame interval",
    "No CPU readback; the tested preload guard is required in both GPU processes",
    "Normal desktop background activity was not disabled",
  ],
  summaries: sizes.map(([width, height]) => {
    const selected = runs.filter((run) => run.consumer.width === width && run.consumer.height === height)
    return {
      width,
      height,
      runs: selected.length,
      ...summary(selected.flatMap((run) => run.consumer.performance.frame_service_ns)),
      run_means_ms: selected.map((run) => run.summary.mean_ms),
      whole_run_cpu_percent: selected.map((run) => run.process_cpu.one_core_percent),
    }
  }),
  runs,
}
await Bun.write(
  resolve(cwd, process.argv[2] ?? ".build/three-performance.json"),
  JSON.stringify(result, null, 2) + "\n",
)
console.log(JSON.stringify({ status: result.status, summaries: result.summaries }, null, 2))
