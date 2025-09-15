import { test, expect, beforeEach, afterEach } from "bun:test"
import { type ParsedKey, nonAlphanumericKeys, type KeyEventType } from "../lib/parse.keypress"
import { Buffer } from "node:buffer"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"

let currentRenderer: TestRenderer
let kittyRenderer: TestRenderer

beforeEach(async () => {
  ;({ renderer: currentRenderer } = await createTestRenderer({}))
  ;({ renderer: kittyRenderer } = await createTestRenderer({ useKittyKeyboard: true }))
})

afterEach(() => {
  currentRenderer.destroy()
  kittyRenderer.destroy()
})

async function triggerInput(sequence: string): Promise<ParsedKey> {
  return new Promise((resolve) => {
    const onKeypress = (parsedKey: ParsedKey) => {
      currentRenderer.keyInput.removeListener("keypress", onKeypress)
      resolve(parsedKey)
    }

    currentRenderer.keyInput.once("keypress", onKeypress)

    currentRenderer.stdin.emit("data", Buffer.from(sequence))
  })
}

async function triggerKittyInput(sequence: string): Promise<ParsedKey> {
  return new Promise((resolve) => {
    const onKeypress = (parsedKey: ParsedKey) => {
      kittyRenderer.keyInput.removeListener("keypress", onKeypress)
      kittyRenderer.keyInput.removeListener("keyrepeat", onKeypress)
      kittyRenderer.keyInput.removeListener("keyrelease", onKeypress)
      resolve(parsedKey)
    }

    kittyRenderer.keyInput.on("keypress", onKeypress)
    kittyRenderer.keyInput.on("keyrepeat", onKeypress)
    kittyRenderer.keyInput.on("keyrelease", onKeypress)

    kittyRenderer.stdin.emit("data", Buffer.from(sequence))
  })
}

test("basic letters via keyInput events", async () => {
  const result = await triggerInput("a")
  expect(result).toEqual({
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
  expect(resultShift).toEqual({
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
  expect(result).toEqual({
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
  expect(resultReturn).toEqual({
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
  expect(resultEnter).toEqual({
    eventType: "press",
    name: "enter",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: "\n",
    raw: "\n",
  })

  const resultTab = await triggerInput("\t")
  expect(resultTab).toEqual({
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
  expect(resultBackspace).toEqual({
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
  expect(resultEscape).toEqual({
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
  expect(resultSpace).toEqual({
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
  expect(resultCtrlA).toEqual({
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
  expect(resultCtrlZ).toEqual({
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
  expect(resultMetaA).toEqual({
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
  expect(resultMetaShiftA).toEqual({
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
  expect(resultF1).toEqual({
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
  expect(resultF1Alt).toEqual({
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
  expect(resultF12).toEqual({
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
  expect(resultUp).toEqual({
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
  expect(resultDown).toEqual({
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
  expect(resultRight).toEqual({
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
  expect(resultLeft).toEqual({
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
  expect(resultHome).toEqual({
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
  expect(resultEnd).toEqual({
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
  expect(resultPageUp).toEqual({
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
  expect(resultPageDown).toEqual({
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
  expect(resultShiftUp).toEqual({
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
  expect(resultMetaAltUp).toEqual({
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
  expect(resultAllModsUp).toEqual({
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
  expect(resultDelete).toEqual({
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
  const result = await new Promise<ParsedKey>((resolve) => {
    const onKeypress = (parsedKey: ParsedKey) => {
      currentRenderer.keyInput.removeListener("keypress", onKeypress)
      resolve(parsedKey)
    }

    currentRenderer.keyInput.on("keypress", onKeypress)
    currentRenderer.stdin.emit("data", Buffer.from("a"))
  })

  expect(result).toEqual({
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
  expect(resultExclamation).toEqual({
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
  expect(resultAt).toEqual({
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
  expect(resultMetaSpace).toEqual({
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
  expect(resultDoubleEscape).toEqual({
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
  expect(result).toEqual({
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
  expect(result).toEqual({
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
  expect(result).toEqual({
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
  expect(result).toEqual({
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
  expect(result).toEqual({
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
  expect(result).toEqual({
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
  expect(result).toEqual({
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
  expect(pressExplicit).toEqual({
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
  expect(pressDefault).toEqual({
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
  expect(pressWithModifier).toEqual({
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

  // Repeat event
  const repeat = await triggerKittyInput("\x1b[97;1:2u")
  expect(repeat).toEqual({
    eventType: "repeat",
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
  expect(release).toEqual({
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

  // Repeat event with modifier
  const repeatWithCtrl = await triggerKittyInput("\x1b[97;5:2u")
  expect(repeatWithCtrl).toEqual({
    eventType: "repeat",
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
  expect(releaseWithShift).toEqual({
    eventType: "release",
    name: "a",
    ctrl: false,
    meta: false,
    shift: true,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;2:3u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard with text via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;1;97u")
  expect(result).toEqual({
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
  expect(result).toEqual({
    eventType: "press",
    name: "a",
    ctrl: true,
    meta: false,
    shift: true,
    option: false,
    number: false,
    sequence: "a",
    raw: "\x1b[97;6u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard alt+shift+a via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;4u")
  expect(result).toEqual({
    eventType: "press",
    name: "a",
    ctrl: false,
    meta: true,
    shift: true,
    option: true,
    number: false,
    sequence: "a",
    raw: "\x1b[97;4u",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  })
})

test("Kitty keyboard super+a via keyInput events", async () => {
  const result = await triggerKittyInput("\x1b[97;9u") // modifier 9 - 1 = 8 = super
  expect(result).toEqual({
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
  expect(result).toEqual({
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
  expect(result).toEqual({
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
  expect(result).toEqual({
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
  expect(result).toEqual({
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
  expect(result).toEqual({
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
  const kp0 = await triggerKittyInput("\x1b[57400u")
  expect(kp0?.name).toBe("kp0")

  const kpEnter = await triggerKittyInput("\x1b[57415u")
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

  // F1 repeat
  const f1Repeat = await triggerKittyInput("\x1b[57364;1:2u")
  expect(f1Repeat.name).toBe("f1")
  expect(f1Repeat.eventType).toBe("repeat")
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

  // Up arrow repeat with Ctrl
  const upRepeatCtrl = await triggerKittyInput("\x1b[57352;5:2u")
  expect(upRepeatCtrl.name).toBe("up")
  expect(upRepeatCtrl.ctrl).toBe(true)
  expect(upRepeatCtrl.eventType).toBe("repeat")
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
  const result = await new Promise<ParsedKey>((resolve) => {
    const onKeypress = (parsedKey: ParsedKey) => {
      currentRenderer.keyInput.removeListener("keypress", onKeypress)
      resolve(parsedKey)
    }

    currentRenderer.keyInput.on("keypress", onKeypress)
    // 128 + 32 = 160, should become \x1b + " "
    currentRenderer.stdin.emit("data", Buffer.from([160]))
  })

  expect(result).toEqual({
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
  expect(result).toEqual({
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
  expect(resultShiftUp).toEqual({
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
  expect(resultShiftInsert).toEqual({
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
  expect(resultCtrlUp).toEqual({
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
  expect(resultCtrlInsert).toEqual({
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
  // Meta modifier is bit 3 (value 8), so modifier value 9 = 8 + 1 (base)
  const metaOnly = await triggerInput("\x1b[1;9A")
  expect(metaOnly.name).toBe("up")
  expect(metaOnly.meta).toBe(true)
  expect(metaOnly.ctrl).toBe(false)
  expect(metaOnly.shift).toBe(false)
  expect(metaOnly.option).toBe(false)

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
  // Ctrl+Meta = 4 + 8 = 12, so modifier value 13 = 12 + 1
  const ctrlMeta = await triggerInput("\x1b[1;13A")
  expect(ctrlMeta.name).toBe("up")
  expect(ctrlMeta.ctrl).toBe(true)
  expect(ctrlMeta.meta).toBe(true)
  expect(ctrlMeta.shift).toBe(false)
  expect(ctrlMeta.option).toBe(false)

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

  // Meta+F1
  const metaF1 = await triggerInput("\x1b[11;9~")
  expect(metaF1.name).toBe("f1")
  expect(metaF1.meta).toBe(true)
  expect(metaF1.ctrl).toBe(false)
  expect(metaF1.eventType).toBe("press")

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
  const bufResult = await new Promise<ParsedKey>((resolve) => {
    const onKeypress = (parsedKey: ParsedKey) => {
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
    }
    expect(mockKey.eventType).toBe(eventType)
  }
})
