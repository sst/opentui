import { test, expect } from "bun:test"
import { buildKittyKeyboardFlags } from "../renderer"

// Kitty Keyboard Protocol progressive enhancement flags
// See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/#progressive-enhancement
const KITTY_FLAG_DISAMBIGUATE = 0b1 // Report disambiguated escape codes
const KITTY_FLAG_EVENT_TYPES = 0b10 // Report event types (press/repeat/release)
const KITTY_FLAG_ALTERNATE_KEYS = 0b100 // Report alternate keys (e.g., numpad vs regular)
const KITTY_FLAG_ALL_KEYS_AS_ESCAPES = 0b1000 // Report all keys as escape codes
const KITTY_FLAG_REPORT_TEXT = 0b10000 // Report text associated with key events

test("buildKittyKeyboardFlags - null/undefined returns 0", () => {
  expect(buildKittyKeyboardFlags(null)).toBe(0)
  expect(buildKittyKeyboardFlags(undefined)).toBe(0)
})

test("buildKittyKeyboardFlags - empty object returns DISAMBIGUATE | ALTERNATE_KEYS (0b101)", () => {
  // Default behavior: disambiguate + alternate keys
  // - Disambiguate fixes ESC timing issues, alt+key ambiguity, makes ctrl+c a key event
  // - Alternate keys enables shifted/base-layout keys for robust shortcut matching
  const expected = KITTY_FLAG_DISAMBIGUATE | KITTY_FLAG_ALTERNATE_KEYS
  expect(buildKittyKeyboardFlags({})).toBe(expected)
  expect(buildKittyKeyboardFlags({})).toBe(0b101)
  expect(buildKittyKeyboardFlags({})).toBe(5)
})

test("buildKittyKeyboardFlags - events: false returns DISAMBIGUATE | ALTERNATE_KEYS (0b101)", () => {
  // Explicit no events: disambiguate + alternate keys
  const expected = KITTY_FLAG_DISAMBIGUATE | KITTY_FLAG_ALTERNATE_KEYS
  expect(buildKittyKeyboardFlags({ events: false })).toBe(expected)
  expect(buildKittyKeyboardFlags({ events: false })).toBe(0b101)
  expect(buildKittyKeyboardFlags({ events: false })).toBe(5)
})

test("buildKittyKeyboardFlags - events: true returns DISAMBIGUATE | ALTERNATE_KEYS | EVENT_TYPES (0b111)", () => {
  // With event types: disambiguate + alternate keys + event types (press/repeat/release)
  const expected = KITTY_FLAG_DISAMBIGUATE | KITTY_FLAG_ALTERNATE_KEYS | KITTY_FLAG_EVENT_TYPES
  expect(buildKittyKeyboardFlags({ events: true })).toBe(expected)
  expect(buildKittyKeyboardFlags({ events: true })).toBe(0b111)
  expect(buildKittyKeyboardFlags({ events: true })).toBe(7)
})

test("buildKittyKeyboardFlags - flag values match kitty spec constants", () => {
  // Default: disambiguate + alternate keys
  expect(buildKittyKeyboardFlags({})).toBe(KITTY_FLAG_DISAMBIGUATE | KITTY_FLAG_ALTERNATE_KEYS)

  // With events: disambiguate + alternate keys + event types
  expect(buildKittyKeyboardFlags({ events: true })).toBe(
    KITTY_FLAG_DISAMBIGUATE | KITTY_FLAG_ALTERNATE_KEYS | KITTY_FLAG_EVENT_TYPES,
  )
})

test("kitty flag constants match spec bit positions", () => {
  // Verify our constants match the kitty keyboard protocol spec
  // https://sw.kovidgoyal.net/kitty/keyboard-protocol/#progressive-enhancement
  expect(KITTY_FLAG_DISAMBIGUATE).toBe(1)
  expect(KITTY_FLAG_EVENT_TYPES).toBe(2)
  expect(KITTY_FLAG_ALTERNATE_KEYS).toBe(4)
  expect(KITTY_FLAG_ALL_KEYS_AS_ESCAPES).toBe(8)
  expect(KITTY_FLAG_REPORT_TEXT).toBe(16)
})

test("flag bit positions are correct powers of 2", () => {
  // Each flag should be a distinct bit
  expect(KITTY_FLAG_DISAMBIGUATE).toBe(1 << 0)
  expect(KITTY_FLAG_EVENT_TYPES).toBe(1 << 1)
  expect(KITTY_FLAG_ALTERNATE_KEYS).toBe(1 << 2)
  expect(KITTY_FLAG_ALL_KEYS_AS_ESCAPES).toBe(1 << 3)
  expect(KITTY_FLAG_REPORT_TEXT).toBe(1 << 4)
})

test("flags can be combined with bitwise OR", () => {
  // Verify flags can be combined properly
  const combined = KITTY_FLAG_ALTERNATE_KEYS | KITTY_FLAG_EVENT_TYPES
  expect(combined).toBe(0b110)
  expect(combined).toBe(6)

  // Check individual bits are set
  expect(combined & KITTY_FLAG_ALTERNATE_KEYS).toBeTruthy()
  expect(combined & KITTY_FLAG_EVENT_TYPES).toBeTruthy()
  expect(combined & KITTY_FLAG_DISAMBIGUATE).toBeFalsy()
})

test("escape sequences match kitty spec format", () => {
  // According to the spec, the push escape code is: CSI > flags u
  // Where CSI = 0x1b 0x5b = \x1b[
  // So the format should be: \x1b[>5u for DISAMBIGUATE | ALTERNATE_KEYS
  // and \x1b[>7u for DISAMBIGUATE | ALTERNATE_KEYS | EVENT_TYPES

  const defaultFlags = buildKittyKeyboardFlags({})
  expect(defaultFlags).toBe(5)
  // The escape sequence would be: \x1b[>5u

  const withEventsFlags = buildKittyKeyboardFlags({ events: true })
  expect(withEventsFlags).toBe(7)
  // The escape sequence would be: \x1b[>7u
})

test("default config enables disambiguate and alternate keys", () => {
  // Default enables two key enhancements:
  // 1. Disambiguate (0b1): Fixes ESC timing, alt+key ambiguity, ctrl+c becomes key event
  // 2. Alternate keys (0b100): Reports shifted/base-layout keys for cross-keyboard shortcuts
  const flags = buildKittyKeyboardFlags({})

  // Should have disambiguate and alternate keys bits set
  expect(flags & KITTY_FLAG_DISAMBIGUATE).toBeTruthy()
  expect(flags & KITTY_FLAG_ALTERNATE_KEYS).toBeTruthy()

  // Should NOT have other enhancements by default
  expect(flags & KITTY_FLAG_EVENT_TYPES).toBeFalsy()
  expect(flags & KITTY_FLAG_ALL_KEYS_AS_ESCAPES).toBeFalsy()
  expect(flags & KITTY_FLAG_REPORT_TEXT).toBeFalsy()
})

test("events config adds event type reporting", () => {
  // With events enabled, we should be able to detect press/repeat/release
  const flags = buildKittyKeyboardFlags({ events: true })

  // Should have disambiguate, alternate keys, and event types
  expect(flags & KITTY_FLAG_DISAMBIGUATE).toBeTruthy()
  expect(flags & KITTY_FLAG_ALTERNATE_KEYS).toBeTruthy()
  expect(flags & KITTY_FLAG_EVENT_TYPES).toBeTruthy()

  // Should NOT have other enhancements
  expect(flags & KITTY_FLAG_ALL_KEYS_AS_ESCAPES).toBeFalsy()
  expect(flags & KITTY_FLAG_REPORT_TEXT).toBeFalsy()
})

test("disambiguate flag solves key ambiguity issues", () => {
  // The disambiguate flag (0b1) fixes several critical problems:
  // 1. ESC key: Without it, sends raw 0x1b (ambiguous with escape sequence start)
  //    With it: sends CSI 27;1u (unambiguous)
  // 2. Alt+[: Without it, sends 0x1b 0x5b (same as CSI!)
  //    With it: sends CSI 91;3u (unambiguous)
  // 3. Ctrl+C: Without it, sends 0x03 (generates SIGINT, kills process)
  //    With it: sends CSI 99;5u (delivered as key event to app)

  const flags = buildKittyKeyboardFlags({})
  expect(flags & KITTY_FLAG_DISAMBIGUATE).toBeTruthy()

  // Per the spec: "This has the nice side effect of making it much easier
  // to integrate into the application event loop."
  // No more timing-based hacks to distinguish ESC from escape sequences!
})

test("can explicitly disable disambiguate", () => {
  const flags = buildKittyKeyboardFlags({ disambiguate: false })
  expect(flags & KITTY_FLAG_DISAMBIGUATE).toBeFalsy()
  expect(flags & KITTY_FLAG_ALTERNATE_KEYS).toBeTruthy() // still enabled by default
})

test("can explicitly disable alternateKeys", () => {
  const flags = buildKittyKeyboardFlags({ alternateKeys: false })
  expect(flags & KITTY_FLAG_ALTERNATE_KEYS).toBeFalsy()
  expect(flags & KITTY_FLAG_DISAMBIGUATE).toBeTruthy() // still enabled by default
})

test("can disable both disambiguate and alternateKeys", () => {
  const flags = buildKittyKeyboardFlags({ disambiguate: false, alternateKeys: false })
  expect(flags).toBe(0)
})

test("can enable all flags", () => {
  const flags = buildKittyKeyboardFlags({
    disambiguate: true,
    alternateKeys: true,
    events: true,
    allKeysAsEscapes: true,
    reportText: true,
  })

  const expected =
    KITTY_FLAG_DISAMBIGUATE |
    KITTY_FLAG_ALTERNATE_KEYS |
    KITTY_FLAG_EVENT_TYPES |
    KITTY_FLAG_ALL_KEYS_AS_ESCAPES |
    KITTY_FLAG_REPORT_TEXT

  expect(flags).toBe(expected)
  expect(flags).toBe(0b11111)
  expect(flags).toBe(31)
})

test("optional flags default to false", () => {
  const flags = buildKittyKeyboardFlags({})

  // These default to true
  expect(flags & KITTY_FLAG_DISAMBIGUATE).toBeTruthy()
  expect(flags & KITTY_FLAG_ALTERNATE_KEYS).toBeTruthy()

  // These default to false
  expect(flags & KITTY_FLAG_EVENT_TYPES).toBeFalsy()
  expect(flags & KITTY_FLAG_ALL_KEYS_AS_ESCAPES).toBeFalsy()
  expect(flags & KITTY_FLAG_REPORT_TEXT).toBeFalsy()
})
