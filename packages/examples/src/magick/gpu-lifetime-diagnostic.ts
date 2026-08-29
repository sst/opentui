import { heapStats } from "bun:jsc"
import { createHash } from "node:crypto"
import { readdirSync } from "node:fs"
import { mkdir, readFile } from "node:fs/promises"
import { cpus, release as kernelRelease } from "node:os"
import { dirname, resolve } from "node:path"
import { parseArgs } from "node:util"
import type { createPixelRenderer, PixelFrame } from "./pixel-renderer.js"
import type { PixelGpuRelease } from "./gpu-lifetime.js"

const { values } = parseArgs({
  options: {
    workload: { type: "string", default: "frames" },
    release: { type: "string", default: "baseline" },
    "canvas-view": { type: "string", default: "cached" },
    mapping: { type: "string", default: "pointer" },
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "720" },
    frames: { type: "string", default: "7200" },
    warmup: { type: "string", default: "120" },
    fps: { type: "string", default: "60" },
    particles: { type: "string", default: "512" },
    cycles: { type: "string", default: "20" },
    "frames-per-cycle": { type: "string", default: "1" },
    "rss-limit-mib": { type: "string", default: "2048" },
    gc: { type: "string", default: "checkpoints" },
    output: { type: "string" },
  },
})
function integer(key: keyof typeof values, min: number, max: number) {
  const value = Number(values[key])
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid --${key}`)
  return value
}
const width = integer("width", 1, 3840)
const height = integer("height", 1, 2160)
const frames = integer("frames", 1, 18_000)
const warmup = integer("warmup", 0, 600)
const fps = integer("fps", 0, 240)
const particles = integer("particles", 0, 4096)
const cycles = integer("cycles", 1, 100)
const framesPerCycle = integer("frames-per-cycle", 0, 60)
const rssLimitBytes = integer("rss-limit-mib", 128, 8192) * 1024 * 1024
if (!["frames", "create-dispose"].includes(values.workload!)) throw new Error("Invalid --workload")
if (!["baseline", "command-buffers", "passes", "combined"].includes(values.release!))
  throw new Error("Invalid --release")
if (!["baseline", "cached"].includes(values["canvas-view"]!)) throw new Error("Invalid --canvas-view")
if (!["view", "pointer"].includes(values.mapping!)) throw new Error("Invalid --mapping")
if (!["none", "checkpoints"].includes(values.gc!)) throw new Error("Invalid --gc")
if (width * height > 3840 * 2160) throw new Error("Framebuffer exceeds 3840 * 2160 pixels")

let gpu: Awaited<ReturnType<typeof createPixelRenderer>> | undefined
let completedFrames = 0
let completedCycles = 0
let forcedGcCount = 0
let checksum = 0
let submitMs = 0
let readbackMs = 0
let consumeMs = 0
const disposedOwnershipTotals: Record<string, number> = {}
const checkpoints: Record<string, unknown>[] = []
const started = performance.now()
const cpuStart = process.cpuUsage()
const result: Record<string, unknown> = {
  date: new Date().toISOString(),
  settings: { ...values, width, height, frames, warmup, fps, particles, cycles, framesPerCycle, rssLimitBytes },
  environment: {
    bun: Bun.version,
    cpu: cpus()[0]?.model,
    kernel: kernelRelease(),
    traceWebgpu: process.env.TRACE_WEBGPU ?? null,
    traceEnabled: process.env.TRACE_WEBGPU === "true",
    debugFfi: process.env.WGPU_DEBUG_FFI ?? null,
  },
  checkpoints,
  note: "Headless arena render and readback only. No Core, terminal, pixel import, or retained frame samples. Release counts are binding calls, not a complete native-resource census.",
}

function capture(label: string, gcMs = 0) {
  // At most 28 records: initialization, warmup, ten progress points, and disposal, each before/after GC.
  if (checkpoints.length >= 32) throw new Error("Checkpoint capacity exceeded")
  const heap = heapStats()
  checkpoints.push({
    label,
    elapsedMs: performance.now() - started,
    completedFrames,
    completedCycles,
    forcedGcCount,
    gcMs,
    ...process.memoryUsage(),
    heapSize: heap.heapSize,
    heapCapacity: heap.heapCapacity,
    extraMemorySize: heap.extraMemorySize,
    objectCount: heap.objectCount,
    protectedObjectCount: heap.protectedObjectCount,
    fds: process.platform === "linux" ? readdirSync("/proc/self/fd").length : null,
    ownership: gpu?.ownership(),
    disposedOwnershipTotals: { ...disposedOwnershipTotals },
  })
}

function checkpoint(label: string) {
  capture(label)
  if (values.gc !== "checkpoints") return
  const start = performance.now()
  Bun.gc(true)
  forcedGcCount++
  capture(`${label}:gc`, performance.now() - start)
}

function checkRss() {
  if (process.memoryUsage.rss() > rssLimitBytes) throw new Error("RSS safety limit exceeded")
}

function consume(frame: PixelFrame) {
  const middle = Math.floor(height / 2) * frame.stride + Math.floor(width / 2) * 4
  checksum = (checksum + frame.data[0] + frame.data[middle] + frame.data[middle + 3]) >>> 0
}

try {
  if (process.env.TRACE_WEBGPU === "true") throw new Error("Refusing TRACE_WEBGPU=true: tracing retains call history")
  if (process.env.WGPU_DEBUG_FFI === "true") throw new Error("Refusing WGPU_DEBUG_FFI=true for a memory diagnostic")
  const { createPixelRenderer } = await import("./pixel-renderer.js")
  const { createArena } = await import("./arena.js")
  const packageUrl = new URL("./package.json", import.meta.resolve("bun-webgpu"))
  const provider = JSON.parse(await readFile(packageUrl, "utf8"))
  if (provider.version !== "0.1.7") throw new Error("Diagnostic requires bun-webgpu 0.1.7")
  result.provider = { version: provider.version, path: packageUrl.href }
  result.revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: import.meta.dir })
    .stdout.toString()
    .trim()
  result.sources = Object.fromEntries(
    await Promise.all(
      ["gpu-lifetime-diagnostic.ts", "gpu-lifetime.ts", "pixel-renderer.ts", "arena.ts"].map(async (name) => [
        name,
        createHash("sha256")
          .update(await readFile(new URL(`./${name}`, import.meta.url)))
          .digest("hex"),
      ]),
    ),
  )
  checkpoint("before-create")
  checkRss()
  const frameWorkload = values.workload === "frames"
  const lifetimeCount = frameWorkload ? 1 : cycles
  const frameCount = frameWorkload ? warmup + frames : framesPerCycle
  let progress = 1
  for (let cycle = 0; cycle < lifetimeCount; cycle++) {
    const arena = createArena(width / height, particles)
    try {
      gpu = await createPixelRenderer(width, height, values.mapping as "view" | "pointer", {
        release: values.release as PixelGpuRelease,
        cacheCanvasView: values["canvas-view"] === "cached",
      })
      result.adapter ??= gpu.adapter
      result.scene ??= arena.counts
      if (cycle === 0) checkpoint("initialized")
      let deadline = performance.now()
      for (let frame = 0; frame < frameCount; frame++) {
        if (frameWorkload && frame === warmup) checkpoint("warmup-complete")
        arena.update(frame / 60)
        const timing = await gpu.draw(arena.scene, arena.camera, consume)
        completedFrames++
        submitMs += timing.submitMs
        readbackMs += timing.readbackMs
        consumeMs += timing.consumeMs
        if (frame % 60 === 0) checkRss()
        if (frameWorkload && frame + 1 - warmup >= Math.ceil((frames * progress) / 10)) {
          checkpoint(`frames:${frame + 1 - warmup}`)
          do progress++
          while (progress <= 10 && frame + 1 - warmup >= Math.ceil((frames * progress) / 10))
          checkRss()
        }
        if (fps) {
          deadline = Math.max(deadline + 1000 / fps, performance.now())
          await Bun.sleep(Math.max(0, deadline - performance.now()))
        }
      }
    } finally {
      try {
        arena.dispose()
      } finally {
        if (gpu) {
          gpu.dispose()
          for (const [key, value] of Object.entries(gpu.ownership()))
            disposedOwnershipTotals[key] = (disposedOwnershipTotals[key] ?? 0) + value
          gpu = undefined
        }
      }
    }
    completedCycles++
    if (!frameWorkload && cycle + 1 >= Math.ceil((cycles * progress) / 10)) {
      checkpoint(`cycles:${cycle + 1}`)
      do progress++
      while (progress <= 10 && cycle + 1 >= Math.ceil((cycles * progress) / 10))
    }
    checkRss()
  }
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error)
  process.exitCode = 1
} finally {
  // Give queued device-loss callbacks a turn before the final GC checkpoint.
  await Bun.sleep(0)
  checkpoint("disposed")
  result.summary = {
    elapsedMs: performance.now() - started,
    cpu: process.cpuUsage(cpuStart),
    completedFrames,
    completedCycles,
    checksum,
    forcedGcCount,
    submitMs,
    readbackMs,
    consumeMs,
    disposedOwnershipTotals,
  }
  const json = JSON.stringify(result, null, 2) + "\n"
  if (values.output) {
    await mkdir(dirname(resolve(values.output)), { recursive: true })
    await Bun.write(values.output, json)
  } else process.stdout.write(json)
}
