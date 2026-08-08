#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import { dirname, resolve } from "node:path"
import { MarkdownRenderable, RGBA, SyntaxStyle } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createMermaidMarkdownRenderer } from "../markdown.js"

type PhaseName = "reset_valid" | "valid_growth" | "invalid_partial_fallback" | "final_completion"

interface CycleMeasurement {
  elapsedNs: bigint
  phaseNs: Record<PhaseName, bigint>
  checksum: number
}

interface BatchMeasurement extends CycleMeasurement {
  iterations: number
}

interface Statistics {
  medianNs: number
  meanNs: number
  minNs: number
  maxNs: number
  spreadPercent: number
  rmePercent: number
}

interface BenchmarkResult extends Statistics {
  name: string
  unit: "cycle" | "update"
  batchIterations: number
  samplesNs: number[]
}

const PHASES: readonly PhaseName[] = ["reset_valid", "valid_growth", "invalid_partial_fallback", "final_completion"]

const source = (body: string) => `Streaming benchmark

\`\`\`mermaid
flowchart LR
  A[Stable reset] --> B[Baseline]
${body}\`\`\`

Rendered output`

const CONTENT: Record<PhaseName, string> = {
  reset_valid: source(""),
  valid_growth: source("  B --> C[Growth applied]\n"),
  invalid_partial_fallback: source("  B --> C[Growth applied]\n  C -->\n"),
  final_completion: source("  B --> C[Growth applied]\n  C --> D[Final complete]\n"),
}

const suite = enumArg("suite", ["quick", "default", "long"] as const, "default")
const defaults = {
  quick: { targetBatchMs: 25, warmupRounds: 1, measuredRounds: 3 },
  default: { targetBatchMs: 300, warmupRounds: 2, measuredRounds: 7 },
  long: { targetBatchMs: 1_000, warmupRounds: 3, measuredRounds: 11 },
}[suite]
const targetBatchMs = numberArg("target-batch-ms", defaults.targetBatchMs, 1)
const warmupRounds = integerArg("warmup-rounds", defaults.warmupRounds, 0)
const measuredRounds = integerArg("rounds", defaults.measuredRounds, 2)
const jsonPath = optionalArg("json")
const quiet = process.argv.includes("--no-output")
let blackhole = 0

const testRenderer = await createTestRenderer({ width: 100, height: 32 })
const { renderer, renderOnce, captureCharFrame } = testRenderer
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromValues(1, 1, 1, 1) } })
const markdown = new MarkdownRenderable(renderer, {
  id: "mermaid-streaming-markdown-benchmark",
  content: CONTENT.reset_valid,
  syntaxStyle,
  streaming: true,
  internalBlockMode: "top-level",
  renderNode: createMermaidMarkdownRenderer(renderer),
})
renderer.root.add(markdown)

try {
  await correctnessPreflight()

  if (!quiet) {
    console.log("correctness preflight passed")
    console.log(
      `mermaid streaming Markdown benchmark suite=${suite} target=${targetBatchMs}ms warmup=${warmupRounds} rounds=${measuredRounds}`,
    )
    process.stdout.write("calibrating streaming cycle\r")
  }

  const targetNs = BigInt(Math.round(targetBatchMs * 1_000_000))
  let batchIterations = 1
  for (;;) {
    const batch = await runBatch(batchIterations)
    if (batch.elapsedNs >= targetNs || batchIterations >= 10_000) break
    const ratio = Number(targetNs) / Math.max(1, Number(batch.elapsedNs))
    batchIterations = Math.min(10_000, batchIterations * Math.max(2, Math.min(10, Math.ceil(ratio))))
  }

  for (let round = 0; round < warmupRounds; round++) await runBatch(batchIterations)

  const cycleSamples: number[] = []
  const phaseSamples = Object.fromEntries(PHASES.map((phase) => [phase, [] as number[]])) as Record<PhaseName, number[]>
  for (let round = 0; round < measuredRounds; round++) {
    const batch = await runBatch(batchIterations)
    cycleSamples.push(Number(batch.elapsedNs) / batch.iterations)
    for (const phase of PHASES) phaseSamples[phase].push(Number(batch.phaseNs[phase]) / batch.iterations)
  }

  const cycleResult = result("streaming_cycle", "cycle", batchIterations, cycleSamples)
  const phaseResults = PHASES.map((phase) => result(`phase_${phase}`, "update", batchIterations, phaseSamples[phase]))

  if (!quiet) {
    process.stdout.write("\x1b[2K\r")
    printResult(cycleResult)
    for (const phaseResult of phaseResults) printResult(phaseResult)
  }

  printMetric("mermaid_streaming_markdown_ns_per_cycle", cycleResult)
  for (const phaseResult of phaseResults) {
    printMetric(`mermaid_streaming_markdown_${phaseResult.name}_ns_per_update`, phaseResult)
  }

  const payload = {
    benchmark: "mermaid-streaming-markdown",
    version: 1,
    timestamp: new Date().toISOString(),
    environment: {
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
      availableParallelism: availableParallelism(),
    },
    config: { suite, targetBatchMs, warmupRounds, measuredRounds, width: 100, height: 32 },
    workload: {
      phases: PHASES,
      updatesPerCycle: PHASES.length,
      bytes: Object.fromEntries(PHASES.map((phase) => [phase, Buffer.byteLength(CONTENT[phase])])),
    },
    checksum: blackhole >>> 0,
    results: [cycleResult, ...phaseResults],
  }

  if (jsonPath) {
    const output = resolve(jsonPath)
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`)
    if (!quiet) console.log(`json=${output}`)
  }
} finally {
  renderer.destroy()
  syntaxStyle.destroy()
}

async function correctnessPreflight(): Promise<void> {
  await update(CONTENT.reset_valid)
  assertFrame("reset_valid", ["Stable reset", "Baseline"], ["flowchart LR"])

  await update(CONTENT.valid_growth)
  assertFrame("valid_growth", ["Growth applied"], ["flowchart LR"])

  await update(CONTENT.invalid_partial_fallback)
  assertFrame("invalid_partial_fallback", ["Growth applied"], ["flowchart LR", "C -->"])

  await update(CONTENT.final_completion)
  assertFrame("final_completion", ["Final complete"], ["flowchart LR"])
}

function assertFrame(phase: PhaseName, included: readonly string[], excluded: readonly string[]): void {
  const frame = captureCharFrame()
  for (const value of included) {
    if (!frame.includes(value)) throw new Error(`correctness preflight ${phase}: expected frame to contain ${value}`)
  }
  for (const value of excluded) {
    if (frame.includes(value)) throw new Error(`correctness preflight ${phase}: expected frame not to contain ${value}`)
  }
}

async function update(content: string): Promise<number> {
  markdown.content = content
  await renderOnce()
  return renderer.frameId | 0
}

async function runCycle(): Promise<CycleMeasurement> {
  const phaseNs = emptyPhaseTimings()
  let checksum = 0
  const cycleStarted = process.hrtime.bigint()
  for (const phase of PHASES) {
    const started = process.hrtime.bigint()
    checksum = (checksum + (await update(CONTENT[phase]))) | 0
    phaseNs[phase] = process.hrtime.bigint() - started
  }
  return { elapsedNs: process.hrtime.bigint() - cycleStarted, phaseNs, checksum }
}

async function runBatch(iterations: number): Promise<BatchMeasurement> {
  const phaseNs = emptyPhaseTimings()
  let checksum = 0
  const started = process.hrtime.bigint()
  for (let iteration = 0; iteration < iterations; iteration++) {
    const cycle = await runCycle()
    checksum = (checksum + cycle.checksum) | 0
    for (const phase of PHASES) phaseNs[phase] += cycle.phaseNs[phase]
  }
  const elapsedNs = process.hrtime.bigint() - started
  blackhole = (blackhole ^ checksum) | 0
  return { elapsedNs, phaseNs, checksum, iterations }
}

function emptyPhaseTimings(): Record<PhaseName, bigint> {
  return { reset_valid: 0n, valid_growth: 0n, invalid_partial_fallback: 0n, final_completion: 0n }
}

function result(
  name: string,
  unit: BenchmarkResult["unit"],
  batchIterations: number,
  samplesNs: number[],
): BenchmarkResult {
  return { name, unit, batchIterations, samplesNs, ...statistics(samplesNs) }
}

function statistics(values: readonly number[]): Statistics {
  const sorted = [...values].sort((left, right) => left - right)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const median = percentile(sorted, 0.5)
  const variance =
    values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0
  const standardError = Math.sqrt(variance) / Math.sqrt(values.length)
  return {
    medianNs: median,
    meanNs: mean,
    minNs: sorted[0]!,
    maxNs: sorted[sorted.length - 1]!,
    spreadPercent: median === 0 ? 0 : ((sorted[sorted.length - 1]! - sorted[0]!) / median) * 100,
    rmePercent: mean === 0 ? 0 : (tCritical95(values.length - 1) * standardError * 100) / mean,
  }
}

function percentile(sorted: readonly number[], quantile: number): number {
  const position = (sorted.length - 1) * quantile
  const lower = Math.floor(position)
  const fraction = position - lower
  return sorted[lower]! + (sorted[Math.min(lower + 1, sorted.length - 1)]! - sorted[lower]!) * fraction
}

function tCritical95(degreesOfFreedom: number): number {
  const values = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228]
  return values[Math.min(Math.max(1, degreesOfFreedom), 10) - 1] ?? 1.96
}

function printResult(value: BenchmarkResult): void {
  console.log(
    `${value.name.padEnd(34)} ${formatNs(value.medianNs).padStart(11)}/${value.unit}` +
      `  spread=${value.spreadPercent.toFixed(2)}% rme=${value.rmePercent.toFixed(2)}%` +
      `  batch=${value.batchIterations}`,
  )
}

function printMetric(name: string, value: BenchmarkResult): void {
  console.log(
    `METRIC ${name}=${value.medianNs.toFixed(2)} unit=ns/${value.unit}` +
      ` spread_pct=${value.spreadPercent.toFixed(2)} rme_pct=${value.rmePercent.toFixed(2)}` +
      ` rounds=${measuredRounds} batch=${value.batchIterations}`,
  )
}

function formatNs(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(3)} ms`
  if (value >= 1_000) return `${(value / 1_000).toFixed(3)} us`
  return `${value.toFixed(1)} ns`
}

function optionalArg(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null
}

function numberArg(name: string, fallback: number, minimum: number): number {
  const raw = optionalArg(name)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < minimum) throw new Error(`--${name} must be >= ${minimum}`)
  return value
}

function integerArg(name: string, fallback: number, minimum: number): number {
  const value = numberArg(name, fallback, minimum)
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer`)
  return value
}

function enumArg<const Values extends readonly string[]>(
  name: string,
  values: Values,
  fallback: Values[number],
): Values[number] {
  const value = optionalArg(name) ?? fallback
  if (!values.includes(value)) throw new Error(`--${name} must be one of: ${values.join(", ")}`)
  return value as Values[number]
}
