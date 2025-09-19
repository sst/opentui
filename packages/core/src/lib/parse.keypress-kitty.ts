// Kitty Keyboard Protocol parser
// Based on https://sw.kovidgoyal.net/kitty/keyboard-protocol/

import { Buffer } from "node:buffer"
import type { ParsedKey } from "./parse.keypress"

const kittyKeyMap: Record<number, string> = {
  // Standard keys
  27: "escape",
  9: "tab",
  13: "enter",
  127: "backspace",

  // Arrow keys
  57344: "escape",
  57345: "enter",
  57346: "tab",
  57347: "backspace",
  57348: "insert",
  57349: "delete",
  57350: "left",
  57351: "right",
  57352: "up",
  57353: "down",
  57354: "pageup",
  57355: "pagedown",
  57356: "home",
  57357: "end",

  // Function keys
  57364: "f1",
  57365: "f2",
  57366: "f3",
  57367: "f4",
  57368: "f5",
  57369: "f6",
  57370: "f7",
  57371: "f8",
  57372: "f9",
  57373: "f10",
  57374: "f11",
  57375: "f12",
  57376: "f13",
  57377: "f14",
  57378: "f15",
  57379: "f16",
  57380: "f17",
  57381: "f18",
  57382: "f19",
  57383: "f20",
  57384: "f21",
  57385: "f22",
  57386: "f23",
  57387: "f24",
  57388: "f25",
  57389: "f26",
  57390: "f27",
  57391: "f28",
  57392: "f29",
  57393: "f30",
  57394: "f31",
  57395: "f32",
  57396: "f33",
  57397: "f34",
  57398: "f35",

  // Keypad
  57400: "kp0",
  57401: "kp1",
  57402: "kp2",
  57403: "kp3",
  57404: "kp4",
  57405: "kp5",
  57406: "kp6",
  57407: "kp7",
  57408: "kp8",
  57409: "kp9",
  57410: "kpdecimal",
  57411: "kpdivide",
  57412: "kpmultiply",
  57413: "kpminus",
  57414: "kpplus",
  57415: "kpenter",
  57416: "kpequal",

  // Media keys
  57428: "mediaplay",
  57429: "mediapause",
  57430: "mediaplaypause",
  57431: "mediareverse",
  57432: "mediastop",
  57433: "mediafastforward",
  57434: "mediarewind",
  57435: "medianext",
  57436: "mediaprev",
  57437: "mediarecord",

  // Volume keys
  57438: "volumedown",
  57439: "volumeup",
  57440: "mute",

  // Modifiers
  57441: "leftshift",
  57442: "leftctrl",
  57443: "leftalt",
  57444: "leftsuper",
  57445: "lefthyper",
  57446: "leftmeta",
  57447: "rightshift",
  57448: "rightctrl",
  57449: "rightalt",
  57450: "rightsuper",
  57451: "righthyper",
  57452: "rightmeta",

  // Special
  57453: "iso_level3_shift",
  57454: "iso_level5_shift",
}

function fromKittyMods(mod: number): {
  shift: boolean
  alt: boolean
  ctrl: boolean
  super: boolean
  hyper: boolean
  meta: boolean
  capsLock: boolean
  numLock: boolean
} {
  return {
    shift: !!(mod & 1),
    alt: !!(mod & 2),
    ctrl: !!(mod & 4),
    super: !!(mod & 8),
    hyper: !!(mod & 16),
    meta: !!(mod & 32),
    capsLock: !!(mod & 64),
    numLock: !!(mod & 128),
  }
}

export function parseKittyKeyboard(sequence: string): ParsedKey | null {
  // Kitty keyboard protocol: CSI unicode-key-code:alternate-key-codes ; modifiers:event-type ; text-as-codepoints u
  const kittyRe = /^\x1b\[([^\x1b]+)u$/
  const match = kittyRe.exec(sequence)

  if (!match) return null

  const params = match[1]
  const fields = params.split(";")

  if (fields.length < 1) return null

  const key: ParsedKey = {
    name: "",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence,
    raw: sequence,
    eventType: "press",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  }

  let text = ""

  // Parse field 1: unicode-key-code:shifted_codepoint:base_layout_codepoint
  const field1 = fields[0]?.split(":") || []
  const codepointStr = field1[0]
  if (!codepointStr) return null

  const codepoint = parseInt(codepointStr, 10)
  if (isNaN(codepoint)) return null

  let shiftedCodepoint: number | undefined
  let baseCodepoint: number | undefined

  // Parse shifted and base codepoints
  if (field1[1]) {
    const shifted = parseInt(field1[1], 10)
    if (!isNaN(shifted) && shifted > 0 && shifted <= 0x10ffff) {
      shiftedCodepoint = shifted
    }
  }
  if (field1[2]) {
    const base = parseInt(field1[2], 10)
    if (!isNaN(base) && base > 0 && base <= 0x10ffff) {
      baseCodepoint = base
    }
  }

  const knownKey = kittyKeyMap[codepoint]
  if (knownKey) {
    key.name = knownKey
    key.code = `[${codepoint}u`
  } else {
    // It's a Unicode character
    if (codepoint > 0 && codepoint <= 0x10ffff) {
      const char = String.fromCodePoint(codepoint)
      key.name = char

      // Store base layout codepoint for keyboard layout disambiguation
      if (baseCodepoint) {
        key.baseCode = baseCodepoint
      }
    } else {
      return null // Invalid codepoint
    }
  }

  // Parse field 2: modifier_mask:event_type
  if (fields[1]) {
    const field2 = fields[1].split(":")
    const modifierStr = field2[0]
    const eventTypeStr = field2[1]

    if (modifierStr) {
      const modifierMask = parseInt(modifierStr, 10)
      if (!isNaN(modifierMask) && modifierMask > 1) {
        const mods = fromKittyMods(modifierMask - 1) // Kitty modifiers start from 1
        key.shift = mods.shift
        key.ctrl = mods.ctrl
        key.meta = mods.alt || mods.meta
        key.option = mods.alt
        key.super = mods.super
        key.hyper = mods.hyper
        key.capsLock = mods.capsLock
        key.numLock = mods.numLock
      }
    }

    // Parse event type: 1 = press (default), 2 = repeat, 3 = release
    if (eventTypeStr === "1" || !eventTypeStr) {
      key.eventType = "press"
    } else if (eventTypeStr === "2") {
      key.eventType = "repeat"
    } else if (eventTypeStr === "3") {
      key.eventType = "release"
    } else {
      key.eventType = "press"
    }
  }

  // Parse field 3: text_as_codepoint[:text_as_codepoint]
  if (fields[2]) {
    const codepoints = fields[2].split(":")
    for (const cpStr of codepoints) {
      const cp = parseInt(cpStr, 10)
      if (!isNaN(cp) && cp > 0 && cp <= 0x10ffff) {
        text += String.fromCodePoint(cp)
      }
    }
  }

  // Handle text generation for printable characters
  if (text === "") {
    // Check if this is a printable character (not a key name like "up", "f1", etc.)
    const isPrintable = key.name.length > 0 && !kittyKeyMap[codepoint]
    if (isPrintable) {
      // Use shifted codepoint if shift is active and we have one
      if (key.shift && shiftedCodepoint) {
        text = String.fromCodePoint(shiftedCodepoint)
      } else {
        text = key.name
      }
    }
  }

  // Special case: shift + space should produce a space
  if (key.name === " " && key.shift && !key.ctrl && !key.meta) {
    text = " "
  }

  if (text) {
    key.sequence = text
  }

  return key
}
