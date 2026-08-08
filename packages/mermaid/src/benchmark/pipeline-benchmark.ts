#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { availableParallelism } from "node:os"
import { detectMermaidDiagram } from "../detect.js"
import { drawFlowchartDiagramGrid } from "../flowchart/drawing.js"
import { parseMermaidFlowchartDiagram } from "../flowchart/parser.js"
import { renderGridStyledText, resolveFlowchartStyleColors } from "../flowchart/style.js"
import { drawSequenceDiagramGrid } from "../sequence/drawing.js"
import { parseMermaidSequenceDiagram } from "../sequence/parser.js"
import { renderSequenceGridStyledText } from "../sequence/render-grid.js"
import { resolveSequenceStyleColors } from "../sequence/style.js"
import { drawStateDiagramGrid } from "../state/drawing.js"
import { parseMermaidStateDiagram } from "../state/parser.js"
import { renderStateGridStyledText } from "../state/render-grid.js"
import { resolveStateStyleColors } from "../state/style.js"

type Family = "flowchart" | "state" | "sequence"

interface Fixture {
  family: Family
  source: string
}

interface BenchmarkCase {
  name: string
  unit: "diagram"
  batchMultiple: number
  run(iteration: number): number
}

interface Statistics {
  medianNsPerDiagram: number
  meanNsPerDiagram: number
  minNsPerDiagram: number
  maxNsPerDiagram: number
  spreadPercent: number
  rmePercent: number
}

interface BenchmarkResult extends Statistics {
  name: string
  unit: "diagram"
  batchIterations: number
  samplesNsPerDiagram: number[]
}

const FIXTURES: readonly Fixture[] = [
  {
    family: "flowchart",
    source: `flowchart LR
  subgraph ingress[Request ingress]
    direction TB
    client([Terminal client]) -->|submit| parser[Parse command]
    parser --> validate{Input valid?}
  end
  subgraph execution[Execution pipeline]
    direction TB
    validate -->|yes| plan[[Build execution plan]]
    plan --> cache[(Result cache)]
    cache -. miss .-> worker[Run worker pool]
    worker ==> aggregate[Aggregate results]
  end
  validate -->|no| reject[Return diagnostics]
  aggregate --> render[Render response]
  render --> client
  worker --> audit[Write audit event]
  audit --> archive[(Event archive)]`,
  },
  {
    family: "state",
    source: `stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Resolving : request received
  state Resolving {
    [*] --> Detecting
    Detecting --> Parsing : family known
    Parsing --> LayingOut : syntax valid
    LayingOut --> Drawing : bounds ready
    Drawing --> [*] : grid complete
  }
  Resolving --> Ready : render complete
  Resolving --> Failed : unsupported syntax
  state Ready {
    [*] --> Visible
    Visible --> Selected : focus next edge
    Selected --> Visible : clear focus
  }
  note right of Ready : Styled output is retained
  Ready --> Idle : source changed
  Failed --> Idle : edit source
  Failed --> [*] : close preview`,
  },
  {
    family: "sequence",
    source: `sequenceDiagram
  autonumber
  box Runtime pipeline
    participant UI as Terminal UI
    participant Adapter as Markdown adapter
    participant Parser as Mermaid parser
    participant Layout as Layout engine
    participant Grid as Styled grid
  end
  UI->>+Adapter: render fenced diagram
  Adapter->>Parser: detect and parse source
  Parser-->>Adapter: typed diagram model
  Adapter->>+Layout: place nodes and routes
  Layout-->>-Adapter: placement plan
  alt supported diagram
    Adapter->>Grid: draw styled cells
    note over Adapter,Grid: Preserve semantic color roles
    Grid-->>Adapter: StyledText chunks
    Adapter-->>UI: measured renderable
  else unsupported syntax
    Adapter--xUI: diagnostic with source line
  end
  loop active navigation
    UI->>Adapter: select next edge
    Adapter-->>UI: highlighted diagram
  end
  deactivate Adapter`,
  },
]

const suite = enumArg("suite", ["quick", "default", "long"] as const, "default")
const defaults = {
  quick: { targetBatchMs: 35, warmupRounds: 1, measuredRounds: 3 },
  default: { targetBatchMs: 400, warmupRounds: 2, measuredRounds: 7 },
  long: { targetBatchMs: 1_000, warmupRounds: 3, measuredRounds: 11 },
}[suite]
const targetBatchMs = numberArg("target-batch-ms", defaults.targetBatchMs, 1)
const warmupRounds = integerArg("warmup-rounds", defaults.warmupRounds, 0)
const measuredRounds = integerArg("rounds", defaults.measuredRounds, 2)
const scenarioFilter = optionalArg("scenario")
const jsonPath = optionalArg("json")
const quiet = process.argv.includes("--no-output")
const listScenarios = process.argv.includes("--list-scenarios")
let blackhole = 0

const parsed = {
  flowchart: parseMermaidFlowchartDiagram(FIXTURES[0]!.source),
  state: parseMermaidStateDiagram(FIXTURES[1]!.source),
  sequence: parseMermaidSequenceDiagram(FIXTURES[2]!.source),
}
const grids = {
  flowchart: drawFlowchartDiagramGrid(parsed.flowchart),
  state: drawStateDiagramGrid(parsed.state),
  sequence: drawSequenceDiagramGrid(parsed.sequence),
}
const colors = {
  flowchart: resolveFlowchartStyleColors(),
  state: resolveStateStyleColors(),
  sequence: resolveSequenceStyleColors(),
}

const cases: BenchmarkCase[] = [
  benchmarkCase("pipeline_complete", (iteration) => runComplete(FIXTURES[iteration % FIXTURES.length]!), 3),
  benchmarkCase("stage_detect", (iteration) => consumeString(detectMermaidDiagram(fixtureAt(iteration).source)), 3),
  benchmarkCase("stage_parse", (iteration) => parseAndConsume(fixtureAt(iteration)), 3),
  benchmarkCase("stage_draw", (iteration) => drawAndConsume(fixtureAt(iteration).family), 3),
  benchmarkCase("stage_styled_text", (iteration) => styledAndConsume(fixtureAt(iteration).family), 3),
  ...FIXTURES.map((fixture) => benchmarkCase(`pipeline_${fixture.family}`, () => runComplete(fixture))),
]

if (listScenarios) {
  for (const benchmark of cases) console.log(benchmark.name)
  process.exit(0)
}

const selectedCases = scenarioFilter
  ? cases.filter((benchmark) => scenarioFilter.split(",").includes(benchmark.name))
  : cases
if (selectedCases.length === 0) throw new Error(`no scenarios matched --scenario=${scenarioFilter}`)

if (!quiet) {
  console.log(
    `mermaid pipeline benchmark suite=${suite} target=${targetBatchMs}ms warmup=${warmupRounds} rounds=${measuredRounds}`,
  )
}

const results: BenchmarkResult[] = []
for (const benchmark of selectedCases) {
  if (!quiet) process.stdout.write(`calibrating ${benchmark.name}\r`)
  const result = runBenchmark(benchmark)
  results.push(result)
  if (!quiet) {
    process.stdout.write("\x1b[2K\r")
    console.log(
      `${result.name.padEnd(22)} ${formatNs(result.medianNsPerDiagram).padStart(11)}/diagram` +
        `  spread=${result.spreadPercent.toFixed(2)}% rme=${result.rmePercent.toFixed(2)}%` +
        `  batch=${result.batchIterations}`,
    )
  }
}

const primary = results.find((result) => result.name === "pipeline_complete")
if (primary) printMetric("mermaid_pipeline_ns_per_diagram", primary)
for (const result of results) printMetric(`mermaid_pipeline_${result.name}_ns_per_diagram`, result)

const payload = {
  benchmark: "mermaid-pipeline",
  version: 1,
  timestamp: new Date().toISOString(),
  environment: {
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
    availableParallelism: availableParallelism(),
  },
  config: { suite, targetBatchMs, warmupRounds, measuredRounds },
  fixtures: FIXTURES.map((fixture) => ({
    family: fixture.family,
    bytes: Buffer.byteLength(fixture.source),
    lines: fixture.source.split("\n").length,
  })),
  checksum: blackhole >>> 0,
  results,
}

if (jsonPath) {
  const output = resolve(jsonPath)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`)
  if (!quiet) console.log(`json=${output}`)
}

function benchmarkCase(name: string, run: (iteration: number) => number, batchMultiple = 1): BenchmarkCase {
  return { name, unit: "diagram", batchMultiple, run }
}

function fixtureAt(iteration: number): Fixture {
  return FIXTURES[iteration % FIXTURES.length]!
}

function runComplete(fixture: Fixture): number {
  const detected = detectMermaidDiagram(fixture.source)
  if (detected !== fixture.family) throw new Error(`expected ${fixture.family}, detected ${detected ?? "nothing"}`)

  switch (fixture.family) {
    case "flowchart": {
      const grid = drawFlowchartDiagramGrid(parseMermaidFlowchartDiagram(fixture.source))
      return consumeStyled(renderGridStyledText(grid, colors.flowchart))
    }
    case "state": {
      const grid = drawStateDiagramGrid(parseMermaidStateDiagram(fixture.source))
      return consumeStyled(renderStateGridStyledText(grid, colors.state))
    }
    case "sequence": {
      const grid = drawSequenceDiagramGrid(parseMermaidSequenceDiagram(fixture.source))
      return consumeStyled(renderSequenceGridStyledText(grid, colors.sequence))
    }
  }
}

function parseAndConsume(fixture: Fixture): number {
  switch (fixture.family) {
    case "flowchart": {
      const diagram = parseMermaidFlowchartDiagram(fixture.source)
      return diagram.nodes.length * 31 + diagram.edges.length
    }
    case "state": {
      const diagram = parseMermaidStateDiagram(fixture.source)
      return diagram.states.length * 31 + diagram.transitions.length
    }
    case "sequence": {
      const diagram = parseMermaidSequenceDiagram(fixture.source)
      return diagram.participants.length * 31 + diagram.steps.length
    }
  }
}

function drawAndConsume(family: Family): number {
  switch (family) {
    case "flowchart":
      return consumeGrid(drawFlowchartDiagramGrid(parsed.flowchart))
    case "state":
      return consumeGrid(drawStateDiagramGrid(parsed.state))
    case "sequence":
      return consumeGrid(drawSequenceDiagramGrid(parsed.sequence))
  }
}

function styledAndConsume(family: Family): number {
  switch (family) {
    case "flowchart":
      return consumeStyled(renderGridStyledText(grids.flowchart, colors.flowchart))
    case "state":
      return consumeStyled(renderStateGridStyledText(grids.state, colors.state))
    case "sequence":
      return consumeStyled(renderSequenceGridStyledText(grids.sequence, colors.sequence))
  }
}

function consumeGrid(grid: {
  width: number
  height: number
  getCell(x: number, y: number): { char: string } | undefined
}): number {
  return grid.width * 31 + grid.height * 17 + (grid.getCell(grid.width >> 1, grid.height >> 1)?.char.length ?? 0)
}

function consumeStyled(styled: { chunks: Array<{ text: string }> }): number {
  const chunks = styled.chunks
  return chunks.length * 31 + (chunks[0]?.text.length ?? 0) + (chunks[chunks.length - 1]?.text.length ?? 0)
}

function consumeString(value: string | undefined): number {
  return value?.length ?? 0
}

function runBatch(benchmark: BenchmarkCase, iterations: number, iterationStart: number): bigint {
  let local = 0
  const started = process.hrtime.bigint()
  for (let offset = 0; offset < iterations; offset++) local = (local + benchmark.run(iterationStart + offset)) | 0
  const elapsed = process.hrtime.bigint() - started
  blackhole = (blackhole ^ local) | 0
  return elapsed
}

function runBenchmark(benchmark: BenchmarkCase): BenchmarkResult {
  const targetNs = BigInt(Math.round(targetBatchMs * 1_000_000))
  let batchIterations = benchmark.batchMultiple
  let iteration = 0

  for (;;) {
    const elapsed = runBatch(benchmark, batchIterations, iteration)
    iteration += batchIterations
    if (elapsed >= targetNs || batchIterations >= 1_000_000) break
    const ratio = Number(targetNs) / Math.max(1, Number(elapsed))
    const limit = 1_000_000 - (1_000_000 % benchmark.batchMultiple)
    batchIterations = Math.min(limit, batchIterations * Math.max(2, Math.min(10, Math.ceil(ratio))))
  }

  for (let round = 0; round < warmupRounds; round++) {
    runBatch(benchmark, batchIterations, iteration)
    iteration += batchIterations
  }

  const samples: number[] = []
  for (let round = 0; round < measuredRounds; round++) {
    const elapsed = runBatch(benchmark, batchIterations, iteration)
    iteration += batchIterations
    samples.push(Number(elapsed) / batchIterations)
  }

  return {
    name: benchmark.name,
    unit: benchmark.unit,
    batchIterations,
    samplesNsPerDiagram: samples,
    ...statistics(samples),
  }
}

function statistics(values: readonly number[]): Statistics {
  const sorted = [...values].sort((left, right) => left - right)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const median = percentile(sorted, 0.5)
  const variance =
    values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0
  const standardError = Math.sqrt(variance) / Math.sqrt(values.length)
  const t95 = tCritical95(values.length - 1)
  return {
    medianNsPerDiagram: median,
    meanNsPerDiagram: mean,
    minNsPerDiagram: sorted[0]!,
    maxNsPerDiagram: sorted[sorted.length - 1]!,
    spreadPercent: median === 0 ? 0 : ((sorted[sorted.length - 1]! - sorted[0]!) / median) * 100,
    rmePercent: mean === 0 ? 0 : (t95 * standardError * 100) / mean,
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

function printMetric(name: string, result: BenchmarkResult): void {
  console.log(
    `METRIC ${name}=${result.medianNsPerDiagram.toFixed(2)}` +
      ` unit=ns/diagram spread_pct=${result.spreadPercent.toFixed(2)}` +
      ` rme_pct=${result.rmePercent.toFixed(2)} rounds=${measuredRounds} batch=${result.batchIterations}`,
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
