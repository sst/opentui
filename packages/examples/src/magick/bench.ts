import { createHash } from "node:crypto"
import { readdirSync } from "node:fs"
import { mkdir, readFile } from "node:fs/promises"
import { cpus, release, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { Writable } from "node:stream"
import type { CliRenderer, KittyImageTransport, NativeImage } from "@opentui/core"
import { createArena } from "./arena.js"
import { createPixelRenderer, packRgba, type PixelFrame } from "./pixel-renderer.js"
import { sizeBenchmarkWindow } from "./window.js"
import { validateOutput } from "./validate-output.js"

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    core: { type: "string" },
    "run-id": { type: "string" },
    import: { type: "string", default: "baseline" },
    transport: { type: "string", default: "raw" },
    mapping: { type: "string", default: "view" },
    width: { type: "string", default: "640" },
    height: { type: "string", default: "360" },
    frames: { type: "string", default: "300" },
    warmup: { type: "string", default: "30" },
    fps: { type: "string", default: "60" },
    particles: { type: "string", default: "512" },
    terminal: { type: "boolean", default: false },
    "terminal-pid": { type: "string" },
    "window-class": { type: "string" },
    "window-size": { type: "string" },
    noise: { type: "boolean", default: false },
    output: { type: "string" },
    "validate-output": { type: "boolean", default: false },
  },
})
const integer = (key: "width" | "height" | "frames" | "warmup" | "fps" | "particles", min: number, max: number) => {
  const value = Number(values[key])
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid --${key}`)
  return value
}
const width = integer("width", 1, 3840),
  height = integer("height", 1, 2160)
const frames = integer("frames", 1, 100_000),
  warmup = integer("warmup", 1, 1000)
const fps = integer("fps", 0, 240),
  particles = integer("particles", 0, 100_000)
if (!["baseline", "native", "pool", "pooled-native"].includes(values.import!))
  throw new Error("--import must be baseline, native, pool, or pooled-native")
if (!["raw", "zlib", "file"].includes(values.transport!)) throw new Error("--transport must be raw, zlib, or file")
if (!["view", "pointer"].includes(values.mapping!)) throw new Error("--mapping must be view or pointer")
if (values.terminal && (!process.stdout.isTTY || !values.output))
  throw new Error("Terminal runs require a TTY and --output")
if (values["validate-output"] && !values.terminal) throw new Error("Output validation requires --terminal")
const root = resolve(values.core ?? fileURLToPath(new URL("../../../../", import.meta.url)))
const core: typeof import("@opentui/core") = await import(pathToFileURL(join(root, "packages/core/src/index.ts")).href)
const Image = core.NativeImage as typeof core.NativeImage & {
  fromPixels?: (
    data: Uint8Array,
    width: number,
    height: number,
    options: { stride: number; format: string; alpha: string },
  ) => NativeImage
}
if (values.import === "native" && !Image.fromPixels)
  throw new Error("Selected core does not implement NativeImage.fromPixels")
interface FramePool {
  publishRgba(data: Uint8Array, stride?: number): NativeImage | null
  publishPixels?(
    data: Uint8Array,
    options: { stride: number; format: "rgba8" | "bgra8"; alpha: "opaque" },
  ): NativeImage | null
  dispose(): void
}
const Pool = (
  core as typeof core & {
    NativeImagePool?: new (options: { width: number; height: number; capacity: number }) => FramePool
  }
).NativeImagePool
if (values.import!.startsWith("pool") && !Pool) throw new Error("Selected core does not implement NativeImagePool")
const nativeAssets = await import(pathToFileURL(join(root, "packages/core/src/platform/runtime-assets.bun.ts")).href)
const libraryPath = await nativeAssets.resolveNativeLibraryPath()
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim()
const samples: Record<string, number>[] = []
const temporaryDirectory = tmpdir()
function imageFiles() {
  try {
    return readdirSync(temporaryDirectory).filter((name) => name.startsWith("opentui-kitty-"))
  } catch {
    return null
  }
}
const existingFiles = imageFiles()
const result: Record<string, unknown> = {
  date: new Date().toISOString(),
  revision,
  root,
  libraryPath,
  librarySha256: createHash("sha256")
    .update(await readFile(libraryPath))
    .digest("hex"),
  sources: Object.fromEntries(
    await Promise.all(
      ["bench.ts", "arena.ts", "pixel-renderer.ts"].map(async (name) => [
        name,
        createHash("sha256")
          .update(await readFile(new URL(`./${name}`, import.meta.url)))
          .digest("hex"),
      ]),
    ),
  ),
  environment: {
    bun: Bun.version, cpu: cpus()[0]?.model, kernel: release(), terminal: process.env.TERM_PROGRAM,
    traceWebGpu: process.env.TRACE_WEBGPU ?? null,
  },
  settings: { ...values, width, height, frames, warmup, fps, particles },
  timing: values.terminal
    ? "Native stdout. Service begins at scene update and ends at DSR parser acknowledgement. Not presentation or input-to-photon latency. No output capture/forwarding."
    : "Offscreen counting feed, without retaining output. Includes native frame staging and feed copying, not terminal time.",
}

async function processTicks(pid: number) {
  const text = await readFile(`/proc/${pid}/stat`, "utf8")
  const fields = text.slice(text.lastIndexOf(") ") + 2).split(" ")
  return Number(fields[11]) + Number(fields[12])
}

function summarize(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]
  return {
    n: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1),
  }
}

let renderer: CliRenderer | undefined
let gpu: Awaited<ReturnType<typeof createPixelRenderer>> | undefined
let pool: FramePool | undefined
let lastImage: NativeImage | undefined
let outputBytes = 0
const sink = values.terminal
  ? undefined
  : Object.assign(
      new Writable({
        write(data, _encoding, callback) {
          outputBytes += data.byteLength
          callback()
        },
      }),
      { columns: 100, rows: 32, isTTY: true },
    )
const arena = createArena(width / height, particles)
const rgba = ["baseline", "pool"].includes(values.import!) ? new Uint8Array(width * height * 4) : undefined
const noise = values.noise ? new Uint8Array(width * height * 4) : undefined
let pendingDraw: (() => Promise<void>) | undefined
let drawFinished = false
let drawError: unknown
let aborted = false
let reply = ""
let pendingReply: (() => void) | undefined
const abort = () => {
  aborted = true
}
process.once("SIGINT", abort)
process.once("SIGTERM", abort)

async function drain(command = "") {
  if (pendingReply) throw new Error("Only one parser probe may be in flight")
  reply = ""
  const start = performance.now()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingReply = undefined
      reject(new Error("Terminal parser probe timed out"))
    }, 3000)
    pendingReply = () => {
      clearTimeout(timer)
      pendingReply = undefined
      resolve()
    }
    // Benchmark instrumentation uses the renderer's output owner, never a second graphics writer.
    ;(renderer as unknown as { writeOut(data: string): boolean }).writeOut(command + "\x1b[5n")
  })
  if (/\x1b_G[^;]*;(?!OK)[^\x1b]+/.test(reply)) throw new Error(`Terminal rejected graphics: ${JSON.stringify(reply)}`)
  return performance.now() - start
}

async function frame() {
  drawFinished = false
  drawError = undefined
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (!drawFinished) return
      clearTimeout(timer)
      renderer!.off("frame", finish)
      resolve()
    }
    const timer = setTimeout(() => {
      renderer!.off("frame", finish)
      reject(new Error("Native frame timed out"))
    }, 5000)
    renderer!.on("frame", finish)
    renderer!.requestRender()
  })
  await renderer!.idle()
  if (sink) await (renderer as unknown as { _feed: { idle(): Promise<void> } })._feed.idle()
  if (drawError) throw drawError
}

async function negotiateTransport() {
  if (values.transport === "raw") return
  if (!renderer!.kittyImageTransportStatus)
    throw new Error("Selected core does not implement image transport selection")
  if (!values.terminal || renderer!.kittyImageTransportStatus.fileState !== "probing") return
  await new Promise<void>((resolve, reject) => {
    const finish = (expired = false) => {
      if (!expired && renderer!.kittyImageTransportStatus.fileState === "probing") return
      clearTimeout(timer)
      process.stdin.off("data", onData)
      if (renderer!.kittyImageTransportStatus.fileState === "probing")
        reject(new Error("File transport negotiation did not settle"))
      else resolve()
    }
    const onData = () => finish()
    const timer = setTimeout(() => finish(true), 6500)
    process.stdin.on("data", onData)
    finish()
  })
}

try {
  let terminalPid = Number(values["terminal-pid"])
  if (values["window-size"]) {
    if (!values.terminal || !values["window-class"])
      throw new Error("Window sizing is only supported through the terminal matrix runner")
    const window = await sizeBenchmarkWindow(values["window-class"], values["window-size"])
    result.window = window
    terminalPid = window.pid
  }
  renderer = values.terminal
    ? await core.createCliRenderer({
        targetFps: 1000,
        maxFps: 1000,
        consoleMode: "disabled",
        exitOnCtrlC: false,
        exitSignals: [],
        useKittyKeyboard: { events: true },
        kittyImageTransport: values.transport as KittyImageTransport,
      })
    : (
        await (
          await import(pathToFileURL(join(root, "packages/core/src/testing.ts")).href)
        ).createTestRenderer({
          width: 100,
          height: 32,
          targetFps: 1000,
          maxFps: 1000,
          stdout: sink as unknown as NodeJS.WriteStream,
          bufferedOutput: "stdout",
          kittyImageTransport: values.transport as KittyImageTransport,
          exitSignals: [],
        })
      ).renderer
  renderer!.pause()
  await renderer!.idle()
  if (renderer!.width < 100 || renderer!.height < 32)
    throw new Error("Terminal must be at least 100 columns by 32 rows")
  renderer!.prependInputHandler((sequence) => {
    if (sequence.startsWith("\x1b_G") || sequence === "\x1b[0n") reply = (reply + sequence).slice(-16384)
    if (sequence === "\x1b[0n") {
      pendingReply?.()
      return true
    }
    return false
  })
  renderer!.keyInput.on("keypress", (key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) abort()
  })
  const hud = new core.TextRenderable(renderer!, {
    height: 2,
    width: 100,
    content: `MAGICK / ${values.import} / ${width}x${height}\nQ quits | Parser service times, not visible FPS`,
    fg: "#c7d8e2",
  })
  renderer!.root.add(hud)
  if (values.terminal) {
    await drain("\x1b_Ga=q,i=19700427,f=32,s=1,v=1;/////w==\x1b\\")
    if (!reply.includes(";OK")) throw new Error("No Kitty graphics query acknowledgement")
  }
  await negotiateTransport()
  result.transportAtStart = renderer!.kittyImageTransportStatus ?? { requested: "raw", effective: "raw" }
  gpu = await createPixelRenderer(width, height, values.mapping as "view" | "pointer")
  if (values.import!.startsWith("pool")) pool = new Pool!({ width, height, capacity: 2 })
  if (values.import === "pooled-native" && !pool?.publishPixels)
    throw new Error("Selected core does not implement NativeImagePool.publishPixels")
  result.adapter = gpu.adapter
  result.scene = arena.counts
  result.geometry = { columns: renderer!.width, rows: renderer!.height, resolution: renderer!.resolution }
  renderer!.setFrameCallback(async () => {
    if (!pendingDraw) return
    const draw = pendingDraw
    pendingDraw = undefined
    try {
      await draw()
    } catch (error) {
      drawError = error
    } finally {
      drawFinished = true
    }
  })
  let cpuStart = process.cpuUsage()
  let measuredStart = performance.now()
  let terminalStart = 0
  let fdsStart = 0
  let fdsPeak = 0
  let measuring = false
  let resized = false
  renderer!.on("resize", () => {
    if (measuring) resized = true
  })
  const clockTicks = Number(Bun.spawnSync(["getconf", "CLK_TCK"]).stdout.toString())
  let deadline = performance.now()
  for (let index = 0; index < warmup + frames; index++) {
    if (aborted) throw new Error("Benchmark interrupted")
    if (index === warmup) {
      measuring = true
      result.geometry = { columns: renderer!.width, rows: renderer!.height, resolution: renderer!.resolution }
      cpuStart = process.cpuUsage()
      if (terminalPid) terminalStart = await processTicks(terminalPid)
      measuredStart = performance.now()
      if (process.platform === "linux") fdsStart = fdsPeak = readdirSync("/proc/self/fd").length
    }
    const sample: Record<string, number> = {}
    const bytesBefore = outputBytes
    let start = 0
    pendingDraw = async () => {
      start = performance.now()
      arena.update(index / 60)
      sample.updateMs = performance.now() - start
      const output = await gpu!.draw(arena.scene, arena.camera, (mapped) => {
        let source: PixelFrame = mapped
        if (noise) {
          let seed = index + 1
          for (let i = 0; i < noise.length; i += 4) {
            seed ^= seed << 13
            seed ^= seed >>> 17
            seed ^= seed << 5
            noise[i] = seed & 255
            noise[i + 1] = (seed >>> 8) & 255
            noise[i + 2] = (seed >>> 16) & 255
            noise[i + 3] = 255
          }
          source = { ...mapped, data: noise, stride: width * 4 }
        }
        const preparing = performance.now()
        let image: NativeImage | null
        if (values.import === "pooled-native")
          image = pool!.publishPixels!(source.data, { stride: source.stride, format: source.format, alpha: "opaque" })
        else if (values.import === "native")
          image = Image.fromPixels!(source.data, width, height, {
            stride: source.stride,
            format: source.format,
            alpha: "opaque",
          })
        else {
          packRgba(source, rgba!)
          image = pool ? pool.publishRgba(rgba!) : core.NativeImage.fromRgba(rgba!, width, height)
        }
        if (!image) throw new Error("Image pool exhausted despite serialized presentation")
        sample.prepareMs = performance.now() - preparing
        return image
      })
      const { value: image, ...timing } = output
      Object.assign(sample, timing)
      try {
        if (index === 0) result.firstFrameSha256 = createHash("sha256").update(image.raw().data).digest("hex")
        if (values["validate-output"] && index === warmup + frames - 1) lastImage = image.retain()
        if (!renderer!.nextRenderBuffer.drawImage(image, 0, 2, 100, 30, width, height, 0, 0, width, height, "kitty"))
          throw new Error("Image placement rejected")
      } finally {
        image.dispose()
      }
    }
    await frame()
    if (resized) throw new Error("Terminal resized during measured frames")
    sample.submissionMs = performance.now() - start
    sample.drainMs = values.terminal ? await drain() : 0
    sample.totalMs = performance.now() - start
    if (sink) sample.bytes = outputBytes - bytesBefore
    sample.rss = process.memoryUsage.rss()
    if (process.platform === "linux" && index % 60 === 0)
      fdsPeak = Math.max(fdsPeak, readdirSync("/proc/self/fd").length)
    const native = renderer!.getStats()
    if (native.nativeRenderTime === undefined || native.nativeStdoutWriteTime === undefined)
      throw new Error("Missing native timing counters")
    sample.nativeRenderMs = native.nativeRenderTime / 1000
    sample.nativeWriteMs = native.nativeStdoutWriteTime / 1000
    const transport = renderer!.kittyImageTransportStatus
    sample.file = Number(transport?.effective === "file")
    sample.zlib = Number(transport?.effective === "zlib")
    sample.pendingFiles = transport?.pendingFiles ?? 0
    sample.pendingBytes = transport?.pendingBytes ?? 0
    if (index >= warmup) samples.push(sample)
    if (fps) {
      deadline = Math.max(deadline + 1000 / fps, performance.now())
      await Bun.sleep(Math.max(0, deadline - performance.now()))
    }
  }
  if (resized) throw new Error("Terminal resized during measured frames")
  const elapsed = (performance.now() - measuredStart) / 1000
  const cpu = process.cpuUsage(cpuStart)
  result.summary = Object.fromEntries(
    Object.keys(samples[0]).map((key) => [key, summarize(samples.map((sample) => sample[key]))]),
  )
  result.throughput = {
    seconds: elapsed,
    completedFramesPerSecond: frames / elapsed,
    clientCpuCores: (cpu.user + cpu.system) / elapsed / 1e6,
    terminalCpuCores: terminalPid ? ((await processTicks(terminalPid)) - terminalStart) / clockTicks / elapsed : null,
    over16ms: samples.filter((sample) => sample.totalMs > 1000 / 60).length,
  }
  result.capabilities = renderer!.capabilities
  result.transportAtEnd = renderer!.kittyImageTransportStatus ?? { requested: "raw", effective: "raw" }
  result.resources = {
    fdsStart,
    fdsPeak,
    fdsEnd: process.platform === "linux" ? readdirSync("/proc/self/fd").length : null,
  }
  if (lastImage) {
    result.validation = await validateOutput(renderer!, lastImage, async (command) => {
      await drain(command)
      return reply
    })
  }
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error)
  process.exitCode = 1
} finally {
  renderer?.pause()
  await renderer?.idle()
  renderer?.suspend()
  try {
    arena.dispose()
    lastImage?.dispose()
    pool?.dispose()
    gpu?.dispose()
  } finally {
    renderer?.destroy()
    sink?.destroy()
  }
  result.remainingNewFiles = existingFiles
    ? (imageFiles()?.filter((name) => !existingFiles.includes(name)) ?? null)
    : null
  process.off("SIGINT", abort)
  process.off("SIGTERM", abort)
  result.samples = samples
  const json = JSON.stringify(result, null, 2) + "\n"
  if (values.output) {
    await mkdir(dirname(resolve(values.output)), { recursive: true })
    await Bun.write(values.output, json)
  } else process.stdout.write(json)
}
