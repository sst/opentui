#!/usr/bin/env bun

// Calibrated layout benchmark for the current JS Yoga-backed render tree.
// Scenarios deliberately mutate layout-affecting state before each measured
// operation, then validate that Yoga is dirty before the frame and clean after
// all required render passes settle.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { BoxRenderable, RGBA, ScrollBoxRenderable, TextRenderable, type Renderable } from "../index.js"
import { createTestRenderer, type TestRenderer } from "../testing.js"

const DEFAULT_ITERATIONS = 100
const DEFAULT_WARMUP = 50
const DEFAULT_ROUNDS = 7
const DEFAULT_MIN_SAMPLE_MS = 500
const DEFAULT_WIDTH = 140
const DEFAULT_HEIGHT = 44
const MAX_LAYOUT_SETTLE_PASSES = 4

type BenchmarkKind = "baseline" | "layout-recalc" | "text-measure" | "tree-mutation" | "scrollbox"
type BenchmarkPhase = "calculate-layout" | "full-render"
type RenderPassMode = "calculate-only" | "single-frame" | "settle-layout"

interface BenchmarkArgs {
  iterations: number
  warmupIterations: number
  rounds: number
  minSampleMs: number
  width: number
  height: number
  scenarioNames?: Set<string>
  jsonPath?: string
  listScenarios: boolean
  output: boolean
  skipValidation: boolean
}

interface BenchmarkContext {
  renderer: TestRenderer
  renderOnce: () => Promise<void>
  width: number
  height: number
}

interface TreeStats {
  renderables: number
  layoutNodes: number
  layoutOnlyBoxes: number
}

interface ScenarioRuntime {
  kind: BenchmarkKind
  phase: BenchmarkPhase
  passMode: RenderPassMode
  renderablesPerIteration: number
  layoutNodesPerIteration: number
  layoutOnlyBoxesPerIteration: number
  layoutMutationsPerIteration: number
  runIteration: (iteration: number) => unknown | Promise<unknown>
  validate?: () => void | Promise<void>
  cleanup: () => void | Promise<void>
}

interface BenchmarkScenario {
  name: string
  description: string
  setup: (ctx: BenchmarkContext) => Promise<ScenarioRuntime>
}

interface BenchmarkSample {
  round: number
  iterations: number
  durationMs: number
  opsPerSecond: number
  nsPerOperation: number
}

interface BenchmarkResult {
  name: string
  description: string
  kind: BenchmarkKind
  phase: BenchmarkPhase
  passMode: RenderPassMode
  iterations: number
  warmupIterations: number
  rounds: number
  minSampleMs: number
  batchIterations: number
  totalMeasuredIterations: number
  renderablesPerIteration: number
  layoutNodesPerIteration: number
  layoutOnlyBoxesPerIteration: number
  layoutMutationsPerIteration: number
  medianDurationMs: number
  bestDurationMs: number
  medianOpsPerSecond: number
  meanOpsPerSecond: number
  medianNsPerOperation: number
  p95NsPerOperation: number
  stdDevNsPerOperation: number
  rmePercent: number
  samples: BenchmarkSample[]
}

interface BenchmarkSinkState {
  value: unknown
  checksum: number
}

interface OpencodeLayoutTreeState {
  root: BoxRenderable
  rows: BoxRenderable[]
  badges: BoxRenderable[]
  stats: TreeStats
}

interface TextReflowTreeState {
  root: BoxRenderable
  rows: BoxRenderable[]
  texts: TextRenderable[]
  stats: TreeStats
}

interface TreeMutationState {
  root: BoxRenderable
  list: BoxRenderable
  rows: BoxRenderable[]
  stats: TreeStats
  nextRowId: number
}

interface ScrollboxReflowState {
  root: BoxRenderable
  scrollBox: ScrollBoxRenderable
  items: BoxRenderable[]
  stats: TreeStats
}

interface ValidationOptions {
  expectProbeChange?: boolean
  minimumSettlePasses?: number
}

const blackhole: BenchmarkSinkState = {
  value: undefined,
  checksum: 0,
}

const COLORS = {
  transparent: RGBA.fromInts(0, 0, 0, 0),
  panel: RGBA.fromInts(28, 32, 38),
  element: RGBA.fromInts(40, 46, 56),
  menu: RGBA.fromInts(35, 40, 48),
  accent: RGBA.fromInts(84, 171, 224),
  warning: RGBA.fromInts(219, 186, 96),
} as const

function parseNumberArg(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric benchmark argument: ${value}`)
  }

  return parsed
}

function parseArgs(argv: string[]): BenchmarkArgs {
  let iterations = DEFAULT_ITERATIONS
  let warmupIterations = DEFAULT_WARMUP
  let rounds = DEFAULT_ROUNDS
  let minSampleMs = DEFAULT_MIN_SAMPLE_MS
  let width = DEFAULT_WIDTH
  let height = DEFAULT_HEIGHT
  let scenarioNames: Set<string> | undefined
  let jsonPath: string | undefined
  let listScenarios = false
  let output = true
  let skipValidation = false

  for (const arg of argv) {
    if (arg === "--list-scenarios") {
      listScenarios = true
      continue
    }

    if (arg === "--no-output") {
      output = false
      continue
    }

    if (arg === "--skip-validation") {
      skipValidation = true
      continue
    }

    if (arg === "--json") {
      jsonPath = "latest-layout-bench-run.json"
      continue
    }

    if (arg.startsWith("--iterations=")) {
      iterations = parseNumberArg(arg.slice("--iterations=".length), DEFAULT_ITERATIONS)
      continue
    }

    if (arg.startsWith("--warmup=")) {
      warmupIterations = parseNumberArg(arg.slice("--warmup=".length), DEFAULT_WARMUP)
      continue
    }

    if (arg.startsWith("--warmup-iterations=")) {
      warmupIterations = parseNumberArg(arg.slice("--warmup-iterations=".length), DEFAULT_WARMUP)
      continue
    }

    if (arg.startsWith("--rounds=")) {
      rounds = parseNumberArg(arg.slice("--rounds=".length), DEFAULT_ROUNDS)
      continue
    }

    if (arg.startsWith("--min-sample-ms=")) {
      minSampleMs = parseNumberArg(arg.slice("--min-sample-ms=".length), DEFAULT_MIN_SAMPLE_MS)
      continue
    }

    if (arg.startsWith("--width=")) {
      width = Math.max(40, parseNumberArg(arg.slice("--width=".length), DEFAULT_WIDTH))
      continue
    }

    if (arg.startsWith("--height=")) {
      height = Math.max(20, parseNumberArg(arg.slice("--height=".length), DEFAULT_HEIGHT))
      continue
    }

    if (arg.startsWith("--scenario=")) {
      const names = arg
        .slice("--scenario=".length)
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
      scenarioNames = new Set(names)
      continue
    }

    if (arg.startsWith("--json=")) {
      const value = arg.slice("--json=".length)
      jsonPath = value || "latest-layout-bench-run.json"
    }
  }

  return {
    iterations,
    warmupIterations,
    rounds,
    minSampleMs,
    width,
    height,
    scenarioNames,
    jsonPath,
    listScenarios,
    output,
    skipValidation,
  }
}

function nowNs(): bigint {
  return process.hrtime.bigint()
}

function nsToMs(ns: bigint): number {
  return Number(ns) / 1_000_000
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const value = sorted[middle]
  if (value === undefined) {
    return 0
  }

  if (sorted.length % 2 === 1) {
    return value
  }

  const previous = sorted[middle - 1]
  if (previous === undefined) {
    return value
  }

  return (previous + value) / 2
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0
  }

  let total = 0
  for (const value of values) {
    total += value
  }
  return total / values.length
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

function sampleStdDev(values: readonly number[]): number {
  if (values.length <= 1) {
    return 0
  }

  const average = mean(values)
  let total = 0
  for (const value of values) {
    const delta = value - average
    total += delta * delta
  }

  return Math.sqrt(total / (values.length - 1))
}

function tCritical95(degreesOfFreedom: number): number {
  const table = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228]
  if (degreesOfFreedom <= 0) {
    return 0
  }

  return table[degreesOfFreedom - 1] ?? 1.96
}

function relativeMarginOfError(values: readonly number[]): number {
  if (values.length <= 1) {
    return 0
  }

  const average = mean(values)
  if (average === 0) {
    return 0
  }

  const sem = sampleStdDev(values) / Math.sqrt(values.length)
  return Math.abs((sem * tCritical95(values.length - 1) * 100) / average)
}

function consume(value: unknown): void {
  blackhole.value = value

  let contribution = 1
  if (typeof value === "number") {
    contribution = value | 0
  } else if (typeof value === "string" || Array.isArray(value)) {
    contribution = value.length
  } else if (value instanceof Map || value instanceof Set) {
    contribution = value.size
  } else if (typeof value === "boolean") {
    contribution = value ? 1 : 0
  } else if (value === null || value === undefined) {
    contribution = 0
  }

  blackhole.checksum = (blackhole.checksum + contribution) >>> 0
}

function roundIterations(value: number): number {
  if (value <= 100) {
    return Math.max(1, Math.ceil(value))
  }

  if (value <= 1_000) {
    return Math.ceil(value / 10) * 10
  }

  if (value <= 10_000) {
    return Math.ceil(value / 100) * 100
  }

  return Math.ceil(value / 1_000) * 1_000
}

function isRootLayoutDirty(ctx: BenchmarkContext): boolean {
  return ctx.renderer.root.getLayoutNode().isDirty()
}

function assertLayoutDirty(ctx: BenchmarkContext, scenarioName: string): void {
  if (!isRootLayoutDirty(ctx)) {
    throw new Error(`${scenarioName}: expected root Yoga node to be dirty after the layout mutation`)
  }
}

function assertLayoutClean(ctx: BenchmarkContext, scenarioName: string): void {
  if (isRootLayoutDirty(ctx)) {
    throw new Error(`${scenarioName}: expected root Yoga node to be clean after layout settling`)
  }
}

async function renderUntilLayoutClean(ctx: BenchmarkContext, scenarioName: string): Promise<number> {
  let passes = 0

  do {
    passes += 1
    await ctx.renderOnce()
  } while (isRootLayoutDirty(ctx) && passes < MAX_LAYOUT_SETTLE_PASSES)

  if (isRootLayoutDirty(ctx)) {
    throw new Error(`${scenarioName}: Yoga layout stayed dirty after ${passes} render passes`)
  }

  return passes
}

function calculateLayout(ctx: BenchmarkContext, scenarioName: string): number {
  ctx.renderer.root.calculateLayout()
  assertLayoutClean(ctx, scenarioName)
  return 1
}

async function validateFullRenderRecalculation(
  ctx: BenchmarkContext,
  scenarioName: string,
  mutate: (iteration: number) => unknown,
  readProbe: () => number,
  options: ValidationOptions = {},
): Promise<void> {
  await renderUntilLayoutClean(ctx, scenarioName)
  assertLayoutClean(ctx, scenarioName)

  const before = readProbe()
  consume(mutate(0))
  assertLayoutDirty(ctx, scenarioName)
  const firstPasses = await renderUntilLayoutClean(ctx, scenarioName)
  const afterFirst = readProbe()

  consume(mutate(1))
  assertLayoutDirty(ctx, scenarioName)
  const secondPasses = await renderUntilLayoutClean(ctx, scenarioName)
  const afterSecond = readProbe()

  const minimumSettlePasses = options.minimumSettlePasses ?? 1
  if (firstPasses < minimumSettlePasses || secondPasses < minimumSettlePasses) {
    throw new Error(`${scenarioName}: expected at least ${minimumSettlePasses} render pass per layout update`)
  }

  if (options.expectProbeChange !== false && before === afterFirst && afterFirst === afterSecond) {
    throw new Error(`${scenarioName}: layout probe did not change across validated recalculations`)
  }

  consume(before + afterFirst + afterSecond + firstPasses + secondPasses)
}

function validateCalculateRecalculation(
  ctx: BenchmarkContext,
  scenarioName: string,
  mutate: (iteration: number) => unknown,
  readProbe: () => number,
): void {
  calculateLayout(ctx, scenarioName)
  assertLayoutClean(ctx, scenarioName)

  const before = readProbe()
  consume(mutate(0))
  assertLayoutDirty(ctx, scenarioName)
  calculateLayout(ctx, scenarioName)
  const afterFirst = readProbe()

  consume(mutate(1))
  assertLayoutDirty(ctx, scenarioName)
  calculateLayout(ctx, scenarioName)
  const afterSecond = readProbe()

  if (before === afterFirst && afterFirst === afterSecond) {
    throw new Error(`${scenarioName}: calculate-layout probe did not change across validated recalculations`)
  }

  consume(before + afterFirst + afterSecond)
}

async function validateStaticFullRender(
  ctx: BenchmarkContext,
  scenarioName: string,
  readProbe: () => number,
): Promise<void> {
  await renderUntilLayoutClean(ctx, scenarioName)
  assertLayoutClean(ctx, scenarioName)

  const before = readProbe()
  await ctx.renderOnce()
  assertLayoutClean(ctx, scenarioName)
  const after = readProbe()

  if (before !== after) {
    throw new Error(`${scenarioName}: static full-render probe changed without a layout mutation`)
  }

  consume(before + after)
}

function layoutChecksum(renderables: readonly Renderable[]): number {
  let checksum = 0

  for (let index = 0; index < renderables.length; index += 1) {
    const layout = renderables[index]!.getLayoutNode().getComputedLayout()
    checksum =
      (checksum +
        (layout.left | 0) * 3 +
        (layout.top | 0) * 5 +
        (layout.width | 0) * 7 +
        (layout.height | 0) * 11 +
        index) |
      0
  }

  return checksum >>> 0
}

function renderableLayoutChecksum(renderables: readonly Renderable[]): number {
  let checksum = 0

  for (let index = 0; index < renderables.length; index += 1) {
    const renderable = renderables[index]!
    checksum =
      (checksum +
        (renderable.x | 0) * 3 +
        (renderable.y | 0) * 5 +
        (renderable.width | 0) * 7 +
        (renderable.height | 0) * 11 +
        index) |
      0
  }

  return checksum >>> 0
}

function createScenarios(): BenchmarkScenario[] {
  return [
    {
      name: "static_opencode_full_render",
      description: "No Yoga dirties: full render pass over an OpenCode-like layout tree for update/render baseline",
      setup: async (ctx) => {
        const state = await buildOpencodeLayoutTree(ctx, {
          messageCount: Math.max(48, ctx.height + 12),
          includeVisualBoxes: true,
          includeText: true,
        })
        const probeTargets = [...state.rows.slice(0, 16), ...state.badges.slice(0, 16)]
        await renderUntilLayoutClean(ctx, "static_opencode_full_render")

        return {
          kind: "baseline",
          phase: "full-render",
          passMode: "single-frame",
          renderablesPerIteration: state.stats.renderables,
          layoutNodesPerIteration: state.stats.layoutNodes,
          layoutOnlyBoxesPerIteration: state.stats.layoutOnlyBoxes,
          layoutMutationsPerIteration: 0,
          runIteration: async () => {
            await ctx.renderOnce()
            return renderableLayoutChecksum(probeTargets)
          },
          validate: () =>
            validateStaticFullRender(ctx, "static_opencode_full_render", () => renderableLayoutChecksum(probeTargets)),
          cleanup: () => {
            state.root.destroyRecursively()
          },
        }
      },
    },
    {
      name: "opencode_leaf_width_calculate_only",
      description: "Dirty one deep leaf width and run only root.calculateLayout()",
      setup: async (ctx) => {
        const state = await buildOpencodeLayoutTree(ctx, {
          messageCount: Math.max(64, ctx.height + 24),
          includeVisualBoxes: false,
          includeText: false,
        })
        calculateLayout(ctx, "opencode_leaf_width_calculate_only")

        const badgeWidths = new Array<number>(state.badges.length).fill(0)
        const mutate = (iteration: number): number => {
          const target = state.badges[iteration % state.badges.length]!
          const targetIndex = iteration % state.badges.length
          const nextWidth = badgeWidths[targetIndex] === 6 ? 11 : 6
          badgeWidths[targetIndex] = nextWidth
          target.width = nextWidth
          return target.width
        }
        const readProbe = () => layoutChecksum(state.badges.slice(0, 24))

        return {
          kind: "layout-recalc",
          phase: "calculate-layout",
          passMode: "calculate-only",
          renderablesPerIteration: state.stats.renderables,
          layoutNodesPerIteration: state.stats.layoutNodes,
          layoutOnlyBoxesPerIteration: state.stats.layoutOnlyBoxes,
          layoutMutationsPerIteration: 1,
          runIteration(iteration) {
            consume(mutate(iteration))
            const passes = calculateLayout(ctx, "opencode_leaf_width_calculate_only")
            return readProbe() + passes
          },
          validate: () => validateCalculateRecalculation(ctx, "opencode_leaf_width_calculate_only", mutate, readProbe),
          cleanup: () => {
            state.root.destroyRecursively()
          },
        }
      },
    },
    {
      name: "opencode_leaf_width_full_render",
      description: "Dirty one deep leaf width and run the full renderer until layout is clean",
      setup: async (ctx) => {
        const state = await buildOpencodeLayoutTree(ctx, {
          messageCount: Math.max(64, ctx.height + 24),
          includeVisualBoxes: true,
          includeText: false,
        })
        await renderUntilLayoutClean(ctx, "opencode_leaf_width_full_render")

        const badgeWidths = new Array<number>(state.badges.length).fill(0)
        const mutate = (iteration: number): number => {
          const target = state.badges[iteration % state.badges.length]!
          const targetIndex = iteration % state.badges.length
          const nextWidth = badgeWidths[targetIndex] === 5 ? 12 : 5
          badgeWidths[targetIndex] = nextWidth
          target.width = nextWidth
          return target.width
        }
        const readProbe = () => renderableLayoutChecksum(state.badges.slice(0, 24))

        return {
          kind: "layout-recalc",
          phase: "full-render",
          passMode: "settle-layout",
          renderablesPerIteration: state.stats.renderables,
          layoutNodesPerIteration: state.stats.layoutNodes,
          layoutOnlyBoxesPerIteration: state.stats.layoutOnlyBoxes,
          layoutMutationsPerIteration: 1,
          async runIteration(iteration) {
            consume(mutate(iteration))
            const passes = await renderUntilLayoutClean(ctx, "opencode_leaf_width_full_render")
            return readProbe() + passes
          },
          validate: () => validateFullRenderRecalculation(ctx, "opencode_leaf_width_full_render", mutate, readProbe),
          cleanup: () => {
            state.root.destroyRecursively()
          },
        }
      },
    },
    {
      name: "opencode_many_rows_full_render",
      description: "Dirty a stripe of row heights and badge widths before a full settled render",
      setup: async (ctx) => {
        const state = await buildOpencodeLayoutTree(ctx, {
          messageCount: Math.max(72, ctx.height * 2),
          includeVisualBoxes: true,
          includeText: false,
        })
        await renderUntilLayoutClean(ctx, "opencode_many_rows_full_render")

        const mutationsPerIteration = Math.min(16, state.rows.length)
        const rowHeights = new Array<number>(state.rows.length).fill(0)
        const badgeWidths = new Array<number>(state.badges.length).fill(0)
        const mutate = (iteration: number): number => {
          let checksum = 0
          for (let offset = 0; offset < mutationsPerIteration; offset += 1) {
            const rowIndex = (iteration * 7 + offset * 11) % state.rows.length
            const row = state.rows[rowIndex]!
            const badgeIndex = (rowIndex * 3 + offset) % state.badges.length
            const badge = state.badges[badgeIndex]!
            const nextHeight = rowHeights[rowIndex] === 2 ? 4 : 2
            const nextWidth = badgeWidths[badgeIndex] === 4 ? 10 : 4
            rowHeights[rowIndex] = nextHeight
            badgeWidths[badgeIndex] = nextWidth
            row.height = nextHeight
            badge.width = nextWidth
            checksum += row.height + badge.width
          }
          return checksum
        }
        const readProbe = () => renderableLayoutChecksum([...state.rows.slice(0, 20), ...state.badges.slice(0, 20)])

        return {
          kind: "layout-recalc",
          phase: "full-render",
          passMode: "settle-layout",
          renderablesPerIteration: state.stats.renderables,
          layoutNodesPerIteration: state.stats.layoutNodes,
          layoutOnlyBoxesPerIteration: state.stats.layoutOnlyBoxes,
          layoutMutationsPerIteration: mutationsPerIteration * 2,
          async runIteration(iteration) {
            consume(mutate(iteration))
            const passes = await renderUntilLayoutClean(ctx, "opencode_many_rows_full_render")
            return readProbe() + passes
          },
          validate: () => validateFullRenderRecalculation(ctx, "opencode_many_rows_full_render", mutate, readProbe),
          cleanup: () => {
            state.root.destroyRecursively()
          },
        }
      },
    },
    {
      name: "text_measure_reflow_full_render",
      description: "Change wrapped text content so Yoga measure functions and parent row layout recalculate",
      setup: async (ctx) => {
        const state = await buildTextReflowTree(ctx, Math.max(36, ctx.height + 8))
        await renderUntilLayoutClean(ctx, "text_measure_reflow_full_render")

        const textVersions = new Array<number>(state.texts.length).fill(0)
        const textWidths = new Array<number>(state.texts.length).fill(0)
        const mutate = (iteration: number): number => {
          const targetIndex = iteration % state.texts.length
          const text = state.texts[targetIndex]!
          const nextWidth = textWidths[targetIndex] === 22 ? 44 : 22
          textWidths[targetIndex] = nextWidth
          textVersions[targetIndex] += 1
          text.width = nextWidth
          text.content = createMeasuredText(textVersions[targetIndex] + iteration)
          return targetIndex + text.textLength + nextWidth
        }
        const readProbe = () => renderableLayoutChecksum([...state.rows.slice(0, 16), ...state.texts.slice(0, 16)])

        return {
          kind: "text-measure",
          phase: "full-render",
          passMode: "settle-layout",
          renderablesPerIteration: state.stats.renderables,
          layoutNodesPerIteration: state.stats.layoutNodes,
          layoutOnlyBoxesPerIteration: state.stats.layoutOnlyBoxes,
          layoutMutationsPerIteration: 2,
          async runIteration(iteration) {
            consume(mutate(iteration))
            const passes = await renderUntilLayoutClean(ctx, "text_measure_reflow_full_render")
            return readProbe() + passes
          },
          validate: () => validateFullRenderRecalculation(ctx, "text_measure_reflow_full_render", mutate, readProbe),
          cleanup: () => {
            state.root.destroyRecursively()
          },
        }
      },
    },
    {
      name: "insert_remove_rows_full_render",
      description: "Remove one row, allocate one replacement row, and settle the full render tree",
      setup: async (ctx) => {
        const state = await buildTreeMutationState(ctx, Math.max(48, ctx.height + 12))
        await renderUntilLayoutClean(ctx, "insert_remove_rows_full_render")

        const mutate = (iteration: number): number => {
          const removed = state.rows.shift()
          if (removed) {
            removed.destroyRecursively()
          }

          const row = createMutationRow(ctx, state.stats, state.nextRowId, iteration)
          state.nextRowId += 1
          state.list.add(row)
          state.rows.push(row)
          return state.rows.length + state.nextRowId
        }
        const readProbe = () => renderableLayoutChecksum(state.rows.slice(0, 24))

        return {
          kind: "tree-mutation",
          phase: "full-render",
          passMode: "settle-layout",
          renderablesPerIteration: state.stats.renderables,
          layoutNodesPerIteration: state.stats.layoutNodes,
          layoutOnlyBoxesPerIteration: state.stats.layoutOnlyBoxes,
          layoutMutationsPerIteration: 2,
          async runIteration(iteration) {
            consume(mutate(iteration))
            const passes = await renderUntilLayoutClean(ctx, "insert_remove_rows_full_render")
            return readProbe() + passes
          },
          validate: () => validateFullRenderRecalculation(ctx, "insert_remove_rows_full_render", mutate, readProbe),
          cleanup: () => {
            state.root.destroyRecursively()
          },
        }
      },
    },
    {
      name: "scrollbox_content_reflow_full_render",
      description:
        "Dirty scrollbox content item heights with viewport culling and sticky-bottom scrollbar recalculation",
      setup: async (ctx) => {
        const state = await buildScrollboxReflowState(ctx, Math.max(120, ctx.height * 6))
        await renderUntilLayoutClean(ctx, "scrollbox_content_reflow_full_render")

        const mutationsPerIteration = Math.min(8, state.items.length)
        const itemHeights = new Array<number>(state.items.length).fill(0)
        const mutate = (iteration: number): number => {
          let checksum = 0
          for (let offset = 0; offset < mutationsPerIteration; offset += 1) {
            const itemIndex = (iteration * 13 + offset * 17) % state.items.length
            const item = state.items[itemIndex]!
            const nextHeight = itemHeights[itemIndex] === 1 ? 4 : 1
            itemHeights[itemIndex] = nextHeight
            item.height = nextHeight
            checksum += item.height + itemIndex
          }
          return checksum
        }
        const readProbe = () =>
          renderableLayoutChecksum(state.items.slice(0, 32)) + state.scrollBox.scrollHeight + state.scrollBox.scrollTop

        return {
          kind: "scrollbox",
          phase: "full-render",
          passMode: "settle-layout",
          renderablesPerIteration: state.stats.renderables,
          layoutNodesPerIteration: state.stats.layoutNodes,
          layoutOnlyBoxesPerIteration: state.stats.layoutOnlyBoxes,
          layoutMutationsPerIteration: mutationsPerIteration,
          async runIteration(iteration) {
            consume(mutate(iteration))
            const passes = await renderUntilLayoutClean(ctx, "scrollbox_content_reflow_full_render")
            return readProbe() + passes
          },
          validate: () =>
            validateFullRenderRecalculation(ctx, "scrollbox_content_reflow_full_render", mutate, readProbe),
          cleanup: () => {
            state.root.destroyRecursively()
          },
        }
      },
    },
  ]
}

async function buildOpencodeLayoutTree(
  ctx: BenchmarkContext,
  options: { messageCount: number; includeVisualBoxes: boolean; includeText: boolean },
): Promise<OpencodeLayoutTreeState> {
  clearRoot(ctx.renderer)
  resetBuffers(ctx.renderer)

  const stats: TreeStats = {
    renderables: 0,
    layoutNodes: 0,
    layoutOnlyBoxes: 0,
  }
  const rows: BoxRenderable[] = []
  const badges: BoxRenderable[] = []

  const root = trackLayoutBox(
    stats,
    new BoxRenderable(ctx.renderer, {
      id: "bench-layout-root",
      width: "100%",
      height: "100%",
      border: false,
      backgroundColor: COLORS.transparent,
      flexDirection: "column",
    }),
  )
  ctx.renderer.root.add(root)

  const header = trackLayoutBox(
    stats,
    new BoxRenderable(ctx.renderer, {
      id: "bench-layout-header",
      width: "100%",
      height: 3,
      flexDirection: "row",
      paddingLeft: 1,
      paddingRight: 1,
      gap: 1,
    }),
  )
  root.add(header)

  for (let i = 0; i < 5; i += 1) {
    const chip = trackLayoutBox(
      stats,
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-chip-${i}`,
        width: 8 + i,
        height: 1,
        flexShrink: 0,
      }),
    )
    header.add(chip)
    badges.push(chip)
  }

  const body = trackLayoutBox(
    stats,
    new BoxRenderable(ctx.renderer, {
      id: "bench-layout-body",
      width: "100%",
      flexGrow: 1,
      flexDirection: "row",
      gap: 1,
      paddingLeft: 1,
      paddingRight: 1,
    }),
  )
  root.add(body)

  const sidebar = trackLayoutBox(
    stats,
    new BoxRenderable(ctx.renderer, {
      id: "bench-layout-sidebar",
      width: 22,
      minWidth: 22,
      maxWidth: 22,
      flexShrink: 0,
      flexDirection: "column",
      gap: 1,
    }),
  )
  body.add(sidebar)

  for (let i = 0; i < 12; i += 1) {
    sidebar.add(
      trackLayoutBox(
        stats,
        new BoxRenderable(ctx.renderer, {
          id: `bench-layout-sidebar-row-${i}`,
          height: 1,
          paddingLeft: 1,
          paddingRight: 1,
        }),
      ),
    )
  }

  const main = trackLayoutBox(
    stats,
    new BoxRenderable(ctx.renderer, {
      id: "bench-layout-main",
      flexGrow: 1,
      flexDirection: "column",
      gap: 1,
    }),
  )
  body.add(main)

  for (let i = 0; i < options.messageCount; i += 1) {
    const row = trackLayoutBox(
      stats,
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-row-${i}`,
        width: "100%",
        height: i % 4 === 0 ? 3 : 2,
        flexDirection: "row",
      }),
    )
    rows.push(row)

    const rail = trackLayoutBox(
      stats,
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-rail-${i}`,
        width: 3,
        minWidth: 3,
        maxWidth: 3,
        flexShrink: 0,
      }),
    )

    const content = trackLayoutBox(
      stats,
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-content-${i}`,
        flexGrow: 1,
        flexDirection: "column",
      }),
    )

    const meta = trackLayoutBox(
      stats,
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-meta-${i}`,
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between",
      }),
    )

    const badgeGroup = trackLayoutBox(
      stats,
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-badges-${i}`,
        flexDirection: "row",
        gap: 1,
      }),
    )

    for (let badgeIndex = 0; badgeIndex < 3; badgeIndex += 1) {
      const badge = trackLayoutBox(
        stats,
        new BoxRenderable(ctx.renderer, {
          id: `bench-layout-badge-${i}-${badgeIndex}`,
          width: 5 + badgeIndex,
          height: 1,
          flexShrink: 0,
        }),
      )
      badgeGroup.add(badge)
      badges.push(badge)
    }

    const actions = trackLayoutBox(
      stats,
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-actions-${i}`,
        flexDirection: "row",
        gap: 1,
        flexShrink: 0,
      }),
    )

    for (let actionIndex = 0; actionIndex < 2; actionIndex += 1) {
      const action = trackLayoutBox(
        stats,
        new BoxRenderable(ctx.renderer, {
          id: `bench-layout-action-${i}-${actionIndex}`,
          width: 4 + actionIndex,
          height: 1,
          flexShrink: 0,
        }),
      )
      actions.add(action)
      badges.push(action)
    }

    meta.add(badgeGroup)
    meta.add(actions)
    content.add(meta)

    if (options.includeVisualBoxes) {
      content.add(
        trackVisualBox(
          stats,
          new BoxRenderable(ctx.renderer, {
            id: `bench-layout-leaf-${i}`,
            width: "100%",
            height: i % 5 === 0 ? 3 : i % 2 === 0 ? 2 : 1,
            border: false,
            backgroundColor: i % 3 === 0 ? COLORS.menu : i % 2 === 0 ? COLORS.panel : COLORS.element,
          }),
        ),
      )
    }

    if (options.includeText && i % 4 === 0) {
      content.add(
        trackText(
          stats,
          new TextRenderable(ctx.renderer, {
            id: `bench-layout-text-${i}`,
            content: `message-${i}`,
            height: 1,
          }),
        ),
      )
    }

    row.add(rail)
    row.add(content)
    main.add(row)
  }

  const footer = trackLayoutBox(
    stats,
    new BoxRenderable(ctx.renderer, {
      id: "bench-layout-footer",
      width: "100%",
      height: 4,
      flexDirection: "row",
      gap: 1,
      paddingLeft: 1,
      paddingRight: 1,
    }),
  )
  root.add(footer)

  for (let i = 0; i < 6; i += 1) {
    const item = trackLayoutBox(
      stats,
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-footer-item-${i}`,
        width: 12 + i,
        height: 1,
        flexDirection: "row",
        gap: 1,
      }),
    )
    footer.add(item)
    badges.push(item)
  }

  return {
    root,
    rows,
    badges,
    stats,
  }
}

async function buildTextReflowTree(ctx: BenchmarkContext, rowCount: number): Promise<TextReflowTreeState> {
  clearRoot(ctx.renderer)
  resetBuffers(ctx.renderer)

  const stats: TreeStats = {
    renderables: 0,
    layoutNodes: 0,
    layoutOnlyBoxes: 0,
  }
  const rows: BoxRenderable[] = []
  const texts: TextRenderable[] = []

  const root = trackLayoutBox(
    stats,
    new BoxRenderable(ctx.renderer, {
      id: "bench-text-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      gap: 1,
    }),
  )
  ctx.renderer.root.add(root)

  for (let i = 0; i < rowCount; i += 1) {
    const row = trackLayoutBox(
      stats,
      new BoxRenderable(ctx.renderer, {
        id: `bench-text-row-${i}`,
        width: "100%",
        flexDirection: "row",
        gap: 1,
      }),
    )
    rows.push(row)

    row.add(
      trackLayoutBox(
        stats,
        new BoxRenderable(ctx.renderer, {
          id: `bench-text-gutter-${i}`,
          width: 6,
          height: 1,
          flexShrink: 0,
        }),
      ),
    )

    const text = trackText(
      stats,
      new TextRenderable(ctx.renderer, {
        id: `bench-text-${i}`,
        width: Math.max(18, Math.floor(ctx.width * 0.34)),
        content: createMeasuredText(i),
        wrapMode: "word",
      }),
    )
    texts.push(text)
    row.add(text)
    root.add(row)
  }

  return {
    root,
    rows,
    texts,
    stats,
  }
}

async function buildTreeMutationState(ctx: BenchmarkContext, rowCount: number): Promise<TreeMutationState> {
  clearRoot(ctx.renderer)
  resetBuffers(ctx.renderer)

  const stats: TreeStats = {
    renderables: 0,
    layoutNodes: 0,
    layoutOnlyBoxes: 0,
  }
  const rows: BoxRenderable[] = []

  const root = trackLayoutBox(
    stats,
    new BoxRenderable(ctx.renderer, {
      id: "bench-mutation-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      gap: 1,
    }),
  )
  ctx.renderer.root.add(root)

  const list = trackLayoutBox(
    stats,
    new BoxRenderable(ctx.renderer, {
      id: "bench-mutation-list",
      width: "100%",
      flexGrow: 1,
      flexDirection: "column",
    }),
  )
  root.add(list)

  for (let i = 0; i < rowCount; i += 1) {
    const row = createMutationRow(ctx, stats, i, i)
    list.add(row)
    rows.push(row)
  }

  return {
    root,
    list,
    rows,
    stats,
    nextRowId: rowCount,
  }
}

function createMutationRow(ctx: BenchmarkContext, stats: TreeStats, id: number, variant: number): BoxRenderable {
  const row = trackLayoutBox(
    stats,
    new BoxRenderable(ctx.renderer, {
      id: `bench-mutation-row-${id}`,
      width: "100%",
      height: 1 + (variant % 3),
      flexDirection: "row",
      gap: 1,
    }),
  )

  for (let i = 0; i < 4; i += 1) {
    row.add(
      trackLayoutBox(
        stats,
        new BoxRenderable(ctx.renderer, {
          id: `bench-mutation-cell-${id}-${i}`,
          width: i === 3 ? "auto" : 8 + ((variant + i) % 5),
          flexGrow: i === 3 ? 1 : 0,
          height: 1,
        }),
      ),
    )
  }

  return row
}

async function buildScrollboxReflowState(ctx: BenchmarkContext, itemCount: number): Promise<ScrollboxReflowState> {
  clearRoot(ctx.renderer)
  resetBuffers(ctx.renderer)

  const stats: TreeStats = {
    renderables: 0,
    layoutNodes: 0,
    layoutOnlyBoxes: 0,
  }
  const items: BoxRenderable[] = []

  const root = trackLayoutBox(
    stats,
    new BoxRenderable(ctx.renderer, {
      id: "bench-scrollbox-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
    }),
  )
  ctx.renderer.root.add(root)

  const scrollBox = trackLayoutBox(
    stats,
    new ScrollBoxRenderable(ctx.renderer, {
      id: "bench-scrollbox",
      width: "100%",
      height: "100%",
      stickyScroll: true,
      stickyStart: "bottom",
      viewportCulling: true,
      contentOptions: {
        flexDirection: "column",
      },
    }),
  ) as ScrollBoxRenderable
  root.add(scrollBox)

  // ScrollBoxRenderable owns wrapper, viewport, content, and two scrollbars.
  // Count those internal renderables so per-node metrics match traversal scale.
  stats.renderables += 5
  stats.layoutNodes += 5
  stats.layoutOnlyBoxes += 3

  for (let i = 0; i < itemCount; i += 1) {
    const item = trackLayoutBox(
      stats,
      new BoxRenderable(ctx.renderer, {
        id: `bench-scrollbox-item-${i}`,
        width: "100%",
        height: 1 + (i % 3),
        flexDirection: "row",
        gap: 1,
        paddingLeft: 1,
        paddingRight: 1,
      }),
    )

    item.add(
      trackVisualBox(
        stats,
        new BoxRenderable(ctx.renderer, {
          id: `bench-scrollbox-item-marker-${i}`,
          width: 2,
          height: 1,
          flexShrink: 0,
          backgroundColor: i % 2 === 0 ? COLORS.accent : COLORS.warning,
        }),
      ),
    )
    item.add(
      trackLayoutBox(
        stats,
        new BoxRenderable(ctx.renderer, {
          id: `bench-scrollbox-item-fill-${i}`,
          flexGrow: 1,
          height: 1,
        }),
      ),
    )

    scrollBox.add(item)
    items.push(item)
  }

  return {
    root,
    scrollBox,
    items,
    stats,
  }
}

function trackLayoutBox<T extends BoxRenderable>(stats: TreeStats, box: T): T {
  stats.renderables += 1
  stats.layoutNodes += 1
  stats.layoutOnlyBoxes += 1
  return box
}

function trackVisualBox<T extends BoxRenderable>(stats: TreeStats, box: T): T {
  stats.renderables += 1
  stats.layoutNodes += 1
  return box
}

function trackText<T extends TextRenderable>(stats: TreeStats, text: T): T {
  stats.renderables += 1
  stats.layoutNodes += 1
  return text
}

function createMeasuredText(iteration: number): string {
  if (iteration % 3 === 0) {
    return `short layout line ${iteration}`
  }

  if (iteration % 3 === 1) {
    return `medium wrapped layout text ${iteration} with enough words to cross the benchmark column and force a different measured height`
  }

  return `long wrapped layout text ${iteration} with repeated terminal interface vocabulary layout render buffer yoga measurement viewport reflow update traversal native boundary `.repeat(
    2,
  )
}

async function runScenario(
  scenario: BenchmarkScenario,
  ctx: BenchmarkContext,
  args: BenchmarkArgs,
): Promise<BenchmarkResult> {
  const runtime = await scenario.setup(ctx)

  try {
    if (!args.skipValidation) {
      await runtime.validate?.()
    }

    let nextIteration = 0
    nextIteration = await runIterations(runtime, args.warmupIterations, nextIteration)

    let batchIterations = args.iterations
    const calibration = await timeIterations(runtime, batchIterations, nextIteration)
    nextIteration = calibration.nextIteration

    if (calibration.durationMs > 0 && calibration.durationMs < args.minSampleMs) {
      const scaledIterations = (batchIterations * args.minSampleMs) / calibration.durationMs
      batchIterations = roundIterations(scaledIterations)
    }

    if (batchIterations !== args.iterations) {
      nextIteration = await runIterations(runtime, Math.min(batchIterations, args.warmupIterations), nextIteration)
    }

    const samples: BenchmarkSample[] = []
    for (let round = 0; round < args.rounds; round += 1) {
      const start = nowNs()
      let sampleIterations = 0
      let durationMs = 0

      do {
        nextIteration = await runIterations(runtime, batchIterations, nextIteration)
        sampleIterations += batchIterations
        durationMs = nsToMs(nowNs() - start)
      } while (durationMs < args.minSampleMs)

      samples.push({
        round: round + 1,
        iterations: sampleIterations,
        durationMs,
        opsPerSecond: (sampleIterations * 1000) / durationMs,
        nsPerOperation: (durationMs * 1_000_000) / sampleIterations,
      })
    }

    const durations = samples.map((sample) => sample.durationMs)
    const opsPerSecond = samples.map((sample) => sample.opsPerSecond)
    const nsPerOperation = samples.map((sample) => sample.nsPerOperation)

    return {
      name: scenario.name,
      description: scenario.description,
      kind: runtime.kind,
      phase: runtime.phase,
      passMode: runtime.passMode,
      iterations: args.iterations,
      warmupIterations: args.warmupIterations,
      rounds: args.rounds,
      minSampleMs: args.minSampleMs,
      batchIterations,
      totalMeasuredIterations: samples.reduce((total, sample) => total + sample.iterations, 0),
      renderablesPerIteration: runtime.renderablesPerIteration,
      layoutNodesPerIteration: runtime.layoutNodesPerIteration,
      layoutOnlyBoxesPerIteration: runtime.layoutOnlyBoxesPerIteration,
      layoutMutationsPerIteration: runtime.layoutMutationsPerIteration,
      medianDurationMs: median(durations),
      bestDurationMs: Math.min(...durations),
      medianOpsPerSecond: median(opsPerSecond),
      meanOpsPerSecond: mean(opsPerSecond),
      medianNsPerOperation: median(nsPerOperation),
      p95NsPerOperation: percentile(nsPerOperation, 95),
      stdDevNsPerOperation: sampleStdDev(nsPerOperation),
      rmePercent: relativeMarginOfError(nsPerOperation),
      samples,
    }
  } finally {
    await runtime.cleanup()
    clearRoot(ctx.renderer)
    resetBuffers(ctx.renderer)
  }
}

async function timeIterations(
  runtime: ScenarioRuntime,
  count: number,
  startIteration: number,
): Promise<{ durationMs: number; nextIteration: number }> {
  const start = nowNs()
  const nextIteration = await runIterations(runtime, count, startIteration)
  return {
    durationMs: nsToMs(nowNs() - start),
    nextIteration,
  }
}

async function runIterations(runtime: ScenarioRuntime, count: number, startIteration: number): Promise<number> {
  for (let iteration = 0; iteration < count; iteration += 1) {
    consume(await runtime.runIteration(startIteration + iteration))
  }

  return startIteration + count
}

function clearRoot(renderer: TestRenderer): void {
  for (const child of renderer.root.getChildren()) {
    child.destroyRecursively()
  }
}

function resetBuffers(renderer: TestRenderer): void {
  const buffers = [renderer.currentRenderBuffer, renderer.nextRenderBuffer]
  for (const buffer of buffers) {
    buffer.clearScissorRects()
    buffer.clearOpacity()
    buffer.clear(COLORS.transparent)
  }
}

function formatNumber(value: number): string {
  return value.toFixed(2)
}

function writeLine(enabled: boolean, line: string): void {
  if (enabled) {
    console.log(line)
  }
}

function printResults(results: BenchmarkResult[], args: BenchmarkArgs): void {
  console.log(
    `layout-benchmark iters=${args.iterations} warmup=${args.warmupIterations} rounds=${args.rounds} min_sample_ms=${args.minSampleMs} renderer=${args.width}x${args.height} scenarios=${results.length} checksum=${blackhole.checksum}`,
  )
  console.log("")

  const header = [
    "scenario",
    "kind",
    "phase",
    "pass mode",
    "batch",
    "nodes",
    "mutations",
    "median ns/op",
    "p95 ns/op",
    "rme %",
  ]
  const rows = results.map((result) => [
    result.name,
    result.kind,
    result.phase,
    result.passMode,
    String(result.batchIterations),
    String(result.layoutNodesPerIteration),
    String(result.layoutMutationsPerIteration),
    formatNumber(result.medianNsPerOperation),
    formatNumber(result.p95NsPerOperation),
    formatNumber(result.rmePercent),
  ])

  const widths = header.map((title, index) => Math.max(title.length, ...rows.map((row) => row[index]?.length ?? 0)))
  const lines = [header, ...rows].map((row, rowIndex) => {
    const line = row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ")
    if (rowIndex !== 0) {
      return line
    }

    const divider = widths.map((width) => "-".repeat(width)).join("  ")
    return `${line}\n${divider}`
  })

  console.log(lines.join("\n"))
  console.log("")

  for (const result of results) {
    console.log(`${result.name}: ${result.description}`)
    for (const sample of result.samples) {
      console.log(
        `  round ${sample.round}: ${sample.iterations} iters, ${formatNumber(sample.durationMs)} ms, ${formatNumber(sample.nsPerOperation)} ns/op (${formatNumber(sample.opsPerSecond)} ops/sec)`,
      )
    }
  }
}

function writeResults(results: BenchmarkResult[], args: BenchmarkArgs, jsonPath: string): void {
  const absolutePath = path.isAbsolute(jsonPath) ? jsonPath : path.resolve(process.cwd(), jsonPath)
  mkdirSync(path.dirname(absolutePath), { recursive: true })
  writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        meta: {
          timestamp: new Date().toISOString(),
          iterations: args.iterations,
          warmupIterations: args.warmupIterations,
          rounds: args.rounds,
          minSampleMs: args.minSampleMs,
          width: args.width,
          height: args.height,
          cwd: process.cwd(),
          args: process.argv.slice(2),
          runtime: {
            bun: typeof Bun !== "undefined" ? Bun.version : undefined,
            node: process.versions.node,
            v8: process.versions.v8,
            platform: process.platform,
            arch: process.arch,
          },
          blackholeChecksum: blackhole.checksum,
        },
        results,
      },
      null,
      2,
    ),
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const scenarios = createScenarios()

  if (args.listScenarios) {
    for (const scenario of scenarios) {
      console.log(`${scenario.name}\t${scenario.description}`)
    }
    return
  }

  if (args.jsonPath) {
    const absolutePath = path.isAbsolute(args.jsonPath) ? args.jsonPath : path.resolve(process.cwd(), args.jsonPath)
    if (existsSync(absolutePath)) {
      throw new Error(`Benchmark output file already exists: ${absolutePath}`)
    }
  }

  const selectedScenarios = args.scenarioNames
    ? scenarios.filter((scenario) => args.scenarioNames!.has(scenario.name))
    : scenarios

  if (selectedScenarios.length === 0) {
    throw new Error("No benchmark scenarios matched the provided --scenario filter")
  }

  writeLine(args.output, `layout benchmark renderer=${args.width}x${args.height}`)
  writeLine(
    args.output,
    `scenarios=${selectedScenarios.length} iterations=${args.iterations} warmup=${args.warmupIterations} rounds=${args.rounds} min_sample_ms=${args.minSampleMs}`,
  )

  const { renderer, renderOnce } = await createTestRenderer({
    width: args.width,
    height: args.height,
    targetFps: 60,
    maxFps: 60,
    screenMode: "main-screen",
    externalOutputMode: "passthrough",
    consoleMode: "disabled",
    useMouse: false,
  })

  renderer.requestRender = () => {}

  const ctx: BenchmarkContext = {
    renderer,
    renderOnce,
    width: args.width,
    height: args.height,
  }
  const results: BenchmarkResult[] = []

  try {
    for (const scenario of selectedScenarios) {
      writeLine(args.output, `Running ${scenario.name}...`)
      const result = await runScenario(scenario, ctx, args)
      results.push(result)
      writeLine(
        args.output,
        `  median=${formatNumber(result.medianNsPerOperation)}ns/op p95=${formatNumber(result.p95NsPerOperation)}ns/op rme=${formatNumber(result.rmePercent)}%`,
      )
    }
  } finally {
    renderer.destroy()
  }

  if (args.output) {
    printResults(results, args)
  }

  if (args.jsonPath) {
    writeResults(results, args, args.jsonPath)
    writeLine(args.output, `Wrote benchmark JSON: ${args.jsonPath}`)
  }
}

await main()
