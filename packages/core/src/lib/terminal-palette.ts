type Hex = string | null

const OSC4_RESPONSE =
  /\x1b]4;(\d+);(?:(?:rgb:)([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)|#([0-9a-fA-F]{6}))(?:\x07|\x1b\\)/g

const OSC_SPECIAL_RESPONSE =
  /\x1b](\d+);(?:(?:rgb:)([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)|#([0-9a-fA-F]{6}))(?:\x07|\x1b\\)/g

export type WriteFunction = (data: string | Buffer) => boolean

export interface TerminalColors {
  palette: Hex[]
  defaultForeground: Hex
  defaultBackground: Hex
  cursorColor: Hex
  mouseForeground: Hex
  mouseBackground: Hex
  tekForeground: Hex
  tekBackground: Hex
  highlightBackground: Hex
  highlightForeground: Hex
}

export interface GetPaletteOptions {
  timeout?: number
  size?: number
}

export interface TerminalPaletteDetector {
  detect(options?: GetPaletteOptions): Promise<TerminalColors>
  detectOSCSupport(timeoutMs?: number): Promise<boolean>
  cleanup(): void
}

export type OscSubscriptionSource = {
  subscribeOsc(handler: (sequence: string) => void): () => void
}

function scaleComponent(comp: string): string {
  const val = parseInt(comp, 16)
  const maxIn = (1 << (4 * comp.length)) - 1
  return Math.round((val / maxIn) * 255)
    .toString(16)
    .padStart(2, "0")
}

function toHex(r?: string, g?: string, b?: string, hex6?: string): string {
  if (hex6) return `#${hex6.toLowerCase()}`
  if (r && g && b) return `#${scaleComponent(r)}${scaleComponent(g)}${scaleComponent(b)}`
  return "#000000"
}

/**
 * Wrap OSC sequence for tmux passthrough
 * tmux requires DCS sequences to pass OSC to the underlying terminal
 * Format: ESC P tmux; ESC <OSC_SEQUENCE> ESC \
 */
function wrapForTmux(osc: string): string {
  // Replace ESC with ESC ESC for tmux (escape the escape)
  const escaped = osc.replace(/\x1b/g, "\x1b\x1b")
  return `\x1bPtmux;${escaped}\x1b\\`
}

export class TerminalPalette implements TerminalPaletteDetector {
  private stdin: NodeJS.ReadStream
  private stdout: NodeJS.WriteStream
  private writeFn: WriteFunction
  private activeSubscriptions: Array<() => void> = []
  private activeTimers: Array<NodeJS.Timeout> = []
  private inLegacyTmux: boolean
  private oscSource?: OscSubscriptionSource

  constructor(
    stdin: NodeJS.ReadStream,
    stdout: NodeJS.WriteStream,
    writeFn?: WriteFunction,
    isLegacyTmux?: boolean,
    oscSource?: OscSubscriptionSource,
  ) {
    this.stdin = stdin
    this.stdout = stdout
    this.writeFn = writeFn || ((data: string | Buffer) => stdout.write(data))
    this.inLegacyTmux = isLegacyTmux ?? false
    this.oscSource = oscSource
  }

  /**
   * Write an OSC sequence, wrapping for tmux if needed
   */
  private writeOsc(osc: string): boolean {
    const data = this.inLegacyTmux ? wrapForTmux(osc) : osc
    return this.writeFn(data)
  }

  cleanup(): void {
    for (const unsubscribe of [...this.activeSubscriptions]) {
      unsubscribe()
    }
    this.activeSubscriptions = []

    for (const timer of this.activeTimers) {
      clearTimeout(timer)
    }
    this.activeTimers = []
  }

  private subscribeInput(handler: (chunk: string | Buffer) => void): () => void {
    if (this.oscSource) {
      const unsubscribe = this.oscSource.subscribeOsc((sequence) => {
        handler(sequence)
      })
      return this.trackSubscription(unsubscribe)
    }

    this.stdin.on("data", handler)
    return this.trackSubscription(() => {
      this.stdin.removeListener("data", handler)
    })
  }

  private trackSubscription(unsubscribe: () => void): () => void {
    let active = true

    const wrapped = () => {
      if (!active) return
      active = false
      unsubscribe()
      const idx = this.activeSubscriptions.indexOf(wrapped)
      if (idx !== -1) this.activeSubscriptions.splice(idx, 1)
    }

    this.activeSubscriptions.push(wrapped)
    return wrapped
  }

  async detectOSCSupport(timeoutMs = 300): Promise<boolean> {
    const out = this.stdout

    if (!out.isTTY || !this.stdin.isTTY) return false

    return new Promise<boolean>((resolve) => {
      let buffer = ""
      let removeDataListener: (() => void) | null = null

      const onData = (chunk: string | Buffer) => {
        buffer += chunk.toString()
        // Reset regex lastIndex before testing due to global flag
        OSC4_RESPONSE.lastIndex = 0
        if (OSC4_RESPONSE.test(buffer)) {
          cleanup()
          resolve(true)
        }
      }

      const onTimeout = () => {
        cleanup()
        resolve(false)
      }

      const cleanup = () => {
        clearTimeout(timer)
        removeDataListener?.()
        removeDataListener = null
        const timerIdx = this.activeTimers.indexOf(timer)
        if (timerIdx !== -1) this.activeTimers.splice(timerIdx, 1)
      }

      const timer = setTimeout(onTimeout, timeoutMs)
      this.activeTimers.push(timer)
      removeDataListener = this.subscribeInput(onData)
      this.writeOsc("\x1b]4;0;?\x07")
    })
  }

  private async queryPalette(indices: number[], timeoutMs = 1200): Promise<Map<number, Hex>> {
    const out = this.stdout
    const results = new Map<number, Hex>()
    indices.forEach((i) => results.set(i, null))

    if (!out.isTTY || !this.stdin.isTTY) {
      return results
    }

    return new Promise<Map<number, Hex>>((resolve) => {
      let buffer = ""
      let idleTimer: NodeJS.Timeout | null = null
      let removeDataListener: (() => void) | null = null

      const onData = (chunk: string | Buffer) => {
        buffer += chunk.toString()

        let m: RegExpExecArray | null
        OSC4_RESPONSE.lastIndex = 0
        while ((m = OSC4_RESPONSE.exec(buffer))) {
          const idx = parseInt(m[1], 10)
          if (results.has(idx)) results.set(idx, toHex(m[2], m[3], m[4], m[5]))
        }

        if (buffer.length > 8192) buffer = buffer.slice(-4096)

        const done = [...results.values()].filter((v) => v !== null).length
        if (done === results.size) {
          cleanup()
          resolve(results)
          return
        }

        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          cleanup()
          resolve(results)
        }, 150)
        if (idleTimer) this.activeTimers.push(idleTimer)
      }

      const onTimeout = () => {
        cleanup()
        resolve(results)
      }

      const cleanup = () => {
        clearTimeout(timer)
        if (idleTimer) clearTimeout(idleTimer)
        removeDataListener?.()
        removeDataListener = null
        const timerIdx = this.activeTimers.indexOf(timer)
        if (timerIdx !== -1) this.activeTimers.splice(timerIdx, 1)
        if (idleTimer) {
          const idleTimerIdx = this.activeTimers.indexOf(idleTimer)
          if (idleTimerIdx !== -1) this.activeTimers.splice(idleTimerIdx, 1)
        }
      }

      const timer = setTimeout(onTimeout, timeoutMs)
      this.activeTimers.push(timer)
      removeDataListener = this.subscribeInput(onData)
      this.writeOsc(indices.map((i) => `\x1b]4;${i};?\x07`).join(""))
    })
  }

  private async querySpecialColors(timeoutMs = 1200): Promise<Record<number, Hex>> {
    const out = this.stdout
    const results: Record<number, Hex> = {
      10: null,
      11: null,
      12: null,
      13: null,
      14: null,
      15: null,
      16: null,
      17: null,
      19: null,
    }

    if (!out.isTTY || !this.stdin.isTTY) {
      return results
    }

    return new Promise<Record<number, Hex>>((resolve) => {
      let buffer = ""
      let idleTimer: NodeJS.Timeout | null = null
      let removeDataListener: (() => void) | null = null

      const onData = (chunk: string | Buffer) => {
        buffer += chunk.toString()
        let updated = false

        let m: RegExpExecArray | null
        OSC_SPECIAL_RESPONSE.lastIndex = 0
        while ((m = OSC_SPECIAL_RESPONSE.exec(buffer))) {
          const idx = parseInt(m[1], 10)
          if (idx in results) {
            results[idx] = toHex(m[2], m[3], m[4], m[5])
            updated = true
          }
        }

        if (buffer.length > 8192) buffer = buffer.slice(-4096)

        const done = Object.values(results).filter((v) => v !== null).length
        if (done === Object.keys(results).length) {
          cleanup()
          resolve(results)
          return
        }

        if (!updated) return

        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          cleanup()
          resolve(results)
        }, 150)
        if (idleTimer) this.activeTimers.push(idleTimer)
      }

      const onTimeout = () => {
        cleanup()
        resolve(results)
      }

      const cleanup = () => {
        clearTimeout(timer)
        if (idleTimer) clearTimeout(idleTimer)
        removeDataListener?.()
        removeDataListener = null
        const timerIdx = this.activeTimers.indexOf(timer)
        if (timerIdx !== -1) this.activeTimers.splice(timerIdx, 1)
        if (idleTimer) {
          const idleTimerIdx = this.activeTimers.indexOf(idleTimer)
          if (idleTimerIdx !== -1) this.activeTimers.splice(idleTimerIdx, 1)
        }
      }

      const timer = setTimeout(onTimeout, timeoutMs)
      this.activeTimers.push(timer)
      removeDataListener = this.subscribeInput(onData)
      this.writeOsc(
        [
          "\x1b]10;?\x07",
          "\x1b]11;?\x07",
          "\x1b]12;?\x07",
          "\x1b]13;?\x07",
          "\x1b]14;?\x07",
          "\x1b]15;?\x07",
          "\x1b]16;?\x07",
          "\x1b]17;?\x07",
          "\x1b]19;?\x07",
        ].join(""),
      )
    })
  }

  async detect(options?: GetPaletteOptions): Promise<TerminalColors> {
    const { timeout = 5000, size = 16 } = options || {}
    const supported = await this.detectOSCSupport()

    if (!supported) {
      return {
        palette: Array(size).fill(null),
        defaultForeground: null,
        defaultBackground: null,
        cursorColor: null,
        mouseForeground: null,
        mouseBackground: null,
        tekForeground: null,
        tekBackground: null,
        highlightBackground: null,
        highlightForeground: null,
      }
    }

    const indicesToQuery = [...Array(size).keys()]
    const [paletteResults, specialColors] = await Promise.all([
      this.queryPalette(indicesToQuery, timeout),
      this.querySpecialColors(timeout),
    ])

    return {
      palette: [...Array(size).keys()].map((i) => paletteResults.get(i) ?? null),
      defaultForeground: specialColors[10],
      defaultBackground: specialColors[11],
      cursorColor: specialColors[12],
      mouseForeground: specialColors[13],
      mouseBackground: specialColors[14],
      tekForeground: specialColors[15],
      tekBackground: specialColors[16],
      highlightBackground: specialColors[17],
      highlightForeground: specialColors[19],
    }
  }
}

export function createTerminalPalette(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  writeFn?: WriteFunction,
  isLegacyTmux?: boolean,
  oscSource?: OscSubscriptionSource,
): TerminalPaletteDetector {
  return new TerminalPalette(stdin, stdout, writeFn, isLegacyTmux, oscSource)
}
