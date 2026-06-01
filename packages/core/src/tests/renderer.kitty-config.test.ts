import { test, expect, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing.js"

let renderer: TestRenderer | undefined

afterEach(() => {
  renderer?.destroy()
  renderer = undefined
})

// Regression test: `config.useKittyKeyboard ?? {}` collapsed a caller-supplied
// `null` to `{}`, which *enabled* Kitty (buildKittyKeyboardFlags({}) === 0b101)
// instead of disabling it (buildKittyKeyboardFlags(null) === 0). The explicit
// `=== undefined` check preserves `null` so Kitty is actually disabled.
test("useKittyKeyboard: null disables the Kitty keyboard protocol", async () => {
  ;({ renderer } = await createTestRenderer({ width: 20, height: 5, useKittyKeyboard: null }))
  expect(renderer.useKittyKeyboard).toBe(false)
})

test("useKittyKeyboard undefined (default) enables the Kitty keyboard protocol", async () => {
  ;({ renderer } = await createTestRenderer({ width: 20, height: 5 }))
  expect(renderer.useKittyKeyboard).toBe(true)
})

test("useKittyKeyboard: {} enables the Kitty keyboard protocol", async () => {
  ;({ renderer } = await createTestRenderer({ width: 20, height: 5, useKittyKeyboard: {} }))
  expect(renderer.useKittyKeyboard).toBe(true)
})
