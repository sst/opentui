import type { CliRenderer } from "../renderer"
import { ANSI } from "../ansi"

export const KeyCodes = {
  // Control keys
  ENTER: "\r",
  TAB: "\t",
  BACKSPACE: "\b",
  // NOTE: This may depend on the platform and terminals
  DELETE: "\x1b[3~",
  HOME: "\x1b[H",
  END: "\x1b[F",
  ESCAPE: "\x1b",

  // Arrow keys
  ARROW_UP: "\x1b[A",
  ARROW_DOWN: "\x1b[B",
  ARROW_RIGHT: "\x1b[C",
  ARROW_LEFT: "\x1b[D",

  // Function keys
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",

  // Control combinations
  CTRL_A: "\x01",
  CTRL_B: "\x02",
  CTRL_C: "\x03",
  CTRL_D: "\x04",
  CTRL_E: "\x05",
  CTRL_F: "\x06",
  CTRL_G: "\x07",
  CTRL_H: "\x08",
  CTRL_I: "\t",
  CTRL_J: "\n",
  CTRL_K: "\x0b",
  CTRL_L: "\x0c",
  CTRL_M: "\r",
  CTRL_N: "\x0e",
  CTRL_O: "\x0f",
  CTRL_P: "\x10",
  CTRL_Q: "\x11",
  CTRL_R: "\x12",
  CTRL_S: "\x13",
  CTRL_T: "\x14",
  CTRL_U: "\x15",
  CTRL_V: "\x16",
  CTRL_W: "\x17",
  CTRL_X: "\x18",
  CTRL_Y: "\x19",
  CTRL_Z: "\x1a",

  // Alt combinations (meta key)
  ALT_A: "\x1ba",
  ALT_B: "\x1bb",
  ALT_C: "\x1bc",
  ALT_D: "\x1bd",
  ALT_E: "\x1be",
  ALT_F: "\x1bf",
  ALT_G: "\x1bg",
  ALT_H: "\x1bh",
  ALT_I: "\x1bi",
  ALT_J: "\x1bj",
  ALT_K: "\x1bk",
  ALT_L: "\x1bl",
  ALT_M: "\x1bm",
  ALT_N: "\x1bn",
  ALT_O: "\x1bo",
  ALT_P: "\x1bp",
  ALT_Q: "\x1bq",
  ALT_R: "\x1br",
  ALT_S: "\x1bs",
  ALT_T: "\x1bt",
  ALT_U: "\x1bu",
  ALT_V: "\x1bv",
  ALT_W: "\x1bw",
  ALT_X: "\x1bx",
  ALT_Y: "\x1by",
  ALT_Z: "\x1bz",
  ALT_LEFT: "\x1b\x1b[D",
  ALT_RIGHT: "\x1b\x1b[C",
  ALT_UP: "\x1b\x1b[A",
  ALT_DOWN: "\x1b\x1b[B",
  ALT_ENTER: "\x1b\r",
  ALT_RETURN: "\x1b\r",
} as const

export type KeyInput = string | keyof typeof KeyCodes

export function createMockKeys(renderer: CliRenderer) {
  const pressKeys = async (keys: KeyInput[], delayMs: number = 0): Promise<void> => {
    for (const key of keys) {
      let keyCode: string
      if (typeof key === "string") {
        // If it's a string but also exists in KeyCodes, use the KeyCodes value
        if (key in KeyCodes) {
          keyCode = KeyCodes[key as keyof typeof KeyCodes]
        } else {
          keyCode = key
        }
      } else {
        // It's a KeyCode enum value
        keyCode = KeyCodes[key]
        if (!keyCode) {
          throw new Error(`Unknown key: ${key}`)
        }
      }

      renderer.stdin.emit("data", Buffer.from(keyCode))

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }

  const pressKey = (key: KeyInput, modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean }): void => {
    let keyCode: string
    if (typeof key === "string") {
      // If it's a string but also exists in KeyCodes, use the KeyCodes value
      if (key in KeyCodes) {
        keyCode = KeyCodes[key as keyof typeof KeyCodes]
      } else {
        keyCode = key
      }
    } else {
      // This branch handles KeyCode enum values (though they're strings at runtime)
      keyCode = KeyCodes[key]
      if (!keyCode) {
        throw new Error(`Unknown key: ${key}`)
      }
    }

    // Apply modifiers if present
    if (modifiers) {
      // For arrow keys and special keys, modify the escape sequence
      if (keyCode.startsWith("\x1b[") && keyCode.length > 2) {
        // Arrow keys: \x1b[A, \x1b[B, \x1b[C, \x1b[D
        // With shift modifier: \x1b[1;2A, \x1b[1;2B, \x1b[1;2C, \x1b[1;2D
        const modifier = 1 + (modifiers.shift ? 1 : 0) + (modifiers.meta ? 2 : 0) + (modifiers.ctrl ? 4 : 0)
        if (modifier > 1) {
          // Insert modifier into sequence
          const ending = keyCode.slice(-1)
          keyCode = `\x1b[1;${modifier}${ending}`
        }
      } else if (keyCode.length === 1) {
        // For regular characters and single-char control codes with modifiers
        let char = keyCode

        // Handle ctrl modifier for characters
        if (modifiers.ctrl) {
          // Ctrl+letter produces control codes (0x01-0x1a for a-z)
          if (char >= "a" && char <= "z") {
            keyCode = String.fromCharCode(char.charCodeAt(0) - 96)
          } else if (char >= "A" && char <= "Z") {
            keyCode = String.fromCharCode(char.charCodeAt(0) - 64)
          }
          // If meta is also pressed, prefix with escape
          if (modifiers.meta) {
            keyCode = `\x1b${keyCode}`
          }
        } else {
          // Handle shift+meta or just meta
          if (modifiers.shift && char >= "a" && char <= "z") {
            char = char.toUpperCase()
          }
          if (modifiers.meta) {
            // For meta+character (including control codes), prefix with escape
            keyCode = `\x1b${char}`
          } else {
            keyCode = char
          }
        }
      } else if (modifiers.meta && !keyCode.startsWith("\x1b")) {
        // For multi-char sequences that aren't escape sequences (like simple control codes)
        // just prefix with escape for meta
        keyCode = `\x1b${keyCode}`
      }
    }

    renderer.stdin.emit("data", Buffer.from(keyCode))
  }

  const typeText = async (text: string, delayMs: number = 0): Promise<void> => {
    const keys = text.split("")
    await pressKeys(keys, delayMs)
  }

  const pressEnter = (modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean }): void => {
    pressKey(KeyCodes.ENTER, modifiers)
  }

  const pressEscape = (modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean }): void => {
    pressKey(KeyCodes.ESCAPE, modifiers)
  }

  const pressTab = (modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean }): void => {
    pressKey(KeyCodes.TAB, modifiers)
  }

  const pressBackspace = (modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean }): void => {
    pressKey(KeyCodes.BACKSPACE, modifiers)
  }

  const pressArrow = (
    direction: "up" | "down" | "left" | "right",
    modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean },
  ): void => {
    const keyMap = {
      up: KeyCodes.ARROW_UP,
      down: KeyCodes.ARROW_DOWN,
      left: KeyCodes.ARROW_LEFT,
      right: KeyCodes.ARROW_RIGHT,
    }
    pressKey(keyMap[direction], modifiers)
  }

  const pressCtrlC = (): void => {
    pressKey("c", { ctrl: true })
  }

  const pasteBracketedText = (text: string): Promise<void> => {
    return pressKeys([ANSI.bracketedPasteStart, text, ANSI.bracketedPasteEnd])
  }

  return {
    pressKeys,
    pressKey,
    typeText,
    pressEnter,
    pressEscape,
    pressTab,
    pressBackspace,
    pressArrow,
    pressCtrlC,
    pasteBracketedText,
  }
}
