import { describe, expect, test } from "bun:test"
import { NativeAudioStreamState as ExportedAudioStreamState, resolveRenderLib } from "../zig.js"
import {
  AudioCaptureStatsStruct,
  AudioStreamCreateOptionsStruct,
  AudioStreamStatsStruct,
  CursorStyleOptionsStruct,
  GridDrawOptionsStruct,
  LogicalCursorStruct,
  MeasureResultStruct,
  NativeAudioStreamCloseReason,
  NativeAudioStreamFormat,
  NativeAudioStreamState,
  StyledChunkStruct,
  VisualCursorStruct,
} from "../zig-structs.js"
import { RGBA } from "../lib/RGBA.js"
import { toArrayBuffer, type Pointer } from "../platform/ffi.js"

// Borrowed-pointer contract for styled text, styled placeholders, and cursor
// options: packed struct buffers must reach the FFI symbol as object values so
// the backend can borrow them for the synchronous call. Passing a pre-resolved
// address instead reintroduces the Node use-after-free from issue #1212.

const lib = resolveRenderLib()
const symbols = (lib as any).opentui.symbols as Record<string, (...args: any[]) => any>

function withStubbedSymbol(name: string, fn: (calls: any[][]) => void): void {
  const calls: any[][] = []
  const original = symbols[name]
  symbols[name] = (...args: any[]) => {
    calls.push(args)
  }
  try {
    fn(calls)
  } finally {
    symbols[name] = original
  }
}

async function forceGc(): Promise<void> {
  if (typeof Bun !== "undefined") {
    Bun.gc(true)
  }
  ;(globalThis as any).gc?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function fieldOffset(struct: { layoutByName: Map<string, { offset: number }> }, name: string): number {
  const field = struct.layoutByName.get(name)
  if (!field) {
    throw new Error(`Missing struct field: ${name}`)
  }
  return field.offset
}

function readPackedColor(packed: ArrayBuffer, offset: number): number[] {
  // 64-bit StyledChunk/CursorStyleOptions layout; matches the supported
  // x64/arm64 native targets.
  const address = new DataView(packed).getBigUint64(offset, true)
  expect(address).not.toBe(0n)
  return [...new Uint16Array(toArrayBuffer(address as unknown as Pointer, 0, 8).slice(0))]
}

describe("borrowed pointer call sites", () => {
  test("reuses owned output storage while preserving public result identity", () => {
    const originals = {
      editBufferGetCursorPosition: symbols.editBufferGetCursorPosition,
      editorViewGetVisualCursor: symbols.editorViewGetVisualCursor,
      textBufferViewMeasureForDimensions: symbols.textBufferViewMeasureForDimensions,
      audioGetStreamStats: symbols.audioGetStreamStats,
    }
    const outputBuffers: Record<string, ArrayBuffer[]> = {
      logical: [],
      visual: [],
      measure: [],
      audio: [],
    }
    let logicalOffset = 1
    let visualOffset = 10
    let lineCount = 2
    let bytesReceived = 20n

    symbols.editBufferGetCursorPosition = (_buffer, output: ArrayBuffer) => {
      outputBuffers.logical.push(output)
      LogicalCursorStruct.packInto({ row: 0, col: logicalOffset, offset: logicalOffset++ }, new DataView(output), 0)
    }
    symbols.editorViewGetVisualCursor = (_view, output: ArrayBuffer) => {
      outputBuffers.visual.push(output)
      VisualCursorStruct.packInto(
        { visualRow: 0, visualCol: visualOffset, logicalRow: 0, logicalCol: visualOffset, offset: visualOffset++ },
        new DataView(output),
        0,
      )
    }
    symbols.textBufferViewMeasureForDimensions = (_view, _width, _height, output: ArrayBuffer) => {
      outputBuffers.measure.push(output)
      MeasureResultStruct.packInto({ lineCount: lineCount++, widthColsMax: 8 }, new DataView(output), 0)
      return 1
    }
    symbols.audioGetStreamStats = (_engine, _streamId, output: ArrayBuffer) => {
      outputBuffers.audio.push(output)
      AudioStreamStatsStruct.packInto(
        {
          bytesReceived: bytesReceived++,
          framesDecoded: 2n,
          framesPlayed: 1n,
          state: NativeAudioStreamState.Playing,
          sampleRate: 48_000,
          channels: 2,
          bufferedFrames: 100,
          capacityFrames: 200,
          underruns: 0,
          errorCode: 0,
          readyGeneration: 1,
        },
        new DataView(output),
        0,
      )
      return 0
    }

    try {
      const logicalFirst = lib.editBufferGetCursorPosition(1 as any)
      const logicalSecond = lib.editBufferGetCursorPosition(1 as any)
      expect(logicalFirst).not.toBe(logicalSecond)
      expect(logicalFirst.offset).toBe(1)
      expect(logicalSecond.offset).toBe(2)

      const visualFirst = lib.editorViewGetVisualCursor(2 as any)
      const visualSecond = lib.editorViewGetVisualCursor(2 as any)
      expect(visualFirst).not.toBe(visualSecond)
      expect(visualFirst.offset).toBe(10)
      expect(visualSecond.offset).toBe(11)

      const measureFirst = lib.textBufferViewMeasureForDimensions(3 as any, 8, 10)!
      const measureSecond = lib.textBufferViewMeasureForDimensions(3 as any, 8, 10)!
      expect(measureFirst).not.toBe(measureSecond)
      expect(measureFirst.lineCount).toBe(2)
      expect(measureSecond.lineCount).toBe(3)

      const audioFirst = lib.audioGetStreamStats(4 as any, 5)!
      const audioSecond = lib.audioGetStreamStats(4 as any, 5)!
      expect(audioFirst).not.toBe(audioSecond)
      expect(audioFirst.bytesReceived).toBe(20n)
      expect(audioSecond.bytesReceived).toBe(21n)

      for (const buffers of Object.values(outputBuffers)) {
        expect(buffers).toHaveLength(2)
        expect(buffers[0]).toBeInstanceOf(ArrayBuffer)
        expect(buffers[1]).toBe(buffers[0])
      }
    } finally {
      Object.assign(symbols, originals)
    }
  })

  test("grid draw repacks and forwards one owning ArrayBuffer", () => {
    const calls: any[][] = []
    const original = symbols.bufferDrawGrid
    const fg = RGBA.fromValues(1, 1, 1, 1)
    const bg = RGBA.fromValues(0, 0, 0, 1)
    symbols.bufferDrawGrid = (...args: any[]) => calls.push(args)
    try {
      const chars = new Uint32Array(11)
      const offsets = new Int32Array([0, 1])
      lib.bufferDrawGrid(1 as any, chars, fg, bg, offsets, 1, offsets, 1, {
        drawInner: true,
        drawOuter: false,
      })
      const firstBuffer = calls[0]![8] as ArrayBuffer
      expect(firstBuffer).toBeInstanceOf(ArrayBuffer)
      expect(new Uint8Array(firstBuffer).slice(0, GridDrawOptionsStruct.size)).toEqual(new Uint8Array([1, 0]))

      lib.bufferDrawGrid(1 as any, chars, fg, bg, offsets, 1, offsets, 1, {
        drawInner: false,
        drawOuter: true,
      })
      expect(calls[1]![8]).toBe(firstBuffer)
      expect(new Uint8Array(firstBuffer).slice(0, GridDrawOptionsStruct.size)).toEqual(new Uint8Array([0, 1]))
    } finally {
      symbols.bufferDrawGrid = original
    }
  })

  test("all cursor queries return fresh results from reused native storage", () => {
    const logicalQueries = [
      "editBufferGetCursorPosition",
      "editBufferGetNextWordBoundary",
      "editBufferGetPrevWordBoundary",
      "editBufferGetEOL",
    ] as const
    const visualQueries = [
      "editorViewGetVisualCursor",
      "editorViewGetNextWordBoundary",
      "editorViewGetPrevWordBoundary",
      "editorViewGetEOL",
      "editorViewGetVisualSOL",
      "editorViewGetVisualEOL",
    ] as const
    const originals = new Map<string, (...args: any[]) => any>()

    try {
      for (const [index, name] of logicalQueries.entries()) {
        originals.set(name, symbols[name])
        const outputBuffers: ArrayBuffer[] = []
        let offset = index + 2
        symbols[name] = (...args: any[]) => {
          const output = args.at(-1) as ArrayBuffer
          outputBuffers.push(output)
          LogicalCursorStruct.packInto({ row: index, col: index + 1, offset: offset++ }, new DataView(output), 0)
        }
        const first = (lib as any)[name](1)
        const second = (lib as any)[name](1)
        expect(first).not.toBe(second)
        expect(first).toEqual({ row: index, col: index + 1, offset: index + 2 })
        expect(second).toEqual({ row: index, col: index + 1, offset: index + 3 })
        expect(outputBuffers[1]).toBe(outputBuffers[0])
      }

      originals.set("editBufferOffsetToPosition", symbols.editBufferOffsetToPosition)
      const positionBuffers: ArrayBuffer[] = []
      symbols.editBufferOffsetToPosition = (_buffer, offset: number, output: ArrayBuffer) => {
        positionBuffers.push(output)
        LogicalCursorStruct.packInto({ row: 1, col: 2, offset }, new DataView(output), 0)
        return 1
      }
      const firstPosition = lib.editBufferOffsetToPosition(1 as any, 9)
      const secondPosition = lib.editBufferOffsetToPosition(1 as any, 10)
      expect(firstPosition).toEqual({ row: 1, col: 2, offset: 9 })
      expect(secondPosition).toEqual({ row: 1, col: 2, offset: 10 })
      expect(positionBuffers[1]).toBe(positionBuffers[0])

      for (const [index, name] of visualQueries.entries()) {
        originals.set(name, symbols[name])
        const outputBuffers: ArrayBuffer[] = []
        let offset = index + 4
        symbols[name] = (...args: any[]) => {
          const output = args.at(-1) as ArrayBuffer
          outputBuffers.push(output)
          VisualCursorStruct.packInto(
            {
              visualRow: index,
              visualCol: index + 1,
              logicalRow: index + 2,
              logicalCol: index + 3,
              offset: offset++,
            },
            new DataView(output),
            0,
          )
        }
        const first = (lib as any)[name](1)
        const second = (lib as any)[name](1)
        expect(first).not.toBe(second)
        expect(first.offset).toBe(index + 4)
        expect(second.offset).toBe(index + 5)
        expect(outputBuffers[1]).toBe(outputBuffers[0])
      }
    } finally {
      for (const [name, original] of originals) symbols[name] = original
    }
  })

  test("audio stream structs preserve the native ABI", () => {
    expect(AudioStreamCreateOptionsStruct.size).toBe(32)
    expect(
      Object.fromEntries(
        ["capacityMs", "startupMs", "resumeMs", "volume", "pan", "groupId", "maxProbeBytes", "format"].map((name) => [
          name,
          fieldOffset(AudioStreamCreateOptionsStruct, name),
        ]),
      ),
    ).toEqual({
      capacityMs: 0,
      startupMs: 4,
      resumeMs: 8,
      volume: 12,
      pan: 16,
      groupId: 20,
      maxProbeBytes: 24,
      format: 28,
    })

    const packed = AudioStreamCreateOptionsStruct.pack({
      capacityMs: 2000,
      startupMs: 1000,
      resumeMs: 500,
      volume: 0.75,
      pan: -0.25,
      groupId: 7,
      maxProbeBytes: 2 * 1024 * 1024,
      format: NativeAudioStreamFormat.Mp3,
    })
    const view = new DataView(packed)
    expect(view.getUint32(0, true)).toBe(2000)
    expect(view.getUint32(4, true)).toBe(1000)
    expect(view.getUint32(8, true)).toBe(500)
    expect(view.getFloat32(12, true)).toBe(0.75)
    expect(view.getFloat32(16, true)).toBe(-0.25)
    expect(view.getUint32(20, true)).toBe(7)
    expect(view.getUint32(24, true)).toBe(2 * 1024 * 1024)
    expect(view.getUint32(28, true)).toBe(NativeAudioStreamFormat.Mp3)

    expect(AudioStreamStatsStruct.size).toBe(56)
    expect(
      Object.fromEntries(
        [
          "bytesReceived",
          "framesDecoded",
          "framesPlayed",
          "state",
          "sampleRate",
          "channels",
          "bufferedFrames",
          "capacityFrames",
          "underruns",
          "errorCode",
          "readyGeneration",
        ].map((name) => [name, fieldOffset(AudioStreamStatsStruct, name)]),
      ),
    ).toEqual({
      bytesReceived: 0,
      framesDecoded: 8,
      framesPlayed: 16,
      state: 24,
      sampleRate: 28,
      channels: 32,
      bufferedFrames: 36,
      capacityFrames: 40,
      underruns: 44,
      errorCode: 48,
      readyGeneration: 52,
    })
  })

  test("audio capture stats preserve the 40-byte native ABI", () => {
    expect(AudioCaptureStatsStruct.size).toBe(40)
    expect(
      Object.fromEntries(
        [
          "framesReceived",
          "framesRead",
          "framesDropped",
          "sampleRate",
          "channels",
          "bufferedFrames",
          "capacityFrames",
        ].map((name) => [name, fieldOffset(AudioCaptureStatsStruct, name)]),
      ),
    ).toEqual({
      framesReceived: 0,
      framesRead: 8,
      framesDropped: 16,
      sampleRate: 24,
      channels: 28,
      bufferedFrames: 32,
      capacityFrames: 36,
    })
  })

  test("audio capture wrappers pass transient buffers directly and normalize booleans", () => {
    const originals = {
      name: symbols.audioGetCaptureDeviceName,
      isDefault: symbols.audioIsCaptureDeviceDefault,
      start: symbols.audioStartCapture,
      running: symbols.audioIsCaptureRunning,
      read: symbols.audioReadCapture,
      stats: symbols.audioGetCaptureStats,
    }
    const calls: Record<string, any[][]> = { name: [], start: [], read: [], stats: [] }
    symbols.audioGetCaptureDeviceName = (...args: any[]) => {
      calls.name.push(args)
      ;(args[2] as Uint8Array).set(new TextEncoder().encode("Microphone"))
      return 10
    }
    symbols.audioIsCaptureDeviceDefault = () => 1
    symbols.audioIsCaptureRunning = () => 1
    symbols.audioStartCapture = (...args: any[]) => {
      calls.start.push(args)
      return 0
    }
    symbols.audioReadCapture = (...args: any[]) => {
      calls.read.push(args)
      new Uint32Array(args[4] as ArrayBuffer)[0] = 2
      return 0
    }
    symbols.audioGetCaptureStats = (...args: any[]) => {
      calls.stats.push(args)
      AudioCaptureStatsStruct.packInto(
        {
          framesReceived: 5n,
          framesRead: 2n,
          framesDropped: 1n,
          sampleRate: 48_000,
          channels: 1,
          bufferedFrames: 3,
          capacityFrames: 48_000,
        },
        new DataView(args[1] as ArrayBuffer),
        0,
      )
      return 0
    }

    try {
      expect(lib.audioGetCaptureDeviceName(1 as any, 2)).toBe("Microphone")
      expect(lib.audioIsCaptureDeviceDefault(1 as any, 2)).toBe(true)
      expect(lib.audioStartCapture(1 as any, { noFixedSizedCallback: true }, 1, 48_000)).toBe(0)
      expect(lib.audioIsCaptureRunning(1 as any)).toBe(true)
      const output = new Float32Array(4)
      expect(lib.audioReadCapture(1 as any, output, 4)).toEqual({ status: 0, framesRead: 2 })
      expect(lib.audioGetCaptureStats(1 as any)).toEqual({
        status: 0,
        stats: {
          framesReceived: 5n,
          framesRead: 2n,
          framesDropped: 1n,
          sampleRate: 48_000,
          channels: 1,
          bufferedFrames: 3,
          capacityFrames: 48_000,
        },
      })

      expect(calls.name[0]![2]).toBeInstanceOf(Uint8Array)
      expect(calls.start[0]![1]).toBeInstanceOf(ArrayBuffer)
      expect(calls.read[0]![1]).toBe(output)
      expect(calls.read[0]![2]).toBe(output.length)
      expect(calls.read[0]![3]).toBe(4)
      expect(calls.read[0]![4]).toBeInstanceOf(ArrayBuffer)
      expect(calls.stats[0]![1]).toBeInstanceOf(ArrayBuffer)
    } finally {
      symbols.audioGetCaptureDeviceName = originals.name
      symbols.audioIsCaptureDeviceDefault = originals.isDefault
      symbols.audioStartCapture = originals.start
      symbols.audioIsCaptureRunning = originals.running
      symbols.audioReadCapture = originals.read
      symbols.audioGetCaptureStats = originals.stats
    }
  })

  test("audio capture reads forward the destination sample capacity", () => {
    const calls: any[][] = []
    const original = symbols.audioReadCapture
    symbols.audioReadCapture = (...args: any[]) => {
      calls.push(args)
      return -1
    }
    try {
      const output = new Float32Array(3)
      expect(lib.audioReadCapture(1 as any, output, 1)).toEqual({ status: -1, framesRead: 0 })
      expect(calls).toHaveLength(1)
      expect(calls[0]).toHaveLength(5)
      expect(calls[0]![1]).toBe(output)
      expect(calls[0]![2]).toBe(output.length)
      expect(calls[0]![3]).toBe(1)
      expect(calls[0]![4]).toBeInstanceOf(ArrayBuffer)
    } finally {
      symbols.audioReadCapture = original
    }
  })

  test("audio capture start contains option getter failures and defaults callback sizing", () => {
    const calls: any[][] = []
    const original = symbols.audioStartCapture
    symbols.audioStartCapture = (...args: any[]) => {
      calls.push(args)
      return 0
    }
    try {
      expect(lib.audioStartCapture(1 as any, undefined, 1, 48_000)).toBe(0)
      const packed = new Uint8Array(calls[0]![1] as ArrayBuffer)
      expect(packed[17]).toBe(1)

      const options = Object.create({ periods: 3 }) as { periods?: number; noFixedSizedCallback?: boolean }
      Object.defineProperty(options, "noFixedSizedCallback", { value: false, enumerable: false })
      expect(lib.audioStartCapture(1 as any, options, 1, 48_000)).toBe(0)
      const inherited = new DataView(calls[1]![1] as ArrayBuffer)
      expect(inherited.getUint32(8, true)).toBe(3)
      expect(inherited.getUint8(17)).toBe(0)

      const throwing = {
        get periods(): number {
          throw new Error("getter failed")
        },
      }
      expect(lib.audioStartCapture(1 as any, throwing, 1, 48_000)).toBe(-1)
      expect(calls).toHaveLength(2)
    } finally {
      symbols.audioStartCapture = original
    }
  })

  test("audioCloseStream forwards its reason and unpacks the owned output buffer", () => {
    const calls: any[][] = []
    const original = symbols.audioCloseStream
    symbols.audioCloseStream = (...args: any[]) => {
      calls.push(args)
      AudioStreamStatsStruct.packInto(
        {
          bytesReceived: 123n,
          framesDecoded: 456n,
          framesPlayed: 321n,
          state: NativeAudioStreamState.Failed,
          sampleRate: 44_100,
          channels: 2,
          bufferedFrames: 0,
          capacityFrames: 44_100,
          underruns: 3,
          errorCode: -3,
          readyGeneration: 7,
        },
        new DataView(args[3]),
        0,
      )
      return 0
    }
    try {
      const result = lib.audioCloseStream(11 as any, 22, NativeAudioStreamCloseReason.TransportError)
      expect(calls).toHaveLength(1)
      expect(calls[0]![0]).toBe(11)
      expect(calls[0]![1]).toBe(22)
      expect(calls[0]![2]).toBe(NativeAudioStreamCloseReason.TransportError)
      expect(calls[0]![3]).toBeInstanceOf(ArrayBuffer)
      expect(result).toEqual({
        status: 0,
        stats: {
          bytesReceived: 123n,
          framesDecoded: 456n,
          framesPlayed: 321n,
          state: NativeAudioStreamState.Failed,
          sampleRate: 44_100,
          channels: 2,
          bufferedFrames: 0,
          capacityFrames: 44_100,
          underruns: 3,
          errorCode: -3,
          readyGeneration: 7,
        },
      })
      expect(ExportedAudioStreamState).toBe(NativeAudioStreamState)
    } finally {
      symbols.audioCloseStream = original
    }
  })

  test("audioWriteStream passes the byte owner directly and forwards count, zero, and errors", () => {
    const calls: any[][] = []
    const original = symbols.audioWriteStream
    const results = [3, 0, -4, 0]
    symbols.audioWriteStream = (...args: any[]) => {
      calls.push(args)
      return results.shift()
    }
    try {
      const bytes = new Uint8Array([1, 2, 3])
      expect(lib.audioWriteStream(0 as any, 1, bytes)).toBe(3)
      expect(lib.audioWriteStream(0 as any, 1, bytes)).toBe(0)
      expect(lib.audioWriteStream(0 as any, 1, bytes)).toBe(-4)
      expect(lib.audioWriteStream(0 as any, 1, new Uint8Array())).toBe(0)
      expect(calls).toHaveLength(4)
      expect(calls[0]).toHaveLength(4)
      expect(calls[0]![2]).toBe(bytes)
      expect(calls[0]![3]).toBe(bytes.byteLength)
      expect(calls[3]![2]).toBeNull()
      expect(calls[3]![3]).toBe(0)
    } finally {
      symbols.audioWriteStream = original
    }
  })

  test("stream create wrappers reject invalid groups and formats before FFI conversion", () => {
    withStubbedSymbol("audioCreateStream", (calls) => {
      expect(lib.audioSetStreamGroup(0 as any, 1, 1.5)).toBe(-1)
      expect(
        lib.audioCreateStream(0 as any, {
          capacityMs: 100,
          startupMs: 10,
          resumeMs: 10,
          maxProbeBytes: 1024 * 1024,
          format: NativeAudioStreamFormat.Mp3,
          volume: 1,
          pan: 0,
          groupId: 1.5,
        }),
      ).toEqual({ status: -1, streamId: null })
      const validOptions = {
        capacityMs: 100,
        startupMs: 10,
        resumeMs: 10,
        maxProbeBytes: 1024 * 1024,
        volume: 1,
        pan: 0,
        groupId: 0,
      }
      void lib.audioCreateStream(0 as any, {
        ...validOptions,
        format: NativeAudioStreamFormat.Flac,
      })
      expect(
        lib.audioCreateStream(0 as any, {
          ...validOptions,
          format: 1.5 as never,
        }),
      ).toEqual({ status: -1, streamId: null })
      expect(
        lib.audioCreateStream(0 as any, {
          ...validOptions,
          format: 3 as never,
        }),
      ).toEqual({ status: -1, streamId: null })
      expect(calls).toHaveLength(1)
    })
  })

  test("textBufferSetStyledText passes the packed chunk buffer as an object value", () => {
    withStubbedSymbol("textBufferSetStyledText", (calls) => {
      const chunks = [
        { text: "hello", fg: RGBA.fromValues(1, 0, 0, 1) },
        { text: "world", bg: RGBA.fromValues(0, 0, 1, 1) },
      ]

      lib.textBufferSetStyledText(0 as any, chunks)

      expect(calls).toHaveLength(1)
      expect(calls[0]![1]).toBeInstanceOf(ArrayBuffer)
      expect((calls[0]![1] as ArrayBuffer).byteLength).toBe(StyledChunkStruct.size * chunks.length)
      expect(calls[0]![2]).toBe(chunks.length)
    })
  })

  test("editorViewSetPlaceholderStyledText passes the packed chunk buffer as an object value", () => {
    withStubbedSymbol("editorViewSetPlaceholderStyledText", (calls) => {
      lib.editorViewSetPlaceholderStyledText(0 as any, [{ text: "placeholder", fg: RGBA.fromValues(0, 1, 0, 1) }])
      lib.editorViewSetPlaceholderStyledText(0 as any, [{ text: "" }])

      expect(calls).toHaveLength(2)
      expect(calls[0]![1]).toBeInstanceOf(ArrayBuffer)
      expect((calls[0]![1] as ArrayBuffer).byteLength).toBe(StyledChunkStruct.size)
      expect(calls[1]![1]).toBeNull()
      expect(calls[1]![2]).toBe(0)
    })
  })

  test("setCursorStyleOptions passes the packed options buffer as an object value", () => {
    withStubbedSymbol("setCursorStyleOptions", (calls) => {
      lib.setCursorStyleOptions(0 as any, { style: "block", blinking: true, color: RGBA.fromValues(1, 1, 0, 1) })

      expect(calls).toHaveLength(1)
      expect(calls[0]![1]).toBeInstanceOf(ArrayBuffer)
      expect((calls[0]![1] as ArrayBuffer).byteLength).toBe(CursorStyleOptionsStruct.size)
    })
  })
})

describe("packed color owner retention", () => {
  test("styled chunk fg and bg colors stay readable after GC of transient chunks", async () => {
    const fgOffset = fieldOffset(StyledChunkStruct, "fg")
    const bgOffset = fieldOffset(StyledChunkStruct, "bg")

    const packTransientChunks = (count: number) => {
      const chunks = []
      const expected = []
      for (let i = 0; i < count; i++) {
        const fg = RGBA.fromValues((i % 16) / 15, 0, 1, 1)
        const bg = RGBA.fromValues(0, (i % 16) / 15, 0, 1)
        chunks.push({ text: `chunk-${i}`, fg, bg })
        expected.push({ fg: [...fg.buffer], bg: [...bg.buffer] })
      }
      // The chunk objects and their RGBA instances are unreachable after this
      // returns; only the packed buffer may keep the color memory alive.
      return { packed: StyledChunkStruct.packList(chunks), expected }
    }

    const count = 16
    const { packed, expected } = packTransientChunks(count)

    for (let round = 0; round < 20; round++) {
      const churn = []
      for (let i = 0; i < 2048; i++) {
        churn.push(new Uint16Array(4).fill(round))
      }
      await forceGc()

      for (let i = 0; i < count; i++) {
        const base = i * StyledChunkStruct.size
        expect(readPackedColor(packed, base + fgOffset)).toEqual(expected[i]!.fg)
        expect(readPackedColor(packed, base + bgOffset)).toEqual(expected[i]!.bg)
      }
    }
  })

  test("cursor style color stays readable after GC of the transient RGBA", async () => {
    const colorOffset = fieldOffset(CursorStyleOptionsStruct, "color")

    const packTransientColor = () => {
      const color = RGBA.fromValues(0.5, 0.25, 0.75, 1)
      return {
        packed: CursorStyleOptionsStruct.pack({ style: 255, blinking: 255, color, cursor: 255 }),
        expected: [...color.buffer],
      }
    }

    const { packed, expected } = packTransientColor()

    for (let round = 0; round < 20; round++) {
      const churn = []
      for (let i = 0; i < 2048; i++) {
        churn.push(new Uint16Array(4).fill(round))
      }
      await forceGc()

      expect(readPackedColor(packed, colorOffset)).toEqual(expected)
    }
  })
})
