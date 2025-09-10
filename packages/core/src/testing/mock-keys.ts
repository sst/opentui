import type { CliRenderer } from "../renderer"

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

  // Alt combinations
  ALT_A: "\x1ba",
  ALT_B: "\x1bb",
  ALT_C: "\x1bc",
  // ... add more as needed
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

  const pressKey = (key: KeyInput): void => {
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

    renderer.stdin.emit("data", Buffer.from(keyCode))
  }

  const typeText = async (text: string, delayMs: number = 0): Promise<void> => {
    const keys = text.split("")
    await pressKeys(keys, delayMs)
  }

  const pressEnter = (): void => {
    pressKey(KeyCodes.ENTER)
  }

  const pressEscape = (): void => {
    pressKey(KeyCodes.ESCAPE)
  }

  const pressTab = (): void => {
    pressKey(KeyCodes.TAB)
  }

  const pressBackspace = (): void => {
    pressKey(KeyCodes.BACKSPACE)
  }

  const pressArrow = (direction: "up" | "down" | "left" | "right"): void => {
    const keyMap = {
      up: KeyCodes.ARROW_UP,
      down: KeyCodes.ARROW_DOWN,
      left: KeyCodes.ARROW_LEFT,
      right: KeyCodes.ARROW_RIGHT,
    }
    pressKey(keyMap[direction])
  }

  const pressCtrlC = (): void => {
    pressKey(KeyCodes.CTRL_C)
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
  }
}
