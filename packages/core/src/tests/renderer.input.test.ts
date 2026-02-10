import { test, expect, beforeEach, afterEach } from "bun:test"
import { nonAlphanumericKeys, type KeyEventType, type ParsedKey } from "../lib/parse.keypress"
import { type KeyEvent } from "../lib/KeyHandler"
import { Buffer } from "node:buffer"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"

let currentRenderer: TestRenderer
let kittyRenderer: TestRenderer
let mockProcessCapabilityResponse: any
let mockGetTerminalCapabilities: any

beforeEach(async () => {
  // Small delay to ensure any pending StdinBuffer timeouts from previous tests complete
  await new Promise((resolve) => setTimeout(resolve, 15))
  ;({ renderer: currentRenderer } = await createTestRenderer({}))
  ;({ renderer: kittyRenderer } = await createTestRenderer({ useKittyKeyboard: true }))

  // Mock native capability functions to avoid interfering with the test terminal
  // @ts-expect-error - mocking for test
  mockProcessCapabilityResponse = currentRenderer.lib.processCapabilityResponse
  // @ts-expect-error - mocking for test
  mockGetTerminalCapabilities = currentRenderer.lib.getTerminalCapabilities

  // @ts-expect-error - mocking for test
  currentRenderer.lib.processCapabilityResponse = () => {}
  // @ts-expect-error - mocking for test
  currentRenderer.lib.getTerminalCapabilities = () => ({ unicode: "unicode" })

  // @ts-expect-error - mocking for test
  kittyRenderer.lib.processCapabilityResponse = () => {}
  // @ts-expect-error - mocking for test
  kittyRenderer.lib.getTerminalCapabilities = () => ({ unicode: "unicode" })
})

afterEach(() => {
  // Restore mocks
  // @ts-expect-error - restore mock
  currentRenderer.lib.processCapabilityResponse = mockProcessCapabilityResponse
  // @ts-expect-error - restore mock
  currentRenderer.lib.getTerminalCapabilities = mockGetTerminalCapabilities
  // @ts-expect-error - restore mock
  kittyRenderer.lib.processCapabilityResponse = mockProcessCapabilityResponse
  // @ts-expect-error - restore mock
  kittyRenderer.lib.getTerminalCapabilities = mockGetTerminalCapabilities

  currentRenderer.destroy()
  kittyRenderer.destroy()
})

async function triggerInput(sequence: string): Promise<KeyEvent> {
  return new Promise((resolve) => {
    const onKeypress = (parsedKey: KeyEvent) => {
      currentRenderer.keyInput.removeListener("keypress", onKeypress)
      resolve(parsedKey)
    }

    currentRenderer.keyInput.once("keypress", onKeypress)

    currentRenderer.stdin.emit("data", Buffer.from(sequence))
  })
}

async function triggerKittyInput(sequence: string): Promise<KeyEvent> {
  return new Promise((resolve) => {
    const onKeypress = (parsedKey: KeyEvent) => {
      kittyRenderer.keyInput.removeListener("keypress", onKeypress)
      kittyRenderer.keyInput.removeListener("keyrelease", onKeypress)
      resolve(parsedKey)
    }

    kittyRenderer.keyInput.on("keypress", onKeypress)
    kittyRenderer.keyInput.on("keyrelease", onKeypress)

    kittyRenderer.stdin.emit("data", Buffer.from(sequence))
  })
}

test("basic letters via keyInput events", async () => {
  const result = await triggerInput("a")
  expect(result).toMatchObject({
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

  const resultShift = await triggerInput("A")
  expect(resultShift).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: false,
    shift: true,
    option: false,
    number: false,
    sequence: "A",
    raw: "A",
  })
})

test("numbers via keyInput events", async () => {
  const result = await triggerInput("1")
  expect(result).toMatchObject({
    eventType: "press",
    name: "1",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: true,
    sequence: "1",
    raw: "1",
  })
})

test("special keys via keyInput events", async () => {
  const resultReturn = await triggerInput("\r")
  expect(resultReturn).toMatchObject({
    eventType: "press",
    name: "return",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\r",
    raw: "\r",
  })

  const resultEnter = await triggerInput("\n")
  expect(resultEnter).toMatchObject({
    eventType: "press",
    name: "linefeed",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\n",
    raw: "\n",
  })

  const resultTab = await triggerInput("\t")
  expect(resultTab).toMatchObject({
    eventType: "press",
    name: "tab",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\t",
    raw: "\t",
  })

  const resultBackspace = await triggerInput("\b")
  expect(resultBackspace).toMatchObject({
    eventType: "press",
    name: "backspace",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\b",
    raw: "\b",
  })

  const resultEscape = await triggerInput("\x1b")
  expect(resultEscape).toMatchObject({
    name: "escape",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b",
    raw: "\x1b",
    eventType: "press",
  })

  const resultSpace = await triggerInput(" ")
  expect(resultSpace).toMatchObject({
    eventType: "press",
    name: "space",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: " ",
    raw: " ",
  })
})

test("ctrl+letter combinations via keyInput events", async () => {
  const resultCtrlA = await triggerInput("\x01")
  expect(resultCtrlA).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: true,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x01",
    raw: "\x01",
  })

  const resultCtrlZ = await triggerInput("\x1a")
  expect(resultCtrlZ).toMatchObject({
    eventType: "press",
    name: "z",
    ctrl: true,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1a",
    raw: "\x1a",
  })
})

test("meta+character combinations via keyInput events", async () => {
  const resultMetaA = await triggerInput("\x1ba")
  expect(resultMetaA).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: true,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1ba",
    raw: "\x1ba",
  })

  const resultMetaShiftA = await triggerInput("\x1bA")
  expect(resultMetaShiftA).toMatchObject({
    eventType: "press",
    name: "A",
    ctrl: false,
    meta: true,
    shift: true,
    option: false,
    number: false,
    sequence: "\x1bA",
    raw: "\x1bA",
  })
})

test("function keys via keyInput events", async () => {
  const resultF1 = await triggerInput("\x1bOP")
  expect(resultF1).toMatchObject({
    eventType: "press",
    name: "f1",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1bOP",
    raw: "\x1bOP",
    code: "OP",
  })

  const resultF1Alt = await triggerInput("\x1b[11~")
  expect(resultF1Alt).toMatchObject({
    eventType: "press",
    name: "f1",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[11~",
    raw: "\x1b[11~",
    code: "[11~",
  })

  const resultF12 = await triggerInput("\x1b[24~")
  expect(resultF12).toMatchObject({
    eventType: "press",
    name: "f12",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[24~",
    raw: "\x1b[24~",
    code: "[24~",
  })
})

test("arrow keys via keyInput events", async () => {
  const resultUp = await triggerInput("\x1b[A")
  expect(resultUp).toMatchObject({
    eventType: "press",
    name: "up",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[A",
    raw: "\x1b[A",
    code: "[A",
  })

  const resultDown = await triggerInput("\x1b[B")
  expect(resultDown).toMatchObject({
    eventType: "press",
    name: "down",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[B",
    raw: "\x1b[B",
    code: "[B",
  })

  const resultRight = await triggerInput("\x1b[C")
  expect(resultRight).toMatchObject({
    eventType: "press",
    name: "right",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[C",
    raw: "\x1b[C",
    code: "[C",
  })

  const resultLeft = await triggerInput("\x1b[D")
  expect(resultLeft).toMatchObject({
    eventType: "press",
    name: "left",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[D",
    raw: "\x1b[D",
    code: "[D",
  })
})

test("navigation keys via keyInput events", async () => {
  const resultHome = await triggerInput("\x1b[H")
  expect(resultHome).toMatchObject({
    eventType: "press",
    name: "home",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[H",
    raw: "\x1b[H",
    code: "[H",
  })

  const resultEnd = await triggerInput("\x1b[F")
  expect(resultEnd).toMatchObject({
    eventType: "press",
    name: "end",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[F",
    raw: "\x1b[F",
    code: "[F",
  })

  const resultPageUp = await triggerInput("\x1b[5~")
  expect(resultPageUp).toMatchObject({
    eventType: "press",
    name: "pageup",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[5~",
    raw: "\x1b[5~",
    code: "[5~",
  })

  const resultPageDown = await triggerInput("\x1b[6~")
  expect(resultPageDown).toMatchObject({
    eventType: "press",
    name: "pagedown",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[6~",
    raw: "\x1b[6~",
    code: "[6~",
  })
})

test("modifier combinations via keyInput events", async () => {
  const resultShiftUp = await triggerInput("\x1b[1;2A")
  expect(resultShiftUp).toMatchObject({
    eventType: "press",
    name: "up",
    ctrl: false,
    meta: false,
    shift: true,
    option: false,
    number: false,
    sequence: "\x1b[1;2A",
    raw: "\x1b[1;2A",
    code: "[A",
  })

  const resultMetaAltUp = await triggerInput("\x1b[1;4A")
  expect(resultMetaAltUp).toMatchObject({
    eventType: "press",
    name: "up",
    ctrl: false,
    meta: true,
    shift: true,
    option: true,
    number: false,
    sequence: "\x1b[1;4A",
    raw: "\x1b[1;4A",
    code: "[A",
  })

  const resultAllModsUp = await triggerInput("\x1b[1;8A")
  expect(resultAllModsUp).toMatchObject({
    eventType: "press",
    name: "up",
    ctrl: true,
    meta: true,
    shift: true,
    option: true,
    number: false,
    sequence: "\x1b[1;8A",
    raw: "\x1b[1;8A",
    code: "[A",
  })
})

test("delete key via keyInput events", async () => {
  const resultDelete = await triggerInput("\x1b[3~")
  expect(resultDelete).toMatchObject({
    eventType: "press",
    name: "delete",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[3~",
    raw: "\x1b[3~",
    code: "[3~",
  })
})

test("Buffer input via keyInput events", async () => {
  // Test with Buffer input by emitting buffer data directly
  const result = await new Promise<KeyEvent>((resolve) => {
    const onKeypress = (parsedKey: KeyEvent) => {
      currentRenderer.keyInput.removeListener("keypress", onKeypress)
      resolve(parsedKey)
    }

    currentRenderer.keyInput.on("keypress", onKeypress)
    currentRenderer.stdin.emit("data", Buffer.from("a"))
  })

  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "a",
  })
})

test("special characters via keyInput events", async () => {
  const resultExclamation = await triggerInput("!")
  expect(resultExclamation).toMatchObject({
    eventType: "press",
    name: "!",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "!",
    raw: "!",
  })

  const resultAt = await triggerInput("@")
  expect(resultAt).toMatchObject({
    eventType: "press",
    name: "@",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "@",
    raw: "@",
  })
})

test("meta space and escape combinations via keyInput events", async () => {
  const resultMetaSpace = await triggerInput("\x1b ")
  expect(resultMetaSpace).toMatchObject({
    eventType: "press",
    name: "space",
    ctrl: false,
    meta: true,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b ",
    raw: "\x1b ",
  })

  const resultDoubleEscape = await triggerInput("\x1b\x1b")
  expect(resultDoubleEscape).toMatchObject({
    eventType: "press",
    name: "escape",
    ctrl: false,
    meta: true,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b\x1b",
    raw: "\x1b\x1b",
  })
})

// ===== KITTY KEYBOARD PROTOCOL INTEGRATION TESTS =====

test("Kitty keyboard basic key via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97u")
  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard shift+a via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97:65;2u")
  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: false,
    shift: true,
    option: false,
    number: false,
    sequence: "A",
    raw: "\x1b[97:65;2u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard ctrl+a via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;5u")
  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: true,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;5u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard alt+a via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;3u")
  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: true,
    shift: false,
    option: true,
    number: false,
    sequence: "a",
    raw: "\x1b[97;3u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard function key via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[57364u")
  expect(result).toMatchObject({
    eventType: "press",
    name: "f1",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[57364u",
    raw: "\x1b[57364u",
    code: "[57364u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard arrow key via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[57352u")
  expect(result).toMatchObject({
    eventType: "press",
    name: "up",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[57352u",
    raw: "\x1b[57352u",
    code: "[57352u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard shift+space via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[32;2u")
  expect(result).toMatchObject({
    eventType: "press",
    name: " ",
    ctrl: false,
    meta: false,
    shift: true,
    option: false,
    number: false,
    sequence: " ",
    raw: "\x1b[32;2u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard event types via keyInput events", async () => {
  // Press event (explicit)
  const pressExplicit = await triggerKittyInput("\x1b[97;1:1u")
  expect(pressExplicit).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;1:1u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })

  // Press event (default when no event type specified)
  const pressDefault = await triggerKittyInput("\x1b[97u")
  expect(pressDefault).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })

  // Press event (modifier without event type)
  const pressWithModifier = await triggerKittyInput("\x1b[97;5u") // Ctrl+a
  expect(pressWithModifier).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: true,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;5u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })

  // Repeat event (emitted as press with repeated=true)
  const repeat = await triggerKittyInput("\x1b[97;1:2u")
  expect(repeat).toMatchObject({
    eventType: "press",
    repeated: true,
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;1:2u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })

  // Release event
  const release = await triggerKittyInput("\x1b[97;1:3u")
  expect(release).toMatchObject({
    eventType: "release",
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;1:3u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })

  // Repeat event with modifier (emitted as press with repeated=true)
  const repeatWithCtrl = await triggerKittyInput("\x1b[97;5:2u")
  expect(repeatWithCtrl).toMatchObject({
    eventType: "press",
    repeated: true,
    name: "a",
    ctrl: true,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;5:2u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })

  // Release event with modifier
  const releaseWithShift = await triggerKittyInput("\x1b[97;2:3u")
  expect(releaseWithShift).toMatchObject({
    eventType: "release",
    name: "a",
    ctrl: false,
    meta: false,
    shift: true,
    option: false,
    number: false,
    sequence: "A",
    raw: "\x1b[97;2:3u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard with text via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;1;97u")
  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;1;97u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard ctrl+shift+a via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;6u")
  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: true,
    meta: false,
    shift: true,
    option: false,
    number: false,
    sequence: "A",
    raw: "\x1b[97;6u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard alt+shift+a via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;4u")
  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: true,
    shift: true,
    option: true,
    number: false,
    sequence: "A",
    raw: "\x1b[97;4u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard super+a via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;9u") // modifier 9 - 1 = 8 = super
  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;9u",
    super: true,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard hyper+a via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;17u") // modifier 17 - 1 = 16 = hyper
  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;17u",
    super: false,
    hyper: true,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard caps lock via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;65u") // modifier 65 - 1 = 64 = caps lock
  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;65u",
    super: false,
    hyper: false,
    capsLock: true,
    numLock: false,
  })
})

test("Kitty keyboard num lock via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;129u") // modifier 129 - 1 = 128 = num lock
  expect(result).toMatchObject({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;129u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: true,
  })
})

test("Kitty keyboard unicode character via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[233u") // é
  expect(result).toMatchObject({
    eventType: "press",
    name: "é",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "é",
    raw: "\x1b[233u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard emoji via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[128512u") // 😀
  expect(result).toMatchObject({
    eventType: "press",
    name: "😀",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "😀",
    raw: "\x1b[128512u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard keypad keys via keyInput events", async () => {
  const kp0 = await triggerKittyInput("\x1b[57399u")
  expect(kp0?.name).toBe("kp0")

  const kpEnter = await triggerKittyInput("\x1b[57414u")
  expect(kpEnter?.name).toBe("kpenter")
})

test("Kitty keyboard media keys via keyInput events", async () => {
  const play = await triggerKittyInput("\x1b[57428u")
  expect(play?.name).toBe("mediaplay")

  const volumeUp = await triggerKittyInput("\x1b[57439u")
  expect(volumeUp?.name).toBe("volumeup")
})

test("Kitty keyboard modifier keys via keyInput events", async () => {
  const leftShift = await triggerKittyInput("\x1b[57441u")
  expect(leftShift?.name).toBe("leftshift")
  expect(leftShift?.eventType).toBe("press")

  const rightCtrl = await triggerKittyInput("\x1b[57448u")
  expect(rightCtrl?.name).toBe("rightctrl")
  expect(rightCtrl?.eventType).toBe("press")
})

test("Kitty keyboard function keys with event types via keyInput events", async () => {
  // F1 press
  const f1Press = await triggerKittyInput("\x1b[57364u")
  expect(f1Press.name).toBe("f1")
  expect(f1Press.eventType).toBe("press")
  expect(f1Press.super ?? false).toBe(false)
  expect(f1Press.hyper ?? false).toBe(false)
  expect(f1Press.capsLock ?? false).toBe(false)
  expect(f1Press.numLock ?? false).toBe(false)

  // F1 repeat (emitted as press with repeated=true)
  const f1Repeat = await triggerKittyInput("\x1b[57364;1:2u")
  expect(f1Repeat.name).toBe("f1")
  expect(f1Repeat.eventType).toBe("press")
  expect((f1Repeat as any).repeated).toBe(true)
  expect(f1Repeat.super ?? false).toBe(false)
  expect(f1Repeat.hyper ?? false).toBe(false)
  expect(f1Repeat.capsLock ?? false).toBe(false)
  expect(f1Repeat.numLock ?? false).toBe(false)

  // F1 release
  const f1Release = await triggerKittyInput("\x1b[57364;1:3u")
  expect(f1Release.name).toBe("f1")
  expect(f1Release.eventType).toBe("release")
  expect(f1Release.super ?? false).toBe(false)
  expect(f1Release.hyper ?? false).toBe(false)
  expect(f1Release.capsLock ?? false).toBe(false)
  expect(f1Release.numLock ?? false).toBe(false)
})

test("Kitty keyboard arrow keys with event types via keyInput events", async () => {
  // Up arrow press
  const upPress = await triggerKittyInput("\x1b[57352u")
  expect(upPress.name).toBe("up")
  expect(upPress.eventType).toBe("press")
  expect(upPress.super ?? false).toBe(false)
  expect(upPress.hyper ?? false).toBe(false)
  expect(upPress.capsLock ?? false).toBe(false)
  expect(upPress.numLock ?? false).toBe(false)

  // Up arrow repeat with Ctrl (emitted as press with repeated=true)
  const upRepeatCtrl = await triggerKittyInput("\x1b[57352;5:2u")
  expect(upRepeatCtrl.name).toBe("up")
  expect(upRepeatCtrl.ctrl).toBe(true)
  expect(upRepeatCtrl.eventType).toBe("press")
  expect((upRepeatCtrl as any).repeated).toBe(true)
  expect(upRepeatCtrl.super).toBe(false)
  expect(upRepeatCtrl.hyper).toBe(false)
  expect(upRepeatCtrl.capsLock).toBe(false)
  expect(upRepeatCtrl.numLock).toBe(false)

  // Down arrow release
  const downRelease = await triggerKittyInput("\x1b[57353;1:3u")
  expect(downRelease.name).toBe("down")
  expect(downRelease.eventType).toBe("release")
  expect(downRelease.super).toBe(false)
  expect(downRelease.hyper).toBe(false)
  expect(downRelease.capsLock).toBe(false)
  expect(downRelease.numLock).toBe(false)
})

// ===== MISSING UNIT TEST CASES INTEGRATION TESTS =====

test("high byte buffer handling via keyInput events", async () => {
  // Test with Buffer input by emitting buffer data directly
  const result = await new Promise<KeyEvent>((resolve) => {
    const onKeypress = (parsedKey: KeyEvent) => {
      currentRenderer.keyInput.removeListener("keypress", onKeypress)
      resolve(parsedKey)
    }

    currentRenderer.keyInput.on("keypress", onKeypress)
    // 128 + 32 = 160, should become \x1b + " "
    currentRenderer.stdin.emit("data", Buffer.from([160]))
  })

  expect(result).toMatchObject({
    eventType: "press",
    name: "space",
    ctrl: false,
    meta: true,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b ",
    raw: "\x1b ",
  })
})

test("empty input via keyInput events", async () => {
  const result = await triggerInput("")
  expect(result).toMatchObject({
    eventType: "press",
    name: "",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "",
    raw: "",
  })
})

test("rxvt style arrow keys with modifiers via keyInput events", async () => {
  const resultShiftUp = await triggerInput("\x1b[a")
  expect(resultShiftUp).toMatchObject({
    eventType: "press",
    name: "up",
    ctrl: false,
    meta: false,
    shift: true,
    option: false,
    number: false,
    sequence: "\x1b[a",
    raw: "\x1b[a",
    code: "[a",
  })

  const resultShiftInsert = await triggerInput("\x1b[2$")
  expect(resultShiftInsert).toMatchObject({
    eventType: "press",
    name: "insert",
    ctrl: false,
    meta: false,
    shift: true,
    option: false,
    number: false,
    sequence: "\x1b[2$",
    raw: "\x1b[2$",
    code: "[2$",
  })
})

test("ctrl modifier keys via keyInput events", async () => {
  const resultCtrlUp = await triggerInput("\x1bOa")
  expect(resultCtrlUp).toMatchObject({
    eventType: "press",
    name: "up",
    ctrl: true,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1bOa",
    raw: "\x1bOa",
    code: "Oa",
  })

  const resultCtrlInsert = await triggerInput("\x1b[2^")
  expect(resultCtrlInsert).toMatchObject({
    eventType: "press",
    name: "insert",
    ctrl: true,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\x1b[2^",
    raw: "\x1b[2^",
    code: "[2^",
  })
})

test("modifier bit calculations and meta/alt relationship via keyInput events", async () => {
  // Super modifier is bit 8, so modifier value 9 = 8 + 1 (base)
  const superOnly = await triggerInput("\x1b[1;9A")
  expect(superOnly.name).toBe("up")
  expect(superOnly.meta).toBe(false)
  expect(superOnly.ctrl).toBe(false)
  expect(superOnly.shift).toBe(false)
  expect(superOnly.option).toBe(false)
  expect((superOnly as any).super).toBe(true)
  expect((superOnly as any).hyper).toBe(false)

  // Alt/Option modifier is bit 1 (value 2), so modifier value 3 = 2 + 1
  const altOnly = await triggerInput("\x1b[1;3A")
  expect(altOnly.name).toBe("up")
  expect(altOnly.meta).toBe(true) // Alt sets meta flag (by design)
  expect(altOnly.option).toBe(true)
  expect(altOnly.ctrl).toBe(false)
  expect(altOnly.shift).toBe(false)

  // Ctrl modifier is bit 2 (value 4), so modifier value 5 = 4 + 1
  const ctrlOnly = await triggerInput("\x1b[1;5A")
  expect(ctrlOnly.name).toBe("up")
  expect(ctrlOnly.ctrl).toBe(true)
  expect(ctrlOnly.meta).toBe(false)
  expect(ctrlOnly.shift).toBe(false)
  expect(ctrlOnly.option).toBe(false)

  // Shift modifier is bit 0 (value 1), so modifier value 2 = 1 + 1
  const shiftOnly = await triggerInput("\x1b[1;2A")
  expect(shiftOnly.name).toBe("up")
  expect(shiftOnly.shift).toBe(true)
  expect(shiftOnly.ctrl).toBe(false)
  expect(shiftOnly.meta).toBe(false)
  expect(shiftOnly.option).toBe(false)

  // Combined modifiers
  // Ctrl+Super = 4 + 8 = 12, so modifier value 13 = 12 + 1
  const ctrlSuper = await triggerInput("\x1b[1;13A")
  expect(ctrlSuper.name).toBe("up")
  expect(ctrlSuper.ctrl).toBe(true)
  expect(ctrlSuper.meta).toBe(false)
  expect(ctrlSuper.shift).toBe(false)
  expect(ctrlSuper.option).toBe(false)
  expect((ctrlSuper as any).super).toBe(true)
  expect((ctrlSuper as any).hyper).toBe(false)

  // Shift+Alt = 1 + 2 = 3, so modifier value 4 = 3 + 1
  const shiftAlt = await triggerInput("\x1b[1;4A")
  expect(shiftAlt.name).toBe("up")
  expect(shiftAlt.shift).toBe(true)
  expect(shiftAlt.option).toBe(true)
  expect(shiftAlt.meta).toBe(true) // Alt sets meta flag
  expect(shiftAlt.ctrl).toBe(false)

  // All modifiers: Shift(1) + Alt(2) + Ctrl(4) + Meta(8) = 15, so modifier value 16 = 15 + 1
  const allMods = await triggerInput("\x1b[1;16A")
  expect(allMods.name).toBe("up")
  expect(allMods.shift).toBe(true)
  expect(allMods.option).toBe(true)
  expect(allMods.ctrl).toBe(true)
  expect(allMods.meta).toBe(true)
})

test("modifier combinations with function keys via keyInput events", async () => {
  // Ctrl+F1
  const ctrlF1 = await triggerInput("\x1b[11;5~")
  expect(ctrlF1.name).toBe("f1")
  expect(ctrlF1.ctrl).toBe(true)
  expect(ctrlF1.meta).toBe(false)
  expect(ctrlF1.eventType).toBe("press")

  // Super+F1
  const superF1 = await triggerInput("\x1b[11;9~")
  expect(superF1.name).toBe("f1")
  expect(superF1.meta).toBe(false)
  expect(superF1.ctrl).toBe(false)
  expect(superF1.super).toBe(true)
  expect(superF1.hyper).toBe(false)
  expect(superF1.eventType).toBe("press")

  // Shift+Ctrl+F1
  const shiftCtrlF1 = await triggerInput("\x1b[11;6~")
  expect(shiftCtrlF1.name).toBe("f1")
  expect(shiftCtrlF1.shift).toBe(true)
  expect(shiftCtrlF1.ctrl).toBe(true)
  expect(shiftCtrlF1.meta).toBe(false)
  expect(shiftCtrlF1.eventType).toBe("press")
})

test("regular parsing always defaults to press event type via keyInput events", async () => {
  // Test various regular key sequences to ensure they all default to "press"
  const keys = [
    "a",
    "A",
    "1",
    "!",
    "\t",
    "\r",
    "\n",
    " ",
    "\x1b",
    "\x01", // Ctrl+A
    "\x1ba", // Alt+A
    "\x1b[A", // Up arrow
    "\x1b[11~", // F1
    "\x1b[1;2A", // Shift+Up
    "\x1b[3~", // Delete
  ]

  for (const keySeq of keys) {
    const result = await triggerInput(keySeq)
    expect(result.eventType).toBe("press")
  }

  // Test with Buffer input too
  const bufResult = await new Promise<KeyEvent>((resolve) => {
    const onKeypress = (parsedKey: KeyEvent) => {
      currentRenderer.keyInput.removeListener("keypress", onKeypress)
      resolve(parsedKey)
    }

    currentRenderer.keyInput.once("keypress", onKeypress)
    currentRenderer.stdin.emit("data", Buffer.from("x"))
  })
  expect(bufResult.eventType).toBe("press")
})

test("nonAlphanumericKeys export validation", async () => {
  expect(Array.isArray(nonAlphanumericKeys)).toBe(true)
  expect(nonAlphanumericKeys.length).toBeGreaterThan(0)
  expect(nonAlphanumericKeys).toContain("up")
  expect(nonAlphanumericKeys).toContain("down")
  expect(nonAlphanumericKeys).toContain("f1")
  expect(nonAlphanumericKeys).toContain("backspace")
  expect(nonAlphanumericKeys).toContain("tab")
  expect(nonAlphanumericKeys).toContain("left")
  expect(nonAlphanumericKeys).toContain("right")
})

test("ParsedKey type structure validation", async () => {
  const key: ParsedKey = {
    name: "test",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: "test",
    raw: "test",
    number: false,
    eventType: "press",
    source: "raw",
  }

  expect(key).toHaveProperty("name")
  expect(key).toHaveProperty("ctrl")
  expect(key).toHaveProperty("meta")
  expect(key).toHaveProperty("shift")
  expect(key).toHaveProperty("option")
  expect(key).toHaveProperty("sequence")
  expect(key).toHaveProperty("raw")
  expect(key).toHaveProperty("number")

  // Test that a key with code property works
  const keyWithCode: ParsedKey = {
    name: "up",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: "\x1b[A",
    raw: "\x1b[A",
    number: false,
    code: "[A",
    eventType: "press",
    source: "raw",
  }

  expect(keyWithCode).toHaveProperty("code")
  expect(keyWithCode.code).toBe("[A")
})

test("KeyEventType type validation", async () => {
  // Test that KeyEventType only allows valid values
  const validEventTypes: KeyEventType[] = ["press", "repeat", "release"]

  for (const eventType of validEventTypes) {
    // This should compile without errors
    const mockKey: ParsedKey = {
      name: "test",
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: "test",
      raw: "test",
      number: false,
      eventType: eventType,
      source: "raw",
    }
    expect(mockKey.eventType).toBe(eventType)
  }
})

// ===== CAPABILITY RESPONSE HANDLING TESTS =====

test("capability responses should not trigger keypress events", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // Send various capability responses - none should trigger keypresses
  currentRenderer.stdin.emit("data", Buffer.from("\x1b[?1016;2$y")) // DECRPM
  currentRenderer.stdin.emit("data", Buffer.from("\x1b[1;2R")) // CPR
  currentRenderer.stdin.emit("data", Buffer.from("\x1b[?62;c")) // DA1

  // Wait for StdinBuffer timeout
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(keypresses).toHaveLength(0)
})

test("capability response followed by keypress", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // Send capability response followed by 'a'
  currentRenderer.stdin.emit("data", Buffer.from("\x1b[?1016;2$ya"))

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(keypresses).toHaveLength(1)
  expect(keypresses[0].name).toBe("a")
})

test("chunked XTVersion response should not trigger keypresses", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // Send XTVersion in chunks (chunks arrive quickly, within StdinBuffer timeout)
  currentRenderer.stdin.emit("data", Buffer.from("\x1bP>|kit"))
  currentRenderer.stdin.emit("data", Buffer.from("ty(0.40"))
  currentRenderer.stdin.emit("data", Buffer.from(".1)\x1b\\"))

  // Wait for StdinBuffer to process
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(keypresses).toHaveLength(0)
})

test("chunked XTVersion followed by keypress", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // Send XTVersion in chunks followed by 'x'
  currentRenderer.stdin.emit("data", Buffer.from("\x1bP>|ghostty"))
  currentRenderer.stdin.emit("data", Buffer.from(" 1.1.3\x1b\\x"))

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(keypresses).toHaveLength(1)
  expect(keypresses[0].name).toBe("x")
})

test("chunked Kitty graphics response should not trigger keypresses", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // Send Kitty graphics response in chunks (arriving quickly)
  currentRenderer.stdin.emit("data", Buffer.from("\x1b_Gi=1;"))
  currentRenderer.stdin.emit("data", Buffer.from("EINVAL:"))
  currentRenderer.stdin.emit("data", Buffer.from("Zero width/height not allowed\x1b\\"))

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(keypresses).toHaveLength(0)
})

test("multiple DECRPM responses in sequence", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // Simulate multiple DECRPM responses arriving together
  currentRenderer.stdin.emit("data", Buffer.from("\x1b[?1016;2$y\x1b[?2027;0$y\x1b[?2031;2$y"))
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(keypresses).toHaveLength(0)
})

test("pixel resolution response should not trigger keypress", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // Mark as waiting for resolution
  // @ts-expect-error - accessing private property for testing
  currentRenderer.waitingForPixelResolution = true

  currentRenderer.stdin.emit("data", Buffer.from("\x1b[4;720;1280t"))
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(keypresses).toHaveLength(0)
  expect(currentRenderer.resolution).toEqual({ width: 1280, height: 720 })
})

test("chunked pixel resolution response", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // @ts-expect-error - accessing private property for testing
  currentRenderer.waitingForPixelResolution = true

  // Send pixel resolution in chunks (arriving quickly)
  currentRenderer.stdin.emit("data", Buffer.from("\x1b[4;72"))
  currentRenderer.stdin.emit("data", Buffer.from("0;1280t"))

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(keypresses).toHaveLength(0)
  expect(currentRenderer.resolution).toEqual({ width: 1280, height: 720 })
})

test("kitty full capability response arriving in realistic chunks", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // Simulate how kitty might send its full response in a few chunks
  currentRenderer.stdin.emit("data", Buffer.from("\x1b[?1016;2$y\x1b[?2027;0$y"))
  await new Promise((resolve) => setTimeout(resolve, 1))

  currentRenderer.stdin.emit("data", Buffer.from("\x1b[?2031;2$y\x1b[?1004;1$y\x1b[1;2R\x1b[1;3R"))
  await new Promise((resolve) => setTimeout(resolve, 1))

  currentRenderer.stdin.emit("data", Buffer.from("\x1bP>|kitty(0."))
  await new Promise((resolve) => setTimeout(resolve, 1))

  currentRenderer.stdin.emit("data", Buffer.from("40.1)\x1b\\\x1b_Gi=1;OK\x1b\\"))
  await new Promise((resolve) => setTimeout(resolve, 1))

  currentRenderer.stdin.emit("data", Buffer.from("\x1b[?62;c"))

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(keypresses).toHaveLength(0)
})

test("capability response interleaved with user input", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // User types 'h'
  currentRenderer.stdin.emit("data", Buffer.from("h"))

  // Capability response arrives
  currentRenderer.stdin.emit("data", Buffer.from("\x1b[?1016;2$y"))

  // User types 'e'
  currentRenderer.stdin.emit("data", Buffer.from("e"))

  // More capability responses
  currentRenderer.stdin.emit("data", Buffer.from("\x1bP>|kitty(0.40.1)\x1b\\"))

  // User types 'llo'
  currentRenderer.stdin.emit("data", Buffer.from("llo"))

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 15))

  // Should only have user keypresses
  expect(keypresses).toHaveLength(5)
  expect(keypresses.map((k) => k.name)).toEqual(["h", "e", "l", "l", "o"])
})

test("delayed capability responses should be processed", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // User input first
  currentRenderer.stdin.emit("data", Buffer.from("abc"))

  // Late capability response (e.g., terminal was slow to respond)
  await new Promise((resolve) => setTimeout(resolve, 50))
  currentRenderer.stdin.emit("data", Buffer.from("\x1b[?2027;2$y"))

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 15))

  // Should have user input but not capability
  expect(keypresses).toHaveLength(3)
  expect(keypresses.map((k) => k.name)).toEqual(["a", "b", "c"])
})

test("vscode minimal capability response", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // VSCode often sends just one DECRPM
  currentRenderer.stdin.emit("data", Buffer.from("\x1b[?1016;2$y"))
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(keypresses).toHaveLength(0)
})

test("alacritty capability response sequence", async () => {
  const keypresses: KeyEvent[] = []
  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  // Simulate alacritty's response pattern
  const alacrittyResponse =
    "\x1b[?1016;0$y\x1b[?2027;0$y\x1b[?2031;0$y\x1b[?1004;2$y\x1b[?2004;2$y\x1b[?2026;2$y\x1b[1;1R\x1b[1;1R\x1b[?0u\x1b[?6c"
  currentRenderer.stdin.emit("data", Buffer.from(alacrittyResponse))
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(keypresses).toHaveLength(0)
})

test("focus and blur events", async () => {
  const events: string[] = []

  currentRenderer.on("focus", () => {
    events.push("focus")
  })

  currentRenderer.on("blur", () => {
    events.push("blur")
  })

  currentRenderer.stdin.emit("data", Buffer.from("\x1b[I"))
  await new Promise((resolve) => setTimeout(resolve, 15))

  currentRenderer.stdin.emit("data", Buffer.from("\x1b[O"))
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(events).toEqual(["focus", "blur"])
})

test("focus events should not trigger keypress", async () => {
  const keypresses: KeyEvent[] = []
  const focusEvents: string[] = []

  currentRenderer.keyInput.on("keypress", (event) => {
    keypresses.push(event)
  })

  currentRenderer.on("focus", () => {
    focusEvents.push("focus")
  })

  currentRenderer.on("blur", () => {
    focusEvents.push("blur")
  })

  currentRenderer.stdin.emit("data", Buffer.from("\x1b[I"))
  await new Promise((resolve) => setTimeout(resolve, 15))
  currentRenderer.stdin.emit("data", Buffer.from("\x1b[O"))
  await new Promise((resolve) => setTimeout(resolve, 15))

  expect(focusEvents).toEqual(["focus", "blur"])
  expect(keypresses).toHaveLength(0)
})
