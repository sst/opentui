import { test, expect, afterAll } from "bun:test"
import { KeyHandler } from "./KeyHandler"
import type { ParsedKey } from "./KeyHandler"
import { createTestRenderer } from "../testing/test-renderer"
import { EventEmitter } from "events"

const { renderer, mockInput } = await createTestRenderer({})

function createKeyHandler(useKittyKeyboard: boolean = false): KeyHandler {
  if (!renderer) {
    throw new Error("Renderer not initialized")
  }

  return new KeyHandler(renderer.stdin, useKittyKeyboard)
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
    const handler = new KeyHandler()

    let receivedKey: ParsedKey | undefined
    handler.on("keypress", (key: ParsedKey) => {
      receivedKey = key
    })

    mockStdin.emit("data", Buffer.from("a"))

    expect(receivedKey).toEqual({
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

  let receivedKey: ParsedKey | undefined
  handler.on("keypress", (key: ParsedKey) => {
    receivedKey = key
  })

  mockInput.pressKey("a")

  expect(receivedKey).toEqual({
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
  handler.on("paste", (text: string) => {
    receivedPaste = text
  })

  mockInput.pasteBracketedText("pasted content")

  expect(receivedPaste).toBe("pasted content")

  handler.destroy()
})

test("KeyHandler - handles paste with multiple parts", () => {
  const handler = createKeyHandler()

  let receivedPaste: string | undefined
  handler.on("paste", (text: string) => {
    receivedPaste = text
  })

  mockInput.pasteBracketedText("chunk1chunk2chunk3")

  expect(receivedPaste).toBe("chunk1chunk2chunk3")

  handler.destroy()
})

test("KeyHandler - strips ANSI codes in paste mode", () => {
  const handler = createKeyHandler()

  let receivedPaste: string | undefined
  handler.on("paste", (text: string) => {
    receivedPaste = text
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

  let receivedKey: ParsedKey | undefined
  handler.on("keypress", (key: ParsedKey) => {
    receivedKey = key
  })

  mockInput.pressKey("c")

  expect(receivedKey).toEqual({
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
