import { test, expect, beforeEach } from "bun:test"
import { InternalKeyHandler, KeyEvent } from "./KeyHandler"

function createKeyHandler(useKittyKeyboard: boolean = false): InternalKeyHandler {
  return new InternalKeyHandler(useKittyKeyboard)
}

test("stopPropagation - stops subsequent global handlers", () => {
  const handler = createKeyHandler()

  const callOrder: string[] = []

  handler.on("keypress", (key: KeyEvent) => {
    callOrder.push("global1")
    key.stopPropagation()
  })

  handler.on("keypress", (key: KeyEvent) => {
    callOrder.push("global2")
  })

  handler.processInput("a")

  expect(callOrder).toEqual(["global1"])
})

test("stopPropagation - stops internal handlers from running", () => {
  const handler = createKeyHandler()

  const callOrder: string[] = []

  handler.on("keypress", (key: KeyEvent) => {
    callOrder.push("global")
    key.stopPropagation()
  })

  handler.onInternal("keypress", (key: KeyEvent) => {
    callOrder.push("internal")
  })

  handler.processInput("a")

  expect(callOrder).toEqual(["global"])
})

test("stopPropagation - internal handler can stop other internal handlers", () => {
  const handler = createKeyHandler()

  const callOrder: string[] = []

  handler.onInternal("keypress", (key: KeyEvent) => {
    callOrder.push("internal1")
    key.stopPropagation()
  })

  handler.onInternal("keypress", (key: KeyEvent) => {
    callOrder.push("internal2")
  })

  handler.processInput("a")

  expect(callOrder).toEqual(["internal1"])
})

test("stopPropagation - does not affect preventDefault", () => {
  const handler = createKeyHandler()

  let stoppedPropagation = false
  let preventedDefault = false

  handler.on("keypress", (key: KeyEvent) => {
    key.stopPropagation()
    key.preventDefault()
    stoppedPropagation = key.propagationStopped
    preventedDefault = key.defaultPrevented
  })

  handler.processInput("a")

  expect(stoppedPropagation).toBe(true)
  expect(preventedDefault).toBe(true)
})

test("stopPropagation - without calling it, all handlers run", () => {
  const handler = createKeyHandler()

  const callOrder: string[] = []

  handler.on("keypress", (key: KeyEvent) => {
    callOrder.push("global1")
  })

  handler.on("keypress", (key: KeyEvent) => {
    callOrder.push("global2")
  })

  handler.onInternal("keypress", (key: KeyEvent) => {
    callOrder.push("internal1")
  })

  handler.onInternal("keypress", (key: KeyEvent) => {
    callOrder.push("internal2")
  })

  handler.processInput("a")

  expect(callOrder).toEqual(["global1", "global2", "internal1", "internal2"])
})

test("stopPropagation - paste events support stopPropagation", () => {
  const handler = createKeyHandler()

  const callOrder: string[] = []

  handler.on("paste", (event) => {
    callOrder.push("global")
    event.stopPropagation()
  })

  handler.onInternal("paste", (event) => {
    callOrder.push("internal")
  })

  handler.processPaste("hello")

  expect(callOrder).toEqual(["global"])
})

test("stopPropagation - works with keyrelease events", () => {
  const handler = createKeyHandler(true) // Enable kitty for release events

  const callOrder: string[] = []

  handler.on("keyrelease", (key: KeyEvent) => {
    callOrder.push("global")
    key.stopPropagation()
  })

  handler.onInternal("keyrelease", (key: KeyEvent) => {
    callOrder.push("internal")
  })

  // Emit a release event directly since we need kitty protocol
  handler.emit(
    "keyrelease",
    new KeyEvent({
      name: "a",
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: "a",
      number: false,
      raw: "a",
      eventType: "release",
      source: "kitty",
    }),
  )

  expect(callOrder).toEqual(["global"])
})

test("stopPropagation - error in handler does not affect propagation stopped state", () => {
  const handler = createKeyHandler()

  const callOrder: string[] = []

  handler.on("keypress", (key: KeyEvent) => {
    callOrder.push("global1")
    key.stopPropagation()
    throw new Error("Test error")
  })

  handler.on("keypress", (key: KeyEvent) => {
    callOrder.push("global2")
  })

  expect(() => handler.processInput("a")).not.toThrow()

  expect(callOrder).toEqual(["global1"])
})

test("stopPropagation - modal scenario: ESC key handled by modal, stops at modal", () => {
  const handler = createKeyHandler()

  const callOrder: string[] = []
  let modalClosed = false
  let appHandledEsc = false

  // Modal handler (internal, should be focused element) - runs BEFORE app handler
  // In a real app, the focused modal element would use onInternal
  handler.onInternal("keypress", (key: KeyEvent) => {
    if (key.name === "escape") {
      callOrder.push("modal")
      modalClosed = true
      key.stopPropagation()
    }
  })

  // App-level global ESC handler (should NOT run if modal stops propagation)
  handler.on("keypress", (key: KeyEvent) => {
    if (key.name === "escape") {
      callOrder.push("app")
      appHandledEsc = true
    }
  })

  handler.processInput("\x1b")

  // Global handlers run before internal handlers
  // So app handler runs first, but modal can still stop further internal handlers
  expect(callOrder).toEqual(["app", "modal"])
  expect(modalClosed).toBe(true)
  expect(appHandledEsc).toBe(true)
})

test("stopPropagation - modal scenario: global modal handler prevents app handler", () => {
  const handler = createKeyHandler()

  const callOrder: string[] = []
  let modalClosed = false
  let appHandledEsc = false

  // Modal as a global handler (registered first) - to stop before app handler
  handler.on("keypress", (key: KeyEvent) => {
    if (key.name === "escape") {
      callOrder.push("modal")
      modalClosed = true
      key.stopPropagation()
    }
  })

  // App-level ESC handler (should NOT run due to stopPropagation)
  handler.on("keypress", (key: KeyEvent) => {
    if (key.name === "escape") {
      callOrder.push("app")
      appHandledEsc = true
    }
  })

  handler.processInput("\x1b")

  // When modal is registered as a global handler first, it can stop the app handler
  expect(callOrder).toEqual(["modal"])
  expect(modalClosed).toBe(true)
  expect(appHandledEsc).toBe(false)
})

test("stopPropagation - event flow without stopPropagation shows order", () => {
  const handler = createKeyHandler()

  const events: string[] = []

  handler.on("keypress", (key: KeyEvent) => {
    events.push("global1")
    expect(key.propagationStopped).toBe(false)
  })

  handler.on("keypress", (key: KeyEvent) => {
    events.push("global2")
    expect(key.propagationStopped).toBe(false)
  })

  handler.onInternal("keypress", (key: KeyEvent) => {
    events.push("internal1")
    expect(key.propagationStopped).toBe(false)
  })

  handler.onInternal("keypress", (key: KeyEvent) => {
    events.push("internal2")
    expect(key.propagationStopped).toBe(false)
  })

  handler.processInput("a")

  // Verify execution order: global handlers first, then internal handlers
  expect(events).toEqual(["global1", "global2", "internal1", "internal2"])
})
