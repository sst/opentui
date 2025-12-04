import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockInput, type MockMouse } from "../testing/test-renderer"
import { RendererControlState } from "../renderer"
import { Renderable } from "../Renderable"

class TestRenderable extends Renderable {
  constructor(renderer: TestRenderer, options: any) {
    super(renderer, options)
  }
}

let renderer: TestRenderer
let mockInput: MockInput
let mockMouse: MockMouse
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer, mockInput, mockMouse, renderOnce } = await createTestRenderer({}))
})

afterEach(() => {
  renderer.destroy()
})

test("initial renderer state is IDLE", () => {
  expect(renderer.controlState).toBe(RendererControlState.IDLE)
  expect(renderer.isRunning).toBe(false)
})

test("start() transitions to EXPLICIT_STARTED and starts rendering", () => {
  renderer.start()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)
  expect(renderer.isRunning).toBe(true)
})

test("pause() transitions to EXPLICIT_PAUSED and stops rendering", () => {
  renderer.start()
  expect(renderer.isRunning).toBe(true)

  renderer.pause()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_PAUSED)
  expect(renderer.isRunning).toBe(false)
})

test("suspend() transitions to EXPLICIT_SUSPENDED and stops rendering", () => {
  renderer.start()
  expect(renderer.isRunning).toBe(true)

  renderer.suspend()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_SUSPENDED)
  expect(renderer.isRunning).toBe(false)
})

test("suspend() disables mouse and keyboard input", () => {
  renderer.start()
  expect(renderer.useMouse).toBe(true)

  renderer.suspend()
  expect(renderer.useMouse).toBe(false)
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_SUSPENDED)
})

test("resume() restores previous EXPLICIT_STARTED state and restarts rendering", () => {
  renderer.start()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)
  expect(renderer.isRunning).toBe(true)

  renderer.suspend()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_SUSPENDED)
  expect(renderer.isRunning).toBe(false)

  renderer.resume()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)
  expect(renderer.isRunning).toBe(true)
})

test("resume() restores previous IDLE state without starting rendering", () => {
  expect(renderer.controlState).toBe(RendererControlState.IDLE)
  expect(renderer.isRunning).toBe(false)

  renderer.suspend()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_SUSPENDED)
  expect(renderer.isRunning).toBe(false)

  renderer.resume()
  expect(renderer.controlState).toBe(RendererControlState.IDLE)
  expect(renderer.isRunning).toBe(false)
})

test("resume() restores previous EXPLICIT_PAUSED state without starting rendering", () => {
  renderer.start()
  renderer.pause()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_PAUSED)
  expect(renderer.isRunning).toBe(false)

  renderer.suspend()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_SUSPENDED)
  expect(renderer.isRunning).toBe(false)

  renderer.resume()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_PAUSED)
  expect(renderer.isRunning).toBe(false)
})

test("resume() restores previous AUTO_STARTED state and restarts rendering", () => {
  renderer.requestLive()
  expect(renderer.controlState).toBe(RendererControlState.AUTO_STARTED)
  expect(renderer.isRunning).toBe(true)

  renderer.suspend()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_SUSPENDED)
  expect(renderer.isRunning).toBe(false)

  renderer.resume()
  expect(renderer.controlState).toBe(RendererControlState.AUTO_STARTED)
  expect(renderer.isRunning).toBe(true)
})

test("stop() transitions to EXPLICIT_STOPPED and stops rendering", () => {
  renderer.start()
  expect(renderer.isRunning).toBe(true)

  renderer.stop()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STOPPED)
  expect(renderer.isRunning).toBe(false)
})

test("requestRender() does not trigger when renderer is suspended", async () => {
  renderer.start()
  renderer.suspend()

  let renderCalled = false
  // @ts-expect-error - renderNative is private
  const originalRender = renderer.renderNative.bind(renderer)
  // @ts-expect-error - renderNative is private
  renderer.renderNative = () => {
    renderCalled = true
    return originalRender()
  }

  renderer.requestRender()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(renderCalled).toBe(false)

  // @ts-expect-error - renderNative is private
  renderer.renderNative = originalRender
})

test("requestRender() does trigger when renderer is paused", async () => {
  renderer.start()
  await Bun.sleep(20)
  renderer.pause()

  let renderCalled = false
  // @ts-expect-error - renderNative is private
  const originalRender = renderer.renderNative.bind(renderer)
  // @ts-expect-error - renderNative is private
  renderer.renderNative = () => {
    renderCalled = true
    return originalRender()
  }

  renderer.requestRender()
  await Bun.sleep(20)

  expect(renderCalled).toBe(true)

  // @ts-expect-error - renderNative is private
  renderer.renderNative = originalRender
})

test("auto() transitions running renderer to AUTO_STARTED state", () => {
  renderer.start()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)

  renderer.auto()
  expect(renderer.controlState).toBe(RendererControlState.AUTO_STARTED)
  expect(renderer.isRunning).toBe(true)
})

test("requestLive() auto-starts idle renderer", () => {
  expect(renderer.controlState).toBe(RendererControlState.IDLE)
  expect(renderer.isRunning).toBe(false)

  renderer.requestLive()
  expect(renderer.controlState).toBe(RendererControlState.AUTO_STARTED)
  expect(renderer.isRunning).toBe(true)
})

test("dropLive() stops auto-started renderer when no live requests remain", () => {
  renderer.requestLive()
  expect(renderer.controlState).toBe(RendererControlState.AUTO_STARTED)
  expect(renderer.isRunning).toBe(true)

  renderer.dropLive()
  expect(renderer.controlState).toBe(RendererControlState.IDLE)
  expect(renderer.isRunning).toBe(false)
})

test("dropLive() does not stop explicitly started renderer", () => {
  renderer.start()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)
  expect(renderer.isRunning).toBe(true)

  renderer.requestLive()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)

  renderer.dropLive()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)
  expect(renderer.isRunning).toBe(true)
})

test("suspend() preserves live request state for resume", () => {
  renderer.requestLive()
  expect(renderer.controlState).toBe(RendererControlState.AUTO_STARTED)
  expect(renderer.isRunning).toBe(true)

  renderer.suspend()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_SUSPENDED)
  expect(renderer.isRunning).toBe(false)

  renderer.resume()
  expect(renderer.controlState).toBe(RendererControlState.AUTO_STARTED)
  expect(renderer.isRunning).toBe(true)
})

test("control state transitions maintain consistency", () => {
  renderer.start()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)
  expect(renderer.isRunning).toBe(true)

  renderer.pause()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_PAUSED)
  expect(renderer.isRunning).toBe(false)

  renderer.start()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)
  expect(renderer.isRunning).toBe(true)

  renderer.suspend()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_SUSPENDED)
  expect(renderer.isRunning).toBe(false)

  renderer.resume()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)
  expect(renderer.isRunning).toBe(true)

  renderer.auto()
  expect(renderer.controlState).toBe(RendererControlState.AUTO_STARTED)
  expect(renderer.isRunning).toBe(true)

  renderer.stop()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STOPPED)
  expect(renderer.isRunning).toBe(false)
})

test("multiple suspend/resume cycles work correctly", () => {
  renderer.start()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)

  renderer.suspend()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_SUSPENDED)
  renderer.resume()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)

  renderer.suspend()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_SUSPENDED)
  renderer.resume()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_STARTED)

  renderer.pause()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_PAUSED)
  renderer.suspend()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_SUSPENDED)
  renderer.resume()
  expect(renderer.controlState).toBe(RendererControlState.EXPLICIT_PAUSED)
})

test("keyboard input is suspended when renderer is suspended", async () => {
  renderer.start()

  let keyEventReceived = false
  const onKeypress = () => {
    keyEventReceived = true
  }
  renderer.keyInput.on("keypress", onKeypress)

  mockInput.pressKey("a")
  expect(keyEventReceived).toBe(true)

  keyEventReceived = false
  renderer.suspend()

  mockInput.pressKey("b")
  expect(keyEventReceived).toBe(false)
  renderer.resume()
  // Wait for renderer to consume stale input and re-register listeners
  await new Promise((r) => setImmediate(r))
  mockInput.pressKey("c")
  expect(keyEventReceived).toBe(true)
  renderer.keyInput.off("keypress", onKeypress)
})

test("mouse input is suspended when renderer is suspended", async () => {
  renderer.start()

  const testRenderable = new TestRenderable(renderer, {
    x: 0,
    y: 0,
    width: renderer.width,
    height: renderer.height,
  })
  renderer.root.add(testRenderable)
  await renderOnce()

  let mouseEventReceived = false
  testRenderable.onMouse = () => {
    mouseEventReceived = true
  }

  await mockMouse.click(0, 0)
  expect(mouseEventReceived).toBe(true)

  mouseEventReceived = false
  renderer.suspend()

  await mockMouse.click(0, 0)
  expect(mouseEventReceived).toBe(false)

  renderer.resume()
  await mockMouse.click(0, 0)
  expect(mouseEventReceived).toBe(true)

  renderer.root.remove(testRenderable.id)
})

test("paste input is suspended when renderer is suspended", async () => {
  renderer.start()

  let pasteEventReceived = false
  const onPaste = () => {
    pasteEventReceived = true
  }
  renderer.keyInput.on("paste", onPaste)

  mockInput.pasteBracketedText("pasted text")
  expect(pasteEventReceived).toBe(true)

  pasteEventReceived = false
  renderer.suspend()

  mockInput.pasteBracketedText("pasted text 2")
  expect(pasteEventReceived).toBe(false)

  renderer.resume()
  // Wait for renderer to consume stale input and re-register listeners
  await new Promise((r) => setImmediate(r))

  mockInput.pasteBracketedText("pasted text 3")
  expect(pasteEventReceived).toBe(true)

  renderer.keyInput.off("paste", onPaste)
})
