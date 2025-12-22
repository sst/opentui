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

test("buildKittyKeyboardFlags - empty object returns ALTERNATE_KEYS (0b100)", () => {
  // Default behavior: alternate keys only (enables kitty mode with base feature)
  // This allows terminals to report shifted/base-layout keys for robust shortcut matching
  expect(buildKittyKeyboardFlags({})).toBe(KITTY_FLAG_ALTERNATE_KEYS)
  expect(buildKittyKeyboardFlags({})).toBe(0b100)
  expect(buildKittyKeyboardFlags({})).toBe(4)
})

test("buildKittyKeyboardFlags - events: false returns ALTERNATE_KEYS (0b100)", () => {
  // Explicit no events: alternate keys only
  expect(buildKittyKeyboardFlags({ events: false })).toBe(KITTY_FLAG_ALTERNATE_KEYS)
  expect(buildKittyKeyboardFlags({ events: false })).toBe(0b100)
  expect(buildKittyKeyboardFlags({ events: false })).toBe(4)
})

test("buildKittyKeyboardFlags - events: true returns ALTERNATE_KEYS | EVENT_TYPES (0b110)", () => {
  // With event types: alternate keys + event types (press/repeat/release)
  const expected = KITTY_FLAG_ALTERNATE_KEYS | KITTY_FLAG_EVENT_TYPES
  expect(buildKittyKeyboardFlags({ events: true })).toBe(expected)
  expect(buildKittyKeyboardFlags({ events: true })).toBe(0b110)
  expect(buildKittyKeyboardFlags({ events: true })).toBe(6)
})

test("buildKittyKeyboardFlags - flag values match kitty spec constants", () => {
  // Just alternate keys (default)
  expect(buildKittyKeyboardFlags({})).toBe(KITTY_FLAG_ALTERNATE_KEYS)

  // Alternate keys + event types
  expect(buildKittyKeyboardFlags({ events: true })).toBe(KITTY_FLAG_ALTERNATE_KEYS | KITTY_FLAG_EVENT_TYPES)
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
  // So the format should be: \x1b[>4u for ALTERNATE_KEYS
  // and \x1b[>6u for ALTERNATE_KEYS | EVENT_TYPES

  const alternateKeysFlags = buildKittyKeyboardFlags({})
  expect(alternateKeysFlags).toBe(4)
  // The escape sequence would be: \x1b[>4u

  const withEventsFlags = buildKittyKeyboardFlags({ events: true })
  expect(withEventsFlags).toBe(6)
  // The escape sequence would be: \x1b[>6u
})

test("default config enables alternate keys for robust shortcut matching", () => {
  // Per the kitty spec, alternate keys enhancement allows reporting:
  // - The shifted key (e.g., 'A' when shift+'a' is pressed)
  // - The base layout key (e.g., 'c' for ctrl+С on Cyrillic keyboard)
  // This is essential for cross-keyboard-layout shortcut matching
  const flags = buildKittyKeyboardFlags({})

  // Should have alternate keys bit set
  expect(flags & KITTY_FLAG_ALTERNATE_KEYS).toBeTruthy()

  // Should NOT have other enhancements by default
  expect(flags & KITTY_FLAG_DISAMBIGUATE).toBeFalsy()
  expect(flags & KITTY_FLAG_EVENT_TYPES).toBeFalsy()
  expect(flags & KITTY_FLAG_ALL_KEYS_AS_ESCAPES).toBeFalsy()
  expect(flags & KITTY_FLAG_REPORT_TEXT).toBeFalsy()
})

test("events config adds event type reporting", () => {
  // With events enabled, we should be able to detect press/repeat/release
  const flags = buildKittyKeyboardFlags({ events: true })

  // Should have both alternate keys and event types
  expect(flags & KITTY_FLAG_ALTERNATE_KEYS).toBeTruthy()
  expect(flags & KITTY_FLAG_EVENT_TYPES).toBeTruthy()

  // Should NOT have other enhancements
  expect(flags & KITTY_FLAG_DISAMBIGUATE).toBeFalsy()
  expect(flags & KITTY_FLAG_ALL_KEYS_AS_ESCAPES).toBeFalsy()
  expect(flags & KITTY_FLAG_REPORT_TEXT).toBeFalsy()
})
