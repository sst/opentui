#!/usr/bin/env bun

import { resolveRenderLib } from "../zig"
import { StdinDrainStatsStruct, StdinTokenStruct } from "../zig-structs"
import { StdinBuffer } from "../lib/stdin-buffer"

type Mode = "zig" | "legacy" | "both"

type Result = {
  mode: "zig" | "legacy"
  iterations: number
  patternsPerIteration: number
  inputBytes: number
  tokens: number
  payloadBytes: number
  elapsedMs: number
  throughputMBps: number
  tokensPerSec: number
  pushes: number
  drainCalls: number
}

const args = process.argv.slice(2)

function getArg(name: string): string | null {
  const prefix = `--${name}=`
  for (const arg of args) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length)
    }
  }
  return null
}

function toNumber(value: string | null, fallback: number): number {
  if (value == null) {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return parsed
}

function toPositiveInt(value: string | null, fallback: number): number {
  const parsed = Math.floor(toNumber(value, fallback))
  return parsed > 0 ? parsed : fallback
}

const modeArg = (getArg("mode") ?? "both") as Mode
const mode: Mode = modeArg === "zig" || modeArg === "legacy" || modeArg === "both" ? modeArg : "both"
const iterations = toPositiveInt(getArg("iters"), 5000)
const warmupIterations = toPositiveInt(getArg("warmup"), 500)
const patternsPerIteration = toPositiveInt(getArg("patterns"), 24)
const timeoutMs = toPositiveInt(getArg("timeout"), 10)
const tokenCapacity = toPositiveInt(getArg("token-cap"), 512)
const payloadCapacity = toPositiveInt(getArg("payload-cap"), 64 * 1024)
const jsonPath = getArg("json")

const encoder = new TextEncoder()
const encode = (value: string) => encoder.encode(value)

const chunkPatterns: Uint8Array[][] = [
  [encode("\x1b[<64;10;5Mx")],
  [encode("x\x1b[<65;10;5M")],
  [encode("\x1b[Ix")],
  [encode("\x1b["), encode("A")],
  [encode("\x1b]10;#ffff"), encode("ff\x07")],
  [encode("\x1b[200~pa"), encode("ste"), encode("\x1b[201~")],
  [encode("\x1b"), encode("\x1b[D")],
  [new Uint8Array([160])],
]

function summarize(result: Omit<Result, "throughputMBps" | "tokensPerSec">): Result {
  const elapsedSeconds = result.elapsedMs / 1000
  const throughputMBps = elapsedSeconds > 0 ? result.inputBytes / elapsedSeconds / (1024 * 1024) : 0
  const tokensPerSec = elapsedSeconds > 0 ? result.tokens / elapsedSeconds : 0
  return {
    ...result,
    throughputMBps,
    tokensPerSec,
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2)
}

function printResult(result: Result): void {
  console.log(`mode: ${result.mode}`)
  console.log(`iterations: ${result.iterations}`)
  console.log(`patterns/iteration: ${result.patternsPerIteration}`)
  console.log(`elapsed: ${formatNumber(result.elapsedMs)}ms`)
  console.log(`input bytes: ${result.inputBytes}`)
  console.log(`tokens: ${result.tokens}`)
  console.log(`payload bytes: ${result.payloadBytes}`)
  console.log(`throughput: ${formatNumber(result.throughputMBps)} MB/s`)
  console.log(`tokens/sec: ${formatNumber(result.tokensPerSec)}`)
  console.log(`pushes: ${result.pushes}`)
  console.log(`drain calls: ${result.drainCalls}`)
}

function runLegacyBenchmark(): Result {
  const buffer = new StdinBuffer({ timeout: timeoutMs })

  let collect = false
  let tokenCount = 0
  let payloadBytes = 0
  let inputBytes = 0
  let pushes = 0

  buffer.on("data", (sequence) => {
    if (!collect) return
    tokenCount += 1
    payloadBytes += sequence.length
  })

  buffer.on("paste", (payload) => {
    if (!collect) return
    tokenCount += 1
    payloadBytes += payload.length
  })

  const runLoops = (loopCount: number) => {
    for (let i = 0; i < loopCount; i += 1) {
      for (let j = 0; j < patternsPerIteration; j += 1) {
        const pattern = chunkPatterns[(i + j) % chunkPatterns.length]!
        for (const chunk of pattern) {
          buffer.process(Buffer.from(chunk))
          if (collect) {
            inputBytes += chunk.length
            pushes += 1
          }
        }
      }

      const flushed = buffer.flush()
      if (collect) {
        tokenCount += flushed.length
        for (const sequence of flushed) {
          payloadBytes += sequence.length
        }
      }
    }
  }

  runLoops(warmupIterations)
  buffer.clear()

  collect = true
  const start = performance.now()
  runLoops(iterations)
  const elapsedMs = performance.now() - start

  buffer.destroy()

  return summarize({
    mode: "legacy",
    iterations,
    patternsPerIteration,
    inputBytes,
    tokens: tokenCount,
    payloadBytes,
    elapsedMs,
    pushes,
    drainCalls: 0,
  })
}

function runZigBenchmark(): Result {
  const lib = resolveRenderLib()
  const parserPtr = lib.createStdinParser({ timeoutMs, maxBufferBytes: 64 * 1024, reserved0: 0 })
  const tokenBuffer = new Uint8Array(StdinTokenStruct.size * tokenCapacity)
  const payloadBuffer = new Uint8Array(payloadCapacity)
  const statsBuffer = new ArrayBuffer(StdinDrainStatsStruct.size)

  let collect = false
  let tokenCount = 0
  let payloadBytes = 0
  let inputBytes = 0
  let pushes = 0
  let drainCalls = 0

  const drainAvailable = (): boolean => {
    let hasPending = false

    while (true) {
      const { status, stats } = lib.stdinParserDrain(parserPtr, tokenBuffer, payloadBuffer, statsBuffer)
      if (status !== 0) {
        throw new Error(`stdinParserDrain failed: ${status}`)
      }

      if (collect) {
        drainCalls += 1
        tokenCount += stats.tokenCount
        payloadBytes += stats.payloadBytes
      }

      hasPending = stats.hasPending === 1
      if (stats.tokenCount === 0) {
        return hasPending
      }
    }
  }

  const flushPending = () => {
    let guard = 0
    while (drainAvailable()) {
      const status = lib.stdinParserFlushTimeout(parserPtr, Date.now() + timeoutMs + 1)
      if (status !== 0) {
        throw new Error(`stdinParserFlushTimeout failed: ${status}`)
      }

      guard += 1
      if (guard > 1024) {
        throw new Error("stdin parser did not settle after timeout flush")
      }
    }
  }

  const runLoops = (loopCount: number) => {
    for (let i = 0; i < loopCount; i += 1) {
      for (let j = 0; j < patternsPerIteration; j += 1) {
        const pattern = chunkPatterns[(i + j) % chunkPatterns.length]!
        for (const chunk of pattern) {
          const status = lib.stdinParserPush(parserPtr, chunk)
          if (status !== 0) {
            throw new Error(`stdinParserPush failed: ${status}`)
          }

          if (collect) {
            inputBytes += chunk.length
            pushes += 1
          }

          drainAvailable()
        }
      }

      flushPending()
    }
  }

  runLoops(warmupIterations)
  const resetStatus = lib.stdinParserReset(parserPtr)
  if (resetStatus !== 0) {
    lib.destroyStdinParser(parserPtr)
    throw new Error(`stdinParserReset failed after warmup: ${resetStatus}`)
  }

  collect = true
  const start = performance.now()
  runLoops(iterations)
  const elapsedMs = performance.now() - start

  lib.destroyStdinParser(parserPtr)

  return summarize({
    mode: "zig",
    iterations,
    patternsPerIteration,
    inputBytes,
    tokens: tokenCount,
    payloadBytes,
    elapsedMs,
    pushes,
    drainCalls,
  })
}

const results: Result[] = []

if (mode === "legacy" || mode === "both") {
  results.push(runLegacyBenchmark())
}

if (mode === "zig" || mode === "both") {
  results.push(runZigBenchmark())
}

for (const result of results) {
  printResult(result)
  console.log("")
}

if (results.length === 2) {
  const legacy = results.find((result) => result.mode === "legacy")!
  const zig = results.find((result) => result.mode === "zig")!
  const throughputRatio = legacy.throughputMBps > 0 ? zig.throughputMBps / legacy.throughputMBps : 0
  const tokenRatio = legacy.tokensPerSec > 0 ? zig.tokensPerSec / legacy.tokensPerSec : 0
  console.log(`zig/legacy throughput ratio: ${formatNumber(throughputRatio)}x`)
  console.log(`zig/legacy tokens/sec ratio: ${formatNumber(tokenRatio)}x`)
}

if (jsonPath) {
  await Bun.write(
    jsonPath,
    JSON.stringify(
      {
        mode,
        iterations,
        warmupIterations,
        patternsPerIteration,
        timeoutMs,
        tokenCapacity,
        payloadCapacity,
        results,
      },
      null,
      2,
    ),
  )
  console.log(`wrote ${jsonPath}`)
}
