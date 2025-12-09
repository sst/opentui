import { test, expect } from "bun:test"
import { buildKittyKeyboardFlags } from "../renderer"

test("buildKittyKeyboardFlags - null/undefined returns 0", () => {
  expect(buildKittyKeyboardFlags(null)).toBe(0)
  expect(buildKittyKeyboardFlags(undefined)).toBe(0)
})

test("buildKittyKeyboardFlags - empty object returns 0b0001", () => {
  // Default behavior: alternate keys only
  expect(buildKittyKeyboardFlags({})).toBe(0b0001)
})

test("buildKittyKeyboardFlags - events: false returns 0b0001", () => {
  // Explicit no events: alternate keys only
  expect(buildKittyKeyboardFlags({ events: false })).toBe(0b0001)
})

test("buildKittyKeyboardFlags - events: true returns 0b0011", () => {
  // With event types: alternate keys + event types
  expect(buildKittyKeyboardFlags({ events: true })).toBe(0b0011)
})

test("buildKittyKeyboardFlags - flag values match expected constants", () => {
  const KITTY_FLAG_ALTERNATE_KEYS = 0b0001
  const KITTY_FLAG_EVENT_TYPES = 0b0010

  // Just alternate keys
  expect(buildKittyKeyboardFlags({})).toBe(KITTY_FLAG_ALTERNATE_KEYS)

  // Alternate keys + event types
  expect(buildKittyKeyboardFlags({ events: true })).toBe(KITTY_FLAG_ALTERNATE_KEYS | KITTY_FLAG_EVENT_TYPES)
})
