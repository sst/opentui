import { test, expect } from "bun:test"
import { parseKeypress, nonAlphanumericKeys, type ParsedKey, type KeyEventType } from "./parse.keypress"
import { Buffer } from "node:buffer"

test("parseKeypress - basic letters", () => {
  expect(parseKeypress("a")).toEqual({
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

  expect(parseKeypress("A")).toEqual({
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

test("parseKeypress - numbers", () => {
  expect(parseKeypress("1")).toEqual({
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

test("parseKeypress - special keys", () => {
  expect(parseKeypress("\r")).toEqual({
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

  expect(parseKeypress("\n")).toEqual({
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

  expect(parseKeypress("\t")).toEqual({
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

  expect(parseKeypress("\b")).toEqual({
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

  expect(parseKeypress("\x1b")).toEqual({
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

  expect(parseKeypress(" ")).toEqual({
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

test("parseKeypress - ctrl+letter combinations", () => {
  expect(parseKeypress("\x01")).toEqual({
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

  expect(parseKeypress("\x1a")).toEqual({
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

test("parseKeypress - meta+character combinations", () => {
  expect(parseKeypress("\x1ba")).toEqual({
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

  expect(parseKeypress("\x1bA")).toEqual({
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

test("parseKeypress - function keys", () => {
  expect(parseKeypress("\x1bOP")).toEqual({
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

  expect(parseKeypress("\x1b[11~")).toEqual({
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

  expect(parseKeypress("\x1b[24~")).toEqual({
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

test("parseKeypress - arrow keys", () => {
  expect(parseKeypress("\x1b[A")).toEqual({
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

  expect(parseKeypress("\x1b[B")).toEqual({
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

  expect(parseKeypress("\x1b[C")).toEqual({
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

  expect(parseKeypress("\x1b[D")).toEqual({
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

test("parseKeypress - navigation keys", () => {
  expect(parseKeypress("\x1b[H")).toEqual({
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

  expect(parseKeypress("\x1b[F")).toEqual({
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

  expect(parseKeypress("\x1b[5~")).toEqual({
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

  expect(parseKeypress("\x1b[6~")).toEqual({
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

test("parseKeypress - modifier combinations", () => {
  expect(parseKeypress("\x1b[1;2A")).toEqual({
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

  expect(parseKeypress("\x1b[1;4A")).toEqual({
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

  expect(parseKeypress("\x1b[1;8A")).toEqual({
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

  expect(parseKeypress("\x1b[1;3A")).toEqual({
    eventType: "press",
    name: "up",
    ctrl: false,
    meta: true,
    shift: false,
    option: true,
    number: false,
    sequence: "\x1b[1;3A",
    raw: "\x1b[1;3A",
    code: "[A",
  })
})

test("parseKeypress - delete key", () => {
  expect(parseKeypress("\x1b[3~")).toEqual({
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

test("parseKeypress - Buffer input", () => {
  const buf = Buffer.from("a")
  expect(parseKeypress(buf)).toEqual({
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

test("parseKeypress - high byte buffer handling", () => {
  const buf = Buffer.from([160]) // 128 + 32, should become \x1b + " "
  expect(parseKeypress(buf)).toEqual({
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

test("parseKeypress - empty input", () => {
  expect(parseKeypress("")).toEqual({
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

  expect(parseKeypress()).toEqual({
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

test("parseKeypress - special characters", () => {
  expect(parseKeypress("!")).toEqual({
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

  expect(parseKeypress("@")).toEqual({
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

test("parseKeypress - meta space and escape combinations", () => {
  expect(parseKeypress("\x1b ")).toEqual({
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

  expect(parseKeypress("\x1b\x1b")).toEqual({
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

test("parseKeypress - rxvt style arrow keys with modifiers", () => {
  expect(parseKeypress("\x1b[a")).toEqual({
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

  expect(parseKeypress("\x1b[2$")).toEqual({
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

test("parseKeypress - ctrl modifier keys", () => {
  expect(parseKeypress("\x1bOa")).toEqual({
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

  expect(parseKeypress("\x1b[2^")).toEqual({
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

test("nonAlphanumericKeys export", () => {
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

test("ParsedKey type structure", () => {
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
  // code is optional, so it may or may not be present

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

// Tests for modifier bit calculations and meta/alt relationship
test("parseKeypress - modifier bit calculations and meta/alt relationship", () => {
  // Meta modifier is bit 3 (value 8), so modifier value 9 = 8 + 1 (base)
  const metaOnly = parseKeypress("\x1b[1;9A")
  expect(metaOnly.name).toBe("up")
  expect(metaOnly.meta).toBe(true)
  expect(metaOnly.ctrl).toBe(false)
  expect(metaOnly.shift).toBe(false)
  expect(metaOnly.option).toBe(false)

  // Alt/Option modifier is bit 1 (value 2), so modifier value 3 = 2 + 1
  // Note: meta flag is set for Alt as well (common terminal behavior)
  const altOnly = parseKeypress("\x1b[1;3A")
  expect(altOnly.name).toBe("up")
  expect(altOnly.meta).toBe(true) // Alt sets meta flag (by design)
  expect(altOnly.option).toBe(true)
  expect(altOnly.ctrl).toBe(false)
  expect(altOnly.shift).toBe(false)

  // Ctrl modifier is bit 2 (value 4), so modifier value 5 = 4 + 1
  const ctrlOnly = parseKeypress("\x1b[1;5A")
  expect(ctrlOnly.name).toBe("up")
  expect(ctrlOnly.ctrl).toBe(true)
  expect(ctrlOnly.meta).toBe(false)
  expect(ctrlOnly.shift).toBe(false)
  expect(ctrlOnly.option).toBe(false)

  // Shift modifier is bit 0 (value 1), so modifier value 2 = 1 + 1
  const shiftOnly = parseKeypress("\x1b[1;2A")
  expect(shiftOnly.name).toBe("up")
  expect(shiftOnly.shift).toBe(true)
  expect(shiftOnly.ctrl).toBe(false)
  expect(shiftOnly.meta).toBe(false)
  expect(shiftOnly.option).toBe(false)

  // Combined modifiers
  // Ctrl+Meta = 4 + 8 = 12, so modifier value 13 = 12 + 1
  const ctrlMeta = parseKeypress("\x1b[1;13A")
  expect(ctrlMeta.name).toBe("up")
  expect(ctrlMeta.ctrl).toBe(true)
  expect(ctrlMeta.meta).toBe(true)
  expect(ctrlMeta.shift).toBe(false)
  expect(ctrlMeta.option).toBe(false)

  // Shift+Alt = 1 + 2 = 3, so modifier value 4 = 3 + 1
  const shiftAlt = parseKeypress("\x1b[1;4A")
  expect(shiftAlt.name).toBe("up")
  expect(shiftAlt.shift).toBe(true)
  expect(shiftAlt.option).toBe(true)
  expect(shiftAlt.meta).toBe(true) // Alt sets meta flag
  expect(shiftAlt.ctrl).toBe(false)

  // All modifiers: Shift(1) + Alt(2) + Ctrl(4) + Meta(8) = 15, so modifier value 16 = 15 + 1
  const allMods = parseKeypress("\x1b[1;16A")
  expect(allMods.name).toBe("up")
  expect(allMods.shift).toBe(true)
  expect(allMods.option).toBe(true)
  expect(allMods.ctrl).toBe(true)
  expect(allMods.meta).toBe(true)
})

test("parseKeypress - modifier combinations with function keys", () => {
  // Ctrl+F1
  const ctrlF1 = parseKeypress("\x1b[11;5~")
  expect(ctrlF1.name).toBe("f1")
  expect(ctrlF1.ctrl).toBe(true)
  expect(ctrlF1.meta).toBe(false)
  expect(ctrlF1.eventType).toBe("press")

  // Meta+F1
  const metaF1 = parseKeypress("\x1b[11;9~")
  expect(metaF1.name).toBe("f1")
  expect(metaF1.meta).toBe(true)
  expect(metaF1.ctrl).toBe(false)
  expect(metaF1.eventType).toBe("press")

  // Shift+Ctrl+F1
  const shiftCtrlF1 = parseKeypress("\x1b[11;6~")
  expect(shiftCtrlF1.name).toBe("f1")
  expect(shiftCtrlF1.shift).toBe(true)
  expect(shiftCtrlF1.ctrl).toBe(true)
  expect(shiftCtrlF1.meta).toBe(false)
  expect(shiftCtrlF1.eventType).toBe("press")
})

test("parseKeypress - regular parsing always defaults to press event type", () => {
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
    const result = parseKeypress(keySeq)
    expect(result.eventType).toBe("press")
  }

  // Test with Buffer input too
  const bufResult = parseKeypress(Buffer.from("x"))
  expect(bufResult.eventType).toBe("press")
})

test("KeyEventType type validation", () => {
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
