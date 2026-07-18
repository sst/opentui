#!/usr/bin/env bun

import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Command } from "commander"
import type { TextChunk } from "../text-buffer.js"
import type { SimpleHighlight } from "../lib/tree-sitter/types.js"

type Implementation = "baseline" | "integrated" | "postpass"
type Stage = "conversion" | "native"

interface Fixture {
  content: string
  highlights: SimpleHighlight[]
}

interface Scenario {
  name: string
  description: string
  fixtures: Fixture[]
}

interface ScenarioResult {
  name: string
  description: string
  finalChars: number
  processedChars: number
  highlightCount: number
  chunkCount: number
  linkedChunkCount: number
  medianMs: number
  p95Ms: number
  minMs: number
  maxMs: number
  throughputMiBPerSecond: number
}

interface Runtime {
  treeSitterToTextChunks: (
    content: string,
    highlights: SimpleHighlight[],
    syntaxStyle: unknown,
    options?: { enabled?: boolean; linkRanges?: Array<{ start: number; end: number; url: string }> },
  ) => TextChunk[]
  detectMarkdownLinks?: (
    highlights: SimpleHighlight[],
    context: { content: string; linkRanges?: Array<{ start: number; end: number; url: string }> },
  ) => SimpleHighlight[]
  detectLinks?: (chunks: TextChunk[], context: { content: string; highlights: SimpleHighlight[] }) => TextChunk[]
  syntaxStyle: { destroy(): void }
  createStyledText: (chunks: TextChunk[]) => unknown
  textBuffer?: { setStyledText(text: unknown): void; getPlainText(): string; destroy(): void }
}

const SUITES = {
  quick: { sizes: [16 * 1024], includeStress: false },
  default: { sizes: [1024, 16 * 1024], includeStress: true },
} as const

const program = new Command()
program
  .name("markdown-link-benchmark")
  .description("Benchmark Markdown link detection, chunk conversion, and optional native ingestion")
  .option("-s, --suite <name>", "benchmark suite: quick, default", "default")
  .option(
    "--implementation <name>",
    "implementation: baseline, integrated, postpass (historical source root required)",
    "integrated",
  )
  .option("--stage <name>", "stage: conversion, native", "conversion")
  .option("--rounds <count>", "measured rounds", "7")
  .option("--min-sample-ms <ms>", "minimum duration per measured round", "200")
  .option(
    "--source-root <path>",
    "packages/core root whose implementation is loaded",
    resolve(import.meta.dir, "../.."),
  )
  .option("--scenario <name>", "run one scenario")
  .option("--list-scenarios", "list scenario names and exit")
  .option("--json <path>", "write JSON results")
  .parse(process.argv)

const options = program.opts()
const suiteName = String(options.suite) as keyof typeof SUITES
const suite = SUITES[suiteName]
const implementation = String(options.implementation) as Implementation
const stage = String(options.stage) as Stage
const rounds = Math.max(1, Math.floor(Number(options.rounds)))
const minSampleMs = Math.max(1, Number(options.minSampleMs))
const sourceRoot = resolve(String(options.sourceRoot))
const scenarioFilter = options.scenario ? String(options.scenario) : undefined
const jsonPath = options.json ? resolve(String(options.json)) : undefined

if (!suite) throw new Error(`Unknown suite: ${suiteName}`)
if (!(["baseline", "integrated", "postpass"] as const).includes(implementation)) {
  throw new Error(`Unknown implementation: ${implementation}`)
}
if (!(["conversion", "native"] as const).includes(stage)) throw new Error(`Unknown stage: ${stage}`)
if (!Number.isFinite(rounds) || !Number.isFinite(minSampleMs)) throw new Error("Invalid timing options")

const scenarios = createScenarios(suite)
if (options.listScenarios) {
  for (const scenario of scenarios) console.log(scenario.name)
  process.exit(0)
}

const selectedScenarios = scenarioFilter ? scenarios.filter((scenario) => scenario.name === scenarioFilter) : scenarios
if (selectedScenarios.length === 0) throw new Error(`Unknown scenario: ${scenarioFilter}`)

const runtime = await loadRuntime(sourceRoot, stage)
let sink = 0
const results: ScenarioResult[] = []

try {
  for (const scenario of selectedScenarios) {
    const preflight = runScenarioOnce(runtime, scenario, implementation, stage, true)
    const samples = measure(() => {
      sink ^= runScenarioOnce(runtime, scenario, implementation, stage, false).checksum
    })
    const sorted = samples.sort((left, right) => left - right)
    const medianMs = percentile(sorted, 0.5)
    const processedMiB = preflight.processedChars / (1024 * 1024)

    results.push({
      name: scenario.name,
      description: scenario.description,
      finalChars: scenario.fixtures.at(-1)?.content.length ?? 0,
      processedChars: preflight.processedChars,
      highlightCount: preflight.highlightCount,
      chunkCount: preflight.chunkCount,
      linkedChunkCount: preflight.linkedChunkCount,
      medianMs,
      p95Ms: percentile(sorted, 0.95),
      minMs: sorted[0] ?? 0,
      maxMs: sorted.at(-1) ?? 0,
      throughputMiBPerSecond: medianMs > 0 ? processedMiB / (medianMs / 1000) : 0,
    })
  }
} finally {
  runtime.textBuffer?.destroy()
  runtime.syntaxStyle.destroy()
}

console.log(
  `markdown link benchmark suite=${suiteName} implementation=${implementation} stage=${stage} rounds=${rounds} minSampleMs=${minSampleMs}`,
)
console.log(`sourceRoot=${sourceRoot}`)
console.table(
  results.map((result) => ({
    scenario: result.name,
    chars: result.finalChars,
    processed: result.processedChars,
    highlights: result.highlightCount,
    chunks: result.chunkCount,
    linked: result.linkedChunkCount,
    medianMs: Number(result.medianMs.toFixed(4)),
    p95Ms: Number(result.p95Ms.toFixed(4)),
    MiBps: Number(result.throughputMiBPerSecond.toFixed(2)),
  })),
)

if (jsonPath) {
  if (existsSync(jsonPath)) throw new Error(`Output file already exists: ${jsonPath}`)
  await mkdir(dirname(jsonPath), { recursive: true })
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        suite: suiteName,
        implementation,
        stage,
        rounds,
        minSampleMs,
        sourceRoot,
        results,
      },
      null,
      2,
    ),
  )
}

// Keep benchmark results observable without adding checksum work to the measured conversion.
if (sink === Number.MIN_SAFE_INTEGER) console.log(sink)

function createScenarios(config: (typeof SUITES)[keyof typeof SUITES]): Scenario[] {
  const result: Scenario[] = []
  for (const size of config.sizes) {
    const suffix = formatSize(size)
    result.push(
      {
        name: `plain_${suffix}`,
        description: "URL-free Markdown",
        fixtures: [buildPlainFixture(size)],
      },
      {
        name: `sparse_bare_${suffix}`,
        description: "One bare URL per roughly 4 KiB",
        fixtures: [buildBareFixture(size, 100)],
      },
      {
        name: `excluded_plain_${suffix}`,
        description: "URL-free Markdown with many excluded code ranges",
        fixtures: [buildExcludedFixture(size)],
      },
      {
        name: `dense_bare_${suffix}`,
        description: "Bare URL on every line",
        fixtures: [buildBareFixture(size, 1)],
      },
      {
        name: `dense_explicit_${suffix}`,
        description: "Explicit Markdown link on every line",
        fixtures: [buildExplicitFixture(size)],
      },
    )
  }

  if (config.includeStress) {
    result.push(
      {
        name: "plain_1m",
        description: "URL-free 1 MiB stress case",
        fixtures: [buildPlainFixture(1024 * 1024)],
      },
      {
        name: "sparse_bare_1m",
        description: "Sparse bare URLs in a 1 MiB block",
        fixtures: [buildBareFixture(1024 * 1024, 100)],
      },
      {
        name: "dense_bare_1m",
        description: "Dense bare URLs in a 1 MiB block",
        fixtures: [buildBareFixture(1024 * 1024, 1)],
      },
      {
        name: "dense_explicit_256k",
        description: "Dense explicit links in a 256 KiB block",
        fixtures: [buildExplicitFixture(256 * 1024)],
      },
      {
        name: "growing_sparse_bare_256k",
        description: "Sixteen cumulative rescans at 16 KiB increments",
        fixtures: Array.from({ length: 16 }, (_, index) => buildBareFixture((index + 1) * 16 * 1024, 100)),
      },
    )
  }
  return result
}

function buildPlainFixture(size: number): Fixture {
  const content = fit("ordinary markdown text without a link\n", size)
  return { content, highlights: [[0, content.length, "spell"]] }
}

function buildBareFixture(size: number, frequency: number): Fixture {
  const plain = "ordinary markdown text without a link\n"
  const linked = "ordinary markdown https://example.test/path?q=1 text\n"
  const parts: string[] = []
  let line = 0
  let length = 0
  while (length < size) {
    const next = line % frequency === 0 ? linked : plain
    const remaining = size - length
    const value = next.slice(0, remaining)
    parts.push(value)
    length += value.length
    line++
  }
  const content = parts.join("")
  return { content, highlights: [[0, content.length, "spell"]] }
}

function buildExcludedFixture(size: number): Fixture {
  const line = "`inline code` ordinary markdown text\n"
  const parts: string[] = []
  const highlights: SimpleHighlight[] = []
  let offset = 0
  while (offset + line.length <= size) {
    parts.push(line)
    highlights.push([offset, offset + 13, "markup.raw"])
    offset += line.length
  }
  if (offset < size) parts.push("x".repeat(size - offset))
  const content = parts.join("")
  highlights.unshift([0, content.length, "spell"])
  return { content, highlights }
}

function buildExplicitFixture(size: number): Fixture {
  const parts: string[] = []
  const highlights: SimpleHighlight[] = []
  let offset = 0
  let index = 0

  while (offset < size) {
    const label = `label-${index}`
    const url = `https://target-${index}.test/path`
    const source = `[${label}](${url})\n`
    if (offset + source.length > size) break
    parts.push(source)
    highlights.push(
      [offset + 1, offset + 1 + label.length, "markup.link.label"],
      [offset + label.length + 3, offset + label.length + 3 + url.length, "markup.link.url"],
    )
    offset += source.length
    index++
  }

  if (offset < size) parts.push("x".repeat(size - offset))
  const content = parts.join("")
  highlights.unshift([0, content.length, "spell"])
  return { content, highlights }
}

function fit(line: string, size: number): string {
  return line.repeat(Math.ceil(size / line.length)).slice(0, size)
}

function formatSize(size: number): string {
  return size >= 1024 * 1024 ? `${size / (1024 * 1024)}m` : `${size / 1024}k`
}

async function loadRuntime(root: string, selectedStage: Stage): Promise<Runtime> {
  const importSource = (relativePath: string) => import(pathToFileURL(resolve(root, relativePath)).href)
  const [{ treeSitterToTextChunks }, linkDetection, { SyntaxStyle }] = await Promise.all([
    importSource("src/lib/tree-sitter-styled-text.ts"),
    importSource("src/lib/detect-links.ts"),
    importSource("src/syntax-style.ts"),
  ])
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: {},
    spell: {},
    "markup.link.label": { underline: true },
    "markup.link.url": { underline: true },
  })

  if (selectedStage === "conversion") {
    return {
      treeSitterToTextChunks,
      detectMarkdownLinks: linkDetection.detectMarkdownLinks,
      detectLinks: linkDetection.detectLinks,
      syntaxStyle,
      createStyledText: (chunks) => ({ chunks }),
    }
  }

  const [{ StyledText }, { TextBuffer }] = await Promise.all([
    importSource("src/lib/styled-text.ts"),
    importSource("src/text-buffer.ts"),
  ])
  return {
    treeSitterToTextChunks,
    detectMarkdownLinks: linkDetection.detectMarkdownLinks,
    detectLinks: linkDetection.detectLinks,
    syntaxStyle,
    createStyledText: (chunks) => new StyledText(chunks),
    textBuffer: TextBuffer.create("unicode"),
  }
}

function convert(runtime: Runtime, fixture: Fixture, selectedImplementation: Implementation): TextChunk[] {
  const context: { content: string; linkRanges?: Array<{ start: number; end: number; url: string }> } = {
    content: fixture.content,
  }
  const highlights = fixture.highlights
  if (selectedImplementation === "integrated") runtime.detectMarkdownLinks!(highlights, context)
  const chunks = runtime.treeSitterToTextChunks(fixture.content, highlights, runtime.syntaxStyle, {
    enabled: false,
    linkRanges: context.linkRanges,
  })
  if (selectedImplementation === "postpass") {
    if (!runtime.detectLinks) throw new Error("The selected source root does not provide the post-pass detector")
    runtime.detectLinks(chunks, { content: fixture.content, highlights: fixture.highlights })
  }
  return chunks
}

function runScenarioOnce(
  runtime: Runtime,
  scenario: Scenario,
  selectedImplementation: Implementation,
  selectedStage: Stage,
  inspect: boolean,
): { checksum: number; processedChars: number; highlightCount: number; chunkCount: number; linkedChunkCount: number } {
  let checksum = 0
  let processedChars = 0
  let highlightCount = 0
  let chunkCount = 0
  let linkedChunkCount = 0

  for (const fixture of scenario.fixtures) {
    const chunks = convert(runtime, fixture, selectedImplementation)
    if (selectedStage === "native") runtime.textBuffer!.setStyledText(runtime.createStyledText(chunks))
    checksum = (checksum * 33 + chunks.length) | 0

    if (!inspect) continue
    const rendered = chunks.map((chunk) => chunk.text).join("")
    if (rendered !== fixture.content) throw new Error(`${scenario.name}: conversion changed rendered text`)
    if (selectedStage === "native" && runtime.textBuffer!.getPlainText() !== fixture.content) {
      throw new Error(`${scenario.name}: native ingestion changed rendered text`)
    }
    processedChars += fixture.content.length
    highlightCount += fixture.highlights.length
    chunkCount += chunks.length
    linkedChunkCount += chunks.reduce((count, chunk) => count + (chunk.link ? 1 : 0), 0)
  }

  return { checksum, processedChars, highlightCount, chunkCount, linkedChunkCount }
}

function measure(operation: () => void): number[] {
  for (let index = 0; index < 3; index++) operation()
  const samples: number[] = []

  for (let round = 0; round < rounds; round++) {
    let iterations = 1
    let elapsed = 0
    do {
      const start = performance.now()
      for (let index = 0; index < iterations; index++) operation()
      elapsed = performance.now() - start
      if (elapsed < minSampleMs)
        iterations = Math.max(iterations + 1, Math.ceil((iterations * minSampleMs) / Math.max(elapsed, 0.01)))
    } while (elapsed < minSampleMs)
    samples.push(elapsed / iterations)
  }
  return samples
}

function percentile(sorted: number[], value: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * value) - 1))] ?? 0
}
