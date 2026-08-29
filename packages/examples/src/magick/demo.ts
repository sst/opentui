import { parseArgs } from "node:util"
import {
  createCliRenderer,
  ImageRenderable,
  NativeImagePool,
  TextRenderable,
  type KittyImageTransport,
} from "@opentui/core"
import { createArena } from "./arena.js"
import { createPixelRenderer } from "./pixel-renderer.js"

const { values } = parseArgs({
  options: {
    width: { type: "string", default: "640" },
    height: { type: "string", default: "360" },
    transport: { type: "string", default: "raw" },
    seconds: { type: "string", default: "0" },
    report: { type: "string" },
  },
})
const width = Number(values.width),
  height = Number(values.height),
  seconds = Number(values.seconds)
if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0) || width * height > 3840 * 2160)
  throw new Error("Invalid framebuffer dimensions")
if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid --seconds")
if (!["raw", "zlib", "file"].includes(values.transport!)) throw new Error("--transport must be raw, zlib, or file")
if (!process.stdout.isTTY) throw new Error("Run this demo in a terminal")

const renderer = await createCliRenderer({
  targetFps: 60,
  maxFps: 60,
  consoleMode: "disabled",
  exitOnCtrlC: false,
  exitSignals: [],
  backgroundColor: "#111925",
  useKittyKeyboard: { events: true, allKeysAsEscapes: true },
  kittyImageTransport: values.transport as KittyImageTransport,
})
renderer.pause()
const arena = createArena(width / height)
const pool = new NativeImagePool({ width, height, capacity: 2 })
const hud = new TextRenderable(renderer, { width: "100%", height: 2, fg: "#c7d8e2" })
const view = new ImageRenderable(renderer, { width: "100%", flexGrow: 1, fit: "fit", protocol: "auto" })
renderer.root.add(hud)
renderer.root.add(view)
let gpu: Awaited<ReturnType<typeof createPixelRenderer>> | undefined
let ready = false
let closing = false
let closePromise: Promise<void> | undefined
let paused = false
let time = 0
let accumulator = 0
let submitted = 0
let dropped = 0
let timer: ReturnType<typeof setTimeout> | undefined
const held = new Map<string, number>()
const player = { x: -3, z: -3 }
const intervals: number[] = []
let lastFrame = performance.now()
renderer.on("frame", () => {
  const now = performance.now()
  if (ready && values.report && submitted > 60 && intervals.length < 100_000) intervals.push(now - lastFrame)
  lastFrame = now
})

function close(): Promise<void> {
  if (closePromise) return closePromise
  closing = true
  closePromise = (async () => {
    clearTimeout(timer)
    renderer.pause()
    await renderer.idle()
    const transport = renderer.kittyImageTransportStatus
    renderer.suspend()
    try {
      if (values.report)
        await Bun.write(
          values.report,
          JSON.stringify(
            {
              width,
              height,
              transport,
              submitted,
              dropped,
              intervals,
              note: "Native OpenTUI ImageRenderable with a two-slot pixel pool. Frame events are submissions, not presentation feedback.",
            },
            null,
            2,
          ) + "\n",
        )
    } finally {
      try {
        arena.dispose()
        gpu?.dispose()
        pool.dispose()
      } finally {
        renderer.destroy()
      }
      process.off("SIGINT", quit)
      process.off("SIGTERM", quit)
    }
  })()
  return closePromise
}

function quit() {
  if (!ready) {
    renderer.suspend()
    renderer.destroy()
    process.exit(0)
  }
  void close().catch((error) => {
    process.stderr.write(`${error}\n`)
    process.exitCode = 1
  })
}
process.once("SIGINT", quit)
process.once("SIGTERM", quit)
renderer.keyInput.on("keypress", (key) => {
  if (key.name === "q" || (key.ctrl && key.name === "c")) quit()
  if (key.name === "space" && !key.repeated) paused = !paused
  if (["w", "a", "s", "d"].includes(key.name))
    held.set(key.name, renderer.capabilities?.kitty_keyboard ? Infinity : performance.now() + 80)
})
renderer.keyInput.on("keyrelease", (key) => held.delete(key.name))
renderer.on("blur", () => held.clear())
renderer.setFrameCallback(async (deltaMs) => {
  if (!ready || closing) return
  try {
    for (const [key, expiry] of held) if (performance.now() >= expiry) held.delete(key)
    if (!paused) {
      accumulator = Math.min(accumulator + deltaMs / 1000, 5 / 60)
      while (accumulator >= 1 / 60) {
        const dx = Number(held.has("d")) - Number(held.has("a"))
        const dz = Number(held.has("s")) - Number(held.has("w"))
        const scale = 4 / 60 / Math.max(1, Math.hypot(dx, dz)) / Math.SQRT2
        player.x = Math.max(-8, Math.min(8, player.x + (dx + dz) * scale))
        player.z = Math.max(-8, Math.min(8, player.z + (dz - dx) * scale))
        time += 1 / 60
        accumulator -= 1 / 60
      }
    }
    arena.update(time, player)
    const { value: image } = await gpu!.draw(arena.scene, arena.camera, (frame) =>
      pool.publishPixels(frame.data, {
        stride: frame.stride,
        format: frame.format,
        alpha: "opaque",
      }),
    )
    if (image) {
      try {
        view.source = image
        await view.loadPromise
        submitted++
      } finally {
        image.dispose()
      }
    } else dropped++
    const status = renderer.kittyImageTransportStatus
    hud.content = `MAGICK / ${width}x${height} / ${status.effective} / two reusable frames\nWASD move | Space pause | Q quit${renderer.capabilities?.kitty_keyboard ? "" : " | legacy key pulses"}`
  } catch (error) {
    process.stderr.write(`${error}\n`)
    process.exitCode = 1
    quit()
  }
})
try {
  gpu = await createPixelRenderer(width, height)
  ready = true
  if (seconds) timer = setTimeout(quit, seconds * 1000)
  renderer.start()
} catch (error) {
  await close()
  throw error
}
