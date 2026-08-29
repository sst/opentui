import assert from "node:assert/strict"

// These cases use an early-exit parser path. They never initialize a GPU or fork the producer.
const defaults = {
  performance: false,
  measured_frames: 8,
  warmup_frames: 0,
  pace_us: 0,
  total_frames: 8,
  timeout_seconds: 55,
}
const cases: { env: Record<string, string>; result?: typeof defaults }[] = [
  { env: {}, result: defaults },
  {
    env: { GPU_SHARING_PERF_FRAMES: "300" },
    result: {
      performance: true,
      measured_frames: 300,
      warmup_frames: 60,
      pace_us: 0,
      total_frames: 360,
      timeout_seconds: 60,
    },
  },
  {
    env: { GPU_SHARING_PERF_FRAMES: "1", GPU_SHARING_PERF_WARMUP: "0" },
    result: {
      performance: true,
      measured_frames: 1,
      warmup_frames: 0,
      pace_us: 0,
      total_frames: 1,
      timeout_seconds: 60,
    },
  },
  {
    env: { GPU_SHARING_PERF_FRAMES: "10000", GPU_SHARING_PERF_WARMUP: "1000", GPU_SHARING_PERF_PACE_US: "100000" },
    result: {
      performance: true,
      measured_frames: 10000,
      warmup_frames: 1000,
      pace_us: 100000,
      total_frames: 11000,
      timeout_seconds: 1160,
    },
  },
  {
    env: { GPU_SHARING_PERF_FRAMES: "300", GPU_SHARING_PERF_PACE_US: "16667" },
    result: {
      performance: true,
      measured_frames: 300,
      warmup_frames: 60,
      pace_us: 16667,
      total_frames: 360,
      timeout_seconds: 67,
    },
  },
  { env: { GPU_SHARING_PERF_FRAMES: "0" } },
  { env: { GPU_SHARING_PERF_FRAMES: "10001" } },
  { env: { GPU_SHARING_PERF_FRAMES: "-1" } },
  { env: { GPU_SHARING_PERF_FRAMES: "" } },
  { env: { GPU_SHARING_PERF_FRAMES: "1.5" } },
  { env: { GPU_SHARING_PERF_FRAMES: "00000000001" } },
  { env: { GPU_SHARING_PERF_FRAMES: "300", GPU_SHARING_PERF_WARMUP: "1001" } },
  { env: { GPU_SHARING_PERF_FRAMES: "300", GPU_SHARING_PERF_WARMUP: "-1" } },
  { env: { GPU_SHARING_PERF_FRAMES: "300", GPU_SHARING_PERF_PACE_US: "100001" } },
  { env: { GPU_SHARING_PERF_WARMUP: "60" } },
  { env: { GPU_SHARING_PERF_PACE_US: "16667" } },
]
const environment = { ...process.env }
for (const key of ["GPU_SHARING_PERF_FRAMES", "GPU_SHARING_PERF_WARMUP", "GPU_SHARING_PERF_PACE_US"]) {
  delete environment[key]
}
for (const test of cases) {
  const run = Bun.spawnSync([".build/three-sharing", "--perf-options"], {
    cwd: import.meta.dir,
    env: { ...environment, ...test.env },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 2000,
    killSignal: "SIGKILL",
  })
  assert.equal(run.exitCode, test.result ? 0 : 1, run.stderr.toString())
  if (test.result) {
    assert.deepEqual(JSON.parse(run.stdout.toString()), test.result)
    assert.equal(run.stderr.toString(), "")
  } else {
    assert.equal(run.stdout.toString(), "")
    assert.equal(JSON.parse(run.stderr.toString()).status, "fail")
  }
}
console.log(JSON.stringify({ status: "pass", cases: cases.length, gpu_initialization: false }))
