import { afterEach, beforeEach, expect, test } from "bun:test"
import { SystemClock } from "../lib/clock.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { ManualClock } from "../testing/manual-clock.js"

let clock: ManualClock
let renderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  clock = new ManualClock()
  ;({ renderer, renderOnce } = await createTestRenderer({ clock, maxFps: 60 }))
})

afterEach(() => {
  renderer.destroy()
})

test("requestRender() does not stall after a backward clock jump", async () => {
  clock.setTime(10_000)
  // @ts-expect-error - inspect private renderer timing state in regression test
  renderer.lastTime = 10_000
  clock.setTime(8_000)

  let renderCalled = false
  // @ts-expect-error - intercept private render method in regression test
  renderer.renderNative = () => {
    renderCalled = true
  }

  renderer.requestRender()
  clock.advance(20)
  await Promise.resolve()

  expect(renderCalled).toBe(true)
})

test("requestRender() uses SystemClock by default when no clock is injected", async () => {
  const originalNow = globalThis.performance.now
  let nowValue = 10_000
  let defaultRenderer: TestRenderer | null = null

  globalThis.performance.now = () => nowValue

  try {
    ;({ renderer: defaultRenderer } = await createTestRenderer({ maxFps: 60 }))

    // @ts-expect-error - inspect private renderer clock in regression test
    expect(defaultRenderer.clock).toBeInstanceOf(SystemClock)

    // @ts-expect-error - inspect private renderer timing state in regression test
    defaultRenderer.lastTime = 10_000
    nowValue = 8_000

    let renderCalled = false
    // @ts-expect-error - intercept private render method in regression test
    defaultRenderer.renderNative = () => {
      renderCalled = true
    }

    defaultRenderer.requestRender()
    await Bun.sleep(20)

    expect(renderCalled).toBe(true)
  } finally {
    defaultRenderer?.destroy()
    globalThis.performance.now = originalNow
  }
})

test("loop() clamps negative deltaTime after a backward clock jump", async () => {
  const deltas: number[] = []

  renderer.setFrameCallback(async (deltaTime) => {
    deltas.push(deltaTime)
  })

  clock.setTime(10_000)
  // @ts-expect-error - inspect private renderer timing state in regression test
  renderer.lastTime = 10_000
  // @ts-expect-error - inspect private renderer timing state in regression test
  renderer.lastFpsTime = 10_000
  clock.setTime(8_000)

  await renderOnce()

  expect(deltas).toEqual([0])
})
