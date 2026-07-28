#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

interface Stats {
  median: number
}

interface RuntimeSummary {
  avgMs: Stats
}

interface ScenarioSummary {
  name: string
  bun: RuntimeSummary
  node: RuntimeSummary
  nodeToBun: Stats
}

interface BenchmarkReport {
  runId: string
  results: ScenarioSummary[]
}

const baselinePath = process.argv[2]
const currentPath = process.argv[3]
if (!baselinePath || !currentPath) {
  throw new Error("usage: bun render-runtime-compare.ts <baseline.json> <current.json> [--json=<path>]")
}

const baseline = readReport(baselinePath)
const current = readReport(currentPath)
const baselineByName = new Map(baseline.results.map((result) => [result.name, result]))

const comparisons = current.results.map((result) => {
  const before = baselineByName.get(result.name)
  if (!before) throw new Error(`baseline is missing scenario ${result.name}`)
  return {
    name: result.name,
    bun: compare(before.bun.avgMs.median, result.bun.avgMs.median),
    node: compare(before.node.avgMs.median, result.node.avgMs.median),
    nodeToBunBefore: before.nodeToBun.median,
    nodeToBunAfter: result.nodeToBun.median,
  }
})

console.log("| Scenario | Bun before | Bun after | Bun change | Node before | Node after | Node change |")
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
for (const result of comparisons) {
  console.log(
    `| ${result.name} | ${formatMs(result.bun.before)} | ${formatMs(result.bun.after)} | ${formatChange(result.bun.change)} | ${formatMs(result.node.before)} | ${formatMs(result.node.after)} | ${formatChange(result.node.change)} |`,
  )
}

const jsonPath = process.argv.find((argument) => argument.startsWith("--json="))?.slice("--json=".length)
if (jsonPath) {
  writeFileSync(
    resolve(jsonPath),
    JSON.stringify({ baselineRunId: baseline.runId, currentRunId: current.runId, results: comparisons }, null, 2),
  )
}

function readReport(path: string): BenchmarkReport {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as BenchmarkReport
}

function compare(before: number, after: number) {
  return { before, after, change: after / before - 1 }
}

function formatMs(value: number): string {
  return `${value.toFixed(4)}ms`
}

function formatChange(value: number): string {
  const percent = value * 100
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`
}
