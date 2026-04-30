import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { BoxRenderable, type KeyEvent, type Renderable } from "@opentui/core"
import { createTestRenderer, type MockInput, type TestRenderer } from "@opentui/core/testing"
import * as addons from "./addons/index.js"
import {
  formatCommandBindings,
  formatKeySequence,
  resolveBindingSections,
  type BindingValue,
  type SequenceBindingLike,
} from "./extras/index.js"
import { type BindingParser, type Keymap, type ReactiveMatcher } from "./index.js"
import { createDefaultOpenTuiKeymap as getKeymap } from "./opentui.js"

const DEFAULT_ITERATIONS = 20_000
const DEFAULT_WARMUP = 2_000
const DEFAULT_ROUNDS = 5
const DEFAULT_MIN_SAMPLE_MS = 250
const KEY_POOL = "abcdefghijklmnopqrstuvwxyz0123456789"

interface BenchmarkArgs {
  iterations: number
  warmupIterations: number
  rounds: number
  minSampleMs: number
  scenarioNames?: Set<string>
  jsonPath?: string
}

interface ScenarioResources {
  renderer: TestRenderer
  mockInput: MockInput
  keymap: OpenTuiKeymap
}

interface ScenarioInstance {
  resources: ScenarioResources
  runIteration?: () => void
  runIterationAsync?: () => Promise<void>
  cleanup: () => void
}

type OpenTuiKeymap = Keymap<Renderable, KeyEvent>

interface BenchmarkScenario {
  name: string
  description: string
  setup: () => Promise<ScenarioInstance>
}

interface BenchmarkSample {
  round: number
  durationMs: number
  opsPerSecond: number
}

interface BenchmarkResult {
  name: string
  description: string
  iterations: number
  warmupIterations: number
  rounds: number
  measuredIterations: number
  medianDurationMs: number
  bestDurationMs: number
  medianOpsPerSecond: number
  samples: BenchmarkSample[]
}

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
  let scenarioNames: Set<string> | undefined
  let jsonPath: string | undefined

  for (const arg of argv) {
    if (arg.startsWith("--iterations=")) {
      iterations = parseNumberArg(arg.slice("--iterations=".length), DEFAULT_ITERATIONS)
      continue
    }

    if (arg.startsWith("--warmup=")) {
      warmupIterations = parseNumberArg(arg.slice("--warmup=".length), DEFAULT_WARMUP)
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
      jsonPath = arg.slice("--json=".length)
    }
  }

  return {
    iterations,
    warmupIterations,
    rounds,
    minSampleMs,
    scenarioNames,
    jsonPath,
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

function roundIterations(value: number): number {
  if (value <= 1_000) {
    return Math.max(1, Math.ceil(value))
  }

  if (value <= 10_000) {
    return Math.ceil(value / 10) * 10
  }

  if (value <= 100_000) {
    return Math.ceil(value / 100) * 100
  }

  return Math.ceil(value / 1_000) * 1_000
}

function createFocusableBox(renderer: TestRenderer, id: string): BoxRenderable {
  return new BoxRenderable(renderer, {
    id,
    width: 10,
    height: 4,
    focusable: true,
  })
}

function createKey(index: number): string {
  return KEY_POOL[index % KEY_POOL.length] ?? "x"
}

const noopBindingParser: BindingParser = () => undefined

function createBracketTokenParser(): BindingParser {
  return ({ input, index, tokens, normalizeTokenName, parseObjectKey }) => {
    if (input[index] !== "[") {
      return undefined
    }

    const end = input.indexOf("]", index)
    if (end === -1) {
      throw new Error(`Invalid key sequence "${input}": unterminated token`)
    }

    const tokenName = normalizeTokenName(input.slice(index, end + 1))
    const token = tokens.get(tokenName)
    if (!token) {
      return { parts: [], nextIndex: end + 1, unknownTokens: [tokenName] }
    }

    return {
      parts: [parseObjectKey(token.stroke, { display: tokenName, match: token.match, tokenName })],
      nextIndex: end + 1,
      usedTokens: [tokenName],
    }
  }
}

function registerGlobalLayers(keymap: OpenTuiKeymap, count: number, cmd = "noop"): void {
  for (let index = 0; index < count; index += 1) {
    keymap.registerLayer({
      priority: index % 3,
      bindings: [{ key: createKey(index), cmd }],
    })
  }
}

function registerTargetLayer(
  keymap: OpenTuiKeymap,
  target: BoxRenderable,
  index: number,
  key = createKey(index),
  cmd = "noop",
): void {
  keymap.registerLayer({
    target,
    targetMode: index % 2 === 0 ? "focus-within" : "focus",
    priority: index % 4,
    bindings: [{ key, cmd }],
  })
}

function registerModeBindingFields(keymap: OpenTuiKeymap): void {
  keymap.registerBindingFields({
    mode(value, ctx) {
      ctx.require("vim.mode", value)
    },
    state(value, ctx) {
      ctx.require("vim.state", value)
    },
  })
}

function registerModeLayerFields(keymap: OpenTuiKeymap): void {
  keymap.registerLayerFields({
    mode(value, ctx) {
      ctx.require("vim.mode", value)
    },
    state(value, ctx) {
      ctx.require("vim.state", value)
    },
  })
}

function registerModeCommandFields(keymap: OpenTuiKeymap): void {
  keymap.registerCommandFields({
    mode(value, ctx) {
      ctx.require("vim.mode", value)
    },
    state(value, ctx) {
      ctx.require("vim.state", value)
    },
  })
}

function normalizeFlagKey(value: unknown, source: string): string {
  if (typeof value !== "string") {
    throw new Error(`${source} must be a string`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${source} cannot be empty`)
  }

  return trimmed
}

function registerNamedBindingFields(keymap: OpenTuiKeymap): void {
  keymap.registerBindingFields({
    activeWhen(value, ctx) {
      ctx.require(normalizeFlagKey(value, "binding field activeWhen"), true)
    },
  })
}

function registerNamedLayerFields(keymap: OpenTuiKeymap): void {
  keymap.registerLayerFields({
    activeWhen(value, ctx) {
      ctx.require(normalizeFlagKey(value, "layer field activeWhen"), true)
    },
  })
}

function createFlagKey(index: number): string {
  return `flag-${index}`
}

// Per-key reactive flag store used to benchmark matcher subscriptions against
// the old keyed invalidation pattern.
interface FlagStore {
  flags: Record<string, boolean>
  listeners: Map<string, Set<() => void>>
  set(key: string, value: boolean): void
}

function createFlagStore(): FlagStore {
  const flags: Record<string, boolean> = Object.create(null)
  const listeners = new Map<string, Set<() => void>>()

  return {
    flags,
    listeners,
    set(key, value) {
      if (flags[key] === value) {
        return
      }
      flags[key] = value
      const bucket = listeners.get(key)
      if (!bucket) {
        return
      }
      for (const onChange of bucket) {
        onChange()
      }
    },
  }
}

function createFlagMatcher(store: FlagStore, key: string): ReactiveMatcher {
  return {
    get: () => store.flags[key] === true,
    subscribe(onChange) {
      let bucket = store.listeners.get(key)
      if (!bucket) {
        bucket = new Set()
        store.listeners.set(key, bucket)
      }
      bucket.add(onChange)
      return () => {
        const current = store.listeners.get(key)
        if (!current) {
          return
        }
        current.delete(onChange)
        if (current.size === 0) {
          store.listeners.delete(key)
        }
      }
    },
  }
}

function registerExternalBindingFields(keymap: OpenTuiKeymap, store: FlagStore): void {
  keymap.registerBindingFields({
    activeExternally(value, ctx) {
      const key = normalizeFlagKey(value, "binding field activeExternally")
      ctx.activeWhen(createFlagMatcher(store, key))
    },
  })
}

function registerStateChangeNoopListener(keymap: OpenTuiKeymap): () => void {
  let events = 0

  return keymap.on("state", () => {
    events += 1
  })
}

function registerStateChangeReadListeners(keymap: OpenTuiKeymap): () => void {
  let sink = 0

  const offActiveKeys = keymap.on("state", () => {
    sink += keymap.getActiveKeys().length
  })
  const offPendingSequence = keymap.on("state", () => {
    sink += keymap.getPendingSequence().length
  })

  return () => {
    offPendingSequence()
    offActiveKeys()
    void sink
  }
}

function registerStateChangeMetadataListeners(keymap: OpenTuiKeymap): () => void {
  let sink = 0

  const offActiveKeys = keymap.on("state", () => {
    sink += keymap.getActiveKeys({ includeMetadata: true }).length
  })
  const offPendingSequence = keymap.on("state", () => {
    sink += keymap.getPendingSequence().length
  })

  return () => {
    offPendingSequence()
    offActiveKeys()
    void sink
  }
}

function registerStateChangeBindingListeners(keymap: OpenTuiKeymap): () => void {
  let sink = 0

  const offActiveKeys = keymap.on("state", () => {
    sink += keymap.getActiveKeys({ includeBindings: true }).length
  })
  const offPendingSequence = keymap.on("state", () => {
    sink += keymap.getPendingSequence().length
  })

  return () => {
    offPendingSequence()
    offActiveKeys()
    void sink
  }
}

function readActiveKeysRepeatedly(keymap: OpenTuiKeymap, count: number): void {
  for (let index = 0; index < count; index += 1) {
    keymap.getActiveKeys()
  }
}

function readActiveKeysWithMetadataRepeatedly(keymap: OpenTuiKeymap, count: number): void {
  for (let index = 0; index < count; index += 1) {
    keymap.getActiveKeys({ includeMetadata: true })
  }
}

function readActiveKeysWithBindingsRepeatedly(keymap: OpenTuiKeymap, count: number): void {
  for (let index = 0; index < count; index += 1) {
    keymap.getActiveKeys({ includeBindings: true })
  }
}

function readPendingSequencePartsRepeatedly(keymap: OpenTuiKeymap, count: number): void {
  for (let index = 0; index < count; index += 1) {
    keymap.getPendingSequence()
  }
}

function setupStateChangeFocusChurn(resources: ScenarioResources): {
  first: BoxRenderable
  second: BoxRenderable
} {
  const first = createFocusableBox(resources.renderer, "state-focus-first")
  const second = createFocusableBox(resources.renderer, "state-focus-second")

  resources.renderer.root.add(first)
  resources.renderer.root.add(second)

  for (let index = 0; index < 8; index += 1) {
    registerTargetLayer(resources.keymap, first, index, createKey(index + 1))
    registerTargetLayer(resources.keymap, second, index + 100, createKey(index + 11))
  }

  registerGlobalLayers(resources.keymap, 120)

  return { first, second }
}

function setupMetadataFocusTree(resources: ScenarioResources): BoxRenderable[] {
  const commands = Array.from({ length: 36 + 300 + 150 }, (_, index) => ({
    name: `metadata-command-${index}`,
    title: `Action ${index}`,
    desc: `Action ${index}`,
    run() {},
  }))

  resources.keymap.registerLayer({ commands: commands })

  const focusChain = createFocusTree(resources, 6)
  let commandIndex = 0

  for (let index = 0; index < focusChain.length; index += 1) {
    const target = focusChain[index]
    if (!target) {
      continue
    }

    for (let layerIndex = 0; layerIndex < 6; layerIndex += 1) {
      resources.keymap.registerLayer({
        target,
        targetMode: index % 2 === 0 ? "focus-within" : "focus",
        priority: layerIndex % 4,
        bindings: [
          {
            key: createKey(index * 10 + layerIndex),
            cmd: `metadata-command-${commandIndex}`,
            desc: `Binding ${commandIndex}`,
            group: `Panel ${index}`,
          },
        ],
      })

      commandIndex += 1
    }
  }

  for (let index = 0; index < 300; index += 1) {
    const sibling = createFocusableBox(resources.renderer, `metadata-sibling-${index}`)
    resources.renderer.root.add(sibling)
    resources.keymap.registerLayer({
      target: sibling,
      targetMode: index % 2 === 0 ? "focus-within" : "focus",
      priority: index % 4,
      bindings: [
        {
          key: createKey(index + 4000),
          cmd: `metadata-command-${commandIndex}`,
          desc: `Binding ${commandIndex}`,
          group: "Sibling",
        },
      ],
    })
    commandIndex += 1
  }

  for (let index = 0; index < 150; index += 1) {
    resources.keymap.registerLayer({
      priority: index % 3,
      bindings: [
        {
          key: createKey(index + 8000),
          cmd: `metadata-command-${commandIndex}`,
          desc: `Binding ${commandIndex}`,
          group: "Global",
        },
      ],
    })
    commandIndex += 1
  }

  return focusChain
}

async function createScenarioResources(): Promise<ScenarioResources> {
  const testSetup = await createTestRenderer({ width: 80, height: 24 })
  const keymap = getKeymap(testSetup.renderer)
  keymap.registerLayer({
    commands: [
      {
        name: "noop",
        run() {},
      },
    ],
  })

  return {
    renderer: testSetup.renderer,
    mockInput: testSetup.mockInput,
    keymap,
  }
}

function createFocusTree(resources: ScenarioResources, depth: number): BoxRenderable[] {
  const chain: BoxRenderable[] = []
  let parent: { add(child: BoxRenderable): void } = resources.renderer.root

  for (let index = 0; index < depth; index += 1) {
    const node = createFocusableBox(resources.renderer, `focus-${index}`)
    parent.add(node)
    chain.push(node)
    parent = node
  }

  chain.at(-1)?.focus()
  return chain
}

const scenarios: BenchmarkScenario[] = [
  {
    name: "compile_layer_default_parser",
    description: "Repeated layer registration using the default binding parser",
    async setup() {
      const resources = await createScenarioResources()
      resources.keymap.registerToken({ name: "<leader>", key: { name: "x", ctrl: true } })

      return {
        resources,
        runIteration() {
          const off = resources.keymap.registerLayer({
            bindings: [{ key: "g<leader>d", cmd: "noop" }],
          })
          off()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "compile_layer_default_parser_with_local_commands",
    description: "Repeated layer registration with per-layer commands compiled on mount",
    async setup() {
      const resources = await createScenarioResources()
      resources.keymap.registerToken({ name: "<leader>", key: { name: "x", ctrl: true } })

      return {
        resources,
        runIteration() {
          const off = resources.keymap.registerLayer({
            commands: [
              {
                name: "bench-local",
                run() {},
              },
            ],
            bindings: [{ key: "g<leader>d", cmd: "bench-local" }],
          })
          off()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "compile_layer_many_noop_parsers",
    description: "Repeated layer registration with many no-op parsers ahead of default",
    async setup() {
      const resources = await createScenarioResources()
      resources.keymap.registerToken({ name: "<leader>", key: { name: "x", ctrl: true } })

      for (let index = 0; index < 32; index += 1) {
        resources.keymap.prependBindingParser(noopBindingParser)
      }

      return {
        resources,
        runIteration() {
          const off = resources.keymap.registerLayer({
            bindings: [{ key: "g<leader>d", cmd: "noop" }],
          })
          off()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "compile_layer_replaced_parser_chain",
    description: "Repeated layer registration after replacing the parser chain",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.clearBindingParsers()
      resources.keymap.appendBindingParser(createBracketTokenParser())
      resources.keymap.appendBindingParser(addons.defaultBindingParser)
      resources.keymap.registerToken({ name: "[leader]", key: { name: "x", ctrl: true } })

      return {
        resources,
        runIteration() {
          const off = resources.keymap.registerLayer({
            bindings: [{ key: "g[leader]d", cmd: "noop" }],
          })
          off()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "register_commands_custom_fields",
    description: "Repeated command registration with compiled and raw custom fields",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerCommandFields({
        desc(value, ctx) {
          ctx.attr("desc", value)
        },
        title(value, ctx) {
          ctx.attr("title", value)
        },
        category(value, ctx) {
          ctx.attr("category", value)
        },
      })

      return {
        resources,
        runIteration() {
          const off = resources.keymap.registerLayer({
            commands: [
              {
                name: "bench-command",
                namespace: "bench",
                desc: "Write the current file",
                title: "Write File",
                category: "File",
                usage: ":write <file>",
                tags: ["file", "write"],
                run() {},
              },
            ],
          })

          off()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "register_commands_custom_fields_with_conditions",
    description: "Repeated command registration with compiled custom fields and command runtime conditions",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerCommandFields({
        desc(value, ctx) {
          ctx.attr("desc", value)
        },
        title(value, ctx) {
          ctx.attr("title", value)
        },
        category(value, ctx) {
          ctx.attr("category", value)
        },
        mode(value, ctx) {
          ctx.require("vim.mode", value)
        },
        state(value, ctx) {
          ctx.require("vim.state", value)
        },
      })

      return {
        resources,
        runIteration() {
          const off = resources.keymap.registerLayer({
            commands: [
              {
                name: "bench-command",
                namespace: "bench",
                desc: "Write the current file",
                title: "Write File",
                category: "File",
                usage: ":write <file>",
                tags: ["file", "write"],
                mode: "normal",
                state: "idle",
                run() {},
              },
            ],
          })

          off()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_commands_query",
    description: "Repeated command discovery with search and filter over raw fields and attrs",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerCommandFields({
        title(value, ctx) {
          ctx.attr("label", value)
        },
      })

      resources.keymap.registerLayer({
        commands: Array.from({ length: 512 }, (_, index) => ({
          name: `command-${index}`,
          namespace: index % 2 === 0 ? "bench" : "other",
          title: index % 4 === 0 ? `Write File ${index}` : `Open Buffer ${index}`,
          usage: index % 4 === 0 ? `:write file-${index}.txt` : `:open file-${index}.txt`,
          tags: index % 4 === 0 ? ["file", "write"] : ["file", "open"],
          run() {},
        })),
      })

      return {
        resources,
        runIteration() {
          resources.keymap.getCommands({
            search: "write",
            searchIn: ["name", "title", "usage", "label"],
            filter: {
              namespace: "bench",
              tags: "file",
            },
          })
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_commands_namespace_query",
    description: "Repeated command discovery with top-level namespace filtering",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerCommandFields({
        title(value, ctx) {
          ctx.attr("label", value)
        },
      })

      resources.keymap.registerLayer({
        commands: Array.from({ length: 512 }, (_, index) => ({
          name: `command-${index}`,
          namespace: index % 2 === 0 ? "bench" : "other",
          title: index % 4 === 0 ? `Write File ${index}` : `Open Buffer ${index}`,
          usage: index % 4 === 0 ? `:write file-${index}.txt` : `:open file-${index}.txt`,
          tags: index % 4 === 0 ? ["file", "write"] : ["file", "open"],
          run() {},
        })),
      })

      return {
        resources,
        runIteration() {
          resources.keymap.getCommands({
            namespace: "bench",
            filter: {
              tags: "file",
            },
          })
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_commands_query_function_filter",
    description: "Repeated command discovery with search and a full-record filter predicate",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerCommandFields({
        title(value, ctx) {
          ctx.attr("label", value)
        },
      })

      resources.keymap.registerLayer({
        commands: Array.from({ length: 512 }, (_, index) => ({
          name: `command-${index}`,
          namespace: index % 2 === 0 ? "bench" : "other",
          title: index % 4 === 0 ? `Write File ${index}` : `Open Buffer ${index}`,
          usage: index % 4 === 0 ? `:write file-${index}.txt` : `:open file-${index}.txt`,
          tags: index % 4 === 0 ? ["file", "write"] : ["file", "open"],
          run() {},
        })),
      })

      return {
        resources,
        runIteration() {
          resources.keymap.getCommands({
            search: "write",
            searchIn: ["name", "title", "usage", "label"],
            filter(command) {
              return (
                command.fields.namespace === "bench" &&
                Array.isArray(command.fields.tags) &&
                command.fields.tags.includes("file")
              )
            },
          })
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_commands_registered_query",
    description: "Repeated registered command discovery with namespace filtering",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerCommandFields({
        title(value, ctx) {
          ctx.attr("label", value)
        },
      })

      for (let layerIndex = 0; layerIndex < 64; layerIndex += 1) {
        resources.keymap.registerLayer({
          commands: Array.from({ length: 8 }, (_, index) => ({
            name: `command-${layerIndex}-${index}`,
            namespace: index % 2 === 0 ? "bench" : "other",
            title: `Command ${layerIndex}-${index}`,
            usage: `:${layerIndex}-${index}`,
            run() {},
          })),
        })
      }

      return {
        resources,
        runIteration() {
          resources.keymap.getCommands({ visibility: "registered", namespace: "bench" })
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_command_entries_query",
    description: "Repeated command-plus-binding discovery with search and filter over raw fields and attrs",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerCommandFields({
        title(value, ctx) {
          ctx.attr("label", value)
        },
      })

      resources.keymap.registerLayer({
        commands: Array.from({ length: 512 }, (_, index) => ({
          name: `command-${index}`,
          namespace: index % 2 === 0 ? "bench" : "other",
          title: index % 4 === 0 ? `Write File ${index}` : `Open Buffer ${index}`,
          usage: index % 4 === 0 ? `:write file-${index}.txt` : `:open file-${index}.txt`,
          tags: index % 4 === 0 ? ["file", "write"] : ["file", "open"],
          run() {},
        })),
        bindings: Array.from({ length: 512 }, (_, index) => ({
          key: createKey(index),
          cmd: `command-${index}`,
          desc: `Binding ${index}`,
        })),
      })

      return {
        resources,
        runIteration() {
          resources.keymap.getCommandEntries({
            search: "write",
            searchIn: ["name", "title", "usage", "label"],
            filter: {
              namespace: "bench",
              tags: "file",
            },
          })
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_command_entries_registered_query",
    description: "Repeated registered command-entry discovery with namespace filtering",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerCommandFields({
        title(value, ctx) {
          ctx.attr("label", value)
        },
      })

      for (let layerIndex = 0; layerIndex < 64; layerIndex += 1) {
        resources.keymap.registerLayer({
          commands: Array.from({ length: 8 }, (_, index) => ({
            name: `command-${layerIndex}-${index}`,
            namespace: index % 2 === 0 ? "bench" : "other",
            title: `Command ${layerIndex}-${index}`,
            usage: `:${layerIndex}-${index}`,
            run() {},
          })),
          bindings: Array.from({ length: 8 }, (_, index) => ({
            key: createKey(layerIndex * 8 + index),
            cmd: `command-${layerIndex}-${index}`,
          })),
        })
      }

      return {
        resources,
        runIteration() {
          resources.keymap.getCommandEntries({ visibility: "registered", namespace: "bench" })
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_command_entries_registered_command_filter",
    description: "Repeated registered command-entry discovery for a requested command set",
    async setup() {
      const resources = await createScenarioResources()
      const commands = Array.from({ length: 64 }, (_, index) => `command-${index}-0`)

      for (let layerIndex = 0; layerIndex < 64; layerIndex += 1) {
        resources.keymap.registerLayer({
          commands: Array.from({ length: 8 }, (_, index) => ({
            name: `command-${layerIndex}-${index}`,
            namespace: index % 2 === 0 ? "bench" : "other",
            title: `Command ${layerIndex}-${index}`,
            usage: `:${layerIndex}-${index}`,
            run() {},
          })),
          bindings: Array.from({ length: 8 }, (_, index) => ({
            key: createKey(layerIndex * 8 + index),
            cmd: `command-${layerIndex}-${index}`,
          })),
        })
      }

      return {
        resources,
        runIteration() {
          resources.keymap.getCommandEntries({ visibility: "registered", filter: { name: commands } })
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_command_bindings_registered_subset",
    description: "Repeated registered command-binding grouping for a requested command set",
    async setup() {
      const resources = await createScenarioResources()
      const commands = Array.from({ length: 64 }, (_, index) => `command-${index}-0`)

      for (let layerIndex = 0; layerIndex < 64; layerIndex += 1) {
        resources.keymap.registerLayer({
          commands: Array.from({ length: 8 }, (_, index) => ({
            name: `command-${layerIndex}-${index}`,
            namespace: index % 2 === 0 ? "bench" : "other",
            title: `Command ${layerIndex}-${index}`,
            usage: `:${layerIndex}-${index}`,
            run() {},
          })),
          bindings: Array.from({ length: 8 }, (_, index) => ({
            key: createKey(layerIndex * 8 + index),
            cmd: `command-${layerIndex}-${index}`,
          })),
        })
      }

      return {
        resources,
        runIteration() {
          resources.keymap.getCommandBindings({ visibility: "registered", commands })
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_command_entries_reachable_shadowed_bindings",
    description: "Repeated reachable command-entry discovery while shadowed commands share bindings by name",
    async setup() {
      const resources = await createScenarioResources()
      const focusChain = createFocusTree(resources, 4)
      const focusedTarget = focusChain.at(-1)
      if (!focusedTarget) {
        throw new Error("Expected focused target for reachable command-entry benchmark")
      }

      resources.keymap.registerLayer({
        commands: Array.from({ length: 128 }, (_, index) => ({
          name: `command-${index}`,
          title: `Global ${index}`,
          run() {},
        })),
        bindings: Array.from({ length: 128 }, (_, index) => ({
          key: createKey(index),
          cmd: `command-${index}`,
        })),
      })

      resources.keymap.registerLayer({
        target: focusedTarget,
        commands: Array.from({ length: 64 }, (_, index) => ({
          name: `command-${index}`,
          title: `Local ${index}`,
          run() {},
        })),
        bindings: Array.from({ length: 64 }, (_, index) => ({
          key: createKey(index + 128),
          cmd: `command-${index}`,
        })),
      })

      return {
        resources,
        runIteration() {
          resources.keymap.getCommandEntries()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_command_bindings_reachable_shadowed_subset",
    description: "Repeated reachable command-binding grouping while shadowed commands share bindings by name",
    async setup() {
      const resources = await createScenarioResources()
      const focusChain = createFocusTree(resources, 4)
      const focusedTarget = focusChain.at(-1)
      const commands = Array.from({ length: 64 }, (_, index) => `command-${index}`)
      if (!focusedTarget) {
        throw new Error("Expected focused target for reachable command-binding benchmark")
      }

      resources.keymap.registerLayer({
        commands: Array.from({ length: 128 }, (_, index) => ({
          name: `command-${index}`,
          title: `Global ${index}`,
          run() {},
        })),
        bindings: Array.from({ length: 128 }, (_, index) => ({
          key: createKey(index),
          cmd: `command-${index}`,
        })),
      })

      resources.keymap.registerLayer({
        target: focusedTarget,
        commands: Array.from({ length: 64 }, (_, index) => ({
          name: `command-${index}`,
          title: `Local ${index}`,
          run() {},
        })),
        bindings: Array.from({ length: 64 }, (_, index) => ({
          key: createKey(index + 128),
          cmd: `command-${index}`,
        })),
      })

      return {
        resources,
        runIteration() {
          resources.keymap.getCommandBindings({ commands })
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "binding_sections_small_mixed",
    description: "Repeated binding-section resolution for a small mixed app config",
    async setup() {
      const resources = await createScenarioResources()
      const sections = ["app", "prompt_input", "dialog_select", "missing"] as const
      const config = {
        app: {
          " command.palette.show ": "ctrl+p",
          "app.exit": ["ctrl+c", "ctrl+d", "<leader>q"],
          "file.save": { name: "s", ctrl: true },
          "file.close": false,
        },
        prompt_input: {
          "prompt.paste": { key: "ctrl+v", preventDefault: false, fallthrough: true },
          "prompt.history.previous": "up",
          "prompt.history.next": "down",
        },
        dialog_select: {
          "dialog.confirm": "enter",
          "dialog.cancel": ["escape", "ctrl+c"],
          "dialog.ignore": [],
        },
      }
      let sink = 0

      return {
        resources,
        runIteration() {
          const resolved = resolveBindingSections(config, { sections })
          sink += resolved.sections.app.length
          sink += resolved.get("app", " app.exit ")?.length ?? 0
        },
        cleanup() {
          void sink
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "binding_sections_large_mixed",
    description: "Repeated binding-section resolution for many sections and mixed binding value shapes",
    async setup() {
      const resources = await createScenarioResources()
      const config: Record<string, Record<string, BindingValue>> = Object.create(null)
      const sections = Array.from({ length: 40 }, (_, index) => `section-${index}`)

      for (let sectionIndex = 0; sectionIndex < 32; sectionIndex += 1) {
        const section: Record<string, BindingValue> = Object.create(null)
        config[`section-${sectionIndex}`] = section

        for (let commandIndex = 0; commandIndex < 64; commandIndex += 1) {
          const command = `command-${commandIndex}`
          switch (commandIndex % 6) {
            case 0:
              section[command] = false
              break
            case 1:
              section[command] = []
              break
            case 2:
              section[command] = createKey(commandIndex)
              break
            case 3:
              section[command] = [createKey(commandIndex), `ctrl+${createKey(commandIndex + 1)}`, "none"]
              break
            case 4:
              section[command] = { key: { name: createKey(commandIndex), ctrl: true }, preventDefault: false }
              break
            default:
              section[command] = "none"
              break
          }
        }
      }

      let sink = 0

      return {
        resources,
        runIteration() {
          const resolved = resolveBindingSections(config, { sections })
          sink += resolved.sections["section-0"]?.length ?? 0
          sink += resolved.get("section-3", "command-4")?.length ?? 0
        },
        cleanup() {
          void sink
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "binding_sections_duplicate_normalized_commands",
    description: "Repeated binding-section resolution with many trimmed command overrides and disables",
    async setup() {
      const resources = await createScenarioResources()
      const section: Record<string, BindingValue> = Object.create(null)

      for (let index = 0; index < 512; index += 1) {
        section[` command-${index} `] = createKey(index)
        section[`command-${index}`] = index % 4 === 0 ? false : [createKey(index + 1), { key: createKey(index + 2) }]
      }

      const config = { app: section }
      let sink = 0

      return {
        resources,
        runIteration() {
          const resolved = resolveBindingSections(config)
          sink += resolved.sections.app.length
          sink += resolved.get("app", " command-7 ")?.length ?? 0
        },
        cleanup() {
          void sink
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "format_key_sequence_plain",
    description: "Repeated plain key-sequence formatting without custom options",
    async setup() {
      const resources = await createScenarioResources()
      const sequence = resources.keymap.parseKeySequence("gdd")
      let sink = ""

      return {
        resources,
        runIteration() {
          sink = formatKeySequence(sequence)
        },
        cleanup() {
          void sink
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "format_key_sequence_token_aliases",
    description: "Repeated key-sequence formatting with token, key, modifier, and separator options",
    async setup() {
      const resources = await createScenarioResources()
      resources.keymap.registerToken({ name: "<leader>", key: { name: "space" } })
      const sequence = [
        ...resources.keymap.parseKeySequence("<leader>s"),
        ...resources.keymap.parseKeySequence({ name: "return", ctrl: true, shift: true, meta: true }),
      ]
      const options = {
        tokenDisplay: {
          "<leader>": "space",
        },
        keyNameAliases: {
          enter: "return",
        },
        modifierAliases: {
          ctrl: "C",
          shift: "S",
          meta: "M",
        },
        separator: " then ",
      }
      let sink = ""

      return {
        resources,
        runIteration() {
          sink = formatKeySequence(sequence, options)
        },
        cleanup() {
          void sink
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "format_command_bindings_dedupe_many",
    description: "Repeated command-binding formatting with display-based dedupe over many bindings",
    async setup() {
      const resources = await createScenarioResources()
      resources.keymap.registerToken({ name: "<leader>", key: { name: "space" } })
      const sequences = [
        resources.keymap.parseKeySequence("ctrl+s"),
        resources.keymap.parseKeySequence("ctrl+s"),
        resources.keymap.parseKeySequence("<leader>s"),
        resources.keymap.parseKeySequence("dd"),
        resources.keymap.parseKeySequence("enter"),
        resources.keymap.parseKeySequence("return"),
      ]
      const bindings: SequenceBindingLike[] = Array.from({ length: 512 }, (_, index) => ({
        sequence: sequences[index % sequences.length] ?? sequences[0]!,
      }))
      let sink: string | undefined

      return {
        resources,
        runIteration() {
          sink = formatCommandBindings(bindings)
        },
        cleanup() {
          void sink
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "format_command_bindings_no_dedupe_many",
    description: "Repeated command-binding formatting retaining duplicate bindings",
    async setup() {
      const resources = await createScenarioResources()
      resources.keymap.registerToken({ name: "<leader>", key: { name: "space" } })
      const sequences = [
        resources.keymap.parseKeySequence("ctrl+s"),
        resources.keymap.parseKeySequence("<leader>s"),
        resources.keymap.parseKeySequence("dd"),
        resources.keymap.parseKeySequence({ name: "return", ctrl: true, shift: true }),
      ]
      const bindings: SequenceBindingLike[] = Array.from({ length: 512 }, (_, index) => ({
        sequence: sequences[index % sequences.length] ?? sequences[0]!,
      }))
      const options = {
        dedupe: false,
        bindingSeparator: " | ",
        tokenDisplay: {
          "<leader>": "space",
        },
      }
      let sink: string | undefined

      return {
        resources,
        runIteration() {
          sink = formatCommandBindings(bindings, options)
        },
        cleanup() {
          void sink
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "run_command_registered",
    description: "Repeated programmatic execution of a directly registered command",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerLayer({
        commands: [
          {
            name: "bench-run-command",
            title: "Bench Run Command",
            desc: "Bench Run Command",
            run() {},
          },
        ],
      })

      return {
        resources,
        runIteration() {
          resources.keymap.runCommand("bench-run-command")
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "run_command_registered_with_command",
    description: "Repeated programmatic execution of a directly registered command with command metadata included",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerLayer({
        commands: [
          {
            name: "bench-run-command",
            title: "Bench Run Command",
            desc: "Bench Run Command",
            run() {},
          },
        ],
      })

      return {
        resources,
        runIteration() {
          resources.keymap.runCommand("bench-run-command", { includeCommand: true })
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_global_layers",
    description: "Repeated getActiveKeys with many global layers",
    async setup() {
      const resources = await createScenarioResources()
      registerGlobalLayers(resources.keymap, 400)

      return {
        resources,
        runIteration() {
          resources.keymap.getActiveKeys()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_focus_tree",
    description: "Repeated getActiveKeys with deep focus chain and many unrelated target layers",
    async setup() {
      const resources = await createScenarioResources()
      const focusChain = createFocusTree(resources, 6)

      for (let index = 0; index < focusChain.length; index += 1) {
        const target = focusChain[index]
        if (!target) {
          continue
        }

        for (let layerIndex = 0; layerIndex < 6; layerIndex += 1) {
          registerTargetLayer(resources.keymap, target, index * 10 + layerIndex)
        }
      }

      for (let index = 0; index < 300; index += 1) {
        const sibling = createFocusableBox(resources.renderer, `sibling-${index}`)
        resources.renderer.root.add(sibling)
        registerTargetLayer(resources.keymap, sibling, index + 1000)
      }

      registerGlobalLayers(resources.keymap, 150)

      return {
        resources,
        runIteration() {
          resources.keymap.getActiveKeys()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_focus_tree_repeat_reads_5x",
    description: "Repeated getActiveKeys five times against the same focus tree state",
    async setup() {
      const resources = await createScenarioResources()
      const focusChain = createFocusTree(resources, 6)

      for (let index = 0; index < focusChain.length; index += 1) {
        const target = focusChain[index]
        if (!target) {
          continue
        }

        for (let layerIndex = 0; layerIndex < 6; layerIndex += 1) {
          registerTargetLayer(resources.keymap, target, index * 10 + layerIndex)
        }
      }

      for (let index = 0; index < 300; index += 1) {
        const sibling = createFocusableBox(resources.renderer, `repeat-sibling-${index}`)
        resources.renderer.root.add(sibling)
        registerTargetLayer(resources.keymap, sibling, index + 3000)
      }

      registerGlobalLayers(resources.keymap, 150)

      return {
        resources,
        runIteration() {
          readActiveKeysRepeatedly(resources.keymap, 5)
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_focus_tree_with_bindings_repeat_reads_5x",
    description: "Repeated getActiveKeys with bindings five times against metadata-rich focus tree state",
    async setup() {
      const resources = await createScenarioResources()
      setupMetadataFocusTree(resources)

      return {
        resources,
        runIteration() {
          readActiveKeysWithBindingsRepeatedly(resources.keymap, 5)
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_focus_tree_with_metadata_repeat_reads_5x",
    description: "Repeated getActiveKeys with metadata five times against metadata-rich focus tree state",
    async setup() {
      const resources = await createScenarioResources()
      setupMetadataFocusTree(resources)

      return {
        resources,
        runIteration() {
          readActiveKeysWithMetadataRepeatedly(resources.keymap, 5)
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "dispatch_focus_tree",
    description: "Repeated key dispatch with deep focus chain and many unrelated target layers",
    async setup() {
      const resources = await createScenarioResources()
      const focusChain = createFocusTree(resources, 6)

      for (let index = 0; index < focusChain.length; index += 1) {
        const target = focusChain[index]
        if (!target) {
          continue
        }

        for (let layerIndex = 0; layerIndex < 6; layerIndex += 1) {
          registerTargetLayer(resources.keymap, target, index * 10 + layerIndex, createKey(layerIndex + 1))
        }
      }

      const focusedTarget = focusChain.at(-1)
      if (!focusedTarget) {
        throw new Error("Expected a focused target for dispatch benchmark")
      }

      resources.keymap.registerLayer({
        target: focusedTarget,
        bindings: [{ key: "x", cmd: "noop" }],
      })

      for (let index = 0; index < 300; index += 1) {
        const sibling = createFocusableBox(resources.renderer, `dispatch-sibling-${index}`)
        resources.renderer.root.add(sibling)
        registerTargetLayer(resources.keymap, sibling, index + 2000)
      }

      registerGlobalLayers(resources.keymap, 150)

      return {
        resources,
        runIteration() {
          resources.mockInput.pressKey("x")
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "dispatch_disambiguation_default_fast_path",
    description: "Repeated exact-key dispatch with no disambiguation resolver installed",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerLayer({
        bindings: [{ key: "g", cmd: "noop" }],
      })

      return {
        resources,
        runIteration() {
          resources.mockInput.pressKey("g")
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "dispatch_disambiguation_sync_run_exact",
    description: "Repeated ambiguous first-stroke dispatch with a sync runExact disambiguation resolver",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.appendDisambiguationResolver((ctx) => ctx.runExact())
      resources.keymap.registerLayer({
        bindings: [
          { key: "g", cmd: "noop" },
          { key: "gg", cmd: "noop" },
        ],
      })

      return {
        resources,
        runIteration() {
          resources.mockInput.pressKey("g")
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "dispatch_disambiguation_sync_continue_sequence",
    description: "Repeated ambiguous first-stroke dispatch with a sync continueSequence disambiguation resolver",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.appendDisambiguationResolver((ctx) => ctx.continueSequence())
      resources.keymap.registerLayer({
        bindings: [
          { key: "g", cmd: "noop" },
          { key: "gg", cmd: "noop" },
        ],
      })

      return {
        resources,
        runIteration() {
          resources.mockInput.pressKey("g")
          resources.keymap.clearPendingSequence()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "dispatch_disambiguation_deferred_timeout_run_exact",
    description:
      "Repeated ambiguous first-stroke dispatch with a deferred timeout resolver that later runs the exact binding",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.appendDisambiguationResolver((ctx) => {
        return ctx.defer(async (deferred) => {
          const elapsed = await deferred.sleep(0)
          if (!elapsed) {
            return
          }

          return deferred.runExact()
        })
      })
      resources.keymap.registerLayer({
        bindings: [
          { key: "g", cmd: "noop" },
          { key: "gg", cmd: "noop" },
        ],
      })

      return {
        resources,
        async runIterationAsync() {
          resources.mockInput.pressKey("g")
          await Bun.sleep(0)
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "dispatch_disambiguation_deferred_timeout_cancelled",
    description:
      "Repeated ambiguous first-stroke dispatch with a deferred timeout resolver that is cancelled before it resolves",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.appendDisambiguationResolver((ctx) => {
        return ctx.defer(async (deferred) => {
          const elapsed = await deferred.sleep(0)
          if (!elapsed) {
            return
          }

          return deferred.runExact()
        })
      })
      resources.keymap.registerLayer({
        bindings: [
          { key: "g", cmd: "noop" },
          { key: "gg", cmd: "noop" },
        ],
      })

      return {
        resources,
        async runIterationAsync() {
          resources.mockInput.pressKey("g")
          resources.keymap.clearPendingSequence()
          await Bun.sleep(0)
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_pending_sequence",
    description: "Repeated getActiveKeys while a multi-key sequence is pending",
    async setup() {
      const resources = await createScenarioResources()
      const focusChain = createFocusTree(resources, 5)

      for (let index = 0; index < focusChain.length; index += 1) {
        const target = focusChain[index]
        if (!target) {
          continue
        }

        for (let layerIndex = 0; layerIndex < 5; layerIndex += 1) {
          registerTargetLayer(resources.keymap, target, index * 10 + layerIndex, createKey(layerIndex + 1))
        }
      }

      registerGlobalLayers(resources.keymap, 120)
      resources.keymap.registerLayer({
        bindings: [
          { key: "ga", cmd: "noop" },
          { key: "gb", cmd: "noop" },
          { key: "gc", cmd: "noop" },
          { key: "gd", cmd: "noop" },
        ],
      })

      resources.mockInput.pressKey("g")

      return {
        resources,
        runIteration() {
          resources.keymap.getActiveKeys()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "pending_sequence_parts_repeat_reads_5x",
    description: "Repeated pending sequence part reads against the same pending state",
    async setup() {
      const resources = await createScenarioResources()
      const focusChain = createFocusTree(resources, 5)

      for (let index = 0; index < focusChain.length; index += 1) {
        const target = focusChain[index]
        if (!target) {
          continue
        }

        for (let layerIndex = 0; layerIndex < 5; layerIndex += 1) {
          registerTargetLayer(resources.keymap, target, index * 10 + layerIndex, createKey(layerIndex + 1))
        }
      }

      registerGlobalLayers(resources.keymap, 120)
      resources.keymap.registerLayer({
        bindings: [
          { key: "ga", cmd: "noop" },
          { key: "gb", cmd: "noop" },
          { key: "gc", cmd: "noop" },
          { key: "gd", cmd: "noop" },
        ],
      })

      resources.mockInput.pressKey("g")

      return {
        resources,
        runIteration() {
          readPendingSequencePartsRepeatedly(resources.keymap, 5)
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_pending_recompiled_token_prefix",
    description: "Repeated getActiveKeys while a late-registered token prefix is pending",
    async setup() {
      const resources = await createScenarioResources()

      for (let index = 0; index < 320; index += 1) {
        resources.keymap.registerLayer({
          bindings: [{ key: `<leader>${createKey(index)}`, cmd: "noop" }],
        })
      }

      resources.keymap.registerToken({
        name: "<leader>",
        key: { name: "x", ctrl: true },
      })
      resources.mockInput.pressKey("x", { ctrl: true })

      return {
        resources,
        runIteration() {
          resources.keymap.getActiveKeys()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_requirement_heavy",
    description: "Repeated getActiveKeys with many runtime-gated bindings",
    async setup() {
      const resources = await createScenarioResources()
      registerModeBindingFields(resources.keymap)
      resources.keymap.setData("vim.mode", "normal")
      resources.keymap.setData("vim.state", "idle")

      for (let index = 0; index < 320; index += 1) {
        resources.keymap.registerLayer({
          bindings: [
            {
              key: createKey(index),
              mode: index % 2 === 0 ? "normal" : "visual",
              state: index % 3 === 0 ? "idle" : "busy",
              cmd: "noop",
            },
            {
              key: createKey(index + 1),
              mode: index % 2 === 0 ? "visual" : "normal",
              state: index % 4 === 0 ? "idle" : "busy",
              cmd: "noop",
            },
          ],
        })
      }

      return {
        resources,
        runIteration() {
          resources.keymap.getActiveKeys()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_layer_requirement_heavy",
    description: "Repeated getActiveKeys with many runtime-gated layers",
    async setup() {
      const resources = await createScenarioResources()
      registerModeLayerFields(resources.keymap)
      resources.keymap.setData("vim.mode", "normal")
      resources.keymap.setData("vim.state", "idle")

      for (let index = 0; index < 320; index += 1) {
        resources.keymap.registerLayer({
          mode: index % 2 === 0 ? "normal" : "visual",
          state: index % 3 === 0 ? "idle" : "busy",
          bindings: [
            { key: createKey(index), cmd: "noop" },
            { key: createKey(index + 1), cmd: "noop" },
          ],
        })
      }

      return {
        resources,
        runIteration() {
          resources.keymap.getActiveKeys()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_enabled_callback_heavy",
    description: "Repeated getActiveKeys with many callback-enabled layers",
    async setup() {
      const resources = await createScenarioResources()
      const enabledStates: boolean[] = []

      for (let index = 0; index < 320; index += 1) {
        enabledStates.push(index % 3 !== 0)
        resources.keymap.registerLayer({
          enabled: () => enabledStates[index] ?? false,
          bindings: [
            { key: createKey(index), cmd: "noop" },
            { key: createKey(index + 1), cmd: "noop" },
          ],
        })
      }

      return {
        resources,
        runIteration() {
          resources.keymap.getActiveKeys()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_commands_command_requirement_heavy",
    description: "Repeated getCommands with many runtime-gated commands using keyed requirements",
    async setup() {
      const resources = await createScenarioResources()
      registerModeCommandFields(resources.keymap)
      resources.keymap.setData("vim.mode", "normal")
      resources.keymap.setData("vim.state", "idle")

      resources.keymap.registerLayer({
        commands: Array.from({ length: 512 }, (_, index) => ({
          name: `command-${index}`,
          mode: index % 2 === 0 ? "normal" : "visual",
          state: index % 3 === 0 ? "idle" : "busy",
          title: `Command ${index}`,
          run() {},
        })),
      })

      return {
        resources,
        runIteration() {
          resources.keymap.getCommands()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "get_commands_enabled_command_callback_heavy",
    description: "Repeated getCommands with many callback-enabled commands via the enabled fields addon",
    async setup() {
      const resources = await createScenarioResources()
      const enabledStates: boolean[] = []

      addons.registerEnabledFields(resources.keymap)

      resources.keymap.registerLayer({
        commands: Array.from({ length: 512 }, (_, index) => {
          enabledStates.push(index % 3 !== 0)

          return {
            name: `command-${index}`,
            enabled: () => enabledStates[index] ?? false,
            title: `Command ${index}`,
            run() {},
          }
        }),
      })

      return {
        resources,
        runIteration() {
          resources.keymap.getCommands()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_binding_sparse_data_churn",
    description: "Repeated setData and getActiveKeys with per-binding dependency keys",
    async setup() {
      const resources = await createScenarioResources()
      registerNamedBindingFields(resources.keymap)

      for (let index = 0; index < 320; index += 1) {
        resources.keymap.setData(createFlagKey(index), true)
        resources.keymap.registerLayer({
          bindings: [
            {
              key: createKey(index),
              activeWhen: createFlagKey(index),
              cmd: "noop",
            },
          ],
        })
      }

      let iteration = 0

      return {
        resources,
        runIteration() {
          const key = createFlagKey(iteration % 320)
          const nextValue = iteration % 2 === 0
          resources.keymap.setData(key, nextValue)
          resources.keymap.getActiveKeys()
          iteration += 1
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_layer_sparse_data_churn",
    description: "Repeated setData and getActiveKeys with per-layer dependency keys",
    async setup() {
      const resources = await createScenarioResources()
      registerNamedLayerFields(resources.keymap)

      for (let index = 0; index < 320; index += 1) {
        resources.keymap.setData(createFlagKey(index), true)
        resources.keymap.registerLayer({
          activeWhen: createFlagKey(index),
          bindings: [{ key: createKey(index), cmd: "noop" }],
        })
      }

      let iteration = 0

      return {
        resources,
        runIteration() {
          const key = createFlagKey(iteration % 320)
          const nextValue = iteration % 2 === 0
          resources.keymap.setData(key, nextValue)
          resources.keymap.getActiveKeys()
          iteration += 1
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "state_change_focus_churn_noop",
    description: "Repeated focus changes with a noop state listener",
    async setup() {
      const resources = await createScenarioResources()
      const { first, second } = setupStateChangeFocusChurn(resources)
      const offStateChange = registerStateChangeNoopListener(resources.keymap)
      let focusFirst = false

      first.focus()

      return {
        resources,
        runIteration() {
          if (focusFirst) {
            first.focus()
          } else {
            second.focus()
          }

          focusFirst = !focusFirst
        },
        cleanup() {
          offStateChange()
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "state_change_focus_churn_read_heavy",
    description: "Repeated focus changes with active key and prefix listeners",
    async setup() {
      const resources = await createScenarioResources()
      const { first, second } = setupStateChangeFocusChurn(resources)
      const offStateChange = registerStateChangeReadListeners(resources.keymap)
      let focusFirst = false

      first.focus()

      return {
        resources,
        runIteration() {
          if (focusFirst) {
            first.focus()
          } else {
            second.focus()
          }

          focusFirst = !focusFirst
        },
        cleanup() {
          offStateChange()
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "state_change_focus_churn_metadata_read_heavy",
    description: "Repeated focus changes with active metadata and prefix listeners",
    async setup() {
      const resources = await createScenarioResources()
      const focusChain = setupMetadataFocusTree(resources)
      const offStateChange = registerStateChangeMetadataListeners(resources.keymap)
      const first = focusChain[0]
      const second = focusChain[1]
      let focusFirst = false

      if (!first || !second) {
        throw new Error("Expected metadata focus targets for metadata benchmark")
      }

      first.focus()

      return {
        resources,
        runIteration() {
          if (focusFirst) {
            first.focus()
          } else {
            second.focus()
          }

          focusFirst = !focusFirst
        },
        cleanup() {
          offStateChange()
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "state_change_focus_churn_bindings_read_heavy",
    description: "Repeated focus changes with active binding and prefix listeners",
    async setup() {
      const resources = await createScenarioResources()
      const focusChain = setupMetadataFocusTree(resources)
      const offStateChange = registerStateChangeBindingListeners(resources.keymap)
      const first = focusChain[0]
      const second = focusChain[1]
      let focusFirst = false

      if (!first || !second) {
        throw new Error("Expected metadata focus targets for binding benchmark")
      }

      first.focus()

      return {
        resources,
        runIteration() {
          if (focusFirst) {
            first.focus()
          } else {
            second.focus()
          }

          focusFirst = !focusFirst
        },
        cleanup() {
          offStateChange()
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "state_change_focus_churn_repeat_reads_5x",
    description: "Repeated focus changes followed by five active key reads",
    async setup() {
      const resources = await createScenarioResources()
      const { first, second } = setupStateChangeFocusChurn(resources)
      let focusFirst = false

      first.focus()

      return {
        resources,
        runIteration() {
          if (focusFirst) {
            first.focus()
          } else {
            second.focus()
          }

          readActiveKeysRepeatedly(resources.keymap, 5)
          focusFirst = !focusFirst
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "state_change_pending_blur_read_heavy",
    description: "Repeated pending sequence blur clears with state listeners",
    async setup() {
      const resources = await createScenarioResources()
      const target = createFocusableBox(resources.renderer, "state-pending-target")
      const offStateChange = registerStateChangeReadListeners(resources.keymap)

      resources.renderer.root.add(target)
      resources.keymap.registerLayer({
        target,
        bindings: [{ key: "dd", cmd: "noop" }],
      })

      return {
        resources,
        runIteration() {
          target.focus()
          resources.mockInput.pressKey("d")
          target.blur()
        },
        cleanup() {
          offStateChange()
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "state_change_external_invalidation_read_heavy",
    description: "Repeated external reactive-matcher invalidation with state listeners",
    async setup() {
      const resources = await createScenarioResources()
      const store = createFlagStore()
      const offStateChange = registerStateChangeReadListeners(resources.keymap)

      registerExternalBindingFields(resources.keymap, store)

      for (let index = 0; index < 320; index += 1) {
        const key = createFlagKey(index)
        store.flags[key] = true
        resources.keymap.registerLayer({
          bindings: [
            {
              key: createKey(index),
              activeExternally: key,
              cmd: "noop",
            },
          ],
        })
      }

      let iteration = 0

      return {
        resources,
        runIteration() {
          const key = createFlagKey(iteration % 320)
          store.set(key, iteration % 2 === 0)
          iteration += 1
        },
        cleanup() {
          offStateChange()
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "active_keys_prefix_merge_heavy",
    description: "Repeated getActiveKeys with many overlapping prefixes across layers",
    async setup() {
      const resources = await createScenarioResources()

      for (let index = 0; index < 160; index += 1) {
        resources.keymap.registerLayer({
          bindings: [
            { key: "ga", cmd: "noop" },
            { key: "gb", cmd: "noop" },
            { key: "gc", cmd: "noop" },
            { key: "gd", cmd: "noop" },
          ],
        })
      }

      return {
        resources,
        runIteration() {
          resources.keymap.getActiveKeys()
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "dispatch_key_hooks_heavy",
    description: "Repeated key dispatch with many registered key hooks",
    async setup() {
      const resources = await createScenarioResources()

      for (let index = 0; index < 80; index += 1) {
        resources.keymap.intercept(
          "key",
          ({ event }) => {
            if (event.name === "z") {
              return
            }
          },
          { priority: index % 5 },
        )
      }

      return {
        resources,
        runIteration() {
          resources.mockInput.pressKey("x")
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
  {
    name: "dispatch_command_data_heavy",
    description: "Repeated matched dispatch while commands receive many runtime data fields",
    async setup() {
      const resources = await createScenarioResources()

      resources.keymap.registerLayer({
        commands: [
          {
            name: "consume-data",
            run(ctx) {
              if (ctx.data["field-0"] === "value-0") {
                return
              }
            },
          },
        ],
      })

      for (let index = 0; index < 20; index += 1) {
        resources.keymap.setData(`field-${index}`, `value-${index}`)
      }

      resources.keymap.registerLayer({
        bindings: [{ key: "x", cmd: "consume-data" }],
      })

      return {
        resources,
        runIteration() {
          resources.mockInput.pressKey("x")
        },
        cleanup() {
          resources.renderer.destroy()
        },
      }
    },
  },
]

async function runScenario(scenario: BenchmarkScenario, args: BenchmarkArgs): Promise<BenchmarkResult> {
  const instance = await scenario.setup()

  try {
    await runIterations(instance, args.warmupIterations)

    let measuredIterations = args.iterations
    const calibrationStart = nowNs()
    await runIterations(instance, measuredIterations)
    const calibrationDurationMs = nsToMs(nowNs() - calibrationStart)

    if (calibrationDurationMs > 0 && calibrationDurationMs < args.minSampleMs) {
      const scaledIterations = (measuredIterations * args.minSampleMs) / calibrationDurationMs
      measuredIterations = roundIterations(scaledIterations)
    }

    if (measuredIterations !== args.iterations) {
      await runIterations(instance, Math.min(measuredIterations, args.warmupIterations))
    }

    const samples: BenchmarkSample[] = []
    for (let round = 0; round < args.rounds; round += 1) {
      const start = nowNs()
      await runIterations(instance, measuredIterations)
      const durationMs = nsToMs(nowNs() - start)
      samples.push({
        round: round + 1,
        durationMs,
        opsPerSecond: (measuredIterations * 1000) / durationMs,
      })
    }

    const durations = samples.map((sample) => sample.durationMs)
    const opsPerSecond = samples.map((sample) => sample.opsPerSecond)

    return {
      name: scenario.name,
      description: scenario.description,
      iterations: args.iterations,
      warmupIterations: args.warmupIterations,
      rounds: args.rounds,
      measuredIterations,
      medianDurationMs: median(durations),
      bestDurationMs: Math.min(...durations),
      medianOpsPerSecond: median(opsPerSecond),
      samples,
    }
  } finally {
    instance.cleanup()
  }
}

async function runIterations(instance: ScenarioInstance, count: number): Promise<void> {
  if (count <= 0) {
    return
  }

  const runIteration = instance.runIteration
  if (runIteration) {
    for (let iteration = 0; iteration < count; iteration += 1) {
      runIteration()
    }
    return
  }

  const runIterationAsync = instance.runIterationAsync
  if (!runIterationAsync) {
    throw new Error("Benchmark scenario must provide runIteration or runIterationAsync")
  }

  for (let iteration = 0; iteration < count; iteration += 1) {
    await runIterationAsync()
  }
}

function formatNumber(value: number): string {
  return value.toFixed(2)
}

function printResults(results: BenchmarkResult[], args: BenchmarkArgs): void {
  console.log(
    `keymap-benchmark iters=${args.iterations} warmup=${args.warmupIterations} rounds=${args.rounds} min_sample_ms=${args.minSampleMs} scenarios=${results.length}`,
  )
  console.log("")

  const header = ["scenario", "iters", "median ms", "best ms", "median ops/sec"]
  const rows = results.map((result) => [
    result.name,
    String(result.measuredIterations),
    formatNumber(result.medianDurationMs),
    formatNumber(result.bestDurationMs),
    formatNumber(result.medianOpsPerSecond),
  ])

  const widths = header.map((title, index) => {
    return Math.max(title.length, ...rows.map((row) => row[index]?.length ?? 0))
  })

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
        `  round ${sample.round}: ${formatNumber(sample.durationMs)} ms (${formatNumber(sample.opsPerSecond)} ops/sec)`,
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
          cwd: process.cwd(),
          args: process.argv.slice(2),
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
  const results: BenchmarkResult[] = []

  const selectedScenarios = args.scenarioNames
    ? scenarios.filter((scenario) => args.scenarioNames!.has(scenario.name))
    : scenarios

  if (selectedScenarios.length === 0) {
    throw new Error("No benchmark scenarios matched the provided --scenario filter")
  }

  for (const scenario of selectedScenarios) {
    results.push(await runScenario(scenario, args))
  }

  printResults(results, args)

  if (args.jsonPath) {
    writeResults(results, args, args.jsonPath)
  }
}

await main()
