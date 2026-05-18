import { afterEach, expect, test } from "bun:test"
import { TextRenderable } from "../renderables/Text.js"
import { ManualClock } from "./manual-clock.js"
import { createTestRenderer, type TestRendererSetup } from "./test-renderer.js"

let setup: TestRendererSetup | null = null

async function drainImmediateWork(): Promise<void> {
  await Promise.resolve()
  await new Promise<void>((resolve) => process.nextTick(resolve))
  await Promise.resolve()
}

afterEach(() => {
  setup?.renderer.destroy()
  setup = null
})

test("flush waits for scheduled render work without forcing an extra frame", async () => {
  setup = await createTestRenderer({ width: 10, height: 4, useThread: false, maxFps: Number.POSITIVE_INFINITY })

  const text = new TextRenderable(setup.renderer, {
    content: "abc",
    width: 3,
    height: 1,
  })
  setup.renderer.root.add(text)

  await setup.flush({ maxPasses: 1 })

  const renderedStats = setup.getNativeStats()
  expect(renderedStats.nativeFrameCount).toBe(1)
  expect(renderedStats.cellsUpdated).toBeGreaterThanOrEqual(3)

  await setup.flush()

  expect(setup.getNativeStats().nativeFrameCount).toBe(1)
})

test("waitForFrame observes text from a scheduled render", async () => {
  setup = await createTestRenderer({ width: 10, height: 4, useThread: false, maxFps: Number.POSITIVE_INFINITY })

  const text = new TextRenderable(setup.renderer, {
    content: "hello",
    width: 5,
    height: 1,
  })
  setup.renderer.root.add(text)

  const frame = await setup.waitForFrame((value) => value.includes("hello"), { maxPasses: 1 })

  expect(frame).toContain("hello")
  expect(setup.getNativeStats().nativeFrameCount).toBe(1)
})

test("waitFor observes predicate changes after scheduled work", async () => {
  setup = await createTestRenderer({ width: 10, height: 4, useThread: false, maxFps: Number.POSITIVE_INFINITY })

  const text = new TextRenderable(setup.renderer, {
    content: "ready",
    width: 5,
    height: 1,
  })
  setup.renderer.root.add(text)

  await setup.waitFor(() => setup!.getNativeStats().nativeFrameCount > 0, { maxPasses: 1 })

  expect(setup.getNativeStats().nativeFrameCount).toBe(1)
})

test("waitForFrame fails instead of rendering when no work is pending", async () => {
  setup = await createTestRenderer({ width: 10, height: 4, useThread: false, maxFps: Number.POSITIVE_INFINITY })

  await expect(setup.waitForFrame((frame) => frame.includes("missing"), { maxPasses: 2 })).rejects.toThrow(
    "hasScheduledRender: false",
  )

  expect(setup.getNativeStats().nativeFrameCount).toBe(0)
})

test("waitForVisualIdle observes a naturally emitted zero-cell live frame", async () => {
  const clock = new ManualClock()
  setup = await createTestRenderer({
    width: 10,
    height: 4,
    useThread: false,
    clock,
    maxFps: Number.POSITIVE_INFINITY,
    targetFps: Number.POSITIVE_INFINITY,
  })

  const text = new TextRenderable(setup.renderer, {
    content: "live",
    width: 4,
    height: 1,
  })
  setup.renderer.root.add(text)
  setup.renderer.start()

  await drainImmediateWork()
  expect(setup.getNativeStats().nativeFrameCount).toBe(1)

  const idle = setup.waitForVisualIdle({ maxFrames: 2 })
  await drainImmediateWork()
  clock.advance(1)
  await idle

  const stats = setup.getNativeStats()
  expect(stats.nativeFrameCount).toBe(2)
  expect(stats.cellsUpdated).toBe(0)

  setup.renderer.stop()
})
