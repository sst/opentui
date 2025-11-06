type Hex = string | null

const OSC4_RESPONSE =
  /\x1b]4;(\d+);(?:(?:rgb:)([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)|#([0-9a-fA-F]{6}))(?:\x07|\x1b\\)/g

export interface TerminalPaletteDetector {
  detect(timeoutMs?: number): Promise<Hex[]>
  detectOSCSupport(timeoutMs?: number): Promise<boolean>
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

  constructor(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream) {
    this.stdin = stdin
    this.stdout = stdout
  }

  async detectOSCSupport(timeoutMs = 300): Promise<boolean> {
    const out = this.stdout
    const inp = this.stdin

    if (!out.isTTY || !inp.isTTY) return false

    return new Promise<boolean>((resolve) => {
      let buffer = ""

      const onData = (chunk: string | Buffer) => {
        buffer += chunk.toString()
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
      }

      const timer = setTimeout(onTimeout, timeoutMs)
      inp.on("data", onData)
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
      }

      const onTimeout = () => {
        cleanup()
        resolve(results)
      }

      const cleanup = () => {
        clearTimeout(timer)
        if (idleTimer) clearTimeout(idleTimer)
        inp.removeListener("data", onData)
      }

      const timer = setTimeout(onTimeout, timeoutMs)
      inp.on("data", onData)
      out.write(indices.map((i) => `\x1b]4;${i};?\x07`).join(""))
    })
  }

  async detect(timeoutMs = 5000): Promise<Hex[]> {
    const supported = await this.detectOSCSupport()
    const method = supported ? "osc" : "ansi"

    const INDICES = method === "osc" ? [...Array(256).keys()] : [...Array(16).keys()]
    const timeout = method === "osc" ? timeoutMs : 1000

    const results = await this.queryPalette(INDICES, timeout)
    return INDICES.map((i) => results.get(i) ?? null)
  }
}

export function createTerminalPalette(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
): TerminalPaletteDetector {
  return new TerminalPalette(stdin, stdout)
}
