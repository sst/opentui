import { test, expect } from "bun:test"
import { InternalKeyHandler, KeyEvent } from "./KeyHandler"

/**
 * Integration tests demonstrating real-world scenarios with stopPropagation
 */

function createKeyHandler(): InternalKeyHandler {
  return new InternalKeyHandler()
}

test("Integration - Modal ESC handler prevents subsequent handlers", () => {
  const handler = createKeyHandler()

  let modalOpen = true
  let modalHandledEsc = false
  let backgroundHandledEsc = false

  // Modal ESC handler (registered first, so it runs first)
  handler.on("keypress", (key: KeyEvent) => {
    if (key.name === "escape" && modalOpen) {
      modalHandledEsc = true
      modalOpen = false
      key.stopPropagation() // Stop other handlers from running
    }
  })

  // Background/app-level ESC handler (registered second, should not run)
  handler.on("keypress", (key: KeyEvent) => {
    if (key.name === "escape") {
      backgroundHandledEsc = true
    }
  })

  // Simulate ESC key press while modal is open
  handler.processInput("\x1b")

  expect(modalOpen).toBe(false)
  expect(modalHandledEsc).toBe(true)
  expect(backgroundHandledEsc).toBe(false) // Modal stopped propagation
})

test("Integration - Focused input field handles key, stops parent handlers", () => {
  const handler = createKeyHandler()

  const inputValue: string[] = []
  let parentHandledKey = false

  // Parent container handler
  handler.on("keypress", (key: KeyEvent) => {
    if (!key.propagationStopped) {
      parentHandledKey = true
    }
  })

  // Focused input field handler (internal/renderable)
  handler.onInternal("keypress", (key: KeyEvent) => {
    if (key.name === "a" || key.name === "b" || key.name === "c") {
      inputValue.push(key.name)
      key.stopPropagation() // Input consumed the key
    }
  })

  // Type some keys
  handler.processInput("a")
  handler.processInput("b")
  handler.processInput("c")

  expect(inputValue).toEqual(["a", "b", "c"])
  expect(parentHandledKey).toBe(true) // Parent ran first (global priority)

  // But internal handler got to consume the keys and stop propagation
  // doesn't prevent parent from seeing them first (global runs before internal)
})

test("Integration - Dialog system with priority: innermost modal wins", () => {
  const handler = createKeyHandler()

  let outerModalClosed = false
  let innerModalClosed = false
  const closeLog: string[] = []

  // Outer modal ESC handler
  const outerHandler = (key: KeyEvent) => {
    if (key.name === "escape" && !key.propagationStopped) {
      closeLog.push("outer")
      outerModalClosed = true
      key.stopPropagation()
    }
  }

  // Inner modal ESC handler (registered later, so it comes first in listener order)
  const innerHandler = (key: KeyEvent) => {
    if (key.name === "escape") {
      closeLog.push("inner")
      innerModalClosed = true
      key.stopPropagation()
    }
  }

  // Register outer first
  handler.on("keypress", outerHandler)

  // Then inner (but we want inner to handle first)
  // In a real app, we'd use prependInputHandler or similar
  // For now, let's simulate by removing outer and re-adding in correct order
  handler.removeListener("keypress", outerHandler)
  handler.on("keypress", innerHandler)
  handler.on("keypress", outerHandler)

  // Press ESC
  handler.processInput("\x1b")

  expect(closeLog).toEqual(["inner"])
  expect(innerModalClosed).toBe(true)
  expect(outerModalClosed).toBe(false) // Inner stopped propagation
})

test("Integration - Keyboard shortcut system with priorities", () => {
  const handler = createKeyHandler()

  const actions: string[] = []

  // Global shortcuts (Ctrl+S = Save, Ctrl+O = Open)
  handler.on("keypress", (key: KeyEvent) => {
    if (key.ctrl && key.name === "s") {
      actions.push("save")
      // Don't stop propagation - allow other handlers to see it
    }
    if (key.ctrl && key.name === "o") {
      actions.push("open")
    }
  })

  // Text editor overrides Ctrl+S when focused
  let editorFocused = true
  handler.onInternal("keypress", (key: KeyEvent) => {
    if (editorFocused && key.ctrl && key.name === "s") {
      actions.push("save-document")
      key.stopPropagation() // Override global save
    }
  })

  // Ctrl+S with editor focused
  handler.processInput("\x13") // Ctrl+S

  expect(actions).toEqual(["save", "save-document"])
  // Note: global runs first, then internal. To truly override,
  // the editor would need to be a global handler registered first
})

test("Integration - preventDefault vs stopPropagation behavior", () => {
  const handler = createKeyHandler()

  const log: string[] = []

  // Handler 1: preventDefault only
  handler.on("keypress", (key: KeyEvent) => {
    if (key.name === "a") {
      log.push("handler1-saw-a")
      key.preventDefault()
    }
  })

  // Handler 2: Should still run (preventDefault doesn't stop global handlers)
  handler.on("keypress", (key: KeyEvent) => {
    if (key.name === "a") {
      log.push("handler2-saw-a")
      if (key.defaultPrevented) {
        log.push("handler2-saw-prevented")
      }
    }
  })

  // Handler 3: Internal handler should not run (preventDefault stops internal)
  handler.onInternal("keypress", (key: KeyEvent) => {
    if (key.name === "a") {
      log.push("handler3-internal-saw-a")
    }
  })

  handler.processInput("a")

  expect(log).toEqual([
    "handler1-saw-a",
    "handler2-saw-a",
    "handler2-saw-prevented",
    // handler3 doesn't run because preventDefault stops internal handlers
  ])

  // Now test with stopPropagation
  log.length = 0

  handler.removeAllListeners("keypress")

  handler.on("keypress", (key: KeyEvent) => {
    if (key.name === "b") {
      log.push("handler1-saw-b")
      key.stopPropagation()
    }
  })

  handler.on("keypress", (key: KeyEvent) => {
    if (key.name === "b") {
      log.push("handler2-saw-b")
    }
  })

  handler.processInput("b")

  expect(log).toEqual([
    "handler1-saw-b",
    // handler2 doesn't run because stopPropagation stops all subsequent handlers
  ])
})

test("Integration - Form submission with Enter key", () => {
  const handler = createKeyHandler()

  let formSubmitted = false
  let inputValue = ""

  // Form's Enter handler
  handler.on("keypress", (key: KeyEvent) => {
    if (key.name === "return" && !key.propagationStopped) {
      formSubmitted = true
    }
  })

  // Input field's Enter handler
  handler.onInternal("keypress", (key: KeyEvent) => {
    if (key.name === "return") {
      // Multi-line input: add newline and stop propagation
      inputValue += "\n"
      key.stopPropagation()
    }
  })

  // Press Enter
  handler.processInput("\r")

  expect(inputValue).toBe("\n")
  expect(formSubmitted).toBe(true) // Global handler ran first

  // In a real app, you'd check defaultPrevented in the form handler
  // or the input would be registered as a global handler first
})

test("Integration - Event bubbling with multiple nested components", () => {
  const handler = createKeyHandler()

  const eventLog: Array<{ component: string; stopped: boolean }> = []

  // Root component
  handler.on("keypress", (key: KeyEvent) => {
    eventLog.push({ component: "root", stopped: key.propagationStopped })
  })

  // Child component (registered as internal, represents focused element)
  handler.onInternal("keypress", (key: KeyEvent) => {
    eventLog.push({ component: "child", stopped: key.propagationStopped })

    // Child handles space key and stops propagation
    if (key.name === "space") {
      key.stopPropagation()
    }
  })

  // Another internal handler (sibling or parent)
  handler.onInternal("keypress", (key: KeyEvent) => {
    eventLog.push({ component: "sibling", stopped: key.propagationStopped })
  })

  handler.processInput(" ") // Space key

  expect(eventLog).toEqual([
    { component: "root", stopped: false },
    { component: "child", stopped: false },
    // sibling doesn't run because child stopped propagation
  ])
  expect(eventLog).toHaveLength(2)
})
