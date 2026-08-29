import { afterEach, expect, test } from "bun:test"
import type { NativeSpanFeed } from "../NativeSpanFeed.js"
import { RGBA } from "../lib/RGBA.js"
import { CliRenderer, CliRenderEvents, type CliRendererConfig } from "../renderer.js"
import { ManualClock } from "../testing/manual-clock.js"
import { createTestStdin, TestWriteStream } from "../testing/test-streams.js"
import { resolveRenderLib } from "../zig.js"

class HeldWriteStream extends TestWriteStream {
  held = true
  releaseWrite: (() => void) | undefined
  writes: Buffer[] = []

  override _write(chunk: Uint8Array, _encoding: BufferEncoding, callback: () => void): void {
    const finish = () => {
      this.writes.push(Buffer.from(chunk))
      callback()
    }
    if (this.held) this.releaseWrite = finish
    else finish()
  }

  releaseOne(): void {
    const release = this.releaseWrite
    this.releaseWrite = undefined
    release?.()
  }

  releaseAll(): void {
    this.held = false
    this.releaseOne()
  }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function createAdmissionRenderer(width = 80, height = 24, config: CliRendererConfig = {}) {
  const clock = new ManualClock()
  const stdout = new HeldWriteStream(width, height)
  const renderer = new CliRenderer(createTestStdin(), stdout as unknown as NodeJS.WriteStream, width, height, {
    clock,
    consoleMode: "disabled",
    ...config,
  })
  const internals = renderer as unknown as { _feed: NativeSpanFeed; loop: () => Promise<void> }
  const feed = internals._feed
  cleanups.push(async () => {
    renderer.destroy()
    stdout.releaseAll()
    await feed.idle()
  })
  return { renderer, stdout, clock, feed, internals }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

test("frame admission bounds delayed output to one frame and coalesces callback work", async () => {
  const { renderer, stdout, clock, feed } = createAdmissionRenderer(1024, 256)
  const lib = resolveRenderLib()
  const observed: string[] = []
  const deltas: number[] = []
  let state = "A"
  let frames = 0
  renderer.on(CliRenderEvents.FRAME, () => frames++)
  renderer.setFrameCallback(async (delta) => {
    observed.push(state)
    deltas.push(delta)
  })
  const fg = RGBA.fromInts(255, 255, 255)
  const bg = RGBA.fromInts(0, 0, 0)
  renderer.addPostProcessFn((buffer) => {
    const row = state.repeat(renderer.width)
    for (let y = 0; y < renderer.height; y++) buffer.drawText(row, 0, y, fg, bg)
  })

  renderer.start()
  await settle()
  const frameBytes = stdout.writableLength
  const chunks = lib.streamGetStats(feed.streamPtr)!.chunks
  expect(frameBytes).toBeGreaterThan(256 * 1024)
  expect(lib.streamGetStats(feed.streamPtr)!.pendingSpans).toBe(0)
  expect(feed.isBackpressured()).toBe(true)

  let peakBytes = frameBytes
  for (let attempt = 0; attempt < 32; attempt++) {
    state = attempt % 2 === 0 ? "B" : "D"
    renderer.requestRender()
    clock.advance(100)
    await settle()
    peakBytes = Math.max(peakBytes, stdout.writableLength)
  }

  expect({ callbacks: observed.length, frames, peakBytes }).toEqual({ callbacks: 1, frames: 1, peakBytes: frameBytes })
  expect(lib.streamGetStats(feed.streamPtr)!.chunks).toBe(chunks)
  expect(renderer.frameId).toBe(1)
  expect(new TextDecoder().decode(renderer.currentRenderBuffer.getRealCharBytes()).startsWith("AAAA")).toBe(true)

  stdout.releaseOne()
  await settle()
  clock.advance(100)
  await settle()
  expect(observed).toEqual(["A"])
  expect(feed.isBackpressured()).toBe(true)

  state = "C"
  stdout.releaseAll()
  await feed.idle()
  clock.advance(0)
  await settle()
  renderer.pause()
  await feed.idle()

  expect(observed).toEqual(["A", "C"])
  expect(deltas).toEqual([0, 3300])
  expect(frames).toBe(2)
  expect(new TextDecoder().decode(renderer.currentRenderBuffer.getRealCharBytes()).startsWith("CCCC")).toBe(true)
  const output = Buffer.concat(stdout.writes).toString()
  expect(output).toContain("A".repeat(1024))
  expect(output).toContain("C".repeat(1024))
  expect(output).not.toContain("B".repeat(1024))
})

for (const control of ["pause", "stop", "suspend", "destroy"] as const) {
  test(`${control} cancels callback work waiting for delayed output`, async () => {
    const { renderer, stdout, clock, feed, internals } = createAdmissionRenderer()
    let callbacks = 0
    renderer.setFrameCallback(async () => {
      callbacks++
    })
    renderer.setTerminalTitle("held-control")
    await internals.loop()
    renderer[control]()
    let idleResolved = false
    void renderer.idle().then(() => {
      idleResolved = true
    })
    await settle()
    expect(idleResolved).toBe(true)
    expect(feed.isBackpressured()).toBe(true)
    stdout.releaseAll()
    await feed.idle()
    clock.advance(100)
    await settle()

    expect(callbacks).toBe(0)
    await renderer.idle()
    if (control !== "destroy") {
      if (control === "suspend") renderer.resume()
      else renderer.requestRender()
      await feed.idle()
      await settle()
      clock.advance(100)
      await settle()
      expect(callbacks).toBe(1)
    }
  })
}

test("destroy retains committed frame and shutdown bytes while admission is blocked", async () => {
  const { renderer, stdout, feed, internals } = createAdmissionRenderer()
  stdout.held = false
  await renderer.setupTerminal()
  await feed.idle()
  stdout.writes.length = 0
  stdout.held = true

  renderer.addPostProcessFn((buffer) => buffer.drawText("committed-before-destroy", 0, 0, RGBA.fromInts(255, 255, 255)))
  await internals.loop()
  let callbacks = 0
  renderer.setFrameCallback(async () => {
    callbacks++
  })
  renderer.intermediateRender()
  renderer.setTerminalTitle("control-during-backpressure")
  renderer.destroy()
  await renderer.idle()
  expect(callbacks).toBe(0)
  expect(feed.isBackpressured()).toBe(true)

  stdout.releaseAll()
  await feed.idle()
  const output = Buffer.concat(stdout.writes).toString()
  expect(output).toContain("committed-before-destroy")
  expect(output).toContain("control-during-backpressure")
  expect(output).toContain("\x1b[?25h")
  expect(output.indexOf("committed-before-destroy")).toBeLessThan(output.indexOf("control-during-backpressure"))
  expect(output.indexOf("control-during-backpressure")).toBeLessThan(output.lastIndexOf("\x1b[?25h"))
})

test("animation requests wait for output credit and remain cancellable", async () => {
  const { renderer, stdout, clock, feed } = createAdmissionRenderer()
  const observed: string[] = []
  renderer.setTerminalTitle("held-animation")
  const cancelled = requestAnimationFrame(() => observed.push("cancelled"))
  const resumed = requestAnimationFrame(() => observed.push("resumed"))
  cancelAnimationFrame(cancelled)
  cancelAnimationFrame(cancelled)
  clock.advance(100)
  await settle()
  expect(observed).toEqual([])

  stdout.releaseAll()
  await feed.idle()
  clock.advance(0)
  await settle()
  expect(renderer.liveRequestCount).toBe(0)
  expect(renderer.isRunning).toBe(false)
  await renderer.idle()
  expect(observed).toEqual(["resumed"])

  renderer.requestLive()
  cancelAnimationFrame(resumed)
  expect(renderer.liveRequestCount).toBe(1)
  renderer.dropLive()
})

for (const [setup, transition] of [
  [false, "destroy"],
  [true, "destroy"],
  [true, "suspend"],
  [true, "passthrough"],
] as const) {
  test(`${transition} preserves captured stdout at feed high water with setup=${setup}`, async () => {
    const { renderer, stdout, clock, feed, internals } = createAdmissionRenderer(80, 24, {
      screenMode: "split-footer",
    })
    if (setup) {
      stdout.held = false
      await renderer.setupTerminal()
      renderer.stdin.emit("data", Buffer.from("\x1b[12;1R"))
      clock.advance(200)
      await settle()
      await feed.idle()
      stdout.writes.length = 0
      stdout.held = true
    }

    for (let i = 0; i < 4096; i++) renderer.setTerminalTitle(`pinned-${i}`)
    expect(resolveRenderLib().streamGetStats(feed.streamPtr)!.pendingSpans).toBe(0)
    expect(feed.isBackpressured()).toBe(true)
    stdout.write("captured-before-transition\n")
    let callbacks = 0
    renderer.setFrameCallback(async () => {
      callbacks++
    })
    await internals.loop()
    expect(callbacks).toBe(0)

    if (transition === "passthrough") {
      renderer.externalOutputMode = "passthrough"
      stdout.write("after-transition\n")
    } else {
      renderer[transition]()
    }
    stdout.releaseAll()
    await feed.idle()
    const output = Buffer.concat(stdout.writes).toString()
    expect(output.includes("captured-before-transition")).toBe(true)
    expect(output.includes("[snapshot ")).toBe(false)
    expect(output.indexOf("pinned-4095")).toBeLessThan(output.indexOf("captured-before-transition"))
    if (transition === "passthrough") {
      expect(output.indexOf("captured-before-transition")).toBeLessThan(output.indexOf("after-transition"))
    } else {
      expect(output.indexOf("captured-before-transition")).toBeLessThan(output.lastIndexOf("\x1b[?25h"))
    }
  })
}

test("a cancelled admission continuation cannot clear a newer wait", async () => {
  const { renderer, stdout, clock, feed } = createAdmissionRenderer()
  const originalIdle = feed.idle.bind(feed)
  let releaseOldContinuation = () => {}
  const oldContinuation = new Promise<void>((resolve) => {
    releaseOldContinuation = resolve
  })
  let waits = 0
  // Delay only the scheduler continuation, never the feed's real byte ownership.
  feed.idle = () => (waits++ === 0 ? originalIdle().then(() => oldContinuation) : originalIdle())
  let callbacks = 0
  renderer.setFrameCallback(async () => {
    callbacks++
  })
  renderer.setTerminalTitle("old-write")
  renderer.start()
  renderer.pause()
  stdout.releaseAll()
  await originalIdle()

  stdout.held = true
  renderer.setTerminalTitle("new-write")
  renderer.requestRender()
  clock.advance(100)
  await settle()
  expect(waits).toBe(1)
  releaseOldContinuation()
  await settle()
  expect(waits).toBe(2)
  expect(renderer.getSchedulerState().hasScheduledRender).toBe(false)
  let idleResolved = false
  void renderer.idle().then(() => {
    idleResolved = true
  })
  await settle()
  expect(idleResolved).toBe(false)
  expect(callbacks).toBe(0)
  expect(feed.isBackpressured()).toBe(true)

  stdout.releaseAll()
  await originalIdle()
  clock.advance(100)
  await settle()
  expect(callbacks).toBe(1)
  expect(idleResolved).toBe(true)
  feed.idle = originalIdle
})

for (const control of ["pause", "stop"] as const) {
  test(`repeated ${control} bounds admission subscriptions and preserves new requests`, async () => {
    const { renderer, stdout, clock, feed } = createAdmissionRenderer()
    const feedInternals = feed as unknown as { idleResolvers: Array<() => void> }
    let callbacks = 0
    renderer.setFrameCallback(async () => {
      callbacks++
    })
    renderer.setTerminalTitle("held-before-pause")
    const heldBytes = stdout.writableLength
    let cancelledIdleCount = 0
    for (let cycle = 0; cycle < 100; cycle++) {
      renderer.start()
      renderer[control]()
      void renderer.idle().then(() => cancelledIdleCount++)
    }
    await settle()
    expect(cancelledIdleCount).toBe(100)
    expect(feedInternals.idleResolvers.length).toBe(1)
    expect(stdout.writableLength).toBe(heldBytes)

    renderer.requestRender()
    clock.advance(100)
    await settle()
    expect(callbacks).toBe(0)
    expect(feed.isBackpressured()).toBe(true)
    expect(feedInternals.idleResolvers.length).toBe(1)
    let idleResolved = false
    void renderer.idle().then(() => {
      idleResolved = true
    })
    await settle()
    expect(idleResolved).toBe(false)

    stdout.releaseAll()
    await feed.idle()
    clock.advance(100)
    await settle()
    expect(callbacks).toBe(1)
    expect(renderer.isRunning).toBe(false)
    expect(idleResolved).toBe(true)
    expect(Buffer.concat(stdout.writes).toString()).toContain("held-before-pause")
  })
}
