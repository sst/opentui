import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import { RendererControlState } from "../renderer"

let renderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer, renderOnce } = await createTestRenderer({}))
})

afterEach(() => {
  renderer.destroy()
})

test("idle() resolves immediately when renderer is already idle", async () => {
  expect(renderer.controlState).toBe(RendererControlState.IDLE)
  expect(renderer.isRunning).toBe(false)

  const start = Date.now()
  await renderer.idle()
  const elapsed = Date.now() - start

  expect(elapsed).toBeLessThan(50)
})

test("idle() waits for running renderer to stop", async () => {
  renderer.start()
  expect(renderer.isRunning).toBe(true)

  const idlePromise = renderer.idle()

  await new Promise((resolve) => setTimeout(resolve, 50))

  renderer.stop()

  await idlePromise

  expect(renderer.isRunning).toBe(false)
})

test("idle() waits for paused renderer after requestRender()", async () => {
  renderer.pause()
  expect(renderer.isRunning).toBe(false)

  renderer.requestRender()

  const idlePromise = renderer.idle()

  await idlePromise

  expect(renderer.isRunning).toBe(false)
})

test("idle() resolves immediately after requestRender() completes", async () => {
  renderer.requestRender()

  await renderer.idle()

  const start = Date.now()
  await renderer.idle()
  const elapsed = Date.now() - start

  expect(elapsed).toBeLessThan(50)
})

test("multiple idle() calls all resolve when renderer becomes idle", async () => {
  renderer.start()

  const idlePromise1 = renderer.idle()
  const idlePromise2 = renderer.idle()
  const idlePromise3 = renderer.idle()

  await new Promise((resolve) => setTimeout(resolve, 50))

  renderer.stop()

  await Promise.all([idlePromise1, idlePromise2, idlePromise3])

  expect(renderer.isRunning).toBe(false)
})

test("idle() resolves when AUTO_STARTED renderer drops all live requests", async () => {
  renderer.requestLive()
  expect(renderer.controlState).toBe(RendererControlState.AUTO_STARTED)
  expect(renderer.isRunning).toBe(true)

  const idlePromise = renderer.idle()

  renderer.dropLive()

  await idlePromise

  expect(renderer.controlState).toBe(RendererControlState.IDLE)
  expect(renderer.isRunning).toBe(false)
})

test("idle() resolves after explicit pause", async () => {
  renderer.start()
  expect(renderer.isRunning).toBe(true)

  const idlePromise = renderer.idle()

  renderer.pause()

  await idlePromise

  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_PAUSED)
  expect(renderer.isRunning).toBe(false)
})

test("idle() resolves immediately when called on paused renderer", async () => {
  renderer.start()
  renderer.pause()

  const start = Date.now()
  await renderer.idle()
  const elapsed = Date.now() - start

  expect(elapsed).toBeLessThan(50)
})

test("idle() resolves when renderer is destroyed", async () => {
  renderer.start()

  const idlePromise = renderer.idle()

  renderer.destroy()

  await idlePromise
})

test("idle() resolves immediately when called on destroyed renderer", async () => {
  renderer.destroy()

  const start = Date.now()
  await renderer.idle()
  const elapsed = Date.now() - start

  expect(elapsed).toBeLessThan(50)
})

test("idle() waits through multiple requestRender() calls", async () => {
  renderer.requestRender()
  renderer.requestRender()

  await renderer.idle()

  expect(renderer.isRunning).toBe(false)
})

test("idle() works correctly with stop() called during rendering", async () => {
  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 50))

  const idlePromise = renderer.idle()

  renderer.stop()

  await idlePromise

  expect(renderer.isRunning).toBe(false)
})

test("idle() resolves after pause() called during rendering", async () => {
  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 50))

  const idlePromise = renderer.idle()

  renderer.pause()

  await idlePromise

  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_PAUSED)
  expect(renderer.isRunning).toBe(false)
})

test("idle() can be used in a loop to wait between operations", async () => {
  const operations: string[] = []

  operations.push("start")
  renderer.requestRender()
  await renderer.idle()
  operations.push("rendered")

  renderer.requestRender()
  await renderer.idle()
  operations.push("rendered again")

  expect(operations).toEqual(["start", "rendered", "rendered again"])
})

test("idle() works with requestAnimationFrame", async () => {
  let frameCallbackExecuted = false

  requestAnimationFrame(() => {
    frameCallbackExecuted = true
  })

  await renderer.idle()

  expect(frameCallbackExecuted).toBe(true)
})

test("idle() waits for all animation frames to complete", async () => {
  let count = 0

  requestAnimationFrame(() => {
    count++
    requestAnimationFrame(() => {
      count++
    })
  })

  await renderer.idle()

  expect(count).toBe(2)
})
