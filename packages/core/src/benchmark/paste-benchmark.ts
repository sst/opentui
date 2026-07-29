#!/usr/bin/env bun

import { Buffer } from "node:buffer"
import { performance } from "node:perf_hooks"
import { Command } from "commander"
import { ANSI } from "../ansi.js"
import { PasteEvent } from "../lib/KeyHandler.js"
import { decodePasteBytes, stripAnsiSequences } from "../lib/paste.js"
import { StdinParser } from "../lib/stdin-parser.js"
import { TextareaRenderable } from "../renderables/Textarea.js"
import { createTestRenderer } from "../testing.js"

type PayloadShape = "wrapped" | "lines"
type Phase = "parser" | "sanitize" | "insert" | "readback" | "measure" | "render"

interface SampleResult {
  shape: PayloadShape
  bytes: number
  lines: number
  phase: Phase
  medianMs: number
  p95Ms: number
  minMs: number
}

const DEFAULT_SIZES = [1024, 16 * 1024, 64 * 1024, 256 * 1024]
const DEFAULT_ITERATIONS = 10
const DEFAULT_WARMUP_ITERATIONS = 2
const DEFAULT_WIDTH = 80
const DEFAULT_HEIGHT = 24
const TEXTAREA_HEIGHT = 6
const MAX_READBACK_BYTES = 1024 * 1024

const program = new Command()
program
  .name("paste-benchmark")
  .description("Benchmark local bracketed paste phases with in-memory terminal output")
  .option("-i, --iterations <count>", "measured iterations", String(DEFAULT_ITERATIONS))
  .option("--warmup-iterations <count>", "warmup iterations", String(DEFAULT_WARMUP_ITERATIONS))
  .option("--sizes <bytes>", "comma-separated payload sizes", DEFAULT_SIZES.join(","))
  .option("--shape <shape>", "payload shape: wrapped, lines, or all", "all")
  .option("--width <columns>", "renderer width", String(DEFAULT_WIDTH))
  .option("--height <rows>", "renderer height", String(DEFAULT_HEIGHT))
  .parse(process.argv)

const options = program.opts()
const iterations = positiveInteger(options.iterations, "iterations")
const warmupIterations = nonNegativeInteger(options.warmupIterations, "warmup iterations")
const sizes = parseSizes(String(options.sizes))
const width = positiveInteger(options.width, "width")
const height = positiveInteger(options.height, "height")
const shapes = parseShapes(String(options.shape))

const { renderer, renderOnce } = await createTestRenderer({
  width,
  height,
  targetFps: 60,
  maxFps: 60,
  screenMode: "main-screen",
  externalOutputMode: "passthrough",
  consoleMode: "disabled",
  useMouse: false,
})

const textarea = new TextareaRenderable(renderer, {
  id: "paste-benchmark-textarea",
  width: "100%",
  maxHeight: TEXTAREA_HEIGHT,
  wrapMode: "word",
  showCursor: false,
})
renderer.root.add(textarea)
textarea.focus()
await renderOnce()

const results: SampleResult[] = []
let sink = 0

try {
  for (const shape of shapes) {
    for (const requestedBytes of sizes) {
      const text = createPayload(shape, requestedBytes)
      const bytes = Buffer.from(text)
      const framed = Buffer.concat([Buffer.from(ANSI.bracketedPasteStart), bytes, Buffer.from(ANSI.bracketedPasteEnd)])
      const event = new PasteEvent(bytes)
      const lines = countLines(text)

      results.push(
        await runPhase(shape, bytes.byteLength, lines, "parser", iterations, warmupIterations, () => {
          const parser = new StdinParser({ armTimeouts: false })
          parser.push(framed)
          const parsed = parser.read()
          if (parsed?.type !== "paste" || parsed.bytes.byteLength !== bytes.byteLength) {
            throw new Error("Parser did not produce the expected paste event")
          }
          sink += parsed.bytes.byteLength
          parser.destroy()
        }),
      )

      results.push(
        await runPhase(shape, bytes.byteLength, lines, "sanitize", iterations, warmupIterations, () => {
          sink += stripAnsiSequences(decodePasteBytes(bytes)).length
        }),
      )

      results.push(
        await runEditorPhase("insert", () => {
          textarea.handlePaste(event)
        }),
        await runEditorPhase("readback", () => {
          textarea.onContentChange = () => {
            sink += textarea.plainText.length
          }
          textarea.handlePaste(event)
        }),
        await runEditorPhase("measure", () => {
          textarea.handlePaste(event)
          const measured = textarea.editorView.measureForDimensions(width, TEXTAREA_HEIGHT)
          sink += measured?.lineCount ?? 0
        }),
        await runEditorPhase("render", async () => {
          renderer.stdin.emit("data", framed)
          await renderOnce()
          sink += renderer.getNativeStats().cellsUpdated
        }),
      )

      function runEditorPhase(phase: Exclude<Phase, "parser" | "sanitize">, operation: () => void | Promise<void>) {
        return runPhase(shape, bytes.byteLength, lines, phase, iterations, warmupIterations, operation, async () => {
          textarea.onContentChange = undefined
          textarea.setText("")
          await renderOnce()
        })
      }
    }
  }
} finally {
  renderer.destroy()
}

console.log("local paste benchmark")
console.log(`- renderer: ${width}x${height}, textarea maxHeight=${TEXTAREA_HEIGHT}`)
console.log("- output: memory (no terminal or SSH writes)")
console.log(`- iterations: ${iterations} (+${warmupIterations} warmup)`)
console.table(results)

if (sink === 0) {
  throw new Error("Benchmark result sink was not updated")
}

async function runPhase(
  shape: PayloadShape,
  bytes: number,
  lines: number,
  phase: Phase,
  measuredIterations: number,
  phaseWarmupIterations: number,
  operation: () => void | Promise<void>,
  reset?: () => void | Promise<void>,
): Promise<SampleResult> {
  const totalIterations = measuredIterations + phaseWarmupIterations
  const samples: number[] = []

  for (let iteration = 0; iteration < totalIterations; iteration += 1) {
    await reset?.()
    const start = performance.now()
    await operation()
    const elapsed = performance.now() - start
    if (iteration >= phaseWarmupIterations) samples.push(elapsed)
  }

  samples.sort((left, right) => left - right)
  return {
    shape,
    bytes,
    lines,
    phase,
    medianMs: round(percentile(samples, 0.5)),
    p95Ms: round(percentile(samples, 0.95)),
    minMs: round(samples[0] ?? 0),
  }
}

function createPayload(shape: PayloadShape, targetBytes: number): string {
  const unit =
    shape === "wrapped"
      ? "dictated text exercises local paste insertion and word wrapping without newlines "
      : "short pasted line used to measure multiline prompt layout\n"
  return unit.repeat(Math.ceil(targetBytes / unit.length)).slice(0, targetBytes)
}

function countLines(text: string): number {
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1
  }
  return lines
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index] ?? 0
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function parseSizes(value: string): number[] {
  const parsed = value.split(",").map((part) => positiveInteger(part.trim(), "payload size"))
  if (parsed.some((size) => size > MAX_READBACK_BYTES)) {
    throw new Error(`Payload sizes cannot exceed ${MAX_READBACK_BYTES} bytes because readback is capped at that size`)
  }
  return parsed
}

function parseShapes(value: string): PayloadShape[] {
  if (value === "all") return ["wrapped", "lines"]
  if (value === "wrapped" || value === "lines") return [value]
  throw new Error(`Invalid payload shape: ${value}`)
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${label}: ${String(value)}`)
  return parsed
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${label}: ${String(value)}`)
  return parsed
}
