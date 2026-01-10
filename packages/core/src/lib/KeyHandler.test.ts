import { test, expect } from "bun:test"
import { InternalKeyHandler, KeyEvent } from "./KeyHandler"
import { createTestRenderer } from "../testing/test-renderer"

const { renderer, mockInput } = await createTestRenderer({})

function createKeyHandler(useKittyKeyboard: boolean = false): InternalKeyHandler {
  return new InternalKeyHandler(useKittyKeyboard)
}

test("KeyHandler - processInput emits keypress events", () => {
  const handler = new InternalKeyHandler()

  let receivedKey: KeyEvent | undefined
  handler.on("keypress", (key: KeyEvent) => {
    receivedKey = key
  })

  handler.processInput("a")

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
})

test("KeyHandler - emits keypress events", () => {
  const handler = createKeyHandler()

  let receivedKey: KeyEvent | undefined
  handler.on("keypress", (key: KeyEvent) => {
    receivedKey = key
  })

  handler.processInput("a")

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
})

test("KeyHandler - handles paste via processPaste", async () => {
  const handler = createKeyHandler()

  let receivedPaste: string | undefined
  handler.on("paste", (event) => {
    receivedPaste = event.text
  })

  handler.processPaste("pasted content")

  expect(receivedPaste).toBe("pasted content")
})

test("KeyHandler - processPaste handles content directly", () => {
  const handler = createKeyHandler()

  let receivedPaste: string | undefined
  handler.on("paste", (event) => {
    receivedPaste = event.text
  })

  // processPaste receives the full content, no chunking
  handler.processPaste("chunk1chunk2chunk3")

  expect(receivedPaste).toBe("chunk1chunk2chunk3")
})

test("KeyHandler - strips ANSI codes in paste", () => {
  const handler = createKeyHandler()

  let receivedPaste: string | undefined
  handler.on("paste", (event) => {
    receivedPaste = event.text
  })

  handler.processPaste("text with \x1b[31mred\x1b[0m color")

  expect(receivedPaste).toBe("text with red color")
})

test("KeyHandler - constructor accepts useKittyKeyboard parameter", () => {
  // Test that constructor accepts the parameter without throwing
  const handler1 = createKeyHandler(false)
  const handler2 = createKeyHandler(true)

  expect(handler1).toBeDefined()
  expect(handler2).toBeDefined()
})

test("KeyHandler - handles string input", () => {
  const handler = createKeyHandler()

  let receivedKey: KeyEvent | undefined
  handler.on("keypress", (key: KeyEvent) => {
    receivedKey = key
  })

  handler.processInput("c")

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
})

test("KeyHandler - event inheritance from EventEmitter", () => {
  const handler = createKeyHandler()

  expect(typeof handler.on).toBe("function")
  expect(typeof handler.emit).toBe("function")
  expect(typeof handler.removeListener).toBe("function")
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

  handler.processInput("a")

  expect(globalHandlerCalled).toBe(true)
  expect(secondHandlerCalled).toBe(false)
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

  handler.processInput("a")

  expect(callOrder).toEqual(["regular", "internal"])
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

  handler.processInput("a")

  expect(regularHandlerCalled).toBe(true)
  expect(internalHandlerCalled).toBe(false)
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

  handler.processInput("a")

  expect(handler1Called).toBe(true)
  expect(handler2Called).toBe(true)
  expect(handler3Called).toBe(true)
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

  handler.processInput("a")

  expect(handler1Called).toBe(false)
  expect(handler2Called).toBe(true)
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
      source: "raw",
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
      source: "raw",
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
      source: "raw",
    }),
  )
  expect(hasListeners).toBe(true)
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

  handler.processPaste("hello")

  expect(callOrder).toEqual(["regular:hello", "internal:hello"])
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

  handler.processPaste("test paste")

  expect(regularHandlerCalled).toBe(true)
  expect(receivedText).toBe("test paste")
  expect(internalHandlerCalled).toBe(false)
})

test("KeyHandler - emits paste event even with empty content", () => {
  const handler = createKeyHandler()

  let pasteEventReceived = false
  let receivedPaste = "not-empty"

  handler.on("paste", (event) => {
    pasteEventReceived = true
    receivedPaste = event.text
  })

  handler.processPaste("")

  expect(pasteEventReceived).toBe(true)
  expect(receivedPaste).toBe("")
})

test("KeyHandler - filters out mouse events", () => {
  const handler = createKeyHandler()

  let keypressCount = 0
  handler.on("keypress", () => {
    keypressCount++
  })

  // Mouse events should not generate keypresses
  handler.processInput("\x1b[<0;10;5M")
  expect(keypressCount).toBe(0)

  handler.processInput("\x1b[<0;10;5m")
  expect(keypressCount).toBe(0)

  // Old-style mouse: \x1b[M + 3 bytes, then "c" is a separate keypress
  handler.processInput("\x1b[M ab")
  expect(keypressCount).toBe(0)

  handler.processInput("c")
  expect(keypressCount).toBe(1)

  handler.processInput("a")
  expect(keypressCount).toBe(2) // Now we have "c" and "a"
})

test("KeyHandler - KeyEvent has source field set to 'raw' by default", () => {
  if (!renderer) {
    throw new Error("Renderer not initialized")
  }

  let receivedKey: KeyEvent | undefined
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    receivedKey = key
  })

  mockInput.pressKey("a")

  expect(receivedKey).toBeDefined()
  expect(receivedKey?.source).toBe("raw")
  expect(receivedKey?.name).toBe("a")

  renderer.keyInput.removeAllListeners("keypress")
})

test("KeyHandler - KeyEvent has source field for different key types", () => {
  if (!renderer) {
    throw new Error("Renderer not initialized")
  }

  const receivedKeys: KeyEvent[] = []
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    receivedKeys.push(key)
  })

  // Test various key types
  mockInput.pressKey("a")
  mockInput.pressKey("A")
  mockInput.pressKey("\x1b[A") // Up arrow
  mockInput.pressKey("\x01") // Ctrl+A

  expect(receivedKeys).toHaveLength(4)
  expect(receivedKeys[0]?.source).toBe("raw")
  expect(receivedKeys[1]?.source).toBe("raw")
  expect(receivedKeys[2]?.source).toBe("raw")
  expect(receivedKeys[3]?.source).toBe("raw")

  renderer.keyInput.removeAllListeners("keypress")
})

test("KeyHandler - KeyEvent source is 'kitty' when using Kitty keyboard protocol", () => {
  const handler = createKeyHandler(true)

  let receivedKey: KeyEvent | undefined
  handler.on("keypress", (key: KeyEvent) => {
    receivedKey = key
  })

  // Send a Kitty keyboard protocol sequence for 'a' (codepoint 97)
  handler.processInput("\x1b[97u")

  expect(receivedKey).toBeDefined()
  expect(receivedKey?.source).toBe("kitty")
  expect(receivedKey?.name).toBe("a")
})

test("KeyHandler - KeyEvent source is 'raw' for non-Kitty sequences even with Kitty enabled", () => {
  if (!renderer) {
    throw new Error("Renderer not initialized")
  }

  const receivedKeys: KeyEvent[] = []
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    receivedKeys.push(key)
  })

  // Send regular sequences that don't match Kitty protocol
  mockInput.pressKey("a")
  mockInput.pressKey("\x1b[A") // Up arrow (standard ANSI)

  expect(receivedKeys).toHaveLength(2)
  expect(receivedKeys[0]?.source).toBe("raw")
  expect(receivedKeys[0]?.name).toBe("a")
  expect(receivedKeys[1]?.source).toBe("raw")
  expect(receivedKeys[1]?.name).toBe("up")

  renderer.keyInput.removeAllListeners("keypress")
})

test("KeyHandler - source field persists through KeyEvent wrapper", () => {
  if (!renderer) {
    throw new Error("Renderer not initialized")
  }

  let receivedKey: KeyEvent | undefined
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    receivedKey = key
  })

  mockInput.pressKey("x")

  expect(receivedKey).toBeInstanceOf(KeyEvent)
  expect(receivedKey?.source).toBe("raw")
  expect(receivedKey?.name).toBe("x")

  // Verify it implements ParsedKey interface
  const parsedKey: typeof receivedKey = receivedKey
  expect(parsedKey?.source).toBe("raw")

  renderer.keyInput.removeAllListeners("keypress")
})

test("KeyHandler - global handler error is caught and logged", () => {
  const handler = createKeyHandler()

  let handlerCalled = false
  let errorThrown = false

  // Handler throws an error
  handler.on("keypress", (key: KeyEvent) => {
    handlerCalled = true
    errorThrown = true
    throw new Error("Test error in global handler")
  })

  // Should not throw - error is caught and logged
  expect(() => handler.processInput("a")).not.toThrow()

  expect(handlerCalled).toBe(true)
  expect(errorThrown).toBe(true)
})

test("KeyHandler - renderable handler error does not stop processing", () => {
  const handler = createKeyHandler()

  let firstInternalCalled = false
  let secondInternalCalled = false
  let errorThrown = false

  // First internal handler throws
  handler.onInternal("keypress", (key: KeyEvent) => {
    firstInternalCalled = true
    errorThrown = true
    throw new Error("Test error in internal handler")
  })

  // Second internal handler should still be called
  handler.onInternal("keypress", (key: KeyEvent) => {
    secondInternalCalled = true
  })

  // Should not throw
  expect(() => handler.processInput("a")).not.toThrow()

  expect(firstInternalCalled).toBe(true)
  expect(errorThrown).toBe(true)
  expect(secondInternalCalled).toBe(true)
})

test("KeyHandler - global handler error stops further global handlers but allows internal handlers", () => {
  const handler = createKeyHandler()

  let globalCalled = false
  let internalCalled = false

  // Global handler throws - stops further global handlers
  handler.on("keypress", (key: KeyEvent) => {
    globalCalled = true
    throw new Error("Global handler error")
  })

  // Internal handler should still be called (different priority level)
  handler.onInternal("keypress", (key: KeyEvent) => {
    internalCalled = true
  })

  // Should not throw - errors are caught
  expect(() => handler.processInput("a")).not.toThrow()

  expect(globalCalled).toBe(true)
  expect(internalCalled).toBe(true)
})

test("KeyHandler - paste handler error is caught and logged", () => {
  const handler = createKeyHandler()

  let handlerCalled = false

  // Paste handler throws
  handler.on("paste", (event) => {
    handlerCalled = true
    throw new Error("Test error in paste handler")
  })

  // Should not throw - error is caught and logged
  expect(() => handler.processPaste("test")).not.toThrow()

  expect(handlerCalled).toBe(true)
})

test("KeyHandler - processInput returns true even when handler throws", () => {
  const handler = createKeyHandler()

  handler.on("keypress", (key: KeyEvent) => {
    throw new Error("Handler error")
  })

  // Should return true indicating the input was handled (even if handler errored)
  const result = handler.processInput("a")
  expect(result).toBe(true)
})

test("KeyHandler - internal handler error with preventDefault still respects prevention", () => {
  const handler = createKeyHandler()

  let globalCalled = false
  let internalCalled = false

  // Global handler prevents default
  handler.on("keypress", (key: KeyEvent) => {
    globalCalled = true
    key.preventDefault()
  })

  // Internal handler should not be called (due to preventDefault)
  handler.onInternal("keypress", (key: KeyEvent) => {
    internalCalled = true
    throw new Error("Should not reach here")
  })

  handler.processInput("a")

  expect(globalCalled).toBe(true)
  expect(internalCalled).toBe(false)
})

test("KeyHandler - error in one event type does not prevent other event types from working", () => {
  const handler = createKeyHandler()

  let keypressCalled = false
  let pasteCalled = false

  // Keypress handler throws
  handler.on("keypress", (key: KeyEvent) => {
    keypressCalled = true
    throw new Error("Keypress error")
  })

  // Paste handler should work fine
  handler.on("paste", (event) => {
    pasteCalled = true
  })

  // Both should not throw - errors are caught and logged
  expect(() => handler.processInput("a")).not.toThrow()
  expect(() => handler.processPaste("test")).not.toThrow()

  expect(keypressCalled).toBe(true)
  expect(pasteCalled).toBe(true)
})

test("KeyHandler - Kitty emoji reassembly: basic emoji", async () => {
  const handler = new InternalKeyHandler({ useKittyKeyboard: true, emojiBufferTimeout: 5 })
  const events: KeyEvent[] = []
  handler.on("keypress", (key: KeyEvent) => events.push(key))

  handler.processInput("\x1b[128512u") // 😀 U+1F600
  await new Promise((r) => setTimeout(r, 10))

  expect(events).toHaveLength(1)
  expect(events[0].name).toBe("😀")
  expect(events[0].sequence).toBe("😀")
  expect(events[0].raw).toBe("\x1b[128512u")
  handler.destroy()
})

test("KeyHandler - Kitty emoji reassembly: ZWJ family", async () => {
  const handler = new InternalKeyHandler({ useKittyKeyboard: true, emojiBufferTimeout: 5 })
  const events: KeyEvent[] = []
  handler.on("keypress", (key: KeyEvent) => events.push(key))

  handler.processInput("\x1b[128104u") // 👨 U+1F468
  handler.processInput("\x1b[8205u") // ZWJ U+200D
  handler.processInput("\x1b[128105u") // 👩 U+1F469
  handler.processInput("\x1b[8205u") // ZWJ
  handler.processInput("\x1b[128103u") // 👧 U+1F467
  await new Promise((r) => setTimeout(r, 10))

  expect(events).toHaveLength(1)
  expect(events[0].name).toBe("👨‍👩‍👧")
  expect(events[0].sequence).toBe("👨‍👩‍👧")
  expect(events[0].raw).toBe("\x1b[128104u\x1b[8205u\x1b[128105u\x1b[8205u\x1b[128103u")
  handler.destroy()
})

test("KeyHandler - Kitty emoji reassembly: flag emoji", async () => {
  const handler = new InternalKeyHandler({ useKittyKeyboard: true, emojiBufferTimeout: 5 })
  const events: KeyEvent[] = []
  handler.on("keypress", (key: KeyEvent) => events.push(key))

  handler.processInput("\x1b[127482u") // 🇺 U+1F1FA
  handler.processInput("\x1b[127480u") // 🇸 U+1F1F8
  await new Promise((r) => setTimeout(r, 10))

  expect(events).toHaveLength(1)
  expect(events[0].name).toBe("🇺🇸")
  expect(events[0].sequence).toBe("🇺🇸")
  handler.destroy()
})

test("KeyHandler - Kitty emoji reassembly: skin tone modifier", async () => {
  const handler = new InternalKeyHandler({ useKittyKeyboard: true, emojiBufferTimeout: 5 })
  const events: KeyEvent[] = []
  handler.on("keypress", (key: KeyEvent) => events.push(key))

  handler.processInput("\x1b[128075u") // 👋 U+1F44B
  handler.processInput("\x1b[127995u") // 🏻 U+1F3FB (light skin tone)
  await new Promise((r) => setTimeout(r, 10))

  expect(events).toHaveLength(1)
  expect(events[0].name).toBe("👋🏻")
  expect(events[0].sequence).toBe("👋🏻")
  handler.destroy()
})

test("KeyHandler - Kitty emoji reassembly: keycap", async () => {
  const handler = new InternalKeyHandler({ useKittyKeyboard: true, emojiBufferTimeout: 5 })
  const events: KeyEvent[] = []
  handler.on("keypress", (key: KeyEvent) => events.push(key))

  handler.processInput("\x1b[35u") // # U+0023
  handler.processInput("\x1b[65039u") // VS16 U+FE0F
  handler.processInput("\x1b[8419u") // Keycap U+20E3
  await new Promise((r) => setTimeout(r, 10))

  expect(events).toHaveLength(1)
  expect(events[0].name).toBe("#️⃣")
  expect(events[0].sequence).toBe("#️⃣")
  handler.destroy()
})

test("KeyHandler - Kitty emoji reassembly: flush on non-emoji input", async () => {
  const handler = new InternalKeyHandler({ useKittyKeyboard: true, emojiBufferTimeout: 5 })
  const events: KeyEvent[] = []
  handler.on("keypress", (key: KeyEvent) => events.push(key))

  handler.processInput("\x1b[128075u") // 👋
  handler.processInput("\x1b[97u") // 'a' - not an extender, should flush

  expect(events).toHaveLength(2)
  expect(events[0].name).toBe("👋")
  expect(events[1].name).toBe("a")
  handler.destroy()
})

test("KeyHandler - Kitty emoji reassembly: non-emoji Kitty sequences pass through", () => {
  const handler = new InternalKeyHandler({ useKittyKeyboard: true, emojiBufferTimeout: 5 })
  const events: KeyEvent[] = []
  handler.on("keypress", (key: KeyEvent) => events.push(key))

  handler.processInput("\x1b[97u") // 'a'
  handler.processInput("\x1b[98u") // 'b'

  expect(events).toHaveLength(2)
  expect(events[0].name).toBe("a")
  expect(events[1].name).toBe("b")
  handler.destroy()
})

test("KeyHandler - Kitty emoji reassembly: multiple flags split correctly", async () => {
  const handler = new InternalKeyHandler({ useKittyKeyboard: true, emojiBufferTimeout: 5 })
  const events: KeyEvent[] = []
  handler.on("keypress", (key: KeyEvent) => events.push(key))

  handler.processInput("\x1b[127482u") // 🇺 U+1F1FA
  handler.processInput("\x1b[127480u") // 🇸 U+1F1F8
  handler.processInput("\x1b[127471u") // 🇯 U+1F1EF
  handler.processInput("\x1b[127477u") // 🇵 U+1F1F5
  await new Promise((r) => setTimeout(r, 10))

  expect(events).toHaveLength(2)
  expect(events[0].name).toBe("🇺🇸")
  expect(events[1].name).toBe("🇯🇵")
  handler.destroy()
})

test("KeyHandler - Kitty emoji reassembly: modifiers prevent buffering", () => {
  const handler = new InternalKeyHandler({ useKittyKeyboard: true, emojiBufferTimeout: 5 })
  const events: KeyEvent[] = []
  handler.on("keypress", (key: KeyEvent) => events.push(key))

  handler.processInput("\x1b[128512;5u") // Ctrl+😀

  expect(events).toHaveLength(1)
  expect(events[0].name).toBe("😀")
  expect(events[0].ctrl).toBe(true)
  handler.destroy()
})

test("KeyHandler - Kitty emoji reassembly: subdivision flag", async () => {
  const handler = new InternalKeyHandler({ useKittyKeyboard: true, emojiBufferTimeout: 5 })
  const events: KeyEvent[] = []
  handler.on("keypress", (key: KeyEvent) => events.push(key))

  handler.processInput("\x1b[127988u") // 🏴 U+1F3F4
  handler.processInput("\x1b[917607u") // Tag g U+E0067
  handler.processInput("\x1b[917602u") // Tag b U+E0062
  handler.processInput("\x1b[917605u") // Tag e U+E0065
  handler.processInput("\x1b[917614u") // Tag n U+E006E
  handler.processInput("\x1b[917607u") // Tag g U+E0067
  handler.processInput("\x1b[917631u") // Tag cancel U+E007F
  await new Promise((r) => setTimeout(r, 10))

  expect(events).toHaveLength(1)
  expect(events[0].name).toBe("🏴󠁧󠁢󠁥󠁮󠁧󠁿")
  handler.destroy()
})
