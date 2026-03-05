import { afterEach, beforeEach, expect, test } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"

let renderer: TestRenderer

beforeEach(async () => {
  ;({ renderer } = await createTestRenderer({}))
})

afterEach(() => {
  renderer.destroy()
})

test("requestRender clamps backwards clock jumps instead of scheduling multi-second stalls", async () => {
  const originalSetTimeout = globalThis.setTimeout
  const observedDelays: number[] = []

  globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: any[]) => {
    observedDelays.push(Number(delay ?? 0))
    return originalSetTimeout(handler, 0, ...args)
  }) as typeof setTimeout

  try {
    // Simulate a bad clock rollback. The renderer should clamp it instead of
    // scheduling a render more than a second in the future.
    // @ts-expect-error testing a private field
    renderer.lastTime = 1000
    // @ts-expect-error testing a private field
    renderer.now = () => 0

    renderer.requestRender()
    await renderer.idle()

    expect(observedDelays.length).toBeGreaterThan(0)
    expect(observedDelays[0]).toBeLessThanOrEqual(17)
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
})
