import { SystemClock, type Clock, type TimerHandle } from "./clock"

type Hex = string | null

const SYSTEM_CLOCK = new SystemClock()

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
  private activeQuerySessions: Array<() => void> = []
  private inLegacyTmux: boolean
  private oscSource?: OscSubscriptionSource
  private readonly clock: Clock

  constructor(
    stdin: NodeJS.ReadStream,
    stdout: NodeJS.WriteStream,
    writeFn?: WriteFunction,
    isLegacyTmux?: boolean,
    oscSource?: OscSubscriptionSource,
    clock?: Clock,
  ) {
    this.stdin = stdin
    this.stdout = stdout
    this.writeFn = writeFn || ((data: string | Buffer) => stdout.write(data))
    this.inLegacyTmux = isLegacyTmux ?? false
    this.oscSource = oscSource
    this.clock = clock ?? SYSTEM_CLOCK
  }

  /**
   * Write an OSC sequence, wrapping for tmux if needed
   */
  private writeOsc(osc: string): boolean {
    const data = this.inLegacyTmux ? wrapForTmux(osc) : osc
    return this.writeFn(data)
  }

  cleanup(): void {
    for (const cleanupSession of [...this.activeQuerySessions]) {
      cleanupSession()
    }
    this.activeQuerySessions = []
  }

  private subscribeInput(handler: (chunk: string | Buffer) => void): () => void {
    if (this.oscSource) {
      return this.oscSource.subscribeOsc((sequence) => {
        handler(sequence)
      })
    }

    this.stdin.on("data", handler)
    return () => {
      this.stdin.removeListener("data", handler)
    }
  }

  private createQuerySession() {
    const timers = new Set<TimerHandle>()
    const subscriptions = new Set<() => void>()
    let closed = false

    const cleanup = () => {
      if (closed) return
      closed = true

      for (const timer of timers) {
        this.clock.clearTimeout(timer)
      }
      timers.clear()

      for (const unsubscribe of subscriptions) {
        unsubscribe()
      }
      subscriptions.clear()

      const idx = this.activeQuerySessions.indexOf(cleanup)
      if (idx !== -1) this.activeQuerySessions.splice(idx, 1)
    }

    this.activeQuerySessions.push(cleanup)

    return {
      setTimer: (fn: () => void, ms: number): TimerHandle => {
        const timer = this.clock.setTimeout(fn, ms)
        timers.add(timer)
        return timer
      },
      resetTimer: (existing: TimerHandle | null, fn: () => void, ms: number): TimerHandle => {
        if (existing) {
          this.clock.clearTimeout(existing)
          timers.delete(existing)
        }

        const timer = this.clock.setTimeout(fn, ms)
        timers.add(timer)
        return timer
      },
      subscribeInput: (handler: (chunk: string | Buffer) => void): (() => void) => {
        const unsubscribe = this.subscribeInput(handler)
        subscriptions.add(unsubscribe)
        return () => {
          if (!subscriptions.has(unsubscribe)) return
          subscriptions.delete(unsubscribe)
          unsubscribe()
        }
      },
      cleanup,
    }
  }

  async detectOSCSupport(timeoutMs = 300): Promise<boolean> {
    const out = this.stdout

    if (!out.isTTY || !this.stdin.isTTY) return false

    return new Promise<boolean>((resolve) => {
      const session = this.createQuerySession()
      let buffer = ""
      let settled = false

      const finish = (supported: boolean) => {
        if (settled) return
        settled = true
        session.cleanup()
        resolve(supported)
      }

      const onData = (chunk: string | Buffer) => {
        buffer += chunk.toString()
        // Reset regex lastIndex before testing due to global flag
        OSC4_RESPONSE.lastIndex = 0
        if (OSC4_RESPONSE.test(buffer)) {
          finish(true)
        }
      }

      session.setTimer(() => {
        finish(false)
      }, timeoutMs)
      session.subscribeInput(onData)
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
      const session = this.createQuerySession()
      let buffer = ""
      let idleTimer: TimerHandle | null = null
      let settled = false

      const finish = () => {
        if (settled) return
        settled = true
        session.cleanup()
        resolve(results)
      }

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
          finish()
          return
        }

        idleTimer = session.resetTimer(idleTimer, finish, 150)
      }

      session.setTimer(finish, timeoutMs)
      session.subscribeInput(onData)
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
      const session = this.createQuerySession()
      let buffer = ""
      let idleTimer: TimerHandle | null = null
      let settled = false

      const finish = () => {
        if (settled) return
        settled = true
        session.cleanup()
        resolve(results)
      }

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
          finish()
          return
        }

        if (!updated) return

        idleTimer = session.resetTimer(idleTimer, finish, 150)
      }

      session.setTimer(finish, timeoutMs)
      session.subscribeInput(onData)
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
  clock?: Clock,
): TerminalPaletteDetector {
  return new TerminalPalette(stdin, stdout, writeFn, isLegacyTmux, oscSource, clock)
}
