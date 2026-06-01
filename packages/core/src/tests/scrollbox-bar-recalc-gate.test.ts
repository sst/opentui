import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing.js"
import { ScrollBoxRenderable } from "../renderables/ScrollBox.js"
import { TextRenderable } from "../renderables/Text.js"

let renderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer, renderOnce } = await createTestRenderer({ width: 80, height: 24 }))
})

afterEach(() => {
  renderer.destroy()
})

async function makeSettledScrollBox(stickyScroll: boolean): Promise<ScrollBoxRenderable> {
  const scrollBox = new ScrollBoxRenderable(renderer, {
    width: 40,
    height: 10,
    scrollY: true,
    stickyScroll,
    stickyStart: stickyScroll ? "bottom" : undefined,
  })
  for (let i = 0; i < 30; i++) {
    scrollBox.add(new TextRenderable(renderer, { content: `Line ${i}`, height: 1 }))
  }
  renderer.root.add(scrollBox)
  // Render until the deferred re-render settles so _lastBarRecalc* are recorded.
  await renderOnce()
  await renderOnce()
  return scrollBox
}

function spyRequestRender(scrollBox: ScrollBoxRenderable): () => number {
  let calls = 0
  const original = scrollBox.requestRender.bind(scrollBox)
  scrollBox.requestRender = () => {
    calls++
    return original()
  }
  return () => calls
}

const flushNextTick = () => new Promise<void>((resolve) => process.nextTick(resolve))

test("recalculateBarProps does not schedule a re-render when nothing changed", async () => {
  const scrollBox = await makeSettledScrollBox(true)
  const getCalls = spyRequestRender(scrollBox)

  // Same content + viewport as the settled state -> no deferred render.
  ;(scrollBox as unknown as { recalculateBarProps(): void }).recalculateBarProps()
  await flushNextTick()

  expect(getCalls()).toBe(0)
})

test("recalculateBarProps schedules a re-render when the viewport changed", async () => {
  const scrollBox = await makeSettledScrollBox(false)
  const getCalls = spyRequestRender(scrollBox)

  // Simulate a viewport dimension change since the last recalculation.
  ;(scrollBox as unknown as { _lastBarRecalcViewportHeight: number })._lastBarRecalcViewportHeight = -999
  ;(scrollBox as unknown as { recalculateBarProps(): void }).recalculateBarProps()
  await flushNextTick()

  expect(getCalls()).toBeGreaterThan(0)
})

test("recalculateBarProps schedules a re-render when sticky scroll content grew", async () => {
  const scrollBox = await makeSettledScrollBox(true)
  const getCalls = spyRequestRender(scrollBox)

  // Simulate content growth since the last recalculation under sticky scroll.
  ;(scrollBox as unknown as { _lastBarRecalcScrollHeight: number })._lastBarRecalcScrollHeight = -1
  ;(scrollBox as unknown as { recalculateBarProps(): void }).recalculateBarProps()
  await flushNextTick()

  expect(getCalls()).toBeGreaterThan(0)
})
