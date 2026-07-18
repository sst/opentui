#!/usr/bin/env node

import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { OptimizedBuffer } from "../buffer.js"
import { EditBuffer } from "../edit-buffer.js"
import { EditorView } from "../editor-view.js"
import { BorderCharArrays } from "../lib/border.js"
import { RGBA } from "../lib/RGBA.js"
import { ptr } from "../platform/ffi.js"
import { TextBufferView } from "../text-buffer-view.js"
import { TextBuffer } from "../text-buffer.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { resolveRenderLib, type RenderLib } from "../zig.js"

type RuntimeName = "bun" | "node"

interface BenchmarkContext {
  lib: RenderLib
  renderer: TestRenderer
}

interface ScenarioRuntime {
  run(operations: number): number
  observe(): number
  teardown(): void
}

interface ScenarioDefinition {
  name: string
  operation: string
  description: string
  setup(context: BenchmarkContext): ScenarioRuntime
}

interface TimedRun {
  elapsedNs: number
  operations: number
  signal: number
}

const COLORS = {
  fg: RGBA.fromValues(0.85, 0.9, 1, 1),
  bg: RGBA.fromValues(0.08, 0.12, 0.18, 1),
  translucentFg: RGBA.fromValues(1, 0.25, 0.1, 0.6),
  translucentBg: RGBA.fromValues(0.1, 0.35, 0.8, 0.45),
} as const

const scenarios = createScenarios()

if (process.argv.includes("--list-scenarios")) {
  for (const scenario of scenarios) console.log(scenario.name)
  process.exit(0)
}

const scenarioName = requiredArg("scenario")
const targetMs = positiveNumberArg("target-ms", 75)
const warmupMs = positiveNumberArg("warmup-ms", 30)
const jsonPath = optionalArg("json")
const outputEnabled = !process.argv.includes("--no-output")
const scenario = scenarios.find((candidate) => candidate.name === scenarioName)

if (!scenario) throw new Error(`unknown scenario: ${scenarioName}`)

const rendererSetup = await createTestRenderer({
  width: 16,
  height: 8,
  screenMode: "split-footer",
  footerHeight: 2,
  externalOutputMode: "passthrough",
  consoleMode: "disabled",
  useMouse: false,
  useThread: false,
  clearOnShutdown: false,
  maxFps: Number.POSITIVE_INFINITY,
})

const context: BenchmarkContext = { lib: resolveRenderLib(), renderer: rendererSetup.renderer }
let runtime: ScenarioRuntime | undefined

try {
  runtime = scenario.setup(context)
  const result = runCalibrated(runtime, targetMs, warmupMs)
  const observedChecksum = runtime.observe() >>> 0
  const checksum = hashNumbers(result.signal, observedChecksum, result.operations)
  const runtimeName: RuntimeName = typeof process.versions.bun === "string" ? "bun" : "node"
  const payload = {
    schemaVersion: 1,
    scenario: {
      name: scenario.name,
      operation: scenario.operation,
      description: scenario.description,
    },
    sample: {
      runtime: {
        name: runtimeName,
        version: process.versions.bun ?? process.version,
        platform: process.platform,
        arch: process.arch,
      },
      targetMs,
      warmupMs,
      elapsedNs: result.elapsedNs,
      operations: result.operations,
      nsPerOp: result.elapsedNs / result.operations,
      checksum,
    },
  }

  if (jsonPath) writeFileSync(resolve(jsonPath), JSON.stringify(payload, null, 2))
  if (outputEnabled) console.log(JSON.stringify(payload, null, 2))
} finally {
  try {
    runtime?.teardown()
  } finally {
    rendererSetup.renderer.destroy()
  }
}

function createScenarios(): ScenarioDefinition[] {
  return [
    {
      name: "renderer_set_pending_split_footer_transition",
      operation: "setPendingSplitFooterTransition",
      description: "Store alternating valid split-footer transitions on a live renderer",
      setup: ({ lib, renderer }) => {
        const snapshot = lib.createOptimizedBuffer(1, 1, "unicode", false, "ffi-bench-transition")
        lib.bufferSetCell(snapshot.ptr, 0, 0, "x", COLORS.fg, COLORS.bg, 0)
        lib.resetSplitScrollback(renderer.rendererPtr, 4, 6)
        return {
          run: (operations) => {
            for (let index = 0; index < operations; index++) {
              const alternate = index & 1
              lib.setPendingSplitFooterTransition(renderer.rendererPtr, 1, 2 + alternate, 2, 3 - alternate, 2, 1)
            }
            return operations
          },
          observe: () => {
            const result = lib.commitSplitFooterSnapshot(renderer.rendererPtr, snapshot, 1, false, false, 6, false)
            const splitOutputOffset = lib.getSplitOutputOffset(renderer.rendererPtr, 6)
            if (splitOutputOffset !== 3) throw new Error(`split transition was not applied: ${splitOutputOffset}`)
            return hashNumbers(
              result.status,
              result.renderOffset,
              splitOutputOffset,
              renderer.getNativeStats().nativeFrameCount,
            )
          },
          teardown: () => snapshot.destroy(),
        }
      },
    },
    {
      name: "renderer_commit_split_footer_snapshot",
      operation: "commitSplitFooterSnapshot",
      description: "Append a one-cell snapshot inside a valid split-footer frame batch",
      setup: ({ lib, renderer }) => {
        const snapshot = lib.createOptimizedBuffer(1, 1, "unicode", false, "ffi-bench-split-commit")
        lib.bufferSetCell(snapshot.ptr, 0, 0, "c", COLORS.fg, COLORS.bg, 0)
        return {
          run: (operations) => {
            let signal = 0
            for (let index = 0; index < operations; index++) {
              const result = lib.commitSplitFooterSnapshot(
                renderer.rendererPtr,
                snapshot,
                1,
                true,
                true,
                6,
                false,
                false,
                false,
              )
              signal = (signal + result.status + result.renderOffset) >>> 0
            }
            return signal
          },
          observe: () => bufferChecksum(snapshot),
          teardown: () => {
            snapshot.destroy()
          },
        }
      },
    },
    createFrameBufferScenario(false),
    createFrameBufferScenario(true),
    createDrawTextScenario("short", "x"),
    createDrawTextScenario("long", "OpenTUI direct FFI benchmark payload ".repeat(4)),
    createDrawTextScenario("unicode", "A界e\u0301👩‍🚀"),
    createSingleBufferScenario(
      "buffer_set_cell_with_alpha_blending",
      "bufferSetCellWithAlphaBlending",
      "Blend one translucent cell through the production wrapper",
      2,
      2,
      (lib, buffer, operations) => {
        for (let index = 0; index < operations; index++) {
          lib.bufferSetCellWithAlphaBlending(
            buffer.ptr,
            index & 1,
            (index >>> 1) & 1,
            index & 1 ? "b" : "a",
            COLORS.translucentFg,
            COLORS.translucentBg,
            index & 1,
          )
        }
        return operations
      },
    ),
    createSingleBufferScenario(
      "buffer_set_cell",
      "bufferSetCell",
      "Set one scalar cell through the production wrapper",
      2,
      2,
      (lib, buffer, operations) => {
        for (let index = 0; index < operations; index++) {
          lib.bufferSetCell(buffer.ptr, index & 1, (index >>> 1) & 1, index & 1 ? "s" : "t", COLORS.fg, COLORS.bg, 1)
        }
        return operations
      },
    ),
    createDrawCharScenario(false),
    createDrawCharScenario(true),
    createSuperSampleScenario("cell", 1, 1),
    createSuperSampleScenario("frame", 80, 24),
    createPackedBufferScenario(),
    createGrayscaleScenario(false),
    createGrayscaleScenario(true),
    createGridScenario(),
    createBoxScenario(),
    createTextRangeScenario(false),
    createTextRangeScenario(true),
    createTextBufferSelectionScenario(false),
    createTextBufferSelectionScenario(true),
    createEditorSelectionScenario(false),
    createEditorSelectionScenario(true),
  ]
}

function createFrameBufferScenario(region: boolean): ScenarioDefinition {
  return {
    name: `buffer_draw_frame_buffer_${region ? "region" : "full"}`,
    operation: "drawFrameBuffer",
    description: region ? "Copy an explicit one-cell source region" : "Copy a complete two-cell frame buffer",
    setup: ({ lib }) => {
      const target = lib.createOptimizedBuffer(2, 1, "unicode", false, `ffi-bench-frame-target-${region}`)
      const source = lib.createOptimizedBuffer(2, 1, "unicode", false, `ffi-bench-frame-source-${region}`)
      lib.bufferDrawText(source.ptr, "fr", 0, 0, COLORS.fg, COLORS.bg, 0)
      return {
        run: (operations) => {
          if (region) {
            for (let index = 0; index < operations; index++) {
              lib.drawFrameBuffer(target.ptr, index & 1, 0, source.ptr, index & 1, 0, 1, 1)
            }
          } else {
            for (let index = 0; index < operations; index++) {
              lib.drawFrameBuffer(target.ptr, 0, 0, source.ptr)
            }
          }
          return operations
        },
        observe: () => bufferChecksum(target),
        teardown: () => {
          source.destroy()
          target.destroy()
        },
      }
    },
  }
}

function createDrawTextScenario(variant: "short" | "long" | "unicode", text: string): ScenarioDefinition {
  return createSingleBufferScenario(
    `buffer_draw_text_${variant}`,
    "bufferDrawText",
    `Draw ${variant} text through the encoding and FFI wrapper`,
    Math.max(2, [...text].length + 2),
    1,
    (lib, buffer, operations) => {
      for (let index = 0; index < operations; index++) {
        lib.bufferDrawText(buffer.ptr, text, 0, 0, COLORS.fg, COLORS.bg, index & 1)
      }
      return operations
    },
  )
}

function createDrawCharScenario(packed: boolean): ScenarioDefinition {
  return {
    name: `buffer_draw_char_${packed ? "packed_grapheme" : "scalar"}`,
    operation: "bufferDrawChar",
    description: packed ? "Draw a retained encoded grapheme handle" : "Draw a Unicode scalar value",
    setup: ({ lib }) => {
      const buffer = lib.createOptimizedBuffer(2, 1, "unicode", false, `ffi-bench-char-${packed}`)
      const encoded = packed ? lib.encodeUnicode("👩‍🚀", "unicode") : null
      const char = packed ? encoded?.data[0]?.char : "Z".codePointAt(0)
      if (char === undefined || (packed && char <= 0x80000000)) throw new Error("failed to create packed grapheme")
      return {
        run: (operations) => {
          for (let index = 0; index < operations; index++) {
            lib.bufferDrawChar(buffer.ptr, char, index & 1, 0, COLORS.fg, COLORS.bg, index & 1)
          }
          return operations
        },
        observe: () => bufferChecksum(buffer),
        teardown: () => {
          if (encoded) lib.freeUnicode(encoded)
          buffer.destroy()
        },
      }
    },
  }
}

function createSuperSampleScenario(
  variant: "cell" | "frame",
  terminalWidth: number,
  terminalHeight: number,
): ScenarioDefinition {
  const pixelWidth = terminalWidth * 2
  const pixelHeight = terminalHeight * 2
  const alignedBytesPerRow = pixelWidth * 4
  return {
    name: `buffer_draw_super_sample_buffer_${variant}`,
    operation: "bufferDrawSuperSampleBuffer",
    description: `Draw a ${terminalWidth}x${terminalHeight} terminal image from a retained RGBA pixel buffer`,
    setup: ({ lib }) => {
      const buffer = lib.createOptimizedBuffer(
        terminalWidth,
        terminalHeight,
        "unicode",
        false,
        `ffi-bench-super-sample-${variant}`,
      )
      const pixels = new Uint8Array(alignedBytesPerRow * pixelHeight)
      for (let index = 0; index < pixels.length; index += 4) {
        pixels[index] = (index >>> 2) & 0xff
        pixels[index + 1] = (index >>> 5) & 0xff
        pixels[index + 2] = (index >>> 8) & 0xff
        pixels[index + 3] = 0xff
      }
      const pixelsPtr = ptr(pixels)
      return {
        run: (operations) => {
          for (let index = 0; index < operations; index++) {
            lib.bufferDrawSuperSampleBuffer(
              buffer.ptr,
              0,
              0,
              pixelsPtr,
              pixels.byteLength,
              "rgba8unorm",
              alignedBytesPerRow,
            )
          }
          return operations
        },
        observe: () => bufferChecksum(buffer),
        teardown: () => buffer.destroy(),
      }
    },
  }
}

function createPackedBufferScenario(): ScenarioDefinition {
  return {
    name: "buffer_draw_packed_buffer",
    operation: "bufferDrawPackedBuffer",
    description: "Draw one valid 48-byte CellResult payload",
    setup: ({ lib }) => {
      const buffer = lib.createOptimizedBuffer(1, 1, "unicode", false, "ffi-bench-packed-buffer")
      const packed = new ArrayBuffer(48)
      const floats = new Float32Array(packed)
      floats.set([0.08, 0.12, 0.18, 1, 0.85, 0.9, 1, 1])
      new Uint32Array(packed)[8] = 0x2588
      const packedBytes = new Uint8Array(packed)
      const packedPtr = ptr(packedBytes)
      return {
        run: (operations) => {
          for (let index = 0; index < operations; index++) {
            lib.bufferDrawPackedBuffer(buffer.ptr, packedPtr, packedBytes.byteLength, 0, 0, 1, 1)
          }
          return operations
        },
        observe: () => bufferChecksum(buffer),
        teardown: () => buffer.destroy(),
      }
    },
  }
}

function createGrayscaleScenario(supersampled: boolean): ScenarioDefinition {
  return {
    name: `buffer_draw_grayscale_buffer${supersampled ? "_supersampled" : ""}`,
    operation: supersampled ? "bufferDrawGrayscaleBufferSupersampled" : "bufferDrawGrayscaleBuffer",
    description: supersampled ? "Draw one cell from four grayscale samples" : "Draw one grayscale cell",
    setup: ({ lib }) => {
      const buffer = lib.createOptimizedBuffer(1, 1, "unicode", false, `ffi-bench-grayscale-${supersampled}`)
      const intensities = supersampled ? new Float32Array([0.2, 0.5, 0.8, 1]) : new Float32Array([0.75])
      const intensitiesPtr = ptr(intensities)
      return {
        run: (operations) => {
          if (supersampled) {
            for (let index = 0; index < operations; index++) {
              lib.bufferDrawGrayscaleBufferSupersampled(buffer.ptr, 0, 0, intensitiesPtr, 2, 2, COLORS.fg, COLORS.bg)
            }
          } else {
            for (let index = 0; index < operations; index++) {
              lib.bufferDrawGrayscaleBuffer(buffer.ptr, 0, 0, intensitiesPtr, 1, 1, COLORS.fg, COLORS.bg)
            }
          }
          return operations
        },
        observe: () => bufferChecksum(buffer),
        teardown: () => {
          buffer.destroy()
          void intensities.byteLength
        },
      }
    },
  }
}

function createGridScenario(): ScenarioDefinition {
  return createSingleBufferScenario(
    "buffer_draw_grid",
    "bufferDrawGrid",
    "Draw one 2x2 grid with valid border and offset arrays",
    3,
    3,
    (lib, buffer, operations) => {
      const columnOffsets = new Int32Array([0, 2])
      const rowOffsets = new Int32Array([0, 2])
      for (let index = 0; index < operations; index++) {
        lib.bufferDrawGrid(buffer.ptr, BorderCharArrays.single, COLORS.fg, COLORS.bg, columnOffsets, 1, rowOffsets, 1, {
          drawInner: true,
          drawOuter: true,
        })
      }
      return operations
    },
  )
}

function createBoxScenario(): ScenarioDefinition {
  return createSingleBufferScenario(
    "buffer_draw_box",
    "bufferDrawBox",
    "Draw a titled 4x3 box through the production wrapper",
    4,
    3,
    (lib, buffer, operations) => {
      for (let index = 0; index < operations; index++) {
        lib.bufferDrawBox(
          buffer.ptr,
          0,
          0,
          4,
          3,
          BorderCharArrays.single,
          0b1_1111,
          COLORS.fg,
          COLORS.bg,
          COLORS.fg,
          "T",
          "B",
        )
      }
      return operations
    },
  )
}

function createTextRangeScenario(editable: boolean): ScenarioDefinition {
  return {
    name: `${editable ? "edit" : "text"}_buffer_get_text_range_by_coords`,
    operation: editable ? "editBufferGetTextRangeByCoords" : "textBufferGetTextRangeByCoords",
    description: `Read a coordinate range from a live ${editable ? "EditBuffer" : "TextBuffer"}`,
    setup: ({ lib }) => {
      const text = "alpha beta\ngamma delta\nunicode 界"
      const owner = editable ? EditBuffer.create("unicode") : TextBuffer.create("unicode")
      owner.setText(text)
      const getRange = editable
        ? (startCol: number, endCol: number) =>
            lib.editBufferGetTextRangeByCoords((owner as EditBuffer).ptr, 0, startCol, 1, endCol, 64)
        : (startCol: number, endCol: number) =>
            lib.textBufferGetTextRangeByCoords((owner as TextBuffer).ptr, 0, startCol, 1, endCol, 64)
      return {
        run: (operations) => {
          let signal = 0
          for (let index = 0; index < operations; index++) {
            const bytes = getRange(index & 1, 5 + (index & 1))
            signal = (signal + (bytes?.byteLength ?? 0) + (bytes?.[0] ?? 0)) >>> 0
          }
          return signal
        },
        observe: () =>
          stringChecksum(editable ? (owner as EditBuffer).getText() : (owner as TextBuffer).getPlainText()),
        teardown: () => owner.destroy(),
      }
    },
  }
}

function createTextBufferSelectionScenario(update: boolean): ScenarioDefinition {
  return {
    name: `text_buffer_view_${update ? "update" : "set"}_local_selection`,
    operation: update ? "textBufferViewUpdateLocalSelection" : "textBufferViewSetLocalSelection",
    description: `${update ? "Update" : "Set"} a local selection on a live TextBufferView`,
    setup: ({ lib }) => {
      const buffer = TextBuffer.create("unicode")
      buffer.setText("alpha beta\ngamma delta")
      const view = TextBufferView.create(buffer)
      view.setViewportSize(20, 2)
      view.setLocalSelection(0, 0, 1, 0, COLORS.bg, COLORS.fg)
      return {
        run: (operations) => {
          let signal = 0
          for (let index = 0; index < operations; index++) {
            const focus = index & 1 ? 5 : 9
            const changed = update
              ? lib.textBufferViewUpdateLocalSelection(view.ptr, 0, 0, focus, 0, COLORS.bg, COLORS.fg)
              : lib.textBufferViewSetLocalSelection(view.ptr, 0, 0, focus, 0, COLORS.bg, COLORS.fg)
            signal = (signal + Number(changed) + focus) >>> 0
          }
          return signal
        },
        observe: () => stringChecksum(view.getSelectedText()),
        teardown: () => {
          view.destroy()
          buffer.destroy()
        },
      }
    },
  }
}

function createEditorSelectionScenario(update: boolean): ScenarioDefinition {
  return {
    name: `editor_view_${update ? "update" : "set"}_local_selection`,
    operation: update ? "editorViewUpdateLocalSelection" : "editorViewSetLocalSelection",
    description: `${update ? "Update" : "Set"} a local selection on a live EditorView`,
    setup: ({ lib }) => {
      const buffer = EditBuffer.create("unicode")
      buffer.setText("alpha beta\ngamma delta")
      const view = EditorView.create(buffer, 20, 2)
      view.setLocalSelection(0, 0, 1, 0, COLORS.bg, COLORS.fg, false, false)
      return {
        run: (operations) => {
          let signal = 0
          for (let index = 0; index < operations; index++) {
            const focus = index & 1 ? 5 : 9
            const changed = update
              ? lib.editorViewUpdateLocalSelection(view.ptr, 0, 0, focus, 0, COLORS.bg, COLORS.fg, false, false)
              : lib.editorViewSetLocalSelection(view.ptr, 0, 0, focus, 0, COLORS.bg, COLORS.fg, false, false)
            signal = (signal + Number(changed) + focus) >>> 0
          }
          return signal
        },
        observe: () => stringChecksum(view.getSelectedText()),
        teardown: () => {
          view.destroy()
          buffer.destroy()
        },
      }
    },
  }
}

function createSingleBufferScenario(
  name: string,
  operation: string,
  description: string,
  width: number,
  height: number,
  run: (lib: RenderLib, buffer: OptimizedBuffer, operations: number) => number,
): ScenarioDefinition {
  return {
    name,
    operation,
    description,
    setup: ({ lib }) => {
      const buffer = lib.createOptimizedBuffer(width, height, "unicode", false, `ffi-bench-${name}`)
      return {
        run: (operations) => run(lib, buffer, operations),
        observe: () => bufferChecksum(buffer),
        teardown: () => buffer.destroy(),
      }
    },
  }
}

function runCalibrated(runtime: ScenarioRuntime, targetMs: number, warmupMs: number): TimedRun {
  const targetNs = targetMs * 1_000_000
  const warmupNs = warmupMs * 1_000_000
  let batchOperations = 64
  let warmedNs = 0
  let lastElapsedNs = 1

  while (warmedNs < warmupNs) {
    const warmup = timeRun(runtime, batchOperations)
    warmedNs += warmup.elapsedNs
    lastElapsedNs = Math.max(warmup.elapsedNs, 1)
    const scale = Math.max(0.25, Math.min(64, 5_000_000 / lastElapsedNs))
    batchOperations = clampOperations(Math.round(batchOperations * scale))
  }

  let operations = clampOperations(Math.round((batchOperations * targetNs) / lastElapsedNs))
  let result = timeRun(runtime, operations)
  for (let attempt = 0; attempt < 4; attempt++) {
    if (result.elapsedNs >= targetNs * 0.8 && result.elapsedNs <= targetNs * 1.5) return result
    const scale = Math.max(0.125, Math.min(16, targetNs / Math.max(result.elapsedNs, 1)))
    operations = clampOperations(Math.round(operations * scale))
    result = timeRun(runtime, operations)
  }
  return result
}

function timeRun(runtime: ScenarioRuntime, operations: number): TimedRun {
  const start = process.hrtime.bigint()
  const signal = runtime.run(operations)
  const elapsedNs = Number(process.hrtime.bigint() - start)
  return { elapsedNs, operations, signal }
}

function clampOperations(value: number): number {
  return Math.max(1, Math.min(50_000_000, value))
}

function bufferChecksum(buffer: OptimizedBuffer): number {
  const buffers = buffer.buffers
  let hash = 2166136261
  for (const values of [buffers.char, buffers.fg, buffers.bg, buffers.attributes]) {
    for (let index = 0; index < values.length; index++) {
      hash = Math.imul(hash ^ values[index]!, 16777619)
    }
  }
  return hash >>> 0
}

function stringChecksum(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return hash >>> 0
}

function hashNumbers(...values: number[]): number {
  let hash = 2166136261
  for (const value of values) hash = Math.imul(hash ^ (value >>> 0), 16777619)
  return hash >>> 0
}

function positiveNumberArg(name: string, fallback: number): number {
  const value = Number(optionalArg(name) ?? fallback)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be > 0`)
  return value
}

function requiredArg(name: string): string {
  const value = optionalArg(name)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function optionalArg(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null
}
