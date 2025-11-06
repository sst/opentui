#!/usr/bin/env -S bun run
/**
 * palette.ts — Query the terminal color palette safely via OSC 4.
 *
 * Works with Bun or Node. No dependencies.
 *
 * Usage:
 *   bun run palette.ts         # auto-detect (default)
 *   bun run palette.ts auto    # auto-detect OSC support
 *   bun run palette.ts ansi    # indices 0–15
 *   bun run palette.ts osc     # indices 0–255
 */

type Hex = string | null

const OSC4_RESPONSE =
  /\x1b]4;(\d+);(?:(?:rgb:)([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)|#([0-9a-fA-F]{6}))(?:\x07|\x1b\\)/g

/**
 * Detect if the terminal supports OSC 4 queries by probing with a single query.
 */
async function detectOSCSupport(timeoutMs = 300): Promise<boolean> {
  const out = process.stdout
  const inp = process.stdin

  if (!out.isTTY || !inp.isTTY) return false

  inp.setEncoding("utf8")
  inp.setRawMode?.(true)
  inp.resume()

  let buffer = ""
  let detected = false

  const onData = (chunk: string) => {
    buffer += chunk
    if (OSC4_RESPONSE.test(buffer)) {
      detected = true
    }
  }

  inp.on("data", onData)
  
  // Probe with a single color query (index 0)
  out.write("\x1b]4;0;?\x07")

  const start = Date.now()
  while (Date.now() - start < timeoutMs && !detected) {
    await new Promise((r) => setTimeout(r, 10))
  }

  inp.removeListener("data", onData)
  inp.setRawMode?.(false)
  
  // Drain any remaining data
  await new Promise((r) => setTimeout(r, 50))
  const drain = () => new Promise<void>((resolve) => {
    const ignore = () => {}
    inp.on("data", ignore)
    setTimeout(() => {
      inp.removeListener("data", ignore)
      resolve()
    }, 50)
  })
  await drain()

  return detected
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

async function queryPalette(indices: number[], timeoutMs = 1200): Promise<Map<number, Hex>> {
  const out = process.stdout
  const inp = process.stdin
  const results = new Map<number, Hex>()
  indices.forEach((i) => results.set(i, null))

  if (!out.isTTY || !inp.isTTY) {
    console.error("Not a TTY — cannot query terminal colors.")
    return results
  }

  inp.setEncoding("utf8")
  inp.setRawMode?.(true)
  inp.resume()

  let buffer = ""
  const onData = (chunk: string) => {
    buffer += chunk
    let m: RegExpExecArray | null
    while ((m = OSC4_RESPONSE.exec(buffer))) {
      const idx = parseInt(m[1], 10)
      if (results.has(idx)) results.set(idx, toHex(m[2], m[3], m[4], m[5]))
    }
    if (buffer.length > 8192) buffer = buffer.slice(-4096)
  }

  inp.on("data", onData)

  // Batch all queries together.
  out.write(indices.map((i) => `\x1b]4;${i};?\x07`).join(""))

  const start = Date.now()
  let lastChange = Date.now()
  let prevCount = 0

  // Wait until either: all indices answered, or no new data for ~100ms
  while (Date.now() - start < timeoutMs) {
    const done = [...results.values()].filter((v) => v !== null).length
    if (done === results.size) break
    if (done !== prevCount) {
      prevCount = done
      lastChange = Date.now()
    } else if (Date.now() - lastChange > 150) {
      // no new data for a bit → likely terminal is done
      break
    }
    await new Promise((r) => setTimeout(r, 25))
  }

  // Drain any trailing data still arriving
  await new Promise((r) => setTimeout(r, 200))

  inp.removeListener("data", onData)
  inp.setRawMode?.(false)

  // Flush anything the terminal might still push before we exit
  const drain = new Promise<void>((resolve) => {
    let drainTimer: NodeJS.Timeout
    const stopDrain = () => {
      clearTimeout(drainTimer)
      inp.removeListener("data", ignore)
      resolve()
    }
    const ignore = () => {
      clearTimeout(drainTimer)
      drainTimer = setTimeout(stopDrain, 100)
    }
    inp.on("data", ignore)
    drainTimer = setTimeout(stopDrain, 150)
  })
  await drain

  inp.pause()
  return results
}

;(async () => {
  const arg = (process.argv[2] || "auto").toLowerCase()
  
  if (arg !== "ansi" && arg !== "osc" && arg !== "auto") {
    console.error("Usage: bun run palette.ts [auto|ansi|osc]")
    process.exit(1)
  }

  let method = arg
  if (method === "auto") {
    const supported = await detectOSCSupport()
    method = supported ? "osc" : "ansi"
    console.error(`Auto-detected: ${method} mode`)
  }

  const INDICES = method === "osc" ? [...Array(256).keys()] : [...Array(16).keys()]
  const timeout = method === "osc" ? 5000 : 1000
  const results = await queryPalette(INDICES, timeout)
  const arr: Hex[] = INDICES.map((i) => results.get(i) ?? null)
  console.log(JSON.stringify(arr, null, 2))
})()
