import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import * as core from "@opentui/core"
import { CliRenderEvents, ImageRenderable, TextRenderable } from "@opentui/core"
import { createTestRenderer, ManualClock, type TestRendererSetup } from "@opentui/core/testing"
import type { Camera, Scene } from "three"
import { setupCommonDemoKeys } from "../lib/standalone-keys.js"
import * as arenaModule from "./arena.js"
import { destroy, run, runStandalone } from "./demo.js"
import * as pixelRendererModule from "./pixel-renderer.js"

test("the example browser can import Magick without starting a terminal or parsing its arguments", async () => {
  const path = fileURLToPath(new URL("./demo.ts", import.meta.url))
  const child = Bun.spawn(
    [
      "bun",
      "-e",
      `process.argv = ["bun", "examples", "--not-a-demo-option"]; const demo = await import(${JSON.stringify(path)}); if (typeof demo.run !== "function" || typeof demo.destroy !== "function") throw new Error("Missing example lifecycle");`,
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  )
  const [exitCode, error] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(error).toBe("")
  expect(exitCode).toBe(0)
})

test.skipIf(process.env.GPU_TESTS !== "1")(
  "the real GPU session leaves the menu demand-driven between visits",
  async () => {
    const setup = await createTestRenderer({ width: 40, height: 12 })
    try {
      for (let visit = 0; visit < 2; visit++) {
        await run(setup.renderer, { width: 65, height: 33 })
        await setup.waitForFrame((frame) => frame.includes("Running"))
        await destroy(setup.renderer)
        setup.renderer.auto()
        await setup.renderOnce()
        expect(setup.renderer.isRunning).toBe(false)
      }
    } finally {
      setup.renderer.destroy()
      await destroy(setup.renderer)
      await new Promise<void>((resolve) => process.nextTick(resolve))
    }
  },
)

function createCpuGpu(width: number, height: number) {
  const data = new Uint8Array(width * height * 4).fill(255)
  let busy = false
  const gpu = {
    adapter: {
      __brand: "GPUAdapterInfo" as const,
      vendor: "CPU test",
      architecture: "",
      device: "",
      description: "",
      isFallbackAdapter: true,
    },
    ownership: () => ({
      encodersCreated: 0,
      encodersFinished: 0,
      encodersReleased: 0,
      passesCreated: 0,
      passesEnded: 0,
      passesReleased: 0,
      commandBuffersCreated: 0,
      commandBuffersSubmitted: 0,
      commandBuffersReleased: 0,
      canvasViewsCreated: 0,
      canvasViewsReleased: 0,
      pendingEncoders: 0,
      pendingPasses: 0,
      pendingCommandBuffers: 0,
      cachedCanvasViews: 0,
    }),
    draws: 0,
    setAnimationActive: mock((_active: boolean) => {}),
    readback: undefined as Promise<void> | undefined,
    error: undefined as Error | undefined,
    async draw<T>(_scene: Scene, _camera: Camera, consume: (frame: pixelRendererModule.PixelFrame) => T) {
      if (busy || gpu.dispose.mock.calls.length) throw new Error("GPU is busy or disposed")
      busy = true
      gpu.draws++
      try {
        if (gpu.readback) await gpu.readback
        if (gpu.error) throw gpu.error
        return consume({ data, width, height, stride: width * 4, format: "rgba8" })
      } finally {
        busy = false
      }
    },
    dispose: mock(() => {
      if (busy) throw new Error("Cannot dispose a pending readback")
    }),
  }
  return gpu
}

function observeArena() {
  const states: { time: number; player: { x: number; z: number } }[] = []
  const createArena = arenaModule.createArena
  spyOn(arenaModule, "createArena").mockImplementation((aspect) => {
    const arena = createArena(aspect)
    const update = arena.update
    arena.update = (time, player) => {
      states.push({ time, player: { ...player! } })
      update(time, player)
    }
    return arena
  })
  return states
}

describe("Magick example lifecycle", () => {
  let setup: TestRendererSetup
  let clock: ManualClock
  let gpus: ReturnType<typeof createCpuGpu>[]
  let factory: ReturnType<typeof spyOn<typeof pixelRendererModule, "createPixelRenderer">>

  beforeEach(async () => {
    clock = new ManualClock()
    setup = await createTestRenderer({
      width: 100,
      height: 30,
      clock,
      kittyKeyboard: true,
      targetFps: 24,
      maxFps: 48,
      exitOnCtrlC: false,
      exitSignals: [],
    })
    setupCommonDemoKeys(setup.renderer)
    gpus = []
    factory = spyOn(pixelRendererModule, "createPixelRenderer").mockImplementation(async (width, height) => {
      const gpu = createCpuGpu(width, height)
      gpus.push(gpu)
      return gpu
    })
  })

  afterEach(async () => {
    try {
      await destroy(setup.renderer)
    } finally {
      setup.renderer.destroy()
      await destroy(setup.renderer)
      await new Promise<void>((resolve) => process.nextTick(resolve))
      mock.restore()
    }
  })

  async function start() {
    const rendered = once(setup.renderer, "frame")
    await run(setup.renderer, { width: 16, height: 8 })
    await rendered
  }

  async function frame() {
    const rendered = once(setup.renderer, "frame")
    clock.advance(20)
    await rendered
  }

  test("host diagnostics and modified WASD shortcuts do not move the player", async () => {
    const states = observeArena()
    const { renderer, mockInput } = setup
    const log = spyOn(console, "log").mockImplementation(() => {})
    const dump = spyOn(renderer, "dumpHitGrid").mockImplementation(() => {})
    const auto = spyOn(renderer, "auto")
    await start()

    mockInput.pressKey("g", { ctrl: true })
    expect(dump).toHaveBeenCalledTimes(1)
    mockInput.pressKey("a", { ctrl: true })
    expect(log).toHaveBeenCalledWith("arena allocated bytes:", expect.stringContaining("MB"))
    await frame()
    expect(states.at(-1)!.player).toEqual({ x: -3, z: -3 })

    mockInput.pressKey("a", { shift: true })
    expect(auto).toHaveBeenCalledTimes(1)
    await frame()
    expect(states.at(-1)!.player).toEqual({ x: -3, z: -3 })

    mockInput.pressKey("s", { shift: true })
    expect(renderer.isRunning).toBe(false)
    const resumed = once(renderer, "frame")
    mockInput.pressKey("l", { shift: true })
    await resumed
    await frame()
    expect(states.at(-1)!.player).toEqual({ x: -3, z: -3 })

    mockInput.pressKey("a")
    await frame()
    expect(states.at(-1)!.player.x).toBeLessThan(-3)
    expect(states.at(-1)!.player.z).toBeGreaterThan(-3)
  })

  test("Space pauses GPU work without disabling stats, console, diagnostics, or reset", async () => {
    const states = observeArena()
    const { renderer, mockInput } = setup
    const overlay = mock()
    renderer.on(CliRenderEvents.DEBUG_OVERLAY_TOGGLE, overlay)
    const log = spyOn(console, "log").mockImplementation(() => {})
    await start()
    const gpu = gpus[0]

    mockInput.pressKey("d")
    await frame()
    await frame()
    expect(states.at(-1)!.player.x).toBeGreaterThan(-3)
    mockInput.pressKey(" ")
    expect(renderer.isRunning).toBe(true)
    const pausedDraws = gpu.draws
    await frame()
    expect(setup.captureCharFrame()).toContain("Paused")
    expect(gpu.draws).toBe(pausedDraws)

    mockInput.pressKey(".")
    expect(overlay.mock.calls).toEqual([[true]])
    mockInput.pressKey(".")
    expect(overlay.mock.calls).toEqual([[true], [false]])
    mockInput.pressKey("`")
    expect(renderer.console.visible).toBe(true)
    mockInput.pressKey('"')
    expect(renderer.console.visible).toBe(false)
    mockInput.pressKey("c")
    expect(log).toHaveBeenCalledWith(
      "Magick diagnostics:",
      expect.objectContaining({ framebuffer: { width: 16, height: 8 }, adapter: gpu.adapter }),
    )
    expect(renderer.console.visible).toBe(true)
    mockInput.pressKey("`")
    await frame()
    expect(gpu.draws).toBe(pausedDraws)

    mockInput.pressKey("r")
    await frame()
    expect(gpu.draws).toBe(pausedDraws + 1)
    expect(states.at(-1)).toEqual({ time: 0, player: { x: -3, z: -3 } })
    await frame()
    expect(gpu.draws).toBe(pausedDraws + 1)
    mockInput.pressKey(" ")
    await frame()
    expect(gpu.draws).toBe(pausedDraws + 2)
    expect(states.at(-1)!.time).toBeGreaterThan(0)
    expect(states.at(-1)!.player).toEqual({ x: -3, z: -3 })
  })

  test("the native scene stays between visible status and help rows when resized", async () => {
    await start()
    const root = setup.renderer.root.getRenderable("magick")!
    const status = root.getRenderable("magick-status") as TextRenderable
    const scene = root.getRenderable("magick-scene") as ImageRenderable
    const help = root.getRenderable("magick-help") as TextRenderable

    for (const [width, height] of [
      [100, 30],
      [40, 12],
    ]) {
      setup.resize(width, height)
      await frame()
      expect([root.width, root.height]).toEqual([width, height])
      expect([status.x, status.y, status.width]).toEqual([0, 0, width])
      expect(status.height).toBeGreaterThan(0)
      expect([scene.x, scene.y, scene.width]).toEqual([0, status.height, width])
      expect(scene.height).toBeGreaterThan(0)
      expect(help.y).toBe(scene.y + scene.height)
      expect(help.y + help.height).toBe(height)
      expect(setup.captureCharFrame().replace(/\s+/g, " ")).toContain("Ctrl+C quit")
      expect(help.plainText).toContain("Esc back")
    }
    expect(scene.image!.raw().data).toEqual(new Uint8Array(16 * 8 * 4).fill(255))
    expect(scene.loadError).toBeNull()
  })

  test("a reset during pending readback survives the older frame while paused", async () => {
    const states = observeArena()
    await start()
    await frame()
    const readback = Promise.withResolvers<void>()
    gpus[0].readback = readback.promise
    setup.renderer.stop()
    const drawing = setup.renderOnce()
    try {
      setup.mockInput.pressKey(" ")
      setup.mockInput.pressKey("r")
    } finally {
      readback.resolve()
      await drawing
    }
    await setup.renderOnce()
    expect(states.at(-1)).toEqual({ time: 0, player: { x: -3, z: -3 } })
    expect(setup.captureCharFrame()).toContain("Paused")
  })

  test("run/destroy/run reuses the GPU and preserves the host tree, callbacks, listeners, and frame rates", async () => {
    const { renderer, mockInput } = setup
    const sentinel = new TextRenderable(renderer, { id: "host-sentinel", content: "Host survives" })
    renderer.root.add(sentinel)
    const hostFrame = mock(async () => {})
    const hostPostProcess = mock(() => {})
    const hostKey = mock()
    renderer.setFrameCallback(hostFrame)
    renderer.addPostProcessFn(hostPostProcess)
    renderer.keyInput.on("keypress", hostKey)
    const listeners = () => [
      ...["blur", "frame"].map((event) => renderer.listeners(event)),
      ...["keypress", "keyrelease"].map((event) => renderer.keyInput.listeners(event)),
    ]
    const before = listeners()
    const destroyListeners = renderer.listenerCount("destroy")

    for (let session = 0; session < 2; session++) {
      await start()
      const root = renderer.root.getRenderable("magick")!
      const gpu = gpus[0]
      const draws = gpu.draws
      await destroy(renderer)
      await destroy(renderer)
      expect(root.isDestroyed).toBe(true)
      expect(renderer.root.getRenderable("magick")).toBeUndefined()
      expect(renderer.root.getRenderable("host-sentinel")).toBe(sentinel)
      expect(renderer.isDestroyed).toBe(false)
      expect([renderer.targetFps, renderer.maxFps]).toEqual([24, 48])
      expect(listeners()).toEqual(before)
      expect(renderer.listenerCount("destroy")).toBe(destroyListeners + 1)
      expect(gpu.dispose).not.toHaveBeenCalled()
      expect(factory).toHaveBeenCalledTimes(1)

      hostFrame.mockClear()
      hostPostProcess.mockClear()
      hostKey.mockClear()
      mockInput.pressKey("w")
      renderer.stop()
      await setup.renderOnce()
      renderer.stop()
      expect(hostFrame).toHaveBeenCalledTimes(1)
      expect(hostPostProcess).toHaveBeenCalledTimes(1)
      expect(hostKey).toHaveBeenCalledTimes(1)
      expect(setup.captureCharFrame()).toContain("Host survives")
      expect(gpu.draws).toBe(draws)
    }
    renderer.destroy()
    await new Promise<void>((resolve) => process.nextTick(resolve))
    expect(gpus[0].dispose).toHaveBeenCalledTimes(1)
  })

  test("destroy waits for GPU initialization without starting or publishing a frame", async () => {
    const ready = Promise.withResolvers<void>()
    const gpu = createCpuGpu(16, 8)
    factory.mockImplementationOnce(async () => {
      await ready.promise
      return gpu
    })
    const { renderer } = setup
    const starting = run(renderer, { width: 16, height: 8 })
    const root = renderer.root.getRenderable("magick")!
    const scene = root.getRenderable("magick-scene") as ImageRenderable
    const loaded = mock()
    scene.onLoad = loaded
    let closed = false
    const closing = destroy(renderer).then(() => (closed = true))
    try {
      await new Promise<void>((resolve) => process.nextTick(resolve))
      expect(closed).toBe(false)
      expect(gpu.dispose).not.toHaveBeenCalled()
      expect(scene.image).toBeNull()
    } finally {
      ready.resolve()
      await Promise.all([starting, closing])
    }
    expect(gpu.draws).toBe(0)
    expect(loaded).not.toHaveBeenCalled()
    expect(gpu.dispose).not.toHaveBeenCalled()
    expect(root.isDestroyed).toBe(true)
    expect(renderer.isDestroyed).toBe(false)
    expect(renderer.isRunning).toBe(false)
    renderer.destroy()
    await new Promise<void>((resolve) => process.nextTick(resolve))
    expect(gpu.dispose).toHaveBeenCalledTimes(1)
  })

  test.each(["session", "renderer"])(
    "%s teardown waits for readback and does not replace the closing image",
    async (owner) => {
      await start()
      const { renderer } = setup
      const root = renderer.root.getRenderable("magick")!
      const scene = root.getRenderable("magick-scene") as ImageRenderable
      const source = scene.source
      const loaded = mock()
      scene.onLoad = loaded
      const readback = Promise.withResolvers<void>()
      const gpu = gpus[0]
      gpu.readback = readback.promise
      const draws = gpu.draws
      renderer.stop()
      const drawing = setup.renderOnce()
      if (owner === "renderer") renderer.destroy()
      let closed = false
      const closing = destroy(renderer).then(() => (closed = true))
      try {
        await new Promise<void>((resolve) => process.nextTick(resolve))
        expect(gpu.draws).toBe(draws + 1)
        expect(closed).toBe(false)
        expect(gpu.dispose).not.toHaveBeenCalled()
      } finally {
        readback.resolve()
        await Promise.all([drawing, closing])
      }
      expect(loaded).not.toHaveBeenCalled()
      expect(scene.source).toBe(source)
      expect(scene.isDestroyed).toBe(true)
      renderer.destroy()
      await new Promise<void>((resolve) => process.nextTick(resolve))
      expect(gpu.dispose).toHaveBeenCalledTimes(1)
    },
  )

  test("startup failure permits retry, and draw failure stops GPU work with diagnostics", async () => {
    const { renderer, mockInput } = setup
    const keyListeners = renderer.keyInput.listeners("keypress")
    factory.mockRejectedValueOnce(new Error("No test adapter"))
    await expect(run(renderer, { width: 16, height: 8 })).rejects.toThrow("No test adapter")
    expect(renderer.root.getRenderable("magick")).toBeUndefined()
    expect(renderer.keyInput.listeners("keypress")).toEqual(keyListeners)
    expect(renderer.isDestroyed).toBe(false)

    const error = spyOn(console, "error").mockImplementation(() => {})
    await start()
    const gpu = gpus[0]
    gpu.error = new Error("Readback failed")
    await frame()
    expect(renderer.isRunning).toBe(false)
    expect(renderer.console.visible).toBe(true)
    expect(error).toHaveBeenCalledWith("Magick rendering failed:", gpu.error)
    const draws = gpu.draws
    mockInput.pressKey("`")
    renderer.stop()
    await setup.renderOnce()
    renderer.stop()
    expect(setup.captureCharFrame()).toContain("Render failed")
    expect(gpu.draws).toBe(draws)
    await destroy(renderer)
    renderer.destroy()
    await new Promise<void>((resolve) => process.nextTick(resolve))
    expect(gpu.dispose).toHaveBeenCalledTimes(1)
  })

  test.each(["failure", "quit"])("standalone startup %s restores the terminal", async (mode) => {
    const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
    const ready = Promise.withResolvers<void>()
    const starting = Promise.withResolvers<void>()
    const gpu = createCpuGpu(16, 8)
    spyOn(core, "createCliRenderer").mockResolvedValue(setup.renderer)
    factory.mockImplementationOnce(async () => {
      starting.resolve()
      await ready.promise
      if (mode === "failure") throw new Error("No test adapter")
      return gpu
    })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
    const running = runStandalone(["--width=16", "--height=8"])
    try {
      await starting.promise
      if (mode === "quit") {
        setup.mockInput.pressEscape()
        expect(setup.renderer.isDestroyed).toBe(true)
        expect(gpu.dispose).not.toHaveBeenCalled()
      }
      ready.resolve()
      if (mode === "failure") await expect(running).rejects.toThrow("No test adapter")
      else await running
      expect(setup.renderer.isDestroyed).toBe(true)
    } finally {
      ready.resolve()
      await running.catch(() => {})
      if (tty) Object.defineProperty(process.stdout, "isTTY", tty)
      else Reflect.deleteProperty(process.stdout, "isTTY")
    }
  })
})
