type Hex = string | null

const OSC4_RESPONSE =
  /\x1b]4;(\d+);(?:(?:rgb:)([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)|#([0-9a-fA-F]{6}))(?:\x07|\x1b\\)/g

export interface TerminalPaletteDetector {
  detect(timeoutMs?: number): Promise<Hex[]>
  detectOSCSupport(timeoutMs?: number): Promise<boolean>
  cleanup(): void
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

export class TerminalPalette implements TerminalPaletteDetector {
  private stdin: NodeJS.ReadStream
  private stdout: NodeJS.WriteStream
  private activeListeners: Array<{ event: string; handler: (...args: any[]) => void }> = []
  private activeTimers: Array<NodeJS.Timeout> = []

  constructor(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream) {
    this.stdin = stdin
    this.stdout = stdout
  }

  cleanup(): void {
    for (const { event, handler } of this.activeListeners) {
      this.stdin.removeListener(event, handler)
    }
    this.activeListeners = []

    for (const timer of this.activeTimers) {
      clearTimeout(timer)
    }
    this.activeTimers = []
  }

  async detectOSCSupport(timeoutMs = 300): Promise<boolean> {
    const out = this.stdout
    const inp = this.stdin

    if (!out.isTTY || !inp.isTTY) return false

    return new Promise<boolean>((resolve) => {
      let buffer = ""

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
        inp.removeListener("data", onData)
        // Remove from active tracking
        const listenerIdx = this.activeListeners.findIndex((l) => l.handler === onData)
        if (listenerIdx !== -1) this.activeListeners.splice(listenerIdx, 1)
        const timerIdx = this.activeTimers.indexOf(timer)
        if (timerIdx !== -1) this.activeTimers.splice(timerIdx, 1)
      }

      const timer = setTimeout(onTimeout, timeoutMs)
      this.activeTimers.push(timer)
      inp.on("data", onData)
      this.activeListeners.push({ event: "data", handler: onData })
      out.write("\x1b]4;0;?\x07")
    })
  }

  private async queryPalette(indices: number[], timeoutMs = 1200): Promise<Map<number, Hex>> {
    const out = this.stdout
    const inp = this.stdin
    const results = new Map<number, Hex>()
    indices.forEach((i) => results.set(i, null))

    if (!out.isTTY || !inp.isTTY) {
      return results
    }

    return new Promise<Map<number, Hex>>((resolve) => {
      let buffer = ""
      let lastResponseTime = Date.now()
      let idleTimer: NodeJS.Timeout | null = null

      const onData = (chunk: string | Buffer) => {
        buffer += chunk.toString()
        lastResponseTime = Date.now()

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
        inp.removeListener("data", onData)
        // Remove from active tracking
        const listenerIdx = this.activeListeners.findIndex((l) => l.handler === onData)
        if (listenerIdx !== -1) this.activeListeners.splice(listenerIdx, 1)
        const timerIdx = this.activeTimers.indexOf(timer)
        if (timerIdx !== -1) this.activeTimers.splice(timerIdx, 1)
        if (idleTimer) {
          const idleTimerIdx = this.activeTimers.indexOf(idleTimer)
          if (idleTimerIdx !== -1) this.activeTimers.splice(idleTimerIdx, 1)
        }
      }

      const timer = setTimeout(onTimeout, timeoutMs)
      this.activeTimers.push(timer)
      inp.on("data", onData)
      this.activeListeners.push({ event: "data", handler: onData })
      out.write(indices.map((i) => `\x1b]4;${i};?\x07`).join(""))
    })
  }

  async detect(timeoutMs = 5000): Promise<Hex[]> {
    const supported = await this.detectOSCSupport()
    
    if (!supported) {
      // Return 256 nulls if OSC is not supported
      return Array(256).fill(null)
    }

    // Always query all 256 colors when OSC is supported
    const INDICES = [...Array(256).keys()]
    const results = await this.queryPalette(INDICES, timeoutMs)
    return INDICES.map((i) => results.get(i) ?? null)
  }
}

export function createTerminalPalette(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
): TerminalPaletteDetector {
  return new TerminalPalette(stdin, stdout)
}
