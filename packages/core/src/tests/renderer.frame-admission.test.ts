import { afterEach, expect, test } from "bun:test"
import type { NativeSpanFeed } from "../NativeSpanFeed.js"
import { RGBA } from "../lib/RGBA.js"
import { CliRenderer, CliRenderEvents } from "../renderer.js"
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

function createAdmissionRenderer(width = 80, height = 24) {
  const clock = new ManualClock()
  const stdout = new HeldWriteStream(width, height)
  const renderer = new CliRenderer(createTestStdin(), stdout as unknown as NodeJS.WriteStream, width, height, {
    clock,
    consoleMode: "disabled",
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
  requestAnimationFrame(() => observed.push("resumed"))
  cancelAnimationFrame(cancelled)
  clock.advance(100)
  await settle()
  expect(observed).toEqual([])

  stdout.releaseAll()
  await feed.idle()
  clock.advance(0)
  await settle()
  renderer.pause()
  await renderer.idle()
  expect(observed).toEqual(["resumed"])
})

for (const control of ["pause", "stop"] as const) {
  test(`new one-shot requests after ${control} survive an existing admission wait`, async () => {
    const { renderer, stdout, clock, feed } = createAdmissionRenderer()
    let callbacks = 0
    renderer.setFrameCallback(async () => {
      callbacks++
    })
    renderer.setTerminalTitle("held-before-pause")
    renderer.start()
    renderer[control]()
    renderer.requestRender()
    stdout.releaseAll()
    await feed.idle()
    clock.advance(100)
    await settle()
    expect(callbacks).toBe(1)
    expect(renderer.isRunning).toBe(false)
  })
}
