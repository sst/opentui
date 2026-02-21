import { readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"

type ScenarioResult = {
  name: string
  bytesPerIter?: string | number
  iters?: number
  bytesTotal?: string | number
  avgMs?: number
  medianMs?: number
  p95Ms?: number
  minMs?: number
  maxMs?: number
  throughputMBps?: number
  elapsedMs?: number
  memory?: {
    start: MemorySample
    end: MemorySample
    delta: MemorySample
    peak: MemorySample
    samples: number
  }
  options?: {
    chunkSize?: number
    initialChunks?: number
    autoCommitOnFull?: boolean
    commitEvery?: number
    reuseStream?: boolean
    pattern?: unknown
  }
}

type MemorySample = {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
}

type BenchRun = {
  runId?: string
  suite?: string
  args?: string[]
  results?: ScenarioResult[]
}

type MetricDelta = {
  baseline: number
  current: number
  delta: number
  deltaPct: number | null
}

type ScenarioDiff = {
  name: string
  status: "ok" | "missing_baseline" | "missing_current"
  bytesPerIter?: string
  iters?: string
  optionsDiff?: string[]
  metrics?: {
    avgMs?: MetricDelta
    medianMs?: MetricDelta
    p95Ms?: MetricDelta
    throughputMBps?: MetricDelta
  }
  memory?: {
    deltaRss?: MetricDelta
    deltaExternal?: MetricDelta
    deltaArrayBuffers?: MetricDelta
    peakRss?: MetricDelta
  }
}

const args = process.argv.slice(2)

function getArg(name: string): string | null {
  const prefix = `--${name}=`
  for (const arg of args) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length)
  }
  return null
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`)
}

const jsonPath = getArg("json")
const positional = args.filter((arg) => !arg.startsWith("--"))

if (positional.length < 2) {
  console.error("usage: bun src/benchmark/native-span-feed-compare.ts <baseline.json> <current.json> [--json=<path>]")
  process.exit(1)
}

const baselinePath = positional[0]
const currentPath = positional[1]

function readBench(path: string): BenchRun {
  const text = readFileSync(path, "utf8")
  return JSON.parse(text) as BenchRun
}

function toBigInt(value: string | number | undefined): bigint | null {
  if (value === undefined) return null
  if (typeof value === "number") return BigInt(value)
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function formatBigPair(baseline?: string | number, current?: string | number): string {
  const base = toBigInt(baseline)
  const curr = toBigInt(current)
  if (base == null || curr == null) return "n/a"
  if (base === curr) return base.toString()
  return `${base.toString()} -> ${curr.toString()}`
}

function formatPair(base: number, curr: number, digits = 3): string {
  const delta = curr - base
  const sign = delta >= 0 ? "+" : ""
  const pct = base !== 0 ? (delta / base) * 100 : null
  const pctStr = pct === null ? "n/a" : `${sign}${pct.toFixed(2)}%`
  return `${base.toFixed(digits)} -> ${curr.toFixed(digits)} (${sign}${delta.toFixed(digits)}, ${pctStr})`
}

function formatBytes(value: number): string {
  const mb = value / (1024 * 1024)
  return `${mb.toFixed(2)}MB`
}

function formatBytesPair(base: number, curr: number): string {
  const delta = curr - base
  const sign = delta >= 0 ? "+" : ""
  const pct = base !== 0 ? (delta / base) * 100 : null
  const pctStr = pct === null ? "n/a" : `${sign}${pct.toFixed(2)}%`
  return `${formatBytes(base)} -> ${formatBytes(curr)} (${sign}${formatBytes(delta)}, ${pctStr})`
}

function metricDelta(base?: number, curr?: number): MetricDelta | undefined {
  if (base === undefined || curr === undefined) return undefined
  const delta = curr - base
  const deltaPct = base !== 0 ? (delta / base) * 100 : null
  return { baseline: base, current: curr, delta, deltaPct }
}

function diffOptions(base?: ScenarioResult["options"], curr?: ScenarioResult["options"]): string[] | undefined {
  if (!base || !curr) return undefined
  const diffs: string[] = []
  const keys: (keyof NonNullable<ScenarioResult["options"]>)[] = [
    "chunkSize",
    "initialChunks",
    "autoCommitOnFull",
    "commitEvery",
    "reuseStream",
    "pattern",
  ]
  for (const key of keys) {
    const b = base[key]
    const c = curr[key]
    if (JSON.stringify(b) !== JSON.stringify(c)) {
      diffs.push(`${String(key)}:${JSON.stringify(b)}->${JSON.stringify(c)}`)
    }
  }
  return diffs.length > 0 ? diffs : undefined
}

const baseline = readBench(baselinePath)
const current = readBench(currentPath)

const baselineMap = new Map<string, ScenarioResult>()
const currentMap = new Map<string, ScenarioResult>()

for (const result of baseline.results ?? []) {
  baselineMap.set(result.name, result)
}
for (const result of current.results ?? []) {
  currentMap.set(result.name, result)
}

const scenarioNames = Array.from(new Set([...baselineMap.keys(), ...currentMap.keys()])).sort()

const diffs: ScenarioDiff[] = []
let missingBaseline = 0
let missingCurrent = 0

for (const name of scenarioNames) {
  const base = baselineMap.get(name)
  const curr = currentMap.get(name)
  if (!base) {
    diffs.push({ name, status: "missing_baseline" })
    missingBaseline += 1
    continue
  }
  if (!curr) {
    diffs.push({ name, status: "missing_current" })
    missingCurrent += 1
    continue
  }

  const avg = metricDelta(base.avgMs, curr.avgMs)
  const med = metricDelta(base.medianMs, curr.medianMs)
  const p95 = metricDelta(base.p95Ms, curr.p95Ms)
  const thr = metricDelta(base.throughputMBps, curr.throughputMBps)

  const memDeltaRss = metricDelta(base.memory?.delta?.rss, curr.memory?.delta?.rss)
  const memDeltaExternal = metricDelta(base.memory?.delta?.external, curr.memory?.delta?.external)
  const memDeltaArrayBuffers = metricDelta(base.memory?.delta?.arrayBuffers, curr.memory?.delta?.arrayBuffers)
  const memPeakRss = metricDelta(base.memory?.peak?.rss, curr.memory?.peak?.rss)

  diffs.push({
    name,
    status: "ok",
    bytesPerIter: formatBigPair(base.bytesPerIter, curr.bytesPerIter),
    iters: formatBigPair(base.iters, curr.iters),
    optionsDiff: diffOptions(base.options, curr.options),
    metrics: {
      avgMs: avg,
      medianMs: med,
      p95Ms: p95,
      throughputMBps: thr,
    },
    memory: {
      deltaRss: memDeltaRss,
      deltaExternal: memDeltaExternal,
      deltaArrayBuffers: memDeltaArrayBuffers,
      peakRss: memPeakRss,
    },
  })
}

const baseLabel = `${baseline.suite ?? "unknown"}:${basename(baselinePath)}`
const currentLabel = `${current.suite ?? "unknown"}:${basename(currentPath)}`

console.log(`baseline=${baseLabel}`)
console.log(`current=${currentLabel}`)
console.log(`scenarios=${scenarioNames.length} missingBaseline=${missingBaseline} missingCurrent=${missingCurrent}`)

for (const diff of diffs) {
  if (diff.status !== "ok") {
    console.log(`scenario=${diff.name} status=${diff.status}`)
    continue
  }

  const metrics = diff.metrics ?? {}
  const avg = metrics.avgMs ? formatPair(metrics.avgMs.baseline, metrics.avgMs.current) : "n/a"
  const median = metrics.medianMs ? formatPair(metrics.medianMs.baseline, metrics.medianMs.current) : "n/a"
  const p95 = metrics.p95Ms ? formatPair(metrics.p95Ms.baseline, metrics.p95Ms.current) : "n/a"
  const throughput = metrics.throughputMBps
    ? formatPair(metrics.throughputMBps.baseline, metrics.throughputMBps.current)
    : "n/a"
  const mem = diff.memory
  const memDeltaRss = mem?.deltaRss ? formatBytesPair(mem.deltaRss.baseline, mem.deltaRss.current) : "n/a"
  const memDeltaExt = mem?.deltaExternal
    ? formatBytesPair(mem.deltaExternal.baseline, mem.deltaExternal.current)
    : "n/a"
  const memDeltaAB = mem?.deltaArrayBuffers
    ? formatBytesPair(mem.deltaArrayBuffers.baseline, mem.deltaArrayBuffers.current)
    : "n/a"
  const memPeak = mem?.peakRss ? formatBytesPair(mem.peakRss.baseline, mem.peakRss.current) : "n/a"
  const opts = diff.optionsDiff ? ` opts=${diff.optionsDiff.join(",")}` : ""

  console.log(
    `scenario=${diff.name} bytesPerIter=${diff.bytesPerIter} iters=${diff.iters} avgMs=${avg} medianMs=${median} p95Ms=${p95} throughputMBps=${throughput} memDeltaRss=${memDeltaRss} memDeltaExt=${memDeltaExt} memDeltaAB=${memDeltaAB} memPeakRss=${memPeak}${opts}`,
  )
}

if (jsonPath) {
  const payload = {
    baseline: { path: baselinePath, runId: baseline.runId, suite: baseline.suite },
    current: { path: currentPath, runId: current.runId, suite: current.suite },
    scenarios: diffs,
  }
  const json = JSON.stringify(payload, null, 2)
  writeFileSync(jsonPath, json)
}
