import { test, expect } from "bun:test"
import { parseKeypress, type ParseKeypressOptions } from "./parse.keypress"

test("parseKeypress - Kitty keyboard protocol disabled by default", () => {
  // Kitty sequences should fall back to regular parsing when disabled
  const result = parseKeypress("\x1b[97u")
  expect(result.name).toBe("")
  expect(result.code).toBeUndefined()
})

test("parseKeypress - Kitty keyboard basic key", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97u", options)
  expect(result.name).toBe("a")
  expect(result.sequence).toBe("a")
  expect(result.ctrl).toBe(false)
  expect(result.meta).toBe(false)
  expect(result.shift).toBe(false)
  expect(result.option).toBe(false)
})

test("parseKeypress - Kitty keyboard shift+a", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97:65;2u", options)
  expect(result.name).toBe("a")
  expect(result.sequence).toBe("A")
  expect(result.shift).toBe(true)
  expect(result.ctrl).toBe(false)
  expect(result.meta).toBe(false)
})

test("parseKeypress - Kitty keyboard ctrl+a", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97;5u", options)
  expect(result.name).toBe("a")
  expect(result.ctrl).toBe(true)
  expect(result.shift).toBe(false)
  expect(result.meta).toBe(false)
})

test("parseKeypress - Kitty keyboard alt+a", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97;3u", options)
  expect(result.name).toBe("a")
  expect(result.meta).toBe(true)
  expect(result.option).toBe(true)
  expect(result.ctrl).toBe(false)
  expect(result.shift).toBe(false)
})

test("parseKeypress - Kitty keyboard function key", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[57364u", options)
  expect(result.name).toBe("f1")
  expect(result.code).toBe("[57364u")
})

test("parseKeypress - Kitty keyboard arrow key", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[57352u", options)
  expect(result.name).toBe("up")
  expect(result.code).toBe("[57352u")
})

test("parseKeypress - Kitty keyboard shift+space", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[32;2u", options)
  expect(result.name).toBe(" ")
  expect(result.sequence).toBe(" ")
  expect(result.shift).toBe(true)
})

test("parseKeypress - Kitty keyboard event types", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }

  // Press event (explicit)
  const pressExplicit = parseKeypress("\x1b[97;1:1u", options)
  expect(pressExplicit.name).toBe("a")
  expect(pressExplicit.eventType).toBe("press")

  // Press event (default when no event type specified)
  const pressDefault = parseKeypress("\x1b[97u", options)
  expect(pressDefault.name).toBe("a")
  expect(pressDefault.eventType).toBe("press")

  // Press event (modifier without event type)
  const pressWithModifier = parseKeypress("\x1b[97;5u", options) // Ctrl+a
  expect(pressWithModifier.name).toBe("a")
  expect(pressWithModifier.ctrl).toBe(true)
  expect(pressWithModifier.eventType).toBe("press")

  // Repeat event
  const repeat = parseKeypress("\x1b[97;1:2u", options)
  expect(repeat.name).toBe("a")
  expect(repeat.eventType).toBe("repeat")

  // Release event
  const release = parseKeypress("\x1b[97;1:3u", options)
  expect(release.name).toBe("a")
  expect(release.eventType).toBe("release")

  // Repeat event with modifier
  const repeatWithCtrl = parseKeypress("\x1b[97;5:2u", options)
  expect(repeatWithCtrl.name).toBe("a")
  expect(repeatWithCtrl.ctrl).toBe(true)
  expect(repeatWithCtrl.eventType).toBe("repeat")

  // Release event with modifier
  const releaseWithShift = parseKeypress("\x1b[97;2:3u", options)
  expect(releaseWithShift.name).toBe("a")
  expect(releaseWithShift.shift).toBe(true)
  expect(releaseWithShift.eventType).toBe("release")
})

test("parseKeypress - Kitty keyboard with text", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97;1;97u", options)
  expect(result.name).toBe("a")
})

test("parseKeypress - Kitty keyboard ctrl+shift+a", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97;6u", options)
  expect(result.name).toBe("a")
  expect(result.ctrl).toBe(true)
  expect(result.shift).toBe(true)
  expect(result.meta).toBe(false)
})

test("parseKeypress - Kitty keyboard alt+shift+a", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97;4u", options)
  expect(result.name).toBe("a")
  expect(result.meta).toBe(true)
  expect(result.option).toBe(true)
  expect(result.shift).toBe(true)
  expect(result.ctrl).toBe(false)
})

test("parseKeypress - Kitty keyboard super+a", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97;9u", options) // modifier 9 - 1 = 8 = super
  expect(result.name).toBe("a")
  expect(result.super).toBe(true)
})

test("parseKeypress - Kitty keyboard hyper+a", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97;17u", options) // modifier 17 - 1 = 16 = hyper
  expect(result.name).toBe("a")
  expect(result.hyper).toBe(true)
})

test("parseKeypress - Kitty keyboard with shifted codepoint", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97:65u", options)
  expect(result.name).toBe("a")
  expect(result.sequence).toBe("a") // No shift pressed, so base character
  expect(result.shift).toBe(false)
})

test("parseKeypress - Kitty keyboard with base layout codepoint", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97:65:97u", options)
  expect(result.name).toBe("a")
  expect(result.sequence).toBe("a") // No shift modifier, so base character
  expect(result.shift).toBe(false)
  expect(result.baseCode).toBe(97) // Base layout codepoint is 'a'
})

test("parseKeypress - Kitty keyboard different layout (QWERTY A key on AZERTY)", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  // On AZERTY, Q key produces 'a', but base layout says it's Q position
  const result = parseKeypress("\x1b[97:65:113u", options) // 113 = 'q'
  expect(result.name).toBe("a") // Actual character produced
  expect(result.sequence).toBe("a")
  expect(result.baseCode).toBe(113) // Physical key position is Q
})

test("parseKeypress - Kitty keyboard caps lock", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97;65u", options) // modifier 65 - 1 = 64 = caps lock
  expect(result.name).toBe("a")
  expect(result.capsLock).toBe(true)
})

test("parseKeypress - Kitty keyboard num lock", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[97;129u", options) // modifier 129 - 1 = 128 = num lock
  expect(result.name).toBe("a")
  expect(result.numLock).toBe(true)
})

test("parseKeypress - Kitty keyboard unicode character", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[233u", options) // é
  expect(result.name).toBe("é")
  expect(result.sequence).toBe("é")
})

test("parseKeypress - Kitty keyboard emoji", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[128512u", options) // 😀
  expect(result.name).toBe("😀")
  expect(result.sequence).toBe("😀")
})

test("parseKeypress - Kitty keyboard invalid codepoint", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }
  const result = parseKeypress("\x1b[1114112u", options) // Invalid codepoint > 0x10FFFF
  // Should fall back to regular parsing when Kitty fails
  expect(result.name).toBe("")
  expect(result.ctrl).toBe(true)
  expect(result.meta).toBe(true)
  expect(result.shift).toBe(true)
  expect(result.option).toBe(true)
})

test("parseKeypress - Kitty keyboard keypad keys", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }

  const kp0 = parseKeypress("\x1b[57400u", options)
  expect(kp0?.name).toBe("kp0")

  const kpEnter = parseKeypress("\x1b[57415u", options)
  expect(kpEnter?.name).toBe("kpenter")
})

test("parseKeypress - Kitty keyboard media keys", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }

  const play = parseKeypress("\x1b[57428u", options)
  expect(play?.name).toBe("mediaplay")

  const volumeUp = parseKeypress("\x1b[57439u", options)
  expect(volumeUp?.name).toBe("volumeup")
})

test("parseKeypress - Kitty keyboard modifier keys", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }

  const leftShift = parseKeypress("\x1b[57441u", options)
  expect(leftShift?.name).toBe("leftshift")
  expect(leftShift?.eventType).toBe("press")

  const rightCtrl = parseKeypress("\x1b[57448u", options)
  expect(rightCtrl?.name).toBe("rightctrl")
  expect(rightCtrl?.eventType).toBe("press")
})

test("parseKeypress - Kitty keyboard function keys with event types", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }

  // F1 press
  const f1Press = parseKeypress("\x1b[57364u", options)
  expect(f1Press.name).toBe("f1")
  expect(f1Press.eventType).toBe("press")

  // F1 repeat
  const f1Repeat = parseKeypress("\x1b[57364;1:2u", options)
  expect(f1Repeat.name).toBe("f1")
  expect(f1Repeat.eventType).toBe("repeat")

  // F1 release
  const f1Release = parseKeypress("\x1b[57364;1:3u", options)
  expect(f1Release.name).toBe("f1")
  expect(f1Release.eventType).toBe("release")
})

test("parseKeypress - Kitty keyboard arrow keys with event types", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }

  // Up arrow press
  const upPress = parseKeypress("\x1b[57352u", options)
  expect(upPress.name).toBe("up")
  expect(upPress.eventType).toBe("press")

  // Up arrow repeat with Ctrl
  const upRepeatCtrl = parseKeypress("\x1b[57352;5:2u", options)
  expect(upRepeatCtrl.name).toBe("up")
  expect(upRepeatCtrl.ctrl).toBe(true)
  expect(upRepeatCtrl.eventType).toBe("repeat")

  // Down arrow release
  const downRelease = parseKeypress("\x1b[57353;1:3u", options)
  expect(downRelease.name).toBe("down")
  expect(downRelease.eventType).toBe("release")
})

test("parseKeypress - Kitty keyboard invalid event types", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }

  // Unknown event type should default to press
  const unknownEvent = parseKeypress("\x1b[97;1:9u", options)
  expect(unknownEvent.name).toBe("a")
  expect(unknownEvent.eventType).toBe("press")

  // Empty event type should default to press
  const emptyEvent = parseKeypress("\x1b[97;1:u", options)
  expect(emptyEvent.name).toBe("a")
  expect(emptyEvent.eventType).toBe("press")
})

// Test progressive enhancement (non-CSI u sequences)
// Note: We don't implement this yet, but these should fall back to regular parsing
test("parseKeypress - Kitty progressive enhancement fallback", () => {
  const options: ParseKeypressOptions = { useKittyKeyboard: true }

  // These would normally be handled by progressive enhancement
  // but since we don't implement it, they should fall back
  const result = parseKeypress("\x1b[1;2A", options) // CSI 1;2A (shift+up with modifiers)
  expect(result.name).toBe("up")
  expect(result.shift).toBe(true)
})
