#!/usr/bin/env bun
/**
 * Diff Word Highlights Benchmark
 *
 * Compares rendering performance of the Diff component with word-level
 * highlighting enabled vs disabled.
 *
 * Usage:
 *   bun packages/core/src/benchmark/diff-word-highlights-benchmark.ts
 *   bun packages/core/src/benchmark/diff-word-highlights-benchmark.ts --iterations 50
 *   bun packages/core/src/benchmark/diff-word-highlights-benchmark.ts --json
 */

import { Command } from "commander"
import { EventEmitter } from "events"
import { DiffRenderable } from "../renderables/Diff"
import { SyntaxStyle } from "../syntax-style"
import { RGBA } from "../lib/RGBA"
import { createTestRenderer } from "../testing"

// Suppress MaxListenersExceededWarning - we intentionally create many renderers
EventEmitter.defaultMaxListeners = 100

const program = new Command()
program
  .name("diff-word-highlights-benchmark")
  .description("Benchmark diff rendering with and without word-level highlights")
  .option("-i, --iterations <count>", "Number of iterations per scenario", "20")
  .option("-w, --warmup <count>", "Number of warmup iterations", "3")
  .option("--json", "Output results as JSON")
  .parse(process.argv)

const options = program.opts()
const iterations = parseInt(options.iterations)
const warmup = parseInt(options.warmup)
const jsonOutput = options.json

// Generate a realistic large diff with many modified lines
// This simulates a real-world code refactoring scenario
function generateLargeDiff(numHunks: number, linesPerHunk: number): string {
  const lines: string[] = []
  lines.push("--- a/src/large-file.ts")
  lines.push("+++ b/src/large-file.ts")

  let oldLine = 1
  let newLine = 1

  for (let h = 0; h < numHunks; h++) {
    // Each hunk has context, removes, and adds
    const contextBefore = 3
    const contextAfter = 3
    const changes = linesPerHunk

    const oldStart = oldLine
    const newStart = newLine
    const oldCount = contextBefore + changes + contextAfter
    const newCount = contextBefore + changes + contextAfter

    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)

    // Context before
    for (let i = 0; i < contextBefore; i++) {
      lines.push(` // Context line ${oldLine + i}: this is unchanged code`)
    }
    oldLine += contextBefore
    newLine += contextBefore

    // Changes - paired removes and adds for word highlight testing
    for (let i = 0; i < changes; i++) {
      const varName = `variable${h}_${i}`
      const funcName = `function${h}_${i}`

      // Vary the types of changes to test different scenarios
      switch (i % 5) {
        case 0:
          // Simple value change
          lines.push(`-  const ${varName} = ${i * 10};`)
          lines.push(`+  const ${varName} = ${i * 10 + 1};`)
          break
        case 1:
          // Function parameter change
          lines.push(`-  ${funcName}(a, b, c);`)
          lines.push(`+  ${funcName}(a, b, c, d);`)
          break
        case 2:
          // String change
          lines.push(`-  const msg = "Hello World ${i}";`)
          lines.push(`+  const msg = "Hello Universe ${i}";`)
          break
        case 3:
          // Type annotation change
          lines.push(`-  let data: string[] = [];`)
          lines.push(`+  let data: Map<string, number> = new Map();`)
          break
        case 4:
          // Comment change
          lines.push(`-  // TODO: implement ${funcName}`)
          lines.push(`+  // DONE: implemented ${funcName}`)
          break
      }
      oldLine++
      newLine++
    }

    // Context after
    for (let i = 0; i < contextAfter; i++) {
      lines.push(` // Context line ${oldLine + i}: more unchanged code`)
    }
    oldLine += contextAfter
    newLine += contextAfter

    // Gap between hunks
    oldLine += 20
    newLine += 20
  }

  return lines.join("\n")
}

// Also generate a diff with unequal adds/removes to test the GitHub behavior
// (word highlights are only shown when adds.length === removes.length)
function generateMixedDiff(numHunks: number): string {
  const lines: string[] = []
  lines.push("--- a/src/mixed-changes.ts")
  lines.push("+++ b/src/mixed-changes.ts")

  let oldLine = 1
  let newLine = 1

  for (let h = 0; h < numHunks; h++) {
    const oldStart = oldLine
    const newStart = newLine

    // Mix of equal and unequal changes
    if (h % 2 === 0) {
      // Equal removes and adds (will have word highlights)
      lines.push(`@@ -${oldStart},8 +${newStart},8 @@`)
      lines.push(` // context`)
      lines.push(`-  const value = "old";`)
      lines.push(`+  const value = "new";`)
      lines.push(`-  const count = 10;`)
      lines.push(`+  const count = 20;`)
      lines.push(` // more context`)
      lines.push(` // end context`)
      oldLine += 8
      newLine += 8
    } else {
      // Unequal (will skip word highlights)
      lines.push(`@@ -${oldStart},6 +${newStart},8 @@`)
      lines.push(` // context`)
      lines.push(`-  oldFunction();`)
      lines.push(`+  newFunction();`)
      lines.push(`+  anotherNewFunction();`)
      lines.push(`+  yetAnotherFunction();`)
      lines.push(` // end context`)
      oldLine += 6
      newLine += 8
    }

    oldLine += 15
    newLine += 15
  }

  return lines.join("\n")
}

interface BenchResult {
  name: string
  iterations: number
  totalMs: number
  avgMs: number
  minMs: number
  maxMs: number
  stdDevMs: number
}

async function runBenchmark(
  name: string,
  createRenderable: (renderer: any) => DiffRenderable,
  numIterations: number,
  numWarmup: number,
): Promise<BenchResult> {
  const times: number[] = []

  // Warmup
  for (let i = 0; i < numWarmup; i++) {
    const { renderer } = await createTestRenderer({ width: 120, height: 50 })
    createRenderable(renderer)
    renderer.destroy()
  }

  // Actual benchmark - measure DiffRenderable construction (which includes word highlight computation)
  for (let i = 0; i < numIterations; i++) {
    const { renderer } = await createTestRenderer({ width: 120, height: 50 })

    const start = performance.now()
    const renderable = createRenderable(renderer)
    renderer.root.add(renderable)
    const end = performance.now()

    times.push(end - start)
    renderer.destroy()
  }

  const totalMs = times.reduce((a, b) => a + b, 0)
  const avgMs = totalMs / times.length
  const minMs = Math.min(...times)
  const maxMs = Math.max(...times)
  const variance = times.reduce((sum, t) => sum + Math.pow(t - avgMs, 2), 0) / times.length
  const stdDevMs = Math.sqrt(variance)

  return {
    name,
    iterations: numIterations,
    totalMs,
    avgMs,
    minMs,
    maxMs,
    stdDevMs,
  }
}

async function main() {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: RGBA.fromHex("#ff79c6") },
    string: { fg: RGBA.fromHex("#f1fa8c") },
    comment: { fg: RGBA.fromHex("#6272a4") },
    number: { fg: RGBA.fromHex("#bd93f9") },
  })

  // Test scenarios
  const scenarios = [
    { name: "Small diff (5 hunks, 5 changes each)", hunks: 5, linesPerHunk: 5 },
    { name: "Medium diff (20 hunks, 10 changes each)", hunks: 20, linesPerHunk: 10 },
    { name: "Large diff (50 hunks, 20 changes each)", hunks: 50, linesPerHunk: 20 },
  ]

  const results: { scenario: string; withHighlights: BenchResult; withoutHighlights: BenchResult }[] = []

  for (const scenario of scenarios) {
    const diff = generateLargeDiff(scenario.hunks, scenario.linesPerHunk)

    if (!jsonOutput) {
      console.log(`\n=== ${scenario.name} ===`)
      console.log(`Total lines in diff: ~${diff.split("\n").length}`)
    }

    // Benchmark with word highlights enabled (default)
    const withHighlights = await runBenchmark(
      `${scenario.name} - WITH word highlights`,
      (renderer) =>
        new DiffRenderable(renderer, {
          id: "bench-diff",
          diff,
          view: "split",
          syntaxStyle,
          disableWordHighlights: false,
          width: "100%",
          height: "100%",
        }),
      iterations,
      warmup,
    )

    // Benchmark with word highlights disabled
    const withoutHighlights = await runBenchmark(
      `${scenario.name} - WITHOUT word highlights`,
      (renderer) =>
        new DiffRenderable(renderer, {
          id: "bench-diff",
          diff,
          view: "split",
          syntaxStyle,
          disableWordHighlights: true,
          width: "100%",
          height: "100%",
        }),
      iterations,
      warmup,
    )

    results.push({ scenario: scenario.name, withHighlights, withoutHighlights })

    if (!jsonOutput) {
      console.log(
        `\nWith word highlights:    avg=${withHighlights.avgMs.toFixed(2)}ms, ` +
          `min=${withHighlights.minMs.toFixed(2)}ms, max=${withHighlights.maxMs.toFixed(2)}ms, ` +
          `stdDev=${withHighlights.stdDevMs.toFixed(2)}ms`,
      )
      console.log(
        `Without word highlights: avg=${withoutHighlights.avgMs.toFixed(2)}ms, ` +
          `min=${withoutHighlights.minMs.toFixed(2)}ms, max=${withoutHighlights.maxMs.toFixed(2)}ms, ` +
          `stdDev=${withoutHighlights.stdDevMs.toFixed(2)}ms`,
      )

      const overhead = ((withHighlights.avgMs - withoutHighlights.avgMs) / withoutHighlights.avgMs) * 100
      const overheadSign = overhead >= 0 ? "+" : ""
      console.log(`Overhead: ${overheadSign}${overhead.toFixed(1)}%`)
    }
  }

  // Also test mixed diff scenario (unequal adds/removes)
  const mixedDiff = generateMixedDiff(30)

  if (!jsonOutput) {
    console.log(`\n=== Mixed diff (30 hunks, some unequal) ===`)
    console.log(`Total lines: ~${mixedDiff.split("\n").length}`)
  }

  const mixedWithHighlights = await runBenchmark(
    "Mixed diff - WITH word highlights",
    (renderer) =>
      new DiffRenderable(renderer, {
        id: "bench-diff",
        diff: mixedDiff,
        view: "split",
        syntaxStyle,
        disableWordHighlights: false,
        width: "100%",
        height: "100%",
      }),
    iterations,
    warmup,
  )

  const mixedWithoutHighlights = await runBenchmark(
    "Mixed diff - WITHOUT word highlights",
    (renderer) =>
      new DiffRenderable(renderer, {
        id: "bench-diff",
        diff: mixedDiff,
        view: "split",
        syntaxStyle,
        disableWordHighlights: true,
        width: "100%",
        height: "100%",
      }),
    iterations,
    warmup,
  )

  results.push({
    scenario: "Mixed diff (30 hunks, some unequal)",
    withHighlights: mixedWithHighlights,
    withoutHighlights: mixedWithoutHighlights,
  })

  if (jsonOutput) {
    console.log(JSON.stringify({ date: new Date().toISOString(), iterations, warmup, results }, null, 2))
  } else {
    console.log(
      `\nWith word highlights:    avg=${mixedWithHighlights.avgMs.toFixed(2)}ms, ` +
        `min=${mixedWithHighlights.minMs.toFixed(2)}ms, max=${mixedWithHighlights.maxMs.toFixed(2)}ms, ` +
        `stdDev=${mixedWithHighlights.stdDevMs.toFixed(2)}ms`,
    )
    console.log(
      `Without word highlights: avg=${mixedWithoutHighlights.avgMs.toFixed(2)}ms, ` +
        `min=${mixedWithoutHighlights.minMs.toFixed(2)}ms, max=${mixedWithoutHighlights.maxMs.toFixed(2)}ms, ` +
        `stdDev=${mixedWithoutHighlights.stdDevMs.toFixed(2)}ms`,
    )

    const overhead = ((mixedWithHighlights.avgMs - mixedWithoutHighlights.avgMs) / mixedWithoutHighlights.avgMs) * 100
    const overheadSign = overhead >= 0 ? "+" : ""
    console.log(`Overhead: ${overheadSign}${overhead.toFixed(1)}%`)

    // Summary
    console.log("\n" + "=".repeat(60))
    console.log("SUMMARY")
    console.log("=".repeat(60))
    for (const r of results) {
      const overhead = ((r.withHighlights.avgMs - r.withoutHighlights.avgMs) / r.withoutHighlights.avgMs) * 100
      const overheadSign = overhead >= 0 ? "+" : ""
      console.log(`${r.scenario}:`)
      console.log(`  Word highlights overhead: ${overheadSign}${overhead.toFixed(1)}%`)
    }
    console.log("\n✓ Benchmark complete")
  }
}

main().catch(console.error)
