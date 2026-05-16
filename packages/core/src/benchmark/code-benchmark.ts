#!/usr/bin/env bun
/**
 * code-benchmark.ts
 *
 * Benchmarks the CodeRenderable primitive end-to-end.
 *
 * Targets (see perf/code-primitive.md):
 *   - B1 single-shot highlight latency (cold + warm)
 *   - B2 streaming append (200 chunks of ~40 chars into a 5KB TS snippet)
 *   - B3 style-only toggles (conceal, syntaxStyle, drawUnstyledText)
 *   - B4 same-content cache test (toggle conceal off+on)
 *
 * Metrics:
 *   - end-to-end ms from `code.content = X` to highlight applied
 *   - worker postMessage round-trip count
 *   - bytes posted to worker (approximate via JSON length of message)
 *
 * Output: human summary + METRIC lines + optional JSON via --json=<path>.
 */

import { createTestRenderer } from "../testing/test-renderer.js"
import { CodeRenderable } from "../renderables/Code.js"
import { SyntaxStyle } from "../syntax-style.js"
import { TreeSitterClient } from "../lib/tree-sitter/client.js"
import { getDataPaths } from "../lib/data-paths.js"
import { parseColor } from "../lib/RGBA.js"
import { writeFileSync } from "node:fs"

const args = new Map<string, string>()
for (const arg of process.argv.slice(2)) {
  const eq = arg.indexOf("=")
  if (arg.startsWith("--") && eq > 0) {
    args.set(arg.slice(2, eq), arg.slice(eq + 1))
  } else if (arg.startsWith("--")) {
    args.set(arg.slice(2), "true")
  }
}

const RUNS = Number(args.get("runs") ?? 9)
const WARMUP = Number(args.get("warmup") ?? 1)
const JSON_PATH = args.get("json")
const QUIET = args.get("quiet") === "true"

// ----------------------------------------------------------------------------
// Sample content: ~5KB TypeScript snippet
// ----------------------------------------------------------------------------
const TS_SNIPPET = `import { EventEmitter } from "events"
import type { Buffer as NodeBuffer } from "node:buffer"

export interface BufferState {
  id: number
  content: string
  filetype: string
  version: number
  hasParser: boolean
}

export type HighlightCallback = (highlights: SimpleHighlight[]) => void

export class SimpleHighlight {
  constructor(
    public readonly startIndex: number,
    public readonly endIndex: number,
    public readonly captureName: string,
  ) {}

  get length(): number {
    return this.endIndex - this.startIndex
  }

  toString(): string {
    return \`\${this.captureName}@[\${this.startIndex},\${this.endIndex})\`
  }
}

export class BufferRegistry extends EventEmitter {
  private buffers = new Map<number, BufferState>()
  private nextId = 1

  create(content: string, filetype: string): BufferState {
    const id = this.nextId++
    const state: BufferState = { id, content, filetype, version: 0, hasParser: false }
    this.buffers.set(id, state)
    this.emit("created", state)
    return state
  }

  update(id: number, content: string): BufferState | undefined {
    const state = this.buffers.get(id)
    if (!state) return undefined
    state.content = content
    state.version += 1
    this.emit("updated", state)
    return state
  }

  dispose(id: number): boolean {
    const state = this.buffers.get(id)
    if (!state) return false
    this.buffers.delete(id)
    this.emit("disposed", state)
    return true
  }

  get(id: number): BufferState | undefined {
    return this.buffers.get(id)
  }

  *all(): IterableIterator<BufferState> {
    yield* this.buffers.values()
  }
}

export async function processBuffers(
  registry: BufferRegistry,
  callback: HighlightCallback,
): Promise<number> {
  let processed = 0
  for (const buffer of registry.all()) {
    if (!buffer.hasParser) continue
    const highlights = await highlight(buffer.content, buffer.filetype)
    callback(highlights)
    processed += 1
  }
  return processed
}

async function highlight(content: string, filetype: string): Promise<SimpleHighlight[]> {
  if (!content || !filetype) return []
  const tokens = content.split(/\\s+/)
  const result: SimpleHighlight[] = []
  let offset = 0
  for (const token of tokens) {
    if (token.length === 0) {
      offset += 1
      continue
    }
    const capture = token.startsWith("//") ? "comment" : "keyword"
    result.push(new SimpleHighlight(offset, offset + token.length, capture))
    offset += token.length + 1
  }
  return result
}

interface RenderOptions {
  width: number
  height: number
  filetype: string
  syntaxTheme: "dark" | "light"
  conceal: boolean
  streaming: boolean
}

export const DEFAULT_OPTIONS: RenderOptions = {
  width: 80,
  height: 24,
  filetype: "typescript",
  syntaxTheme: "dark",
  conceal: true,
  streaming: false,
}

export function mergeOptions(
  base: RenderOptions,
  override: Partial<RenderOptions>,
): RenderOptions {
  return { ...base, ...override }
}
`

// Duplicate with renamed identifiers so the snippet lands near 5KB while staying parseable.
const TS_SNIPPET_FULL = TS_SNIPPET + TS_SNIPPET.replace(/Buffer/g, "Frame").replace(/highlight/g, "tokenize")

if (TS_SNIPPET_FULL.length < 4500) {
  throw new Error(`TS_SNIPPET_FULL too small: ${TS_SNIPPET_FULL.length} chars (need >= 4500)`)
}

// ----------------------------------------------------------------------------
// Instrumented TreeSitterClient: wraps worker.postMessage to count traffic
// ----------------------------------------------------------------------------
interface ClientStats {
  messages: number
  bytes: number
  oneshotMessages: number
  oneshotBytes: number
}

function makeFreshStats(): ClientStats {
  return { messages: 0, bytes: 0, oneshotMessages: 0, oneshotBytes: 0 }
}

let _statsRef: ClientStats = makeFreshStats()

async function buildInstrumentedClient(): Promise<{ client: TreeSitterClient; reset: () => void; snapshot: () => ClientStats }> {
  const dataPaths = getDataPaths()
  const client = new TreeSitterClient({ dataPath: dataPaths.globalDataPath })

  // The constructor calls startWorker(); the `worker` field is private.
  // Reach in once and wrap postMessage.
  const anyClient = client as unknown as { worker: Worker }
  const worker = anyClient.worker
  const originalPost = worker.postMessage.bind(worker)
  // @ts-expect-error overwrite for instrumentation
  worker.postMessage = (message: any, ...rest: any[]) => {
    try {
      const json = JSON.stringify(message)
      const bytes = json.length
      _statsRef.messages += 1
      _statsRef.bytes += bytes
      if (message?.type === "ONESHOT_HIGHLIGHT") {
        _statsRef.oneshotMessages += 1
        _statsRef.oneshotBytes += bytes
      }
    } catch {
      _statsRef.messages += 1
    }
    return originalPost(message, ...rest)
  }

  // Wait for parser warmup before measuring.
  await client.preloadParser("typescript")

  return {
    client,
    reset: () => {
      _statsRef = makeFreshStats()
    },
    snapshot: () => ({ ..._statsRef }),
  }
}

// ----------------------------------------------------------------------------
// Stats helpers
// ----------------------------------------------------------------------------
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mad(values: number[], med: number): number {
  const deviations = values.map((v) => Math.abs(v - med))
  return median(deviations)
}

interface MetricBlock {
  name: string
  unit: string
  values: number[]
  median: number
  mad: number
  min: number
  max: number
}

function makeMetricBlock(name: string, unit: string, values: number[]): MetricBlock {
  const med = median(values)
  return {
    name,
    unit,
    values,
    median: med,
    mad: mad(values, med),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

// ----------------------------------------------------------------------------
// Scenario driver
// ----------------------------------------------------------------------------
interface ScenarioContext {
  client: TreeSitterClient
  reset: () => void
  snapshot: () => ClientStats
  syntaxStyleA: SyntaxStyle
  syntaxStyleB: SyntaxStyle
}

interface ScenarioResult {
  name: string
  blocks: MetricBlock[]
}

// Drive the renderer until the CodeRenderable is fully idle. Coalescing in
// Code.ts means a stale bail clears the flag *and* requests a render — we
// have to actually consume those renders for the next highlight to fire.
async function settle(code: CodeRenderable, renderOnce: () => Promise<void>): Promise<void> {
  const MAX_ROUNDS = 32
  for (let i = 0; i < MAX_ROUNDS; i++) {
    await code.highlightingDone
    if (!code.isHighlighting) {
      // One more render to flush any pending dirty state (set by bailStale).
      await renderOnce()
      if (!code.isHighlighting) return
    }
  }
  throw new Error("settle: code never went idle")
}

async function withCode<T>(
  ctx: ScenarioContext,
  options: { content?: string; streaming?: boolean; drawUnstyledText?: boolean },
  fn: (code: CodeRenderable, renderOnce: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const { renderer, renderOnce } = await createTestRenderer({ width: 100, height: 40 })
  const code = new CodeRenderable(renderer, {
    content: options.content ?? "",
    filetype: "typescript",
    syntaxStyle: ctx.syntaxStyleA,
    drawUnstyledText: options.drawUnstyledText ?? false,
    streaming: options.streaming ?? false,
    width: "100%",
    height: "100%",
    treeSitterClient: ctx.client,
  })
  renderer.root.add(code)
  try {
    return await fn(code, renderOnce)
  } finally {
    code.destroy()
    renderer.destroy()
  }
}

// B1: single-shot highlight (cold = first time we see this content;
// warm = same content already seen by worker)
async function scenarioB1(ctx: ScenarioContext): Promise<ScenarioResult> {
  const latencies: number[] = []
  const msgCounts: number[] = []
  const byteCounts: number[] = []

  for (let i = 0; i < WARMUP + RUNS; i++) {
    await withCode(ctx, {}, async (code, renderOnce) => {
      ctx.reset()
      const t0 = performance.now()
      code.content = TS_SNIPPET_FULL
      await renderOnce() // triggers renderSelf -> startHighlight
      await code.highlightingDone
      const t1 = performance.now()
      if (i >= WARMUP) {
        const snap = ctx.snapshot()
        latencies.push(t1 - t0)
        msgCounts.push(snap.messages)
        byteCounts.push(snap.bytes)
      }
    })
  }

  return {
    name: "b1_single_shot",
    blocks: [
      makeMetricBlock("b1_single_shot_ms", "ms", latencies),
      makeMetricBlock("b1_single_shot_msgs", "count", msgCounts),
      makeMetricBlock("b1_single_shot_bytes", "bytes", byteCounts),
    ],
  }
}

// B2: streaming append — 200 chunks of ~40 chars into the snippet
const STREAM_CHUNKS = Number(args.get("stream-chunks") ?? 200)
const STREAM_CHUNK_SIZE = Number(args.get("stream-chunk-size") ?? 40)

function makeStreamAppend(base: string): string[] {
  const chunks: string[] = []
  const appendCorpus = `// generated comment line ${"x".repeat(STREAM_CHUNK_SIZE)}\n`
  for (let i = 0; i < STREAM_CHUNKS; i++) {
    chunks.push(appendCorpus.slice(0, STREAM_CHUNK_SIZE))
  }
  return chunks
}

async function scenarioB2(ctx: ScenarioContext): Promise<ScenarioResult> {
  const totalTimes: number[] = []
  const settleTimes: number[] = []
  const msgCounts: number[] = []
  const byteCounts: number[] = []
  const chunks = makeStreamAppend(TS_SNIPPET_FULL)

  for (let i = 0; i < WARMUP + RUNS; i++) {
    await withCode(ctx, { content: TS_SNIPPET_FULL, streaming: true }, async (code, renderOnce) => {
      // Let the initial highlight settle so we measure only the stream.
      await renderOnce()
      await code.highlightingDone

      ctx.reset()
      const t0 = performance.now()
      let buffer = TS_SNIPPET_FULL
      for (const chunk of chunks) {
        buffer = buffer + chunk
        code.content = buffer
        await renderOnce()
      }
      const tAppendsDone = performance.now()
      // Drive frames until the renderable is fully idle. With coalescing the
      // in-flight highlight may bail-stale, request a render, and only fire
      // the next highlight on that subsequent frame.
      await settle(code, renderOnce)
      const tSettled = performance.now()

      if (i >= WARMUP) {
        const snap = ctx.snapshot()
        totalTimes.push(tSettled - t0)
        settleTimes.push(tSettled - tAppendsDone)
        msgCounts.push(snap.messages)
        byteCounts.push(snap.bytes)
      }
    })
  }

  return {
    name: "b2_streaming_append",
    blocks: [
      makeMetricBlock("b2_streaming_total_ms", "ms", totalTimes),
      makeMetricBlock("b2_streaming_settle_ms", "ms", settleTimes),
      makeMetricBlock("b2_streaming_msgs", "count", msgCounts),
      makeMetricBlock("b2_streaming_bytes", "bytes", byteCounts),
    ],
  }
}

// B3: style-only toggles on stable content
async function scenarioB3(ctx: ScenarioContext): Promise<ScenarioResult> {
  const concealTimes: number[] = []
  const concealMsgs: number[] = []
  const styleTimes: number[] = []
  const styleMsgs: number[] = []

  for (let i = 0; i < WARMUP + RUNS; i++) {
    await withCode(ctx, { content: TS_SNIPPET_FULL }, async (code, renderOnce) => {
      await renderOnce()
      await code.highlightingDone

      // Toggle conceal
      ctx.reset()
      const tc0 = performance.now()
      code.conceal = !code.conceal
      await renderOnce()
      await code.highlightingDone
      const tc1 = performance.now()
      const concealSnap = ctx.snapshot()

      // Swap syntaxStyle
      ctx.reset()
      const ts0 = performance.now()
      code.syntaxStyle = ctx.syntaxStyleB
      await renderOnce()
      await code.highlightingDone
      const ts1 = performance.now()
      const styleSnap = ctx.snapshot()

      if (i >= WARMUP) {
        concealTimes.push(tc1 - tc0)
        concealMsgs.push(concealSnap.messages)
        styleTimes.push(ts1 - ts0)
        styleMsgs.push(styleSnap.messages)
      }
    })
  }

  return {
    name: "b3_style_toggles",
    blocks: [
      makeMetricBlock("b3_conceal_toggle_ms", "ms", concealTimes),
      makeMetricBlock("b3_conceal_toggle_msgs", "count", concealMsgs),
      makeMetricBlock("b3_syntaxstyle_swap_ms", "ms", styleTimes),
      makeMetricBlock("b3_syntaxstyle_swap_msgs", "count", styleMsgs),
    ],
  }
}

// B4: same-content cache test — set the same content twice, then toggle conceal off+on
async function scenarioB4(ctx: ScenarioContext): Promise<ScenarioResult> {
  const resetTimes: number[] = []
  const resetMsgs: number[] = []
  const toggleTimes: number[] = []
  const toggleMsgs: number[] = []

  for (let i = 0; i < WARMUP + RUNS; i++) {
    await withCode(ctx, {}, async (code, renderOnce) => {
      // Initial highlight to warm any internal state
      code.content = TS_SNIPPET_FULL
      await renderOnce()
      await code.highlightingDone

      // Re-set the SAME content
      ctx.reset()
      const t0 = performance.now()
      code.content = TS_SNIPPET_FULL + " " // tweak by 1 char to force dirty
      await renderOnce()
      await code.highlightingDone
      code.content = TS_SNIPPET_FULL // back to original
      await renderOnce()
      await code.highlightingDone
      const t1 = performance.now()
      const resetSnap = ctx.snapshot()

      // Toggle conceal off then on
      ctx.reset()
      const tg0 = performance.now()
      code.conceal = false
      await renderOnce()
      await code.highlightingDone
      code.conceal = true
      await renderOnce()
      await code.highlightingDone
      const tg1 = performance.now()
      const toggleSnap = ctx.snapshot()

      if (i >= WARMUP) {
        resetTimes.push(t1 - t0)
        resetMsgs.push(resetSnap.messages)
        toggleTimes.push(tg1 - tg0)
        toggleMsgs.push(toggleSnap.messages)
      }
    })
  }

  return {
    name: "b4_cache_test",
    blocks: [
      makeMetricBlock("b4_content_reset_ms", "ms", resetTimes),
      makeMetricBlock("b4_content_reset_msgs", "count", resetMsgs),
      makeMetricBlock("b4_conceal_pingpong_ms", "ms", toggleTimes),
      makeMetricBlock("b4_conceal_pingpong_msgs", "count", toggleMsgs),
    ],
  }
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function fmtBlock(b: MetricBlock): string {
  return `  ${b.name.padEnd(34)} median=${b.median.toFixed(2)} ${b.unit.padEnd(5)} mad=${b.mad.toFixed(2)}  min=${b.min.toFixed(2)}  max=${b.max.toFixed(2)}`
}

async function main() {
  const syntaxStyleA = SyntaxStyle.fromStyles({
    default: { fg: parseColor("#E6EDF3") },
    keyword: { fg: parseColor("#88C0D0"), bold: true },
    string: { fg: parseColor("#A3BE8C") },
    comment: { fg: parseColor("#616E88"), italic: true },
    function: { fg: parseColor("#81A1C1") },
    type: { fg: parseColor("#8FBCBB") },
  })
  const syntaxStyleB = SyntaxStyle.fromStyles({
    default: { fg: parseColor("#F8F8F2") },
    keyword: { fg: parseColor("#F92672"), bold: true },
    string: { fg: parseColor("#E6DB74") },
    comment: { fg: parseColor("#75715E"), italic: true },
    function: { fg: parseColor("#66D9EF") },
    type: { fg: parseColor("#A6E22E") },
  })

  const { client, reset, snapshot } = await buildInstrumentedClient()
  const ctx: ScenarioContext = { client, reset, snapshot, syntaxStyleA, syntaxStyleB }

  const scenarioFilter = args.get("only")?.split(",")
  const all: ScenarioResult[] = []
  const scenarios: Array<[string, (ctx: ScenarioContext) => Promise<ScenarioResult>]> = [
    ["b1", scenarioB1],
    ["b2", scenarioB2],
    ["b3", scenarioB3],
    ["b4", scenarioB4],
  ]

  for (const [name, fn] of scenarios) {
    if (scenarioFilter && !scenarioFilter.includes(name)) continue
    if (!QUIET) process.stderr.write(`running ${name}...\n`)
    const result = await fn(ctx)
    all.push(result)
  }

  // Human-readable summary
  if (!QUIET) {
    console.log("\n=== CodeRenderable benchmark ===")
    console.log(`runs=${RUNS} warmup=${WARMUP}`)
    console.log(`snippet=${TS_SNIPPET_FULL.length} chars  stream=${STREAM_CHUNKS}x${STREAM_CHUNK_SIZE}`)
    for (const r of all) {
      console.log(`\n[${r.name}]`)
      for (const b of r.blocks) console.log(fmtBlock(b))
    }
    console.log("")
  }

  // METRIC lines (machine-readable)
  for (const r of all) {
    for (const b of r.blocks) {
      console.log(`METRIC ${b.name}=${b.median.toFixed(4)} unit=${b.unit} mad=${b.mad.toFixed(4)}`)
    }
  }

  if (JSON_PATH) {
    writeFileSync(
      JSON_PATH,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          runs: RUNS,
          warmup: WARMUP,
          snippetChars: TS_SNIPPET_FULL.length,
          streamChunks: STREAM_CHUNKS,
          streamChunkSize: STREAM_CHUNK_SIZE,
          scenarios: all,
        },
        null,
        2,
      ),
    )
  }

  // The TreeSitterClient owns a Worker that keeps the loop alive.
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
