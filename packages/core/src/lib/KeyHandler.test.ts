import { test, expect, afterAll } from "bun:test"
import { KeyHandler, InternalKeyHandler, KeyEvent } from "./KeyHandler"
import { createTestRenderer } from "../testing/test-renderer"
import { EventEmitter } from "events"

const { renderer, mockInput } = await createTestRenderer({})

function createKeyHandler(useKittyKeyboard: boolean = false): InternalKeyHandler {
  if (!renderer) {
    throw new Error("Renderer not initialized")
  }

  return new InternalKeyHandler(renderer.stdin, useKittyKeyboard)
}

afterAll(() => {
  if (renderer) {
    renderer.destroy()
  }
})

test("KeyHandler - constructor uses process.stdin by default", () => {
  const originalStdin = process.stdin

  // Mock process.stdin temporarily
  const mockStdin = Object.assign(new EventEmitter(), {
    setRawMode: () => {},
    resume: () => {},
    setEncoding: () => {},
  })

  Object.defineProperty(process, "stdin", {
    value: mockStdin,
    writable: true,
  })

  try {
    const handler = new InternalKeyHandler()

    let receivedKey: KeyEvent | undefined
    handler.on("keypress", (key: KeyEvent) => {
      receivedKey = key
    })

    mockStdin.emit("data", Buffer.from("a"))

    expect(receivedKey).toMatchObject({
      name: "a",
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      number: false,
      sequence: "a",
      raw: "a",
      eventType: "press",
    })

    handler.destroy()
  } finally {
    Object.defineProperty(process, "stdin", {
      value: originalStdin,
      writable: true,
    })
  }
})

test("KeyHandler - emits keypress events", () => {
  const handler = createKeyHandler()

  let receivedKey: KeyEvent | undefined
  handler.on("keypress", (key: KeyEvent) => {
    receivedKey = key
  })

  mockInput.pressKey("a")

  expect(receivedKey).toMatchObject({
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "a",
    eventType: "press",
  })

  handler.destroy()
})

test("KeyHandler - handles paste mode", () => {
  const handler = createKeyHandler()

  let receivedPaste: string | undefined
  handler.on("paste", (event) => {
    receivedPaste = event.text
  })

  mockInput.pasteBracketedText("pasted content")

  expect(receivedPaste).toBe("pasted content")

  handler.destroy()
})

test("KeyHandler - handles paste with multiple parts", () => {
  const handler = createKeyHandler()

  let receivedPaste: string | undefined
  handler.on("paste", (event) => {
    receivedPaste = event.text
  })

  mockInput.pasteBracketedText("chunk1chunk2chunk3")

  expect(receivedPaste).toBe("chunk1chunk2chunk3")

  handler.destroy()
})

test("KeyHandler - strips ANSI codes in paste mode", () => {
  const handler = createKeyHandler()

  let receivedPaste: string | undefined
  handler.on("paste", (event) => {
    receivedPaste = event.text
  })

  mockInput.pasteBracketedText("text with \x1b[31mred\x1b[0m color")

  expect(receivedPaste).toBe("text with red color")

  handler.destroy()
})

test("KeyHandler - constructor accepts useKittyKeyboard parameter", () => {
  // Test that constructor accepts the parameter without throwing
  const handler1 = createKeyHandler(false)
  const handler2 = createKeyHandler(true)

  expect(handler1).toBeDefined()
  expect(handler2).toBeDefined()

  handler1.destroy()
  handler2.destroy()
})

test("KeyHandler - destroy method cleans up properly", () => {
  const handler = createKeyHandler()

  expect(() => handler.destroy()).not.toThrow()
})

test("KeyHandler - handles Buffer input", () => {
  const handler = createKeyHandler()

  let receivedKey: KeyEvent | undefined
  handler.on("keypress", (key: KeyEvent) => {
    receivedKey = key
  })

  mockInput.pressKey("c")

  expect(receivedKey).toMatchObject({
    name: "c",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "c",
    raw: "c",
    eventType: "press",
  })

  handler.destroy()
})

test("KeyHandler - event inheritance from EventEmitter", () => {
  const handler = createKeyHandler()

  expect(typeof handler.on).toBe("function")
  expect(typeof handler.emit).toBe("function")
  expect(typeof handler.removeListener).toBe("function")

  handler.destroy()
})

test("KeyHandler - preventDefault stops propagation", () => {
  const handler = createKeyHandler()

  let globalHandlerCalled = false
  let secondHandlerCalled = false

  handler.on("keypress", (key: KeyEvent) => {
    globalHandlerCalled = true
    key.preventDefault()
  })

  handler.on("keypress", (key: KeyEvent) => {
    if (!key.defaultPrevented) {
      secondHandlerCalled = true
    }
  })

  mockInput.pressKey("a")

  expect(globalHandlerCalled).toBe(true)
  expect(secondHandlerCalled).toBe(false)

  handler.destroy()
})

test("InternalKeyHandler - onInternal handlers run after regular handlers", () => {
  const handler = createKeyHandler()

  const callOrder: string[] = []

  handler.onInternal("keypress", (key: KeyEvent) => {
    callOrder.push("internal")
  })

  handler.on("keypress", (key: KeyEvent) => {
    callOrder.push("regular")
  })

  mockInput.pressKey("a")

  expect(callOrder).toEqual(["regular", "internal"])

  handler.destroy()
})

test("InternalKeyHandler - preventDefault prevents internal handlers from running", () => {
  const handler = createKeyHandler()

  let regularHandlerCalled = false
  let internalHandlerCalled = false

  // Register regular handler that prevents default
  handler.on("keypress", (key: KeyEvent) => {
    regularHandlerCalled = true
    key.preventDefault()
  })

  // Register internal handler (should not run if prevented)
  handler.onInternal("keypress", (key: KeyEvent) => {
    internalHandlerCalled = true
  })

  mockInput.pressKey("a")

  expect(regularHandlerCalled).toBe(true)
  expect(internalHandlerCalled).toBe(false)

  handler.destroy()
})

test("InternalKeyHandler - multiple internal handlers can be registered", () => {
  const handler = createKeyHandler()

  let handler1Called = false
  let handler2Called = false
  let handler3Called = false

  const internalHandler1 = () => {
    handler1Called = true
  }
  const internalHandler2 = () => {
    handler2Called = true
  }
  const internalHandler3 = () => {
    handler3Called = true
  }

  handler.onInternal("keypress", internalHandler1)
  handler.onInternal("keypress", internalHandler2)
  handler.onInternal("keypress", internalHandler3)

  mockInput.pressKey("a")

  expect(handler1Called).toBe(true)
  expect(handler2Called).toBe(true)
  expect(handler3Called).toBe(true)

  handler.destroy()
})

test("InternalKeyHandler - offInternal removes specific handlers", () => {
  const handler = createKeyHandler()

  let handler1Called = false
  let handler2Called = false

  const internalHandler1 = () => {
    handler1Called = true
  }
  const internalHandler2 = () => {
    handler2Called = true
  }

  handler.onInternal("keypress", internalHandler1)
  handler.onInternal("keypress", internalHandler2)

  // Remove only handler1
  handler.offInternal("keypress", internalHandler1)

  mockInput.pressKey("a")

  expect(handler1Called).toBe(false)
  expect(handler2Called).toBe(true)

  handler.destroy()
})

test("InternalKeyHandler - emit returns true when there are listeners", () => {
  const handler = createKeyHandler()

  // No listeners initially
  let hasListeners = handler.emit(
    "keypress",
    new KeyEvent({
      name: "a",
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: "a",
      number: false,
      raw: "a",
      eventType: "press",
    }),
  )
  expect(hasListeners).toBe(false)

  // Add regular listener
  handler.on("keypress", () => {})
  hasListeners = handler.emit(
    "keypress",
    new KeyEvent({
      name: "b",
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: "b",
      number: false,
      raw: "b",
      eventType: "press",
    }),
  )
  expect(hasListeners).toBe(true)

  // Remove regular listener, add internal listener
  handler.removeAllListeners("keypress")
  handler.onInternal("keypress", () => {})
  hasListeners = handler.emit(
    "keypress",
    new KeyEvent({
      name: "c",
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: "c",
      number: false,
      raw: "c",
      eventType: "press",
    }),
  )
  expect(hasListeners).toBe(true)

  handler.destroy()
})

test("InternalKeyHandler - paste events work with priority system", () => {
  const handler = createKeyHandler()

  const callOrder: string[] = []

  handler.on("paste", (event) => {
    callOrder.push(`regular:${event.text}`)
  })

  handler.onInternal("paste", (event) => {
    callOrder.push(`internal:${event.text}`)
  })

  mockInput.pasteBracketedText("hello")

  expect(callOrder).toEqual(["regular:hello", "internal:hello"])

  handler.destroy()
})

test("InternalKeyHandler - paste preventDefault prevents internal handlers", () => {
  const handler = createKeyHandler()

  let regularHandlerCalled = false
  let internalHandlerCalled = false
  let receivedText = ""

  handler.on("paste", (event) => {
    regularHandlerCalled = true
    receivedText = event.text
    event.preventDefault()
  })

  handler.onInternal("paste", (event) => {
    internalHandlerCalled = true
  })

  mockInput.pasteBracketedText("test paste")

  expect(regularHandlerCalled).toBe(true)
  expect(receivedText).toBe("test paste")
  expect(internalHandlerCalled).toBe(false)

  handler.destroy()
})
