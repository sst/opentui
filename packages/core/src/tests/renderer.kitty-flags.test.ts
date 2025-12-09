import { test, expect } from "bun:test"
import { buildKittyKeyboardFlags } from "../renderer"

test("buildKittyKeyboardFlags - useKitty false returns 0", () => {
  expect(buildKittyKeyboardFlags(false, false)).toBe(0)
  expect(buildKittyKeyboardFlags(false, true)).toBe(0)
})

test("buildKittyKeyboardFlags - useKitty true, useEvents false returns 0b0001", () => {
  // Default behavior: alternate keys only
  expect(buildKittyKeyboardFlags(true, false)).toBe(0b0001)
})

test("buildKittyKeyboardFlags - useKitty true, useEvents true returns 0b0011", () => {
  // With event types: alternate keys + event types
  expect(buildKittyKeyboardFlags(true, true)).toBe(0b0011)
})

test("buildKittyKeyboardFlags - flag values match expected constants", () => {
  const KITTY_FLAG_ALTERNATE_KEYS = 0b0001
  const KITTY_FLAG_EVENT_TYPES = 0b0010

  // Just alternate keys
  expect(buildKittyKeyboardFlags(true, false)).toBe(KITTY_FLAG_ALTERNATE_KEYS)

  // Alternate keys + event types
  expect(buildKittyKeyboardFlags(true, true)).toBe(KITTY_FLAG_ALTERNATE_KEYS | KITTY_FLAG_EVENT_TYPES)
})
