import { describe, expect, test } from "bun:test"
import { resolveRenderLib } from "../zig.js"
import { StyledChunkStruct, CursorStyleOptionsStruct } from "../zig-structs.js"
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

function withStubbedSymbols(
  replacements: Record<string, (...args: any[]) => any>,
  fn: (calls: Record<string, any[][]>) => void,
): void {
  const originals: Record<string, (...args: any[]) => any> = {}
  const calls: Record<string, any[][]> = {}
  for (const [name, replacement] of Object.entries(replacements)) {
    originals[name] = symbols[name]!
    calls[name] = []
    symbols[name] = (...args: any[]) => {
      calls[name]!.push(args)
      return replacement(...args)
    }
  }
  try {
    fn(calls)
  } finally {
    for (const [name, original] of Object.entries(originals)) symbols[name] = original
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

  test("clipboard calls pass transient request and output buffers as object values", () => {
    withStubbedSymbols(
      {
        clipboardServiceCreate: () => 1,
        clipboardServiceDestroy: () => 0,
        clipboardReadOperationStart: () => 0,
        clipboardWriteOperationStart: () => 0,
        clipboardClearOperationStart: () => 0,
        clipboardOperationResultMimeLength: () => 0,
        clipboardOperationResultMimeCopy: () => 0,
        clipboardOperationResultDataCopy: () => 0,
        clipboardOperationResultErrorCode: () => 0,
        clipboardOperationResultDiagnosticCopy: () => 0,
      },
      (calls) => {
        const service = lib.clipboardServiceCreate(2, 2, "seat0")!
        lib.clipboardReadOperationStart(service, Uint8Array.of(1, 2), 0, 16, 100)
        lib.clipboardWriteOperationStart(service, Uint8Array.of(3, 4), 0, 100)
        lib.clipboardClearOperationStart(service, 0, 100)
        lib.clipboardOperationResultMimeLength(1 as any)
        lib.clipboardOperationResultMimeCopy(1 as any, new Uint8Array(2))
        lib.clipboardOperationResultDataCopy(1 as any, new Uint8Array(2))
        lib.clipboardOperationResultErrorCode(1 as any)
        lib.clipboardOperationResultDiagnosticCopy(1 as any, new Uint8Array(2))
        lib.clipboardServiceDestroy(service)

        expect(calls.clipboardServiceCreate![0]![2]).toBeInstanceOf(Uint8Array)
        expect(calls.clipboardReadOperationStart![0]![1]).toBeInstanceOf(Uint8Array)
        expect(calls.clipboardReadOperationStart![0]![6]).toBeInstanceOf(Uint32Array)
        expect(calls.clipboardWriteOperationStart![0]![1]).toBeInstanceOf(Uint8Array)
        expect(calls.clipboardWriteOperationStart![0]![5]).toBeInstanceOf(Uint32Array)
        expect(calls.clipboardClearOperationStart![0]![3]).toBeInstanceOf(Uint32Array)
        expect(calls.clipboardOperationResultMimeLength![0]![1]).toBeInstanceOf(Uint32Array)
        expect(calls.clipboardOperationResultMimeCopy![0]![1]).toBeInstanceOf(Uint8Array)
        expect(calls.clipboardOperationResultDataCopy![0]![1]).toBeInstanceOf(Uint8Array)
        expect(calls.clipboardOperationResultErrorCode![0]![1]).toBeInstanceOf(Int32Array)
        expect(calls.clipboardOperationResultDiagnosticCopy![0]![1]).toBeInstanceOf(Uint8Array)
      },
    )
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
