import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"

const directory = process.env.WEBGPU_NODE_MODULES
assert(directory, "Set WEBGPU_NODE_MODULES")
const cwd = import.meta.dir
const results: unknown[] = []
const cases = [
  { name: "egl-odd-pitch", args: ["/dev/dri/renderD128", "65", "33"] },
  { name: "egl-video-size", args: ["/dev/dri/renderD128", "640", "360"] },
  { name: "egl-minimum", args: ["/dev/dri/renderD128", "1", "1"] },
  { name: "egl-igpu", args: ["/dev/dri/renderD129", "65", "33"] },
  { name: "dawn-odd-pitch", args: ["/dev/dri/renderD128", "65", "33", "dawn-consumer.ts"] },
  { name: "dawn-video-size", args: ["/dev/dri/renderD128", "640", "360", "dawn-consumer.ts"] },
  { name: "reject-zero", args: ["/dev/dri/renderD128", "0", "33"], error: "dimension 1..2048" },
  { name: "reject-over-bound", args: ["/dev/dri/renderD128", "2049", "33"], error: "dimension 1..2048" },
  { name: "reject-bad-node", args: ["/dev/dri/nonexistent", "65", "33"], error: "open EGL render node" },
  {
    name: "reject-wrong-gpu",
    args: ["/dev/dri/renderD129", "65", "33", "dawn-consumer.ts"],
    error: "Dawn adapter vendor/device match",
  },
  {
    name: "egl-detect-stale-pattern",
    args: ["/dev/dri/renderD128", "65", "33"],
    env: { GPU_SHARING_BAD_PATTERN: "1" },
    error: "sampled pixel mismatch",
  },
  {
    name: "dawn-detect-stale-pattern",
    args: ["/dev/dri/renderD128", "65", "33", "dawn-consumer.ts"],
    env: { GPU_SHARING_BAD_PATTERN: "1" },
    error: "sampled pixel mismatch",
  },
  {
    name: "reap-disconnected-consumer",
    args: ["/dev/dri/renderD128", "65", "33", "fault-consumer.ts"],
    env: { GPU_SHARING_FAULT: "exit" },
    error: "recvmsg size/EOF",
  },
  {
    name: "kill-and-reap-stalled-consumer",
    args: ["/dev/dri/renderD128", "65", "33", "fault-consumer.ts"],
    error: "receive poll timeout/error",
  },
]

for (const test of cases) {
  let command = ["timeout", "--kill-after=2s", "30s", ".build/native-sharing", ...test.args]
  const trace = test.name === "egl-odd-pitch" || test.name === "dawn-odd-pitch"
  const tracePath = `.build/${test.name}.trace`
  if (trace) command = ["strace", "-f", "-yy", "-e", "trace=sendmsg,recvmsg", "-o", tracePath, ...command]
  const processResult = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...test.env },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 35_000,
  })
  const stdout = processResult.stdout.toString().trim()
  const stderr = processResult.stderr.toString().trim()
  assert.equal(processResult.exitCode, test.error ? 1 : 0, `${test.name}: ${stderr}`)
  const fault = stderr.match(/fault_consumer_pid=(\d+)/)
  if (fault) {
    assert.throws(() => process.kill(Number(fault[1]), 0), { code: "ESRCH" }, "consumer must be reaped")
  }
  if (test.error) {
    assert(stderr.includes(test.error), `${test.name}: ${stderr}`)
    assert.equal(stdout, "", "failed runs must not report success")
    results.push({ name: test.name, status: "pass", expected_failure: test.error, exit_code: processResult.exitCode })
  } else {
    const result = JSON.parse(stdout)
    assert.equal(result.status, "pass")
    assert.equal(result.frames, 8)
    assert.equal(result.slots, 2)
    assert.equal(result.pixels_verified, Number(test.args[1]) * Number(test.args[2]) * 8)
    assert.equal(result.cpu_pixel_transport_bytes, 0)
    assert.equal(stderr, "", `${test.name}: unexpected diagnostics`)
    if (trace) {
      const sends = (await Bun.file(resolve(cwd, tracePath)).text())
        .split("\n")
        .filter((line) => line.includes("sendmsg(") && line.includes("SCM_RIGHTS"))
      const processes = new Set(sends.map((line) => line.trim().split(/\s+/)[0])).size
      const dmaBufs = sends.filter((line) => line.includes("</dmabuf:")).length
      const syncFiles = sends.filter((line) => line.includes("<anon_inode:sync_file>")).length
      assert.equal(processes, 2, "SCM_RIGHTS must cross producer/consumer processes")
      assert.equal(dmaBufs, 2, "two image registrations, not per-frame re-export")
      assert.equal(syncFiles, 16, "one acquire/release fence per frame")
      result.strace = { processes, dma_buf_sends: dmaBufs, sync_file_sends: syncFiles }
    }
    results.push({ name: test.name, ...result })
  }
}

const probe = Bun.spawnSync(["timeout", "--kill-after=2s", "15s", "bun", "dawn-consumer.ts", "--probe-enums"], {
  cwd,
  env: process.env,
  stdout: "pipe",
  stderr: "pipe",
  timeout: 20_000,
})
assert.equal(probe.exitCode, 0, probe.stderr.toString())
results.push({ name: "bun-webgpu-enum-mismatch", ...JSON.parse(probe.stdout.toString()) })

const versions = Bun.spawnSync(["pkg-config", "--modversion", "vulkan", "egl", "glesv2", "gbm", "libdrm"])
assert.equal(versions.exitCode, 0)
const packagePath = realpathSync(resolve(directory, "bun-webgpu"))
const library = Bun.file(resolve(packagePath, "../bun-webgpu-linux-x64/libwebgpu_wrapper.so"))
const sourceHashes: Record<string, string> = {}
for (const source of [
  "native-sharing.c",
  "dawn-consumer.c",
  "dawn-consumer.ts",
  "protocol.h",
  "producer.comp",
  "verify.ts",
  "fault-consumer.ts",
  "Makefile",
  "dawn-headers.sh",
]) {
  sourceHashes[source] = new Bun.CryptoHasher("sha256")
    .update(await Bun.file(resolve(cwd, source)).arrayBuffer())
    .digest("hex")
}
const evidence = {
  status: "pass",
  recorded_at: new Date().toISOString(),
  base_commit: "202e1e6a0013252b6d0cd08c034e25f21d55f220",
  bun_version: Bun.version,
  bun_revision: Bun.revision,
  package_versions: Object.fromEntries(
    ["vulkan", "egl", "glesv2", "gbm", "libdrm"].map((name, index) => [
      name,
      versions.stdout.toString().trim().split("\n")[index],
    ]),
  ),
  dawn_revision: "d18e21db186c42c073a90f91bdea0cc438b1924d",
  bun_webgpu_version: "0.1.7",
  dawn_library_sha256: new Bun.CryptoHasher("sha256").update(await library.arrayBuffer()).digest("hex"),
  native_feature_values: { SharedTextureMemoryDmaBuf: "0x50022", SharedFenceSyncFD: "0x5002a" },
  source_sha256: sourceHashes,
  results,
  limits: [
    "Serialized validation, not a throughput or overlap measurement",
    "Same-GPU linear RGBA8 single-plane single-sample images only",
    "No Vulkan validation layer installed; Dawn validation scopes are checked",
    "Dawn import and commands use a native helper on the Bun device pointer",
    "No Three.js, OpenTUI, display, or stock-terminal integration",
  ],
}
const output = JSON.stringify(evidence, null, 2) + "\n"
if (process.argv[2]) await Bun.write(resolve(cwd, process.argv[2]), output)
console.log(output.trimEnd())
