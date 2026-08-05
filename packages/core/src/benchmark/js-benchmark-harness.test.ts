import { describe, expect, test } from "bun:test"

import { defaultBenchmarkCases } from "./js-benchmark-cases.js"
import { runBenchmarkCli } from "./js-benchmark.js"
import { OptimizedBuffer } from "../buffer.js"
import { MouseParser } from "../lib/parse.mouse.js"
import { Node } from "../yoga.js"
import {
  calculateInnerRsdPpm,
  canonicalJson,
  createManifest,
  manifestHash,
  runBenchmarks,
  validateManifestResults,
  type BenchmarkCase,
  type BenchmarkRuntime,
  type HarnessOptions,
} from "./js-benchmark-harness.js"

const options: HarnessOptions = {
  protocolVersion: 1,
  measurement: { target_batch_ms: 0.000001, warmup_batches: 1, measured_batches: 2, max_rsd_ppm: 1_000_000 },
  minBatchIterations: 1,
  maxBatchIterations: 4,
  maxCaseNs: 15_000_000_000,
  maxProcessNs: 60_000_000_000,
}

function fakeCase(
  runtimeOverrides: Partial<BenchmarkRuntime> = {},
  caseOverrides: Partial<BenchmarkCase> = {},
): BenchmarkCase {
  let completed = 0
  let validated = 0
  return {
    category: "Test",
    name: "case",
    workload_version: 1,
    parameters: { size: 1 },
    setup() {
      return {
        run() {
          completed++
        },
        validateBatch(iterations) {
          expect(completed - validated).toBe(iterations)
          validated = completed
        },
        teardown() {},
        ...runtimeOverrides,
      }
    },
    ...caseOverrides,
  }
}

function batchClock(elapsedNs: number[], initialCalls = 5): () => number {
  let calls = 0
  let now = 0
  return () => {
    const batchCall = calls++ - initialCalls
    if (batchCall < 0) return now
    const batchIndex = Math.floor(batchCall / 4)
    if (batchIndex < elapsedNs.length && batchCall % 4 === 1) now += elapsedNs[batchIndex]!
    return now
  }
}

describe("statistics and manifest", () => {
  test("uses sample standard deviation and integer ppm rounding", () => {
    expect(calculateInnerRsdPpm([10, 10])).toBe(0)
    expect(calculateInnerRsdPpm([1, 2])).toBe(471_405)
    expect(calculateInnerRsdPpm([1, 3])).toBe(707_107)
  })

  test("canonicalizes keys and hashes protocol_version as a manifest field", () => {
    const manifest = createManifest([fakeCase()], options)
    expect(manifest.protocol_version).toBe(1)
    expect(manifest.measurement).toEqual({
      ...options.measurement,
      min_batch_iterations: options.minBatchIterations,
      max_batch_iterations: options.maxBatchIterations,
      max_case_ns: options.maxCaseNs,
      max_process_ns: options.maxProcessNs,
    })
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}')
    expect(manifestHash(manifest)).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(manifestHash({ ...manifest, protocol_version: 2 })).not.toBe(manifestHash(manifest))
  })

  test("rejects duplicate identities and manifest/result disagreement", () => {
    expect(() => createManifest([fakeCase(), fakeCase()], options)).toThrow("duplicate benchmark identity")
    const manifest = createManifest([fakeCase()], options)
    expect(() => validateManifestResults(manifest, [])).toThrow("manifest/result count mismatch")
    expect(() => validateManifestResults(manifest, [{ category: "Test", name: "other" }])).toThrow(
      "manifest/result identity mismatch",
    )
  })
})

describe("runner", () => {
  test("invokes operations synchronously while awaiting setup and teardown", async () => {
    let thenCalls = 0
    let validations = 0
    let teardown = false
    const benchmark = fakeCase(
      {},
      {
        async setup() {
          return {
            run() {
              return { then: () => thenCalls++ }
            },
            validateBatch() {
              expect(thenCalls).toBe(0)
              validations++
            },
            async teardown() {
              teardown = true
            },
          }
        },
      },
    )

    await runBenchmarks([benchmark], { ...options, clock: batchClock([1, 1, 1, 1, 1], 6), maxBatchIterations: 1 })

    expect(thenCalls).toBe(0)
    expect(validations).toBe(5)
    expect(teardown).toBe(true)
  })

  test("calibrates within bounds and validates every batch", async () => {
    let validations = 0
    const benchmark = fakeCase({
      run() {},
      validateBatch() {
        validations++
      },
    })
    // Untimed validation, calibration at 1 then 2, warmup, and two measured batches.
    const clock = batchClock([1, 1, 2, 2, 2, 2])
    const output = await runBenchmarks([benchmark], {
      ...options,
      clock,
      measurement: { ...options.measurement, target_batch_ms: 0.000002 },
    })
    expect(output.results[0]!.batch_iterations).toBe(2)
    expect(validations).toBe(6)
  })

  test("rejects invalid timing and integer overflow", async () => {
    await expect(runBenchmarks([fakeCase()], { ...options, clock: batchClock([0]) })).rejects.toThrow(
      "must be a positive safe integer",
    )
    await expect(
      runBenchmarks([fakeCase()], { ...options, clock: batchClock([Number.MAX_SAFE_INTEGER + 1]) }),
    ).rejects.toThrow("safe integer")
  })

  test("accepts stable batches and rejects over-limit RSD without rerunning", async () => {
    const stableClock = batchClock([1, 1, 1, 10, 10])
    const stable = await runBenchmarks([fakeCase()], {
      ...options,
      clock: stableClock,
      measurement: { ...options.measurement, warmup_batches: 1, max_rsd_ppm: 0 },
      maxBatchIterations: 1,
    })
    expect(stable.results[0]!.inner_rsd_ppm).toBe(0)

    const unstableClock = batchClock([1, 1, 1, 10, 20])
    await expect(
      runBenchmarks([fakeCase()], {
        ...options,
        clock: unstableClock,
        measurement: { ...options.measurement, warmup_batches: 1, max_rsd_ppm: 1 },
        maxBatchIterations: 1,
      }),
    ).rejects.toThrow("inner RSD")
  })

  test("requires post-batch validation and tears down after failures", async () => {
    let teardown = 0
    const benchmark = fakeCase({
      run() {},
      validateBatch() {
        throw new Error("work was not observed")
      },
      teardown() {
        teardown++
      },
    })
    await expect(runBenchmarks([benchmark], { ...options, clock: batchClock([1]) })).rejects.toThrow(
      "work was not observed",
    )
    expect(teardown).toBe(1)
  })

  test("applies case duration to setup and still tears down", async () => {
    let now = 0
    let teardown = 0
    const benchmark = fakeCase(
      {},
      {
        setup() {
          now = 6
          return {
            run() {},
            validateBatch() {},
            teardown() {
              teardown++
            },
          }
        },
      },
    )
    await expect(runBenchmarks([benchmark], { ...options, clock: () => now, maxCaseNs: 5 })).rejects.toThrow(
      "maximum case duration exceeded",
    )
    expect(teardown).toBe(1)
  })

  test("applies case duration to validation and still tears down", async () => {
    let now = 0
    let teardown = 0
    const benchmark = fakeCase({
      run() {
        now++
      },
      validateBatch() {
        now = 10
      },
      teardown() {
        teardown++
      },
    })
    await expect(runBenchmarks([benchmark], { ...options, clock: () => now, maxCaseNs: 5 })).rejects.toThrow(
      "maximum case duration exceeded",
    )
    expect(teardown).toBe(1)
  })

  test("applies process duration to case orchestration", async () => {
    let now = 0
    let teardowns = 0
    const first = fakeCase(
      {
        run() {},
        validateBatch() {},
        teardown() {
          teardowns++
          now = 6
        },
      },
      { name: "first" },
    )
    await expect(
      runBenchmarks([first, fakeCase({}, { name: "second" })], {
        ...options,
        clock: () => now++,
        maxBatchIterations: 1,
        maxProcessNs: 5,
      }),
    ).rejects.toThrow("maximum benchmark process duration exceeded")
    expect(teardowns).toBe(1)
  })

  test("bounds a hanging setup by the remaining process duration", async () => {
    let elapsedBeforeHang = 0
    const clock = () => Bun.nanoseconds() + elapsedBeforeHang
    const benchmark = fakeCase(
      {},
      {
        setup() {
          elapsedBeforeHang = 4_000_000
          return new Promise<BenchmarkRuntime>(() => {})
        },
      },
    )
    const startedAt = performance.now()

    await expect(
      runBenchmarks([benchmark], { ...options, clock, maxCaseNs: 100_000_000, maxProcessNs: 5_000_000 }),
    ).rejects.toThrow("maximum benchmark process duration exceeded")
    expect(performance.now() - startedAt).toBeLessThan(100)
  })

  test("bounds a hanging teardown by the remaining case duration", async () => {
    let teardownAttempted = false
    let elapsedBeforeHang = 0
    const clock = () => Bun.nanoseconds() + elapsedBeforeHang
    const benchmark = fakeCase({
      validateBatch() {
        throw new Error("validation failed")
      },
      teardown() {
        teardownAttempted = true
        elapsedBeforeHang = 4_000_000
        return new Promise<void>(() => {})
      },
    })
    const startedAt = performance.now()

    await expect(
      runBenchmarks([benchmark], { ...options, clock, maxCaseNs: 5_000_000, maxProcessNs: 100_000_000 }),
    ).rejects.toThrow("maximum case duration exceeded")
    expect(teardownAttempted).toBe(true)
    expect(performance.now() - startedAt).toBeLessThan(100)
  })

  test("rounds lifecycle deadlines up to the next millisecond", async () => {
    const setTimeout = globalThis.setTimeout
    let timerDelay: number | undefined
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      timerDelay = delay ?? 0
      return setTimeout(callback, delay, ...args)
    }) as typeof globalThis.setTimeout

    try {
      const benchmark = fakeCase(
        {},
        {
          async setup() {
            return { run() {}, validateBatch() {}, teardown() {} }
          },
        },
      )
      await runBenchmarks([benchmark], {
        ...options,
        clock: batchClock([1, 1, 1, 1, 1], 6),
        maxBatchIterations: 1,
        maxCaseNs: 999_999,
        maxProcessNs: 999_999,
      })
    } finally {
      globalThis.setTimeout = setTimeout
    }

    expect(timerDelay).toBe(1)
  })
})

test("layout workloads validate consecutive batches", async () => {
  for (const benchmark of defaultBenchmarkCases.slice(0, 2)) {
    const runtime = await benchmark.setup()
    try {
      for (let iteration = 0; iteration < 4; iteration += 2) {
        runtime.run(iteration)
        runtime.run(iteration + 1)
        runtime.validateBatch(2)
      }
    } finally {
      await runtime.teardown()
    }
  }
})

test("leaf layout rejects corrupt final output", async () => {
  const benchmark = defaultBenchmarkCases[0]!
  for (const invalid of ["zero", "width"] as const) {
    const getComputedLayout = Node.prototype.getComputedLayout
    const runtime = await benchmark.setup()
    Node.prototype.getComputedLayout = function () {
      const layout = getComputedLayout.call(this)
      if (invalid === "zero") return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
      return { ...layout, width: layout.width + 1 }
    }
    try {
      runtime.run(0)
      expect(() => runtime.validateBatch(1)).toThrow("leaf-width-calculate: final checksum")
    } finally {
      Node.prototype.getComputedLayout = getComputedLayout
      await runtime.teardown()
    }
  }
})

test("Yoga layout reads reject all-zero setup and measured output", async () => {
  const benchmark = defaultBenchmarkCases[1]!
  const getComputedLayout = Node.prototype.getComputedLayout
  const allZeroLayout = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 })

  Node.prototype.getComputedLayout = allZeroLayout
  try {
    await expect(benchmark.setup()).rejects.toThrow("yoga-layout-reads-100: node 0 fixture geometry")
  } finally {
    Node.prototype.getComputedLayout = getComputedLayout
  }

  const runtime = await benchmark.setup()
  try {
    runtime.run(0)
    Node.prototype.getComputedLayout = allZeroLayout
    runtime.run(1)
    expect(() => runtime.validateBatch(2)).toThrow("yoga-layout-reads-100: batch checksum")
  } finally {
    Node.prototype.getComputedLayout = getComputedLayout
    await runtime.teardown()
  }
})

test("stdin SGR workload rejects wrong decoded dispatch during setup", async () => {
  const benchmark = defaultBenchmarkCases[3]!
  const parseMouseEvent = MouseParser.prototype.parseMouseEvent
  const wrongDispatch: typeof MouseParser.prototype.parseMouseEvent = () => ({
    type: "move",
    button: 0,
    x: 2,
    y: 1,
    modifiers: { shift: false, alt: false, ctrl: false },
  })

  MouseParser.prototype.parseMouseEvent = wrongDispatch
  try {
    await expect(benchmark.setup()).rejects.toThrow("stdin-sgr-bubble-depth-8: fixed SGR bytes decoded incorrectly")
  } finally {
    MouseParser.prototype.parseMouseEvent = parseMouseEvent
  }
})

test("proportional column widths observe output across consecutive batches", async () => {
  const benchmark = defaultBenchmarkCases[4]!
  expect(benchmark).toMatchObject({
    category: "JS Text Table",
    name: "proportional-column-widths",
    workload_version: 1,
    parameters: {
      allocations_per_operation: 1,
      mix: "alternating",
      min_width: 1,
      ordinary_widths: "4,49,4,54,38",
      ordinary_target_width: 104,
      remainder_columns: 64,
      remainder_width: 17,
      remainder_target_width: 584,
    },
  })
  const runtime = await benchmark.setup()
  let iteration = 0
  try {
    for (const batch of [1, 2, 5, 3]) {
      for (let index = 0; index < batch; index++) runtime.run(iteration++)
      runtime.validateBatch(batch)
    }
  } finally {
    await runtime.teardown()
  }
})

test("text buffer word-wrap measurement validates alternating cache misses", async () => {
  const benchmark = defaultBenchmarkCases.find(({ name }) => name === "text-buffer-word-wrap-measure")!
  expect(benchmark).toMatchObject({
    category: "JS Text",
    workload_version: 1,
    parameters: {
      width_method: "unicode",
      wrap_mode: "word",
      logical_lines: 64,
      tokens_per_line: 128,
      line_columns: 767,
      text_bytes: 49_151,
      width_a: 72,
      width_b: 78,
      measure_height: 2_048,
    },
  })
  const runtime = await benchmark.setup()
  try {
    runtime.run(0)
    runtime.validateBatch(1)
    runtime.run(1)
    runtime.run(2)
    runtime.validateBatch(2)
    runtime.run(3)
    runtime.validateBatch(1)
  } finally {
    await runtime.teardown()
  }
})

test("direct box drawing observes variants across consecutive batches", async () => {
  const benchmark = defaultBenchmarkCases.find(({ name }) => name === "draw-box-titled-scissored")!
  expect(benchmark).toMatchObject({
    category: "JS Buffer",
    workload_version: 1,
    parameters: {
      buffer_width: 80,
      buffer_height: 24,
      width_method: "unicode",
      box_x: 2,
      box_y: 2,
      box_width: 76,
      box_height: 20,
      scissor_x: 0,
      scissor_y: 0,
      scissor_width: 72,
      scissor_height: 24,
      border_style: "rounded",
      should_fill: true,
      titles_per_box: 2,
      title_variants: 2,
      visible_cells: 1_400,
    },
  })
  const runtime = await benchmark.setup()
  try {
    runtime.run(0)
    runtime.run(1)
    runtime.validateBatch(2)
    runtime.run(2)
    runtime.validateBatch(1)
  } finally {
    await runtime.teardown()
  }
})

test("direct box drawing rejects a no-op draw", async () => {
  const benchmark = defaultBenchmarkCases.find(({ name }) => name === "draw-box-titled-scissored")!
  const runtime = await benchmark.setup()
  const drawBox = OptimizedBuffer.prototype.drawBox
  OptimizedBuffer.prototype.drawBox = () => {}
  try {
    runtime.run(0)
    expect(() => runtime.validateBatch(1)).toThrow("draw-box-titled-scissored: observation")
  } finally {
    OptimizedBuffer.prototype.drawBox = drawBox
    await runtime.teardown()
  }
})

class MemoryWriter {
  text = ""
  write(data: string) {
    this.text += data
  }
  flush() {}
}

const memoryWriters = () => ({ stdout: new MemoryWriter(), stderr: new MemoryWriter() })

describe("CLI", () => {
  test("accepts only --format=json and keeps diagnostics off stdout", async () => {
    const { stdout, stderr } = memoryWriters()
    expect(await runBenchmarkCli(["--json"], { stdout, stderr, cases: [] })).toBe(2)
    expect(stdout.text).toBe("")
    expect(stderr.text).toContain("usage:")
  })

  test("buffers stdout until the complete suite succeeds", async () => {
    const { stdout, stderr } = memoryWriters()
    const exitCode = await runBenchmarkCli(["--format=json"], {
      stdout,
      stderr,
      cases: [fakeCase()],
      options: { ...options, clock: batchClock([0]) },
      bunVersion: "test-bun",
      zigVersion: "test-zig",
    })
    expect(exitCode).toBe(1)
    expect(stdout.text).toBe("")
    expect(stderr.text).toContain("elapsed nanoseconds")
  })

  test("writes exactly one JSON document on success", async () => {
    const { stdout, stderr } = memoryWriters()
    const exitCode = await runBenchmarkCli(["--format=json"], {
      stdout,
      stderr,
      cases: [fakeCase()],
      options: {
        ...options,
        maxBatchIterations: 1,
        clock: batchClock([1, 1, 1, 1, 1]),
      },
      bunVersion: "test-bun",
      zigVersion: "test-zig",
    })
    expect(exitCode).toBe(0)
    expect(stderr.text).toBe("")
    const text = stdout.text
    expect(text.trim().split("\n")).toHaveLength(1)
    expect(JSON.parse(text).manifest.protocol_version).toBe(1)
  })
})
