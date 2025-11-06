#!/usr/bin/env -S bun run
/**
 * probe-osc4.ts — Detect OSC 4 support by sending one query and measuring round-trip time.
 *
 * Usage:
 *   bun run probe-osc4.ts
 *
 * Output:
 *   If response received: “Supported. Index 0 responded in XXX ms: <hex>”
 *   If no response within timeout: “No response within timeout (YYY ms) — assume unsupported or blocked.”
 */

type HexOrNull = string | null

const TIMEOUT_MS = 5000

const QUERY = "\x1b]4;0;?\x07" // OSC 4 ; index 0 ; ? BEL

const RESPONSE_REGEX =
  /\x1b]4;0;(?:rgb:([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)|#([0-9a-fA-F]{6}))(?:\x07|\x1b\\)/

function scaleComponent(comp: string): string {
  const val = parseInt(comp, 16)
  const maxIn = (1 << (4 * comp.length)) - 1
  return Math.round((val / maxIn) * 255)
    .toString(16)
    .padStart(2, "0")
}

function convertToHex(r?: string, g?: string, b?: string, hex6?: string): string {
  if (hex6) return `#${hex6.toLowerCase()}`
  if (r && g && b) {
    return `#${scaleComponent(r)}${scaleComponent(g)}${scaleComponent(b)}`
  }
  return "#000000"
}

async function probe(): Promise<void> {
  const inp = process.stdin
  const out = process.stdout

  if (!inp.isTTY || !out.isTTY) {
    console.error("Not a TTY — cannot reliably perform probe.")
    process.exit(1)
  }

  inp.setEncoding("utf8")
  inp.setRawMode?.(true)
  inp.resume()

  let buffer = ""
  const onData = (chunk: string) => {
    buffer += chunk
  }
  inp.on("data", onData)

  const start = Date.now()
  out.write(QUERY)

  const result = await new Promise<{ hex: HexOrNull; elapsed: number }>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ hex: null, elapsed: Date.now() - start })
    }, TIMEOUT_MS)

    const check = () => {
      const m = RESPONSE_REGEX.exec(buffer)
      if (m) {
        clearTimeout(timer)
        const hex = convertToHex(m[1], m[2], m[3], m[4])
        resolve({ hex, elapsed: Date.now() - start })
      } else {
        // keep waiting
        setTimeout(check, 10)
      }
    }
    check()
  })

  inp.removeListener("data", onData)
  inp.setRawMode?.(false)
  inp.pause()

  if (result.hex) {
    console.log(`Supported. Index 0 responded in ${result.elapsed} ms: ${result.hex}`)
    process.exit(0)
  } else {
    console.log(`No response within timeout (${result.elapsed} ms) — assume unsupported or blocked.`)
    process.exit(1)
  }
}

probe().catch((err) => {
  console.error("Error during probe:", err)
  process.exit(1)
})
