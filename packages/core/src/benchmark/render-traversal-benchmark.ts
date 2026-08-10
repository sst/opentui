#!/usr/bin/env bun

// This benchmark targets render/layout bookkeeping in wrapper-heavy trees,
// scrollbox culling, and scrollbar-heavy paths that exercise Renderable
// traversal without depending on one specific widget.

import { performance } from "node:perf_hooks"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Command } from "commander"
import {
  BoxRenderable,
  type OptimizedBuffer,
  Renderable,
  RGBA,
  ScrollBarRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type RenderContext,
} from "../index.js"
import { createTestRenderer, type TestRenderer } from "../testing.js"

type ScenarioRuntime = {
  renderablesPerIteration: number
  layoutOnlyBoxesPerIteration: number
  runIteration: (iteration: number) => Promise<void>
  validate?: () => void | Promise<void>
  teardown?: () => void | Promise<void>
}

type ScenarioDefinition = {
  name: string
  description: string
  setup: (ctx: BenchmarkContext) => Promise<ScenarioRuntime> | ScenarioRuntime
}

type BenchmarkContext = {
  renderer: TestRenderer
  renderOnce: () => Promise<void>
  width: number
  height: number
}

type ScenarioResult = {
  name: string
  description: string
  iterations: number
  warmupIterations: number
  elapsedMs: number
  renderablesPerIteration: number
  layoutOnlyBoxesPerIteration: number
  avgMs: number
  medianMs: number
  p95Ms: number
  minMs: number
  maxMs: number
  stdDevMs: number
  rsdPercent: number
  rmePercent: number
  approxUsPerRenderable: number
}

type TimingStats = {
  avgMs: number
  medianMs: number
  p95Ms: number
  minMs: number
  maxMs: number
  stdDevMs: number
  rsdPercent: number
  rmePercent: number
}

type TreeStats = {
  renderables: number
  layoutOnlyBoxes: number
}

type LayoutTreeOptions = {
  messageCount: number
  includeVisibleBoxes: boolean
  includeText: boolean
}

type LayoutTreeState = {
  root: BoxRenderable
  stats: TreeStats
}

type SpinnerScenarioKind =
  | "noop"
  | "bottom"
  | "history-one"
  | "mixed-three"
  | "history-four"
  | "history-all"
  | "all"
  | "text"

type SpinnerTreeState = {
  root: BoxRenderable
  historySpinners: BenchmarkSpinnerRenderable[]
  bottomSpinner: BenchmarkSpinnerRenderable
  textSpinner: TextRenderable
  stats: TreeStats
  nextFrame: number
}

const SUITES = {
  quick: { iterations: 300, warmupIterations: 40 },
  default: { iterations: 1800, warmupIterations: 120 },
  long: { iterations: 5000, warmupIterations: 250 },
} as const

const COLORS = {
  transparent: RGBA.fromInts(0, 0, 0, 0),
  panel: RGBA.fromInts(28, 32, 38),
  element: RGBA.fromInts(40, 46, 56),
  menu: RGBA.fromInts(35, 40, 48),
  accent: RGBA.fromInts(84, 171, 224),
  warning: RGBA.fromInts(219, 186, 96),
} as const

const SPINNER_FRAMES = ["|", "/", "-", "\\"] as const

class BenchmarkSpinnerRenderable extends Renderable {
  private frameIndex = 0

  constructor(ctx: RenderContext, id: string) {
    super(ctx, { id, width: 1, height: 1, flexShrink: 0 })
  }

  public setFrame(frameIndex: number): void {
    const normalized = frameIndex % SPINNER_FRAMES.length
    if (this.frameIndex === normalized) return
    this.frameIndex = normalized
    this.requestRender()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    buffer.drawText(SPINNER_FRAMES[this.frameIndex], this._screenX, this._screenY, COLORS.warning)
  }
}

let benchmarkChecksum = 0

const program = new Command()
program
  .name("render-traversal-benchmark")
  .description("Benchmark render-tree traversal with headless test renderer")
  .option("-s, --suite <name>", "benchmark suite: quick, default, long", "default")
  .option("-i, --iterations <count>", "iterations per scenario")
  .option("--warmup-iterations <count>", "warmup iterations per scenario")
  .option("--width <count>", "test renderer width", "140")
  .option("--height <count>", "test renderer height", "44")
  .option("--scenario <name>", "run only one scenario")
  .option("--force-full-composition", "force complete composition for spinner scenario controls")
  .option("--list-scenarios", "list scenario names and exit")
  .option("--json [path]", "write benchmark results to JSON")
  .option("--no-output", "suppress stdout output")
  .parse(process.argv)

const options = program.opts()
const suiteName = String(options.suite)
const suiteDefaults = SUITES[suiteName as keyof typeof SUITES]

if (!suiteDefaults) {
  console.error(`Unknown suite: ${suiteName}. Valid suites: ${Object.keys(SUITES).join(", ")}`)
  process.exit(1)
}

const iterations = Math.max(1, Math.floor(toNumber(options.iterations, suiteDefaults.iterations)))
const warmupIterations = Math.max(0, Math.floor(toNumber(options.warmupIterations, suiteDefaults.warmupIterations)))
const width = Math.max(40, Math.floor(toNumber(options.width, 140)))
const height = Math.max(20, Math.floor(toNumber(options.height, 44)))
const scenarioFilter = options.scenario ? String(options.scenario) : null
const outputEnabled = options.output !== false
const forceFullComposition = options.forceFullComposition === true

const jsonArg = options.json
const jsonPath =
  typeof jsonArg === "string"
    ? path.resolve(process.cwd(), jsonArg)
    : jsonArg
      ? path.resolve(process.cwd(), "latest-render-traversal-bench-run.json")
      : null

if (jsonPath) {
  const dir = path.dirname(jsonPath)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }

  if (existsSync(jsonPath)) {
    console.error(`Error: output file already exists: ${jsonPath}`)
    process.exit(1)
  }
}

const scenarios = createScenarios()

if (options.listScenarios) {
  for (const scenario of scenarios) {
    console.log(scenario.name)
  }
  process.exit(0)
}

const selectedScenarios = scenarioFilter ? scenarios.filter((scenario) => scenario.name === scenarioFilter) : scenarios
if (selectedScenarios.length === 0) {
  console.error(`Unknown scenario: ${scenarioFilter}`)
  process.exit(1)
}

if (outputEnabled) {
  console.log(`render traversal benchmark (${suiteName})`)
  console.log(`- renderer: ${width}x${height}`)
  console.log(`- scenarios: ${selectedScenarios.length}`)
  console.log(`- iterations: ${iterations} (+${warmupIterations} warmup)`)
}

const { renderer, renderOnce } = await createTestRenderer({
  width,
  height,
  targetFps: 60,
  maxFps: 60,
  screenMode: "main-screen",
  externalOutputMode: "passthrough",
  consoleMode: "disabled",
  useMouse: false,
  useThread: false,
})

// Benchmarks drive frames explicitly. Prevent property mutations from racing
// the measured renderOnce() call through the asynchronous frame scheduler.
renderer.requestRender = (renderable) => invalidateRoot(renderer.root, renderable)

const ctx: BenchmarkContext = { renderer, renderOnce, width, height }
const results: ScenarioResult[] = []

try {
  for (const scenario of selectedScenarios) {
    writeLine(outputEnabled, `Running ${scenario.name}...`)
    const result = await runScenario(scenario, ctx, iterations, warmupIterations)
    results.push(result)
    writeLine(
      outputEnabled,
      `  avg=${result.avgMs.toFixed(4)}ms p95=${result.p95Ms.toFixed(4)}ms rsd=${result.rsdPercent.toFixed(2)}% rme=${result.rmePercent.toFixed(2)}%`,
    )
  }
} finally {
  renderer.destroy()
}

if (outputEnabled) {
  console.table(
    results.map((result) => ({
      scenario: result.name,
      renderables: result.renderablesPerIteration,
      layoutOnlyBoxes: result.layoutOnlyBoxesPerIteration,
      avgMs: result.avgMs,
      p95Ms: result.p95Ms,
      "rsd%": result.rsdPercent,
      "rme%": result.rmePercent,
      usPerRenderable: result.approxUsPerRenderable,
    })),
  )
}

if (jsonPath) {
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        metadata: {
          suite: suiteName,
          width,
          height,
          iterations,
          warmupIterations,
          scenarioFilter,
          timestamp: new Date().toISOString(),
          runtime: {
            name: typeof process.versions.bun === "string" ? "bun" : "node",
            version: process.versions.bun ?? process.version,
            platform: process.platform,
            arch: process.arch,
          },
          checksum: benchmarkChecksum,
        },
        scenarios: results,
      },
      null,
      2,
    ),
  )
  writeLine(outputEnabled, `Wrote benchmark JSON: ${jsonPath}`)
}

function createScenarios(): ScenarioDefinition[] {
  return [
    createYogaLayoutReadScenario(100),
    createYogaLayoutReadScenario(1000),
    createYogaLayoutReadScenario(10000),
    {
      name: "layout_only_opencode_wrappers",
      description: "OpenCode-like nested layout boxes with no visible box output",
      setup: async (ctx) => {
        const state = await buildOpencodeLayoutTree(ctx, {
          messageCount: Math.max(48, ctx.height + 12),
          includeVisibleBoxes: false,
          includeText: false,
        })

        return {
          renderablesPerIteration: state.stats.renderables,
          layoutOnlyBoxesPerIteration: state.stats.layoutOnlyBoxes,
          runIteration: async () => {
            await ctx.renderOnce()
          },
          teardown: () => {
            state.root.destroyRecursively()
          },
        }
      },
    },
    {
      name: "mixed_opencode_wrappers",
      description: "OpenCode-like layout tree with sparse visible panels and text leaves",
      setup: async (ctx) => {
        const state = await buildOpencodeLayoutTree(ctx, {
          messageCount: Math.max(40, ctx.height + 8),
          includeVisibleBoxes: true,
          includeText: true,
        })

        return {
          renderablesPerIteration: state.stats.renderables,
          layoutOnlyBoxesPerIteration: state.stats.layoutOnlyBoxes,
          runIteration: async () => {
            await ctx.renderOnce()
          },
          teardown: () => {
            state.root.destroyRecursively()
          },
        }
      },
    },
    {
      name: "render_list_hot_path",
      description: "Repeated render-list traversal over an unchanged OpenCode-like tree",
      setup: async (ctx) => {
        const state = await buildOpencodeLayoutTree(ctx, {
          messageCount: Math.max(48, ctx.height + 12),
          includeVisibleBoxes: false,
          includeText: false,
        })
        const batchSize = 1000

        return {
          renderablesPerIteration: state.stats.renderables * batchSize,
          layoutOnlyBoxesPerIteration: state.stats.layoutOnlyBoxes * batchSize,
          runIteration: async () => {
            for (let index = 0; index < batchSize; index++) {
              ctx.renderer.root.render(ctx.renderer.nextRenderBuffer, 0)
            }
          },
          teardown: () => {
            state.root.destroyRecursively()
          },
        }
      },
    },
    createSpinnerScenario("noop"),
    createSpinnerScenario("bottom"),
    createSpinnerScenario("history-one"),
    createSpinnerScenario("mixed-three"),
    createSpinnerScenario("history-four"),
    createSpinnerScenario("history-all"),
    createSpinnerScenario("all"),
    createSpinnerScenario("text"),
    {
      name: "scrollbox_viewport_culling",
      description: "Viewport-culling content tree with many hidden children",
      setup: async (ctx) => {
        clearRoot(ctx.renderer)
        resetBuffers(ctx.renderer)

        let renderables = 0
        let layoutOnlyBoxes = 0
        const root = new BoxRenderable(ctx.renderer, {
          id: "bench-scroll-root",
          width: "100%",
          height: "100%",
          border: false,
          backgroundColor: COLORS.transparent,
        })
        renderables += 1
        layoutOnlyBoxes += 1
        ctx.renderer.root.add(root)

        const scrollBox = new ScrollBoxRenderable(ctx.renderer, {
          id: "bench-scrollbox",
          width: "100%",
          height: "100%",
          stickyScroll: true,
          stickyStart: "bottom",
          viewportCulling: true,
        })
        renderables += 1
        layoutOnlyBoxes += 1
        root.add(scrollBox)

        const itemCount = Math.max(120, ctx.height * 8)
        for (let i = 0; i < itemCount; i += 1) {
          const item = new BoxRenderable(ctx.renderer, {
            id: `bench-scroll-item-${i}`,
            width: "100%",
            height: i % 3 === 0 ? 3 : 2,
            border: false,
            backgroundColor: COLORS.transparent,
            paddingLeft: 2,
            paddingRight: 1,
            flexDirection: "column",
          })
          renderables += 1
          layoutOnlyBoxes += 1

          const leaf = new BoxRenderable(ctx.renderer, {
            id: `bench-scroll-leaf-${i}`,
            width: "100%",
            height: 1,
            border: false,
            backgroundColor: i % 2 === 0 ? COLORS.panel : COLORS.element,
          })
          renderables += 1

          item.add(leaf)
          scrollBox.add(item)
        }

        await ctx.renderOnce()

        return {
          renderablesPerIteration: renderables,
          layoutOnlyBoxesPerIteration: layoutOnlyBoxes,
          runIteration: async () => {
            await ctx.renderOnce()
          },
          teardown: () => {
            root.destroyRecursively()
          },
        }
      },
    },
    createCullingScalingScenario(100),
    createCullingScalingScenario(1000),
    createCullingScalingScenario(5000),
    createCullingScalingScenario(10000),
    {
      name: "scrollbar_stack",
      description: "Visible scrollbars and slider tracks with arrows",
      setup: async (ctx) => {
        clearRoot(ctx.renderer)
        resetBuffers(ctx.renderer)

        let renderables = 0
        let layoutOnlyBoxes = 0

        const root = new BoxRenderable(ctx.renderer, {
          id: "bench-scrollbar-root",
          width: "100%",
          height: "100%",
          border: false,
          backgroundColor: COLORS.transparent,
          flexDirection: "column",
          gap: 1,
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
        })
        renderables += 1
        layoutOnlyBoxes += 1
        ctx.renderer.root.add(root)

        const verticalRow = new BoxRenderable(ctx.renderer, {
          id: "bench-scrollbar-vertical-row",
          width: "100%",
          height: 14,
          border: false,
          backgroundColor: COLORS.transparent,
          flexDirection: "row",
          gap: 1,
        })
        renderables += 1
        layoutOnlyBoxes += 1
        root.add(verticalRow)

        for (let i = 0; i < 10; i += 1) {
          const bar = new ScrollBarRenderable(ctx.renderer, {
            id: `bench-vertical-scrollbar-${i}`,
            orientation: "vertical",
            showArrows: true,
            width: 2,
            height: 14,
            trackOptions: {
              backgroundColor: COLORS.panel,
              foregroundColor: COLORS.accent,
            },
            arrowOptions: {
              backgroundColor: COLORS.panel,
              foregroundColor: COLORS.warning,
            },
          })
          bar.scrollSize = 400 + i * 30
          bar.viewportSize = 24 + (i % 3)
          bar.scrollPosition = 10 + i * 7
          renderables += 4
          verticalRow.add(bar)
        }

        const horizontalColumn = new BoxRenderable(ctx.renderer, {
          id: "bench-scrollbar-horizontal-column",
          width: "100%",
          flexGrow: 1,
          border: false,
          backgroundColor: COLORS.transparent,
          flexDirection: "column",
          gap: 1,
        })
        renderables += 1
        layoutOnlyBoxes += 1
        root.add(horizontalColumn)

        for (let i = 0; i < 8; i += 1) {
          const bar = new ScrollBarRenderable(ctx.renderer, {
            id: `bench-horizontal-scrollbar-${i}`,
            orientation: "horizontal",
            showArrows: true,
            width: 28,
            height: 1,
            trackOptions: {
              backgroundColor: COLORS.element,
              foregroundColor: COLORS.accent,
            },
            arrowOptions: {
              backgroundColor: COLORS.element,
              foregroundColor: COLORS.warning,
            },
          })
          bar.scrollSize = 520 + i * 50
          bar.viewportSize = 32 + (i % 4)
          bar.scrollPosition = 15 + i * 11
          renderables += 4
          horizontalColumn.add(bar)
        }

        await ctx.renderOnce()

        return {
          renderablesPerIteration: renderables,
          layoutOnlyBoxesPerIteration: layoutOnlyBoxes,
          runIteration: async () => {
            await ctx.renderOnce()
          },
          teardown: () => {
            root.destroyRecursively()
          },
        }
      },
    },
  ]
}

function createYogaLayoutReadScenario(nodeCount: number): ScenarioDefinition {
  return {
    name: `yoga_layout_reads_${nodeCount}`,
    description: `Read ${nodeCount} computed Yoga layouts through the production FFI path`,
    setup: async (ctx) => {
      clearRoot(ctx.renderer)
      resetBuffers(ctx.renderer)

      const root = new BoxRenderable(ctx.renderer, {
        id: `bench-yoga-layout-root-${nodeCount}`,
        width: "100%",
        flexDirection: "column",
      })
      ctx.renderer.root.add(root)

      const nodes = Array.from({ length: nodeCount }, (_, index) => {
        const node = new BoxRenderable(ctx.renderer, {
          id: `bench-yoga-layout-node-${nodeCount}-${index}`,
          width: "100%",
          height: 1,
          flexShrink: 0,
        })
        root.add(node)
        return node.getLayoutNode()
      })

      await ctx.renderOnce()

      return {
        renderablesPerIteration: nodeCount,
        layoutOnlyBoxesPerIteration: nodeCount,
        runIteration: async () => {
          benchmarkChecksum = (benchmarkChecksum + readLayoutChecksum(nodes)) >>> 0
        },
        teardown: () => root.destroyRecursively(),
      }
    },
  }
}

type LayoutReader = { getComputedLayout: () => { left: number; top: number; width: number; height: number } }

function readLayoutChecksum(nodes: readonly LayoutReader[]): number {
  let checksum = 0
  // Keep the hot call site bounded so Node optimizes the same loop regardless
  // of the total fixture size or unrelated bundle-shape changes.
  for (let chunkStart = 0; chunkStart < nodes.length; chunkStart += 1000) {
    checksum += readLayoutChunk(nodes, chunkStart, Math.min(chunkStart + 1000, nodes.length))
  }
  return checksum
}

function readLayoutChunk(nodes: readonly LayoutReader[], start: number, end: number): number {
  let checksum = 0
  for (let index = start; index < end; index++) {
    const layout = nodes[index]!.getComputedLayout()
    checksum += layout.left + layout.top + layout.width + layout.height + index
  }
  return checksum
}

// Frame-time scaling with total child count under viewport culling, at a
// constant visible count (~viewport height). This is the per-frame
// O(total children) layout-refresh path in Renderable.updateLayout for
// _hasVisibleChildFilter parents: before culling can read screen positions,
// every child gets one updateFromLayout (FFI getComputedLayout) per frame,
// so steady-state frame time grows with hidden children. Watch
// approxUsPerRenderable across the scaling scenarios: roughly constant means
// the per-frame cost is linear in total children; if the refresh path ever
// becomes O(visible), it should drop as childCount grows.
function createCullingScalingScenario(childCount: number): ScenarioDefinition {
  return {
    name: `scrollbox_culling_scaling_${childCount}`,
    description: `Scrolling viewport-culled scrollbox with ${childCount} rows, constant visible count`,
    setup: async (ctx) => {
      clearRoot(ctx.renderer)
      resetBuffers(ctx.renderer)

      let renderables = 0
      let layoutOnlyBoxes = 0

      const root = new BoxRenderable(ctx.renderer, {
        id: `bench-culling-scaling-root-${childCount}`,
        width: "100%",
        height: "100%",
        border: false,
        backgroundColor: COLORS.transparent,
      })
      renderables += 1
      layoutOnlyBoxes += 1
      ctx.renderer.root.add(root)

      const scrollBox = new ScrollBoxRenderable(ctx.renderer, {
        id: `bench-culling-scaling-scrollbox-${childCount}`,
        width: "100%",
        height: "100%",
        viewportCulling: true,
      })
      renderables += 1
      layoutOnlyBoxes += 1
      root.add(scrollBox)

      for (let i = 0; i < childCount; i += 1) {
        const row = new BoxRenderable(ctx.renderer, {
          id: `bench-culling-scaling-row-${i}`,
          width: "100%",
          height: 1,
          flexShrink: 0,
          border: false,
          backgroundColor: i % 2 === 0 ? COLORS.panel : COLORS.element,
        })
        renderables += 1
        scrollBox.add(row)
      }

      await ctx.renderOnce()
      scrollBox.scrollTo(Math.floor(childCount / 2))
      await ctx.renderOnce()

      return {
        renderablesPerIteration: renderables,
        layoutOnlyBoxesPerIteration: layoutOnlyBoxes,
        runIteration: async (iteration) => {
          // Alternate 1-row scrolls: every frame is a real translate change
          // (the steady-state streaming/scrolling workload) while the visible
          // count stays constant and the position returns home every 2 frames.
          scrollBox.scrollBy(iteration % 2 === 0 ? 1 : -1)
          await ctx.renderOnce()
        },
        teardown: () => {
          root.destroyRecursively()
        },
      }
    },
  }
}

function createSpinnerScenario(kind: SpinnerScenarioKind): ScenarioDefinition {
  const names: Record<SpinnerScenarioKind, string> = {
    noop: "spinner_complex_noop",
    bottom: "spinner_bottom_tick",
    "history-one": "spinner_history_one_tick",
    "mixed-three": "spinner_mixed_three_tick",
    "history-four": "spinner_history_four_tick",
    "history-all": "spinner_history_all_tick",
    all: "spinner_all_tick",
    text: "spinner_text_tick",
  }
  const descriptions: Record<SpinnerScenarioKind, string> = {
    noop: "Unchanged OpenCode-like screen containing nine paint spinners and one text spinner",
    bottom: "One-cell bottom spinner tick in an otherwise unchanged OpenCode-like screen",
    "history-one": "One of eight one-cell history spinners ticks in an unchanged message list",
    "mixed-three": "Bottom spinner and two one-cell history spinners tick together",
    "history-four": "Four one-cell history spinners on separate rows tick together",
    "history-all": "Eight one-cell history spinners on separate rows tick together",
    all: "Eight history spinners and the bottom spinner tick together",
    text: "Same-width fixed one-cell TextRenderable spinner tick without layout invalidation",
  }

  return {
    name: names[kind],
    description: descriptions[kind],
    setup: async (ctx) => {
      const state = await buildSpinnerTree(ctx)
      const expectedCells =
        kind === "noop"
          ? 0
          : kind === "mixed-three"
            ? 3
            : kind === "history-four"
              ? 4
              : kind === "history-all"
                ? state.historySpinners.length
                : kind === "all"
                  ? 9
                  : 1

      const mutate = () => {
        state.nextFrame = (state.nextFrame + 1) % SPINNER_FRAMES.length
        switch (kind) {
          case "noop":
            return
          case "bottom":
            state.bottomSpinner.setFrame(state.nextFrame)
            return
          case "history-one":
            state.historySpinners[3]!.setFrame(state.nextFrame)
            return
          case "mixed-three":
            state.historySpinners[2]!.setFrame(state.nextFrame)
            state.historySpinners[5]!.setFrame(state.nextFrame)
            state.bottomSpinner.setFrame(state.nextFrame)
            return
          case "history-four":
            for (const index of [1, 3, 5, 7]) state.historySpinners[index]!.setFrame(state.nextFrame)
            return
          case "history-all":
            for (const spinner of state.historySpinners) spinner.setFrame(state.nextFrame)
            return
          case "all":
            for (const spinner of state.historySpinners) spinner.setFrame(state.nextFrame)
            state.bottomSpinner.setFrame(state.nextFrame)
            return
          case "text":
            state.textSpinner.content = SPINNER_FRAMES[state.nextFrame]
        }
      }

      const validate = async () => {
        if (Boolean(ctx.renderer.root.getLayoutNode().isDirty())) {
          throw new Error(`${names[kind]} started validation with dirty Yoga`)
        }

        mutate()
        const layoutDirty = Boolean(ctx.renderer.root.getLayoutNode().isDirty())
        if (layoutDirty) {
          throw new Error(`${names[kind]} Yoga dirtiness mismatch: ${layoutDirty}`)
        }

        await ctx.renderOnce()
        const cellsUpdated = ctx.renderer.getNativeStats().cellsUpdated
        if (cellsUpdated !== expectedCells) {
          throw new Error(`${names[kind]} expected ${expectedCells} changed cells, got ${cellsUpdated}`)
        }
        if (Boolean(ctx.renderer.root.getLayoutNode().isDirty())) {
          throw new Error(`${names[kind]} left Yoga dirty after rendering`)
        }
        const incrementalFrame = copyBuffer(ctx.renderer.currentRenderBuffer)
        benchmarkChecksum = (benchmarkChecksum ^ hashCopiedBuffer(incrementalFrame)) >>> 0

        invalidateRoot(ctx.renderer.root)
        await ctx.renderOnce()
        assertBufferEquals(names[kind], incrementalFrame, ctx.renderer.currentRenderBuffer)
      }

      return {
        renderablesPerIteration: state.stats.renderables,
        layoutOnlyBoxesPerIteration: state.stats.layoutOnlyBoxes,
        runIteration: async () => {
          mutate()
          if (forceFullComposition) invalidateRoot(ctx.renderer.root)
          await ctx.renderOnce()
        },
        validate,
        teardown: () => state.root.destroyRecursively(),
      }
    },
  }
}

async function buildSpinnerTree(ctx: BenchmarkContext): Promise<SpinnerTreeState> {
  clearRoot(ctx.renderer)
  resetBuffers(ctx.renderer)

  let renderables = 0
  let layoutOnlyBoxes = 0
  const historySpinners: BenchmarkSpinnerRenderable[] = []

  const layoutBox = (options: ConstructorParameters<typeof BoxRenderable>[1]): BoxRenderable => {
    renderables += 1
    layoutOnlyBoxes += 1
    return new BoxRenderable(ctx.renderer, options)
  }
  const visualBox = (options: ConstructorParameters<typeof BoxRenderable>[1]): BoxRenderable => {
    renderables += 1
    return new BoxRenderable(ctx.renderer, options)
  }
  const text = (options: ConstructorParameters<typeof TextRenderable>[1]): TextRenderable => {
    renderables += 1
    return new TextRenderable(ctx.renderer, options)
  }
  const spinner = (id: string): BenchmarkSpinnerRenderable => {
    renderables += 1
    return new BenchmarkSpinnerRenderable(ctx.renderer, id)
  }

  const root = visualBox({
    id: "bench-spinner-root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: COLORS.panel,
  })
  ctx.renderer.root.add(root)

  const header = visualBox({
    id: "bench-spinner-header",
    width: "100%",
    height: 3,
    flexShrink: 0,
    flexDirection: "row",
    gap: 1,
    paddingLeft: 1,
    paddingRight: 1,
    backgroundColor: COLORS.menu,
  })
  root.add(header)
  header.add(text({ id: "bench-spinner-title", content: "OpenCode session", width: 18, height: 1 }))
  for (let index = 0; index < 7; index += 1) {
    const chip = layoutBox({
      id: `bench-spinner-header-chip-${index}`,
      width: 10,
      height: 1,
      flexShrink: 0,
      paddingLeft: 1,
      paddingRight: 1,
    })
    chip.add(text({ id: `bench-spinner-header-chip-text-${index}`, content: `chip-${index}`, width: 8, height: 1 }))
    header.add(chip)
  }

  const body = layoutBox({
    id: "bench-spinner-body",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
  })
  root.add(body)

  const sidebar = visualBox({
    id: "bench-spinner-sidebar",
    width: 22,
    minWidth: 22,
    maxWidth: 22,
    flexShrink: 0,
    flexDirection: "column",
    backgroundColor: COLORS.menu,
    paddingLeft: 1,
    paddingRight: 1,
  })
  body.add(sidebar)
  for (let index = 0; index < 14; index += 1) {
    const row = layoutBox({ id: `bench-spinner-sidebar-row-${index}`, width: "100%", height: 2, flexShrink: 0 })
    row.add(text({ id: `bench-spinner-sidebar-text-${index}`, content: `session-${index}`, width: 18, height: 1 }))
    sidebar.add(row)
  }

  const main = layoutBox({
    id: "bench-spinner-main",
    flexGrow: 1,
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
  })
  body.add(main)

  const messages = new ScrollBoxRenderable(ctx.renderer, {
    id: "bench-spinner-messages",
    width: "100%",
    flexGrow: 1,
    viewportCulling: true,
    scrollY: true,
    backgroundColor: COLORS.transparent,
  })
  renderables += 6
  layoutOnlyBoxes += 6
  main.add(messages)

  for (let index = 0; index < 8; index += 1) {
    const message = visualBox({
      id: `bench-spinner-message-${index}`,
      width: "100%",
      height: 4,
      flexShrink: 0,
      flexDirection: "row",
      backgroundColor: index % 2 === 0 ? COLORS.element : COLORS.panel,
    })
    const rail = visualBox({
      id: `bench-spinner-message-rail-${index}`,
      width: 2,
      minWidth: 2,
      maxWidth: 2,
      flexShrink: 0,
      backgroundColor: index % 2 === 0 ? COLORS.accent : COLORS.warning,
    })
    const content = layoutBox({
      id: `bench-spinner-message-content-${index}`,
      flexGrow: 1,
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
    })
    const meta = layoutBox({
      id: `bench-spinner-message-meta-${index}`,
      width: "100%",
      height: 1,
      flexShrink: 0,
      flexDirection: "row",
      justifyContent: "space-between",
    })
    const badges = layoutBox({
      id: `bench-spinner-message-badges-${index}`,
      width: 32,
      height: 1,
      flexShrink: 0,
      flexDirection: "row",
      gap: 1,
    })
    badges.add(
      text({
        id: `bench-spinner-role-${index}`,
        content: index % 2 === 0 ? "assistant" : "tool",
        width: 10,
        height: 1,
      }),
    )
    badges.add(text({ id: `bench-spinner-time-${index}`, content: `${index + 1}ms`, width: 8, height: 1 }))

    const actions = layoutBox({
      id: `bench-spinner-message-actions-${index}`,
      width: 8,
      height: 1,
      flexShrink: 0,
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 1,
    })
    const historySpinner = spinner(`bench-spinner-history-${index}`)
    historySpinners.push(historySpinner)
    actions.add(historySpinner)
    actions.add(text({ id: `bench-spinner-action-${index}`, content: "ok", width: 2, height: 1 }))
    meta.add(badges)
    meta.add(actions)

    const messageBody = layoutBox({
      id: `bench-spinner-message-body-${index}`,
      width: "100%",
      height: 2,
      flexShrink: 0,
      flexDirection: "column",
    })
    messageBody.add(
      text({
        id: `bench-spinner-message-text-${index}`,
        content: `Message ${index}: cached markdown, tool output, and session history remain unchanged.`,
        width: "100%",
        height: 1,
      }),
    )
    const detail = layoutBox({
      id: `bench-spinner-message-detail-${index}`,
      width: "100%",
      height: 1,
      flexShrink: 0,
      flexDirection: "row",
      gap: 1,
    })
    for (let detailIndex = 0; detailIndex < 4; detailIndex += 1) {
      detail.add(
        text({
          id: `bench-spinner-message-detail-${index}-${detailIndex}`,
          content: `d${detailIndex}`,
          width: 3,
          height: 1,
        }),
      )
    }
    messageBody.add(detail)
    content.add(meta)
    content.add(messageBody)
    message.add(rail)
    message.add(content)
    messages.add(message)
  }

  const footer = visualBox({
    id: "bench-spinner-footer",
    width: "100%",
    height: 4,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
    paddingLeft: 1,
    paddingRight: 1,
    backgroundColor: COLORS.element,
  })
  root.add(footer)
  const bottomSpinner = spinner("bench-spinner-bottom")
  footer.add(bottomSpinner)
  footer.add(text({ id: "bench-spinner-footer-status", content: "Working", width: 10, height: 1 }))
  const textSpinner = text({ id: "bench-spinner-text", content: SPINNER_FRAMES[0], width: 1, height: 1 })
  footer.add(textSpinner)
  for (let index = 0; index < 6; index += 1) {
    const item = layoutBox({
      id: `bench-spinner-footer-item-${index}`,
      width: 10,
      height: 1,
      flexShrink: 0,
      flexDirection: "row",
    })
    item.add(text({ id: `bench-spinner-footer-item-text-${index}`, content: `item-${index}`, width: 8, height: 1 }))
    footer.add(item)
  }

  let settled = false
  for (let pass = 0; pass < 8; pass += 1) {
    await ctx.renderOnce()
    if (!Boolean(ctx.renderer.root.getLayoutNode().isDirty()) && ctx.renderer.getNativeStats().cellsUpdated === 0) {
      settled = true
      break
    }
  }
  if (!settled) throw new Error("spinner benchmark fixture did not settle to a no-op frame")

  return {
    root,
    historySpinners,
    bottomSpinner,
    textSpinner,
    stats: { renderables, layoutOnlyBoxes },
    nextFrame: 0,
  }
}

type CopiedBuffer = {
  char: Uint32Array
  fg: Uint16Array
  bg: Uint16Array
  attributes: Uint32Array
}

function copyBuffer(buffer: OptimizedBuffer): CopiedBuffer {
  const { char, fg, bg, attributes } = buffer.buffers
  return {
    char: char.slice(),
    fg: fg.slice(),
    bg: bg.slice(),
    attributes: attributes.slice(),
  }
}

function hashCopiedBuffer(buffer: CopiedBuffer): number {
  let hash = 2166136261
  const update = (value: number) => {
    hash = Math.imul(hash ^ value, 16777619)
  }
  for (const value of buffer.char) update(value)
  for (const value of buffer.fg) update(value)
  for (const value of buffer.bg) update(value)
  for (const value of buffer.attributes) update(value)
  return hash >>> 0
}

function assertBufferEquals(name: string, expected: CopiedBuffer, actualBuffer: OptimizedBuffer): void {
  const actual = actualBuffer.buffers
  for (const channel of ["char", "fg", "bg", "attributes"] as const) {
    const expectedValues = expected[channel]
    const actualValues = actual[channel]
    if (expectedValues.length !== actualValues.length) {
      throw new Error(`${name} ${channel} length mismatch: ${expectedValues.length} !== ${actualValues.length}`)
    }
    for (let index = 0; index < expectedValues.length; index++) {
      if (expectedValues[index] !== actualValues[index]) {
        throw new Error(`${name} ${channel} mismatch at ${index}: ${expectedValues[index]} !== ${actualValues[index]}`)
      }
    }
  }
}

function invalidateRoot(root: TestRenderer["root"], renderable?: Renderable): void {
  ;(root as unknown as { invalidate?: (source?: Renderable) => void }).invalidate?.(renderable)
}

async function buildOpencodeLayoutTree(ctx: BenchmarkContext, options: LayoutTreeOptions): Promise<LayoutTreeState> {
  clearRoot(ctx.renderer)
  resetBuffers(ctx.renderer)

  let renderables = 0
  let layoutOnlyBoxes = 0

  const trackLayoutBox = (box: BoxRenderable): BoxRenderable => {
    renderables += 1
    layoutOnlyBoxes += 1
    return box
  }

  const trackVisualBox = (box: BoxRenderable): BoxRenderable => {
    renderables += 1
    return box
  }

  const trackText = (text: TextRenderable): TextRenderable => {
    renderables += 1
    return text
  }

  const root = trackLayoutBox(
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
    header.add(
      trackLayoutBox(
        new BoxRenderable(ctx.renderer, {
          id: `bench-layout-chip-${i}`,
          flexShrink: 0,
          paddingLeft: 1,
          paddingRight: 1,
        }),
      ),
    )
  }

  const body = trackLayoutBox(
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
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-row-${i}`,
        width: "100%",
        flexDirection: "row",
      }),
    )

    const rail = trackLayoutBox(
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-rail-${i}`,
        width: 3,
        minWidth: 3,
        maxWidth: 3,
        flexShrink: 0,
      }),
    )

    const content = trackLayoutBox(
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-content-${i}`,
        flexGrow: 1,
        flexDirection: "column",
      }),
    )

    const meta = trackLayoutBox(
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-meta-${i}`,
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between",
      }),
    )

    const badges = trackLayoutBox(
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-badges-${i}`,
        flexDirection: "row",
        gap: 1,
      }),
    )

    const actions = trackLayoutBox(
      new BoxRenderable(ctx.renderer, {
        id: `bench-layout-actions-${i}`,
        flexDirection: "row",
        gap: 1,
        flexShrink: 0,
      }),
    )

    meta.add(badges)
    meta.add(actions)
    content.add(meta)

    if (options.includeVisibleBoxes) {
      content.add(
        trackVisualBox(
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
          new TextRenderable(ctx.renderer, {
            id: `bench-layout-text-${i}`,
            content: `message-${i}`,
          }),
        ),
      )
    }

    row.add(rail)
    row.add(content)
    main.add(row)
  }

  const footer = trackLayoutBox(
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
    footer.add(
      trackLayoutBox(
        new BoxRenderable(ctx.renderer, {
          id: `bench-layout-footer-item-${i}`,
          flexDirection: "row",
          gap: 1,
        }),
      ),
    )
  }

  await ctx.renderOnce()

  return {
    root,
    stats: {
      renderables,
      layoutOnlyBoxes,
    },
  }
}

async function runScenario(
  scenario: ScenarioDefinition,
  ctx: BenchmarkContext,
  iterations: number,
  warmupIterations: number,
): Promise<ScenarioResult> {
  const runtime = await scenario.setup(ctx)

  try {
    await runtime.validate?.()

    for (let i = 0; i < warmupIterations; i += 1) {
      await runtime.runIteration(i)
    }

    const samples = new Array<number>(iterations)
    const elapsedStart = performance.now()

    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now()
      await runtime.runIteration(i)
      samples[i] = performance.now() - start
    }

    const elapsedMs = performance.now() - elapsedStart
    const stats = calculateStats(samples)

    await runtime.validate?.()

    return {
      name: scenario.name,
      description: scenario.description,
      iterations,
      warmupIterations,
      elapsedMs: round(elapsedMs, 4),
      renderablesPerIteration: runtime.renderablesPerIteration,
      layoutOnlyBoxesPerIteration: runtime.layoutOnlyBoxesPerIteration,
      avgMs: round(stats.avgMs, 4),
      medianMs: round(stats.medianMs, 4),
      p95Ms: round(stats.p95Ms, 4),
      minMs: round(stats.minMs, 4),
      maxMs: round(stats.maxMs, 4),
      stdDevMs: round(stats.stdDevMs, 4),
      rsdPercent: round(stats.rsdPercent, 2),
      rmePercent: round(stats.rmePercent, 2),
      approxUsPerRenderable:
        runtime.renderablesPerIteration > 0 ? round((stats.avgMs * 1000) / runtime.renderablesPerIteration, 3) : 0,
    }
  } finally {
    await runtime.teardown?.()
    clearRoot(ctx.renderer)
    resetBuffers(ctx.renderer)
  }
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

function calculateStats(samples: number[]): TimingStats {
  if (samples.length === 0) {
    return {
      avgMs: 0,
      medianMs: 0,
      p95Ms: 0,
      minMs: 0,
      maxMs: 0,
      stdDevMs: 0,
      rsdPercent: 0,
      rmePercent: 0,
    }
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const total = samples.reduce((sum, value) => sum + value, 0)
  const avgMs = total / samples.length
  const mid = Math.floor(sorted.length / 2)
  const medianMs = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  const p95Index = Math.floor((sorted.length - 1) * 0.95)
  const p95Ms = sorted[p95Index]
  const minMs = sorted[0]
  const maxMs = sorted[sorted.length - 1]

  let variance = 0
  for (const value of samples) {
    const diff = value - avgMs
    variance += diff * diff
  }
  variance /= samples.length

  return {
    avgMs,
    medianMs,
    p95Ms,
    minMs,
    maxMs,
    stdDevMs: Math.sqrt(variance),
    rsdPercent: avgMs === 0 ? 0 : (Math.sqrt(variance) / avgMs) * 100,
    rmePercent: relativeMarginOfError(samples, avgMs),
  }
}

// 95% confidence relative margin of error via Student-t, matching the
// convention in layout-benchmark.ts.
function relativeMarginOfError(samples: readonly number[], average: number): number {
  if (samples.length <= 1 || average === 0) {
    return 0
  }

  let variance = 0
  for (const value of samples) {
    const diff = value - average
    variance += diff * diff
  }
  variance /= samples.length - 1

  const sem = Math.sqrt(variance) / Math.sqrt(samples.length)
  return Math.abs((sem * tCritical95(samples.length - 1) * 100) / average)
}

function tCritical95(degreesOfFreedom: number): number {
  const table = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228]
  if (degreesOfFreedom <= 0) {
    return 0
  }

  return table[degreesOfFreedom - 1] ?? 1.96
}

function round(value: number, places: number): number {
  return Number(value.toFixed(places))
}

function toNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function writeLine(enabled: boolean, line: string): void {
  if (enabled) {
    console.log(line)
  }
}
