import { EventEmitter } from "events"
import { parseKeypress, type ParsedKey } from "./parse.keypress"
import { singleton } from "../singleton"

export type { ParsedKey }

type KeyHandlerEventMap = {
  keypress: [ParsedKey]
  keyrepeat: [ParsedKey]
  keyrelease: [ParsedKey]
}

export class KeyHandler extends EventEmitter<KeyHandlerEventMap> {
  private stdin: NodeJS.ReadStream
  private useKittyKeyboard: boolean
  private listener: (key: Buffer) => void

  constructor(stdin?: NodeJS.ReadStream, useKittyKeyboard: boolean = false) {
    super()

    this.stdin = stdin || process.stdin
    this.useKittyKeyboard = useKittyKeyboard

    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(true)
    }
    this.stdin.resume()
    this.stdin.setEncoding("utf8")
    this.listener = (key: Buffer) => {
      const parsedKey = parseKeypress(key, { useKittyKeyboard: this.useKittyKeyboard })

      switch (parsedKey.eventType) {
        case "press":
          this.emit("keypress", parsedKey)
          break
        case "repeat":
          this.emit("keyrepeat", parsedKey)
          break
        case "release":
          this.emit("keyrelease", parsedKey)
          break
        default:
          this.emit("keypress", parsedKey)
          break
      }
    }
    this.stdin.on("data", this.listener)
  }

  public destroy(): void {
    this.stdin.removeListener("data", this.listener)
    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(false)
    }
    keyHandler = null
  }
}

let keyHandler: KeyHandler | null = null

export function getKeyHandler(useKittyKeyboard: boolean = false): KeyHandler {
  if (!keyHandler) {
    keyHandler = singleton("KeyHandler", () => new KeyHandler(process.stdin, useKittyKeyboard))
  }
  return keyHandler
}
