import { EventEmitter } from "events"
import { parseKeypress, type ParsedKey } from "./parse.keypress"
import { ANSI } from "../ansi"

export type { ParsedKey }

type KeyHandlerEventMap = {
  keypress: [ParsedKey]
  keyrepeat: [ParsedKey]
  keyrelease: [ParsedKey]
  paste: [string]
}

export class KeyHandler extends EventEmitter<KeyHandlerEventMap> {
  private stdin: NodeJS.ReadStream
  private useKittyKeyboard: boolean
  private listener: (key: Buffer) => void
  private pasteMode: boolean = false
  private pasteBuffer: string[] = []

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
      let data = key.toString()
      if (data.startsWith(ANSI.bracketedPasteStart)) {
        this.pasteMode = true
      }
      if (this.pasteMode) {
        this.pasteBuffer.push(Bun.stripANSI(data))
        if (data.endsWith(ANSI.bracketedPasteEnd)) {
          this.pasteMode = false
          this.emit("paste", this.pasteBuffer.join(""))
          this.pasteBuffer = []
        }
        return
      }
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
  }
}
