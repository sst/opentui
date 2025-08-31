import { EventEmitter } from "events"
import { parseKeypress, type ParsedKey } from "./parse.keypress"
import { singleton } from "../singleton"

type KeyHandlerEventMap = {
  keypress: [ParsedKey]
}

export class KeyHandler extends EventEmitter<KeyHandlerEventMap> {
  constructor() {
    super()

    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()
    process.stdin.setEncoding("utf8")

    process.stdin.on("data", (key: Buffer) => {
      const parsedKey = parseKeypress(key)
      this.emit("keypress", parsedKey)
    })
  }

  public destroy(): void {
    process.stdin.removeAllListeners("data")
  }
}

let keyHandler: KeyHandler | null = null

export function getKeyHandler(): KeyHandler {
  if (!keyHandler) {
    keyHandler = singleton("KeyHandler", () => new KeyHandler())
  }
  return keyHandler
}
