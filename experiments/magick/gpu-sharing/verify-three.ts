import assert from "node:assert/strict"
import { resolve } from "node:path"

assert(process.env.WEBGPU_NODE_MODULES && process.env.MAGICK_ARENA_MODULE, "Explicit module and dependencies required")
const cwd = import.meta.dir
const guard = resolve(cwd, ".build/no-readback-guard.so")
const results: unknown[] = []
for (const [width, height] of [
  [65, 33],
  [640, 360],
]) {
  for (const mode of ["arena", "no-readback", "calibration", "stale"]) {
    const name = `${mode}-${width}x${height}`
    const trace = mode === "no-readback" || (mode === "arena" && width === 65)
    const tracePath = resolve(cwd, `.build/three-${name}.trace`)
    let command = [
      "timeout",
      "--kill-after=2s",
      "60s",
      ".build/three-sharing",
      "/dev/dri/renderD128",
      String(width),
      String(height),
      "three-producer.ts",
    ]
    if (mode === "no-readback") command.push("--no-readback")
    if (trace) command = ["strace", "-f", "-yy", "-e", "trace=sendmsg,recvmsg", "-o", tracePath, ...command]
    const run = Bun.spawnSync(command, {
      cwd,
      env: {
        ...process.env,
        ...(mode === "no-readback" ? { LD_PRELOAD: guard } : {}),
        ...(mode === "calibration" ? { GPU_SHARING_CALIBRATION: "1" } : {}),
        ...(mode === "stale" ? { GPU_SHARING_THREE_STALE: "1" } : {}),
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 65_000,
    })
    const stdout = run.stdout.toString().trim()
    const stderr = run.stderr.toString().trim()
    assert.equal(run.exitCode, mode === "stale" ? 1 : 0, `${name}: ${stderr}`)
    if (mode === "stale") {
      assert(stderr.includes("Three arena digest mismatch"), stderr)
      assert(stderr.includes("sequence=3"), stderr)
      assert.equal(stdout, "", "Rejected frames must not report success")
      results.push({ name, status: "pass", expected_failure: "Three arena digest mismatch", sequence: 3, stderr })
      continue
    }
    assert.equal(stderr, "", `${name}: unexpected diagnostics`)
    const records = stdout.split("\n").map((line) => JSON.parse(line))
    assert.equal(records.length, 2)
    const [producer, consumer] = records
    assert.equal(producer.type, "three-producer")
    assert.equal(producer.status, "pass")
    assert.equal(consumer.status, "pass")
    assert.equal(consumer.producer, "Three.js WebGPURenderer")
    assert.equal(consumer.width, width)
    assert.equal(consumer.height, height)
    assert.equal(consumer.cpu_pixel_transport_bytes, 0)
    assert.equal(consumer.shared_image_cpu_maps, 0)
    assert.equal(consumer.bridge_pixel_copy_commands, 0)
    assert.equal(consumer.frames, 8)
    assert.equal(producer.shared_render_calls, 8)
    assert.equal(consumer.producer_reference_readbacks, mode === "no-readback" ? 0 : 8)
    assert.equal(consumer.consumer_readbacks, mode === "no-readback" ? 0 : 8)
    assert.deepEqual(producer.reference_hashes, consumer.hashes)
    assert.equal(consumer.hashes.length, mode === "no-readback" ? 0 : 8)
    if (mode === "arena") assert.equal(new Set(consumer.hashes).size, 8, "All arena frames must change")
    if (mode === "calibration") assert.equal(consumer.calibration, true)
    let syscallEvidence
    if (trace) {
      const sends = (await Bun.file(tracePath).text())
        .split("\n")
        .filter((line) => line.includes("sendmsg(") && line.includes("SCM_RIGHTS"))
      syscallEvidence = {
        processes: new Set(sends.map((line) => line.trim().split(/\s+/)[0])).size,
        dma_buf_sends: sends.filter((line) => line.includes("</dmabuf:")).length,
        sync_file_sends: sends.filter((line) => line.includes("<anon_inode:sync_file>")).length,
      }
      assert.deepEqual(syscallEvidence, { processes: 2, dma_buf_sends: 2, sync_file_sends: 16 })
      assert(
        sends.every((line) => line.includes("iov_len=64")),
        "Only fixed metadata accompanies descriptors",
      )
    }
    results.push({
      name,
      status: "pass",
      producer,
      consumer,
      strace: syscallEvidence,
      readback_guard: mode === "no-readback" ? "glReadPixels and wgpuBufferMapAsync abort on call" : undefined,
    })
  }
}

for (const [name, binary, args, operation] of [
  ["guard-blocks-egl-readback", ".build/native-sharing", [], "glReadPixels"],
  ["guard-blocks-dawn-reference", ".build/three-sharing", ["three-producer.ts"], "wgpuBufferMapAsync"],
] as const) {
  const run = Bun.spawnSync(["timeout", "--kill-after=2s", "60s", binary, "/dev/dri/renderD128", "65", "33", ...args], {
    cwd,
    env: { ...process.env, LD_PRELOAD: guard },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 65_000,
  })
  const stderr = run.stderr.toString().trim()
  assert.equal(run.exitCode, 1, stderr)
  assert(stderr.includes(`GPU_SHARING_READBACK_GUARD: ${operation}`), stderr)
  assert.equal(run.stdout.toString().trim(), "")
  results.push({ name, status: "pass", blocked_operation: operation })
}

const sources: Record<string, string> = {}
for (const file of [
  "three-sharing.c",
  "three-producer.c",
  "three-producer.ts",
  "three-protocol.h",
  "no-readback-guard.c",
  "verify-three.ts",
  "native-sharing.c",
  "dawn-consumer.c",
  "protocol.h",
  "Makefile",
]) {
  sources[file] = new Bun.CryptoHasher("sha256").update(await Bun.file(resolve(cwd, file)).arrayBuffer()).digest("hex")
}
const packages = ["vulkan", "egl", "glesv2", "gbm", "libdrm"]
const versions = Bun.spawnSync(["pkg-config", "--modversion", ...packages])
assert.equal(versions.exitCode, 0)
const evidence = {
  status: "pass",
  recorded_at: new Date().toISOString(),
  native_gate_commit: "d64ce1a1",
  bun_version: Bun.version,
  bun_revision: Bun.revision,
  source_sha256: sources,
  results,
  package_versions: Object.fromEntries(
    packages.map((name, index) => [name, versions.stdout.toString().trim().split("\n")[index]]),
  ),
  scope: "Actual Three.js arena output imported by EGL across processes; not a terminal presentation integration",
  limits: [
    "Same-GPU linear RGBA8, single sample, two slots, eight serial frames",
    "Validation compares FNV1a64 over every RGBA byte to a separately rendered private reference texture",
    "Primary-color calibration also checks every sampled RGBA value exactly",
    "No-readback mode skips validation and forbids both readback entrypoints with an independently tested preload guard",
    "Vulkan bridge records ownership/layout barriers only; its bounded host waits protect command buffer reuse",
    "Pinned Bun private texture wrapper and instance-local Three canvas-format hook; no public API changes",
    "No Vulkan validation layer installed; native Dawn validation scopes checked",
  ],
}
const output = JSON.stringify(evidence, null, 2) + "\n"
if (process.argv[2]) await Bun.write(resolve(cwd, process.argv[2]), output)
console.log(output.trimEnd())
