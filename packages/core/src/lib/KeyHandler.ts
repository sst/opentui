import { EventEmitter } from "events"
import { parseKeypress, type KeyEventType, type ParsedKey } from "./parse.keypress"
import { getGraphemeSegmenter } from "./grapheme-segmenter"

// Grapheme cluster extenders per UAX #29 (https://unicode.org/reports/tr29/)
// and emoji sequences per UTS #51 (https://unicode.org/reports/tr51/)
function isGraphemeExtender(codepoint: number): boolean {
  return (
    codepoint === 0x200d || // ZWJ (Grapheme_Cluster_Break=ZWJ)
    (codepoint >= 0xfe00 && codepoint <= 0xfe0f) || // Variation Selectors (Grapheme_Cluster_Break=Extend)
    (codepoint >= 0x1f3fb && codepoint <= 0x1f3ff) || // Emoji Modifiers (Emoji_Modifier=Yes → Extend)
    (codepoint >= 0x1f1e6 && codepoint <= 0x1f1ff) || // Regional Indicators (form RI pairs)
    codepoint === 0x20e3 || // Combining Enclosing Keycap (emoji_keycap_sequence)
    (codepoint >= 0xe0020 && codepoint <= 0xe007f) // Tag Characters (Grapheme_Cluster_Break=Extend)
  )
}

// Codepoints that can start multi-codepoint emoji sequences per UTS #51
function canStartGraphemeCluster(codepoint: number): boolean {
  return (
    (codepoint >= 0x1f1e6 && codepoint <= 0x1f1ff) || // Regional Indicators (emoji_flag_sequence)
    (codepoint >= 0x1f300 && codepoint <= 0x1faff) || // Emoji ranges (Emoji=Yes)
    codepoint === 0x1f3f4 || // Black Flag (emoji_tag_sequence base)
    codepoint === 0x23 || // # (emoji_keycap_sequence)
    codepoint === 0x2a || // * (emoji_keycap_sequence)
    (codepoint >= 0x30 && codepoint <= 0x39) || // 0-9 (emoji_keycap_sequence)
    (codepoint >= 0x2600 && codepoint <= 0x27bf) // Misc Symbols & Dingbats (Emoji=Yes)
  )
}

type EmojiBuffer = {
  codepoints: number[]
  rawSequences: string[]
  baseParsedKey: ParsedKey
}

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
  source: "raw" | "kitty"
  code?: string
  super?: boolean
  hyper?: boolean
  capsLock?: boolean
  numLock?: boolean
  baseCode?: number
  repeated?: boolean

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
    this.source = key.source
    this.code = key.code
    this.super = key.super
    this.hyper = key.hyper
    this.capsLock = key.capsLock
    this.numLock = key.numLock
    this.baseCode = key.baseCode
    this.repeated = key.repeated
  }

  get defaultPrevented(): boolean {
    return this._defaultPrevented
  }
  preventDefault(): void {
    this._defaultPrevented = true
  }
}

export class PasteEvent {
  text: string
  private _defaultPrevented: boolean = false

  constructor(text: string) {
    this.text = text
  }

  get defaultPrevented(): boolean {
    return this._defaultPrevented
  }

  preventDefault(): void {
    this._defaultPrevented = true
  }
}

export type KeyHandlerEventMap = {
  keypress: [KeyEvent]
  keyrelease: [KeyEvent]
  paste: [PasteEvent]
}

export type KeyHandlerOptions = {
  useKittyKeyboard?: boolean
  emojiBufferTimeout?: number
}

export class KeyHandler extends EventEmitter<KeyHandlerEventMap> {
  protected useKittyKeyboard: boolean
  private emojiBuffer: EmojiBuffer | null = null
  private emojiTimeout: Timer | null = null
  private readonly emojiBufferTimeoutMs: number

  constructor(options: KeyHandlerOptions | boolean = false) {
    super()
    if (typeof options === "boolean") {
      this.useKittyKeyboard = options
      this.emojiBufferTimeoutMs = 10
    } else {
      this.useKittyKeyboard = options.useKittyKeyboard ?? false
      this.emojiBufferTimeoutMs = options.emojiBufferTimeout ?? 10
    }
  }

  private getCodepointFromKittyKey(parsedKey: ParsedKey): number | null {
    if (parsedKey.source !== "kitty") return null
    if (parsedKey.name.length === 0) return null

    const codepoint = parsedKey.name.codePointAt(0)
    if (codepoint === undefined) return null
    if (parsedKey.name.length !== String.fromCodePoint(codepoint).length) return null

    return codepoint
  }

  private shouldBufferForEmoji(parsedKey: ParsedKey): boolean {
    if (parsedKey.source !== "kitty") return false
    if (parsedKey.eventType !== "press") return false
    if (parsedKey.ctrl || parsedKey.meta || parsedKey.super || parsedKey.hyper) return false

    const codepoint = this.getCodepointFromKittyKey(parsedKey)
    if (codepoint === null) return false

    if (this.emojiBuffer !== null) {
      if (isGraphemeExtender(codepoint)) return true
      const lastCp = this.emojiBuffer.codepoints[this.emojiBuffer.codepoints.length - 1]!
      const ZWJ = 0x200d
      if (lastCp === ZWJ) return true
      return false
    }

    return canStartGraphemeCluster(codepoint)
  }

  private bufferEmojiCodepoint(parsedKey: ParsedKey, rawSequence: string): void {
    const codepoint = this.getCodepointFromKittyKey(parsedKey)!

    if (this.emojiBuffer === null) {
      this.emojiBuffer = {
        codepoints: [codepoint],
        rawSequences: [rawSequence],
        baseParsedKey: parsedKey,
      }
    } else {
      this.emojiBuffer.codepoints.push(codepoint)
      this.emojiBuffer.rawSequences.push(rawSequence)
    }

    this.scheduleEmojiFlush()
  }

  private scheduleEmojiFlush(): void {
    if (this.emojiTimeout) {
      clearTimeout(this.emojiTimeout)
    }
    this.emojiTimeout = setTimeout(() => {
      this.flushEmojiBuffer()
    }, this.emojiBufferTimeoutMs)
  }

  private assembleGraphemes(codepoints: number[]): string[] {
    const text = String.fromCodePoint(...codepoints)
    return [...getGraphemeSegmenter().segment(text)].map((seg) => seg.segment)
  }

  public flushEmojiBuffer(): void {
    if (this.emojiTimeout) {
      clearTimeout(this.emojiTimeout)
      this.emojiTimeout = null
    }

    if (this.emojiBuffer === null) return

    const { codepoints, rawSequences, baseParsedKey } = this.emojiBuffer
    this.emojiBuffer = null

    const graphemes = this.assembleGraphemes(codepoints)

    for (const grapheme of graphemes) {
      const keyEvent: ParsedKey = {
        ...baseParsedKey,
        name: grapheme,
        sequence: grapheme,
        raw: rawSequences.join(""),
      }

      try {
        if (keyEvent.eventType === "press") {
          this.emit("keypress", new KeyEvent(keyEvent))
        } else {
          this.emit("keyrelease", new KeyEvent(keyEvent))
        }
      } catch (error) {
        console.error(`[KeyHandler] Error emitting buffered emoji:`, error)
      }
    }
  }

  public processInput(data: string): boolean {
    const parsedKey = parseKeypress(data, { useKittyKeyboard: this.useKittyKeyboard })

    if (!parsedKey) {
      return false
    }

    if (this.shouldBufferForEmoji(parsedKey)) {
      this.bufferEmojiCodepoint(parsedKey, data)
      return true
    }

    this.flushEmojiBuffer()

    try {
      switch (parsedKey.eventType) {
        case "press":
          this.emit("keypress", new KeyEvent(parsedKey))
          break
        case "release":
          this.emit("keyrelease", new KeyEvent(parsedKey))
          break
        default:
          this.emit("keypress", new KeyEvent(parsedKey))
          break
      }
    } catch (error) {
      console.error(`[KeyHandler] Error processing input:`, error)
      return true
    }

    return true
  }

  public processPaste(data: string): void {
    try {
      const cleanedData = Bun.stripANSI(data)
      this.emit("paste", new PasteEvent(cleanedData))
    } catch (error) {
      console.error(`[KeyHandler] Error processing paste:`, error)
    }
  }

  public destroy(): void {
    if (this.emojiTimeout) {
      clearTimeout(this.emojiTimeout)
      this.emojiTimeout = null
    }
    this.emojiBuffer = null
  }
}

export class InternalKeyHandler extends KeyHandler {
  private renderableHandlers: Map<keyof KeyHandlerEventMap, Set<Function>> = new Map()

  constructor(options: KeyHandlerOptions | boolean = false) {
    super(options)
  }

  public emit<K extends keyof KeyHandlerEventMap>(event: K, ...args: KeyHandlerEventMap[K]): boolean {
    return this.emitWithPriority(event, ...args)
  }

  private emitWithPriority<K extends keyof KeyHandlerEventMap>(event: K, ...args: KeyHandlerEventMap[K]): boolean {
    let hasGlobalListeners = false

    try {
      hasGlobalListeners = super.emit(event as any, ...args)
    } catch (error) {
      console.error(`[KeyHandler] Error in global ${event} handler:`, error)
    }

    const renderableSet = this.renderableHandlers.get(event)
    const renderableHandlers = renderableSet && renderableSet.size > 0 ? [...renderableSet] : []
    let hasRenderableListeners = false

    if (renderableSet && renderableSet.size > 0) {
      hasRenderableListeners = true

      if (event === "keypress" || event === "keyrelease" || event === "paste") {
        const keyEvent = args[0]
        if (keyEvent.defaultPrevented) return hasGlobalListeners || hasRenderableListeners
      }

      for (const handler of renderableHandlers) {
        try {
          handler(...args)
        } catch (error) {
          console.error(`[KeyHandler] Error in renderable ${event} handler:`, error)
        }
      }
    }

    return hasGlobalListeners || hasRenderableListeners
  }

  public onInternal<K extends keyof KeyHandlerEventMap>(
    event: K,
    handler: (...args: KeyHandlerEventMap[K]) => void,
  ): void {
    if (!this.renderableHandlers.has(event)) {
      this.renderableHandlers.set(event, new Set())
    }
    this.renderableHandlers.get(event)!.add(handler)
  }

  public offInternal<K extends keyof KeyHandlerEventMap>(
    event: K,
    handler: (...args: KeyHandlerEventMap[K]) => void,
  ): void {
    const handlers = this.renderableHandlers.get(event)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  public override destroy(): void {
    super.destroy()
    this.renderableHandlers.clear()
  }
}
