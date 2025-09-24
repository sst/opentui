import { EventEmitter } from "events"
import { parseKeypress, type KeyEventType, type ParsedKey } from "./parse.keypress"
import { ANSI } from "../ansi"

export class KeyEvent implements ParsedKey {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  option: boolean
  sequence: string
  number: boolean
  raw: string
  eventType: KeyEventType
  code?: string
  super?: boolean
  hyper?: boolean
  capsLock?: boolean
  numLock?: boolean
  baseCode?: number

  private _defaultPrevented: boolean = false

  constructor(key: ParsedKey) {
    this.name = key.name
    this.ctrl = key.ctrl
    this.meta = key.meta
    this.shift = key.shift
    this.option = key.option
    this.sequence = key.sequence
    this.number = key.number
    this.raw = key.raw
    this.eventType = key.eventType
    this.code = key.code
    this.super = key.super
    this.hyper = key.hyper
    this.capsLock = key.capsLock
    this.numLock = key.numLock
    this.baseCode = key.baseCode
  }

  get defaultPrevented(): boolean {
    return this._defaultPrevented
  }
  preventDefault(): void {
    this._defaultPrevented = true
  }
}

type KeyHandlerEventMap = {
  keypress: [KeyEvent]
  keyrepeat: [KeyEvent]
  keyrelease: [KeyEvent]
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
          this.emit("keypress", new KeyEvent(parsedKey))
          break
        case "repeat":
          this.emit("keyrepeat", new KeyEvent(parsedKey))
          break
        case "release":
          this.emit("keyrelease", new KeyEvent(parsedKey))
          break
        default:
          this.emit("keypress", new KeyEvent(parsedKey))
          break
      }
    }
    this.stdin.on("data", this.listener)
  }

  public destroy(): void {
    this.stdin.removeListener("data", this.listener)
  }
}
