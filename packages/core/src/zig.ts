import { dlopen, toArrayBuffer, JSCallback, ptr, type Pointer } from "bun:ffi"
import { existsSync } from "fs"
import { type CursorStyle, type DebugOverlayCorner, type WidthMethod } from "./types"
import { RGBA } from "./lib/RGBA"
import { OptimizedBuffer } from "./buffer"
import { TextBuffer } from "./text-buffer"

const module = await import(`@opentui/core-${process.platform}-${process.arch}/index.ts`)
const targetLibPath = module.default
if (!existsSync(targetLibPath)) {
  throw new Error(`opentui is not supported on the current platform: ${process.platform}-${process.arch}`)
}

function getOpenTUILib(libPath?: string) {
  const resolvedLibPath = libPath || targetLibPath

  const rawSymbols = dlopen(resolvedLibPath, {
    // Logging
    setLogCallback: {
      args: ["ptr"],
      returns: "void",
    },
    // Renderer management
    createRenderer: {
      args: ["u32", "u32", "bool"],
      returns: "ptr",
    },
    destroyRenderer: {
      args: ["ptr"],
      returns: "void",
    },
    setUseThread: {
      args: ["ptr", "bool"],
      returns: "void",
    },
    setBackgroundColor: {
      args: ["ptr", "ptr"],
      returns: "void",
    },
    setRenderOffset: {
      args: ["ptr", "u32"],
      returns: "void",
    },
    updateStats: {
      args: ["ptr", "f64", "u32", "f64"],
      returns: "void",
    },
    updateMemoryStats: {
      args: ["ptr", "u32", "u32", "u32"],
      returns: "void",
    },
    render: {
      args: ["ptr", "bool"],
      returns: "void",
    },
    getNextBuffer: {
      args: ["ptr"],
      returns: "ptr",
    },
    getCurrentBuffer: {
      args: ["ptr"],
      returns: "ptr",
    },

    createOptimizedBuffer: {
      args: ["u32", "u32", "bool", "u8", "ptr", "usize"],
      returns: "ptr",
    },
    destroyOptimizedBuffer: {
      args: ["ptr"],
      returns: "void",
    },

    drawFrameBuffer: {
      args: ["ptr", "i32", "i32", "ptr", "u32", "u32", "u32", "u32"],
      returns: "void",
    },
    getBufferWidth: {
      args: ["ptr"],
      returns: "u32",
    },
    getBufferHeight: {
      args: ["ptr"],
      returns: "u32",
    },
    bufferClear: {
      args: ["ptr", "ptr"],
      returns: "void",
    },
    bufferGetCharPtr: {
      args: ["ptr"],
      returns: "ptr",
    },
    bufferGetFgPtr: {
      args: ["ptr"],
      returns: "ptr",
    },
    bufferGetBgPtr: {
      args: ["ptr"],
      returns: "ptr",
    },
    bufferGetAttributesPtr: {
      args: ["ptr"],
      returns: "ptr",
    },
    bufferGetRespectAlpha: {
      args: ["ptr"],
      returns: "bool",
    },
    bufferSetRespectAlpha: {
      args: ["ptr", "bool"],
      returns: "void",
    },
    bufferGetId: {
      args: ["ptr", "ptr", "usize"],
      returns: "usize",
    },
    bufferGetRealCharSize: {
      args: ["ptr"],
      returns: "u32",
    },
    bufferWriteResolvedChars: {
      args: ["ptr", "ptr", "usize", "bool"],
      returns: "u32",
    },

    bufferDrawText: {
      args: ["ptr", "ptr", "u32", "u32", "u32", "ptr", "ptr", "u8"],
      returns: "void",
    },
    bufferSetCellWithAlphaBlending: {
      args: ["ptr", "u32", "u32", "u32", "ptr", "ptr", "u8"],
      returns: "void",
    },
    bufferSetCell: {
      args: ["ptr", "u32", "u32", "u32", "ptr", "ptr", "u8"],
      returns: "void",
    },
    bufferFillRect: {
      args: ["ptr", "u32", "u32", "u32", "u32", "ptr"],
      returns: "void",
    },
    bufferResize: {
      args: ["ptr", "u32", "u32"],
      returns: "void",
    },

    resizeRenderer: {
      args: ["ptr", "u32", "u32"],
      returns: "void",
    },

    // Cursor functions (now renderer-scoped)
    setCursorPosition: {
      args: ["ptr", "i32", "i32", "bool"],
      returns: "void",
    },
    setCursorStyle: {
      args: ["ptr", "ptr", "u32", "bool"],
      returns: "void",
    },
    setCursorColor: {
      args: ["ptr", "ptr"],
      returns: "void",
    },

    // Debug overlay
    setDebugOverlay: {
      args: ["ptr", "bool", "u8"],
      returns: "void",
    },

    // Terminal control
    clearTerminal: {
      args: ["ptr"],
      returns: "void",
    },
    setTerminalTitle: {
      args: ["ptr", "ptr", "usize"],
      returns: "void",
    },

    bufferDrawSuperSampleBuffer: {
      args: ["ptr", "u32", "u32", "ptr", "usize", "u8", "u32"],
      returns: "void",
    },
    bufferDrawPackedBuffer: {
      args: ["ptr", "ptr", "usize", "u32", "u32", "u32", "u32"],
      returns: "void",
    },
    bufferDrawBox: {
      args: ["ptr", "i32", "i32", "u32", "u32", "ptr", "u32", "ptr", "ptr", "ptr", "u32"],
      returns: "void",
    },
    bufferPushScissorRect: {
      args: ["ptr", "i32", "i32", "u32", "u32"],
      returns: "void",
    },
    bufferPopScissorRect: {
      args: ["ptr"],
      returns: "void",
    },
    bufferClearScissorRects: {
      args: ["ptr"],
      returns: "void",
    },

    addToHitGrid: {
      args: ["ptr", "i32", "i32", "u32", "u32", "u32"],
      returns: "void",
    },
    checkHit: {
      args: ["ptr", "u32", "u32"],
      returns: "u32",
    },
    dumpHitGrid: {
      args: ["ptr"],
      returns: "void",
    },
    dumpBuffers: {
      args: ["ptr", "i64"],
      returns: "void",
    },
    dumpStdoutBuffer: {
      args: ["ptr", "i64"],
      returns: "void",
    },
    enableMouse: {
      args: ["ptr", "bool"],
      returns: "void",
    },
    disableMouse: {
      args: ["ptr"],
      returns: "void",
    },
    enableKittyKeyboard: {
      args: ["ptr", "u8"],
      returns: "void",
    },
    disableKittyKeyboard: {
      args: ["ptr"],
      returns: "void",
    },
    setupTerminal: {
      args: ["ptr", "bool"],
      returns: "void",
    },

    // TextBuffer functions
    createTextBuffer: {
      args: ["u8"],
      returns: "ptr",
    },
    destroyTextBuffer: {
      args: ["ptr"],
      returns: "void",
    },
    textBufferGetLength: {
      args: ["ptr"],
      returns: "u32",
    },

    textBufferReset: {
      args: ["ptr"],
      returns: "void",
    },
    textBufferSetSelection: {
      args: ["ptr", "u32", "u32", "ptr", "ptr"],
      returns: "void",
    },
    textBufferResetSelection: {
      args: ["ptr"],
      returns: "void",
    },
    textBufferSetDefaultFg: {
      args: ["ptr", "ptr"],
      returns: "void",
    },
    textBufferSetDefaultBg: {
      args: ["ptr", "ptr"],
      returns: "void",
    },
    textBufferSetDefaultAttributes: {
      args: ["ptr", "ptr"],
      returns: "void",
    },
    textBufferResetDefaults: {
      args: ["ptr"],
      returns: "void",
    },
    textBufferWriteChunk: {
      args: ["ptr", "ptr", "u32", "ptr", "ptr", "ptr"],
      returns: "u32",
    },
    textBufferFinalizeLineInfo: {
      args: ["ptr"],
      returns: "void",
    },
    textBufferGetLineCount: {
      args: ["ptr"],
      returns: "u32",
    },
    textBufferGetLineInfoDirect: {
      args: ["ptr", "ptr", "ptr"],
      returns: "u32",
    },
    textBufferGetSelectionInfo: {
      args: ["ptr"],
      returns: "u64",
    },
    textBufferGetSelectedText: {
      args: ["ptr", "ptr", "usize"],
      returns: "usize",
    },
    textBufferGetPlainText: {
      args: ["ptr", "ptr", "usize"],
      returns: "usize",
    },
    textBufferSetLocalSelection: {
      args: ["ptr", "i32", "i32", "i32", "i32", "ptr", "ptr"],
      returns: "bool",
    },
    textBufferResetLocalSelection: {
      args: ["ptr"],
      returns: "void",
    },
    textBufferInsertChunkGroup: {
      args: ["ptr", "usize", "ptr", "u32", "ptr", "ptr", "u8"],
      returns: "u32",
    },
    textBufferRemoveChunkGroup: {
      args: ["ptr", "usize"],
      returns: "u32",
    },
    textBufferReplaceChunkGroup: {
      args: ["ptr", "usize", "ptr", "u32", "ptr", "ptr", "u8"],
      returns: "u32",
    },
    textBufferGetChunkGroupCount: {
      args: ["ptr"],
      returns: "usize",
    },
    textBufferSetWrapWidth: {
      args: ["ptr", "u32"],
      returns: "void",
    },
    textBufferSetWrapMode: {
      args: ["ptr", "u8"],
      returns: "void",
    },

    getArenaAllocatedBytes: {
      args: [],
      returns: "usize",
    },

    bufferDrawTextBuffer: {
      args: ["ptr", "ptr", "i32", "i32", "i32", "i32", "u32", "u32", "bool"],
      returns: "void",
    },

    // Terminal capability functions
    getTerminalCapabilities: {
      args: ["ptr", "ptr"],
      returns: "void",
    },
    processCapabilityResponse: {
      args: ["ptr", "ptr", "usize"],
      returns: "void",
    },
  })

  if (process.env.DEBUG_FFI === "true" || process.env.TRACE_FFI === "true") {
    return {
      symbols: convertToDebugSymbols(rawSymbols.symbols),
    }
  }

  return rawSymbols
}

function convertToDebugSymbols<T extends Record<string, any>>(symbols: T): T {
  const debugSymbols: Record<string, any> = {}
  const traceSymbols: Record<string, any> = {}
  let hasTracing = false

  Object.entries(symbols).forEach(([key, value]) => {
    debugSymbols[key] = value
  })

  if (process.env.DEBUG_FFI === "true") {
    Object.entries(symbols).forEach(([key, value]) => {
      if (typeof value === "function") {
        debugSymbols[key] = (...args: any[]) => {
          console.log(`${key}(${args.map((arg) => String(arg)).join(", ")})`)
          const result = value(...args)
          console.log(`${key} returned:`, String(result))
          return result
        }
      }
    })
  }

  if (process.env.TRACE_FFI === "true") {
    hasTracing = true
    Object.entries(symbols).forEach(([key, value]) => {
      if (typeof value === "function") {
        traceSymbols[key] = []
        const originalFunc = debugSymbols[key]
        debugSymbols[key] = (...args: any[]) => {
          const start = performance.now()
          const result = originalFunc(...args)
          const end = performance.now()
          traceSymbols[key].push(end - start)
          return result
        }
      }
    })
  }

  if (hasTracing) {
    process.on("exit", () => {
      const allStats: Array<{
        name: string
        count: number
        total: number
        average: number
        min: number
        max: number
        median: number
        p90: number
        p99: number
      }> = []

      for (const [key, timings] of Object.entries(traceSymbols)) {
        if (!Array.isArray(timings) || timings.length === 0) {
          continue
        }

        const sortedTimings = [...timings].sort((a, b) => a - b)
        const count = sortedTimings.length

        const total = sortedTimings.reduce((acc, t) => acc + t, 0)
        const average = total / count
        const min = sortedTimings[0]
        const max = sortedTimings[count - 1]

        const medianIndex = Math.floor(count / 2)
        const p90Index = Math.floor(count * 0.9)
        const p99Index = Math.floor(count * 0.99)

        const median = sortedTimings[medianIndex]
        const p90 = sortedTimings[Math.min(p90Index, count - 1)]
        const p99 = sortedTimings[Math.min(p99Index, count - 1)]

        allStats.push({
          name: key,
          count,
          total,
          average,
          min,
          max,
          median,
          p90,
          p99,
        })
      }

      allStats.sort((a, b) => b.total - a.total)

      console.log("\n--- OpenTUI FFI Call Performance ---")
      console.log("Sorted by total time spent (descending)")
      console.log(
        "-------------------------------------------------------------------------------------------------------------------------",
      )

      if (allStats.length === 0) {
        console.log("No trace data collected or all symbols had zero calls.")
      } else {
        const nameHeader = "Symbol"
        const callsHeader = "Calls"
        const totalHeader = "Total (ms)"
        const avgHeader = "Avg (ms)"
        const minHeader = "Min (ms)"
        const maxHeader = "Max (ms)"
        const medHeader = "Med (ms)"
        const p90Header = "P90 (ms)"
        const p99Header = "P99 (ms)"

        const nameWidth = Math.max(nameHeader.length, ...allStats.map((s) => s.name.length))
        const countWidth = Math.max(callsHeader.length, ...allStats.map((s) => String(s.count).length))
        const totalWidth = Math.max(totalHeader.length, ...allStats.map((s) => s.total.toFixed(2).length))
        const avgWidth = Math.max(avgHeader.length, ...allStats.map((s) => s.average.toFixed(2).length))
        const minWidth = Math.max(minHeader.length, ...allStats.map((s) => s.min.toFixed(2).length))
        const maxWidth = Math.max(maxHeader.length, ...allStats.map((s) => s.max.toFixed(2).length))
        const medianWidth = Math.max(medHeader.length, ...allStats.map((s) => s.median.toFixed(2).length))
        const p90Width = Math.max(p90Header.length, ...allStats.map((s) => s.p90.toFixed(2).length))
        const p99Width = Math.max(p99Header.length, ...allStats.map((s) => s.p99.toFixed(2).length))

        // Header
        console.log(
          `${nameHeader.padEnd(nameWidth)} | ` +
            `${callsHeader.padStart(countWidth)} | ` +
            `${totalHeader.padStart(totalWidth)} | ` +
            `${avgHeader.padStart(avgWidth)} | ` +
            `${minHeader.padStart(minWidth)} | ` +
            `${maxHeader.padStart(maxWidth)} | ` +
            `${medHeader.padStart(medianWidth)} | ` +
            `${p90Header.padStart(p90Width)} | ` +
            `${p99Header.padStart(p99Width)}`,
        )
        // Separator
        console.log(
          `${"-".repeat(nameWidth)}-+-${"-".repeat(countWidth)}-+-${"-".repeat(totalWidth)}-+-${"-".repeat(avgWidth)}-+-${"-".repeat(minWidth)}-+-${"-".repeat(maxWidth)}-+-${"-".repeat(medianWidth)}-+-${"-".repeat(p90Width)}-+-${"-".repeat(p99Width)}`,
        )

        allStats.forEach((stat) => {
          console.log(
            `${stat.name.padEnd(nameWidth)} | ` +
              `${String(stat.count).padStart(countWidth)} | ` +
              `${stat.total.toFixed(2).padStart(totalWidth)} | ` +
              `${stat.average.toFixed(2).padStart(avgWidth)} | ` +
              `${stat.min.toFixed(2).padStart(minWidth)} | ` +
              `${stat.max.toFixed(2).padStart(maxWidth)} | ` +
              `${stat.median.toFixed(2).padStart(medianWidth)} | ` +
              `${stat.p90.toFixed(2).padStart(p90Width)} | ` +
              `${stat.p99.toFixed(2).padStart(p99Width)}`,
          )
        })
      }
      console.log(
        "-------------------------------------------------------------------------------------------------------------------------",
      )
    })
  }

  return debugSymbols as T
}

// Log levels matching Zig's LogLevel enum
export enum LogLevel {
  Error = 0,
  Warn = 1,
  Info = 2,
  Debug = 3,
}

export interface LineInfo {
  lineStarts: number[]
  lineWidths: number[]
  maxLineWidth: number
}

export interface RenderLib {
  createRenderer: (width: number, height: number, options?: { testing: boolean }) => Pointer | null
  destroyRenderer: (renderer: Pointer) => void
  setUseThread: (renderer: Pointer, useThread: boolean) => void
  setBackgroundColor: (renderer: Pointer, color: RGBA) => void
  setRenderOffset: (renderer: Pointer, offset: number) => void
  updateStats: (renderer: Pointer, time: number, fps: number, frameCallbackTime: number) => void
  updateMemoryStats: (renderer: Pointer, heapUsed: number, heapTotal: number, arrayBuffers: number) => void
  render: (renderer: Pointer, force: boolean) => void
  getNextBuffer: (renderer: Pointer) => OptimizedBuffer
  getCurrentBuffer: (renderer: Pointer) => OptimizedBuffer
  createOptimizedBuffer: (
    width: number,
    height: number,
    widthMethod: WidthMethod,
    respectAlpha?: boolean,
    id?: string,
  ) => OptimizedBuffer
  destroyOptimizedBuffer: (bufferPtr: Pointer) => void
  drawFrameBuffer: (
    targetBufferPtr: Pointer,
    destX: number,
    destY: number,
    bufferPtr: Pointer,
    sourceX?: number,
    sourceY?: number,
    sourceWidth?: number,
    sourceHeight?: number,
  ) => void
  getBufferWidth: (buffer: Pointer) => number
  getBufferHeight: (buffer: Pointer) => number
  bufferClear: (buffer: Pointer, color: RGBA) => void
  bufferGetCharPtr: (buffer: Pointer) => Pointer
  bufferGetFgPtr: (buffer: Pointer) => Pointer
  bufferGetBgPtr: (buffer: Pointer) => Pointer
  bufferGetAttributesPtr: (buffer: Pointer) => Pointer
  bufferGetRespectAlpha: (buffer: Pointer) => boolean
  bufferSetRespectAlpha: (buffer: Pointer, respectAlpha: boolean) => void
  bufferGetId: (buffer: Pointer) => string
  bufferGetRealCharSize: (buffer: Pointer) => number
  bufferWriteResolvedChars: (buffer: Pointer, outputBuffer: Uint8Array, addLineBreaks: boolean) => number
  bufferDrawText: (
    buffer: Pointer,
    text: string,
    x: number,
    y: number,
    color: RGBA,
    bgColor?: RGBA,
    attributes?: number,
  ) => void
  bufferSetCellWithAlphaBlending: (
    buffer: Pointer,
    x: number,
    y: number,
    char: string,
    color: RGBA,
    bgColor: RGBA,
    attributes?: number,
  ) => void
  bufferSetCell: (
    buffer: Pointer,
    x: number,
    y: number,
    char: string,
    color: RGBA,
    bgColor: RGBA,
    attributes?: number,
  ) => void
  bufferFillRect: (buffer: Pointer, x: number, y: number, width: number, height: number, color: RGBA) => void
  bufferDrawSuperSampleBuffer: (
    buffer: Pointer,
    x: number,
    y: number,
    pixelDataPtr: Pointer,
    pixelDataLength: number,
    format: "bgra8unorm" | "rgba8unorm",
    alignedBytesPerRow: number,
  ) => void
  bufferDrawPackedBuffer: (
    buffer: Pointer,
    dataPtr: Pointer,
    dataLen: number,
    posX: number,
    posY: number,
    terminalWidthCells: number,
    terminalHeightCells: number,
  ) => void
  bufferDrawBox: (
    buffer: Pointer,
    x: number,
    y: number,
    width: number,
    height: number,
    borderChars: Uint32Array,
    packedOptions: number,
    borderColor: RGBA,
    backgroundColor: RGBA,
    title: string | null,
  ) => void
  bufferResize: (buffer: Pointer, width: number, height: number) => void
  resizeRenderer: (renderer: Pointer, width: number, height: number) => void
  setCursorPosition: (renderer: Pointer, x: number, y: number, visible: boolean) => void
  setCursorStyle: (renderer: Pointer, style: CursorStyle, blinking: boolean) => void
  setCursorColor: (renderer: Pointer, color: RGBA) => void
  setDebugOverlay: (renderer: Pointer, enabled: boolean, corner: DebugOverlayCorner) => void
  clearTerminal: (renderer: Pointer) => void
  setTerminalTitle: (renderer: Pointer, title: string) => void
  addToHitGrid: (renderer: Pointer, x: number, y: number, width: number, height: number, id: number) => void
  checkHit: (renderer: Pointer, x: number, y: number) => number
  dumpHitGrid: (renderer: Pointer) => void
  dumpBuffers: (renderer: Pointer, timestamp?: number) => void
  dumpStdoutBuffer: (renderer: Pointer, timestamp?: number) => void
  enableMouse: (renderer: Pointer, enableMovement: boolean) => void
  disableMouse: (renderer: Pointer) => void
  enableKittyKeyboard: (renderer: Pointer, flags: number) => void
  disableKittyKeyboard: (renderer: Pointer) => void
  setupTerminal: (renderer: Pointer, useAlternateScreen: boolean) => void

  // TextBuffer methods
  createTextBuffer: (widthMethod: WidthMethod) => TextBuffer
  destroyTextBuffer: (buffer: Pointer) => void
  textBufferGetLength: (buffer: Pointer) => number

  textBufferReset: (buffer: Pointer) => void
  textBufferSetSelection: (
    buffer: Pointer,
    start: number,
    end: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ) => void
  textBufferResetSelection: (buffer: Pointer) => void
  textBufferSetLocalSelection: (
    buffer: Pointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ) => boolean
  textBufferResetLocalSelection: (buffer: Pointer) => void
  textBufferSetDefaultFg: (buffer: Pointer, fg: RGBA | null) => void
  textBufferSetDefaultBg: (buffer: Pointer, bg: RGBA | null) => void
  textBufferSetDefaultAttributes: (buffer: Pointer, attributes: number | null) => void
  textBufferResetDefaults: (buffer: Pointer) => void
  textBufferWriteChunk: (
    buffer: Pointer,
    textBytes: Uint8Array,
    fg: RGBA | null,
    bg: RGBA | null,
    attributes: number | null,
  ) => number
  textBufferFinalizeLineInfo: (buffer: Pointer) => void
  textBufferGetLineCount: (buffer: Pointer) => number
  textBufferGetLineInfoDirect: (buffer: Pointer, lineStartsPtr: Pointer, lineWidthsPtr: Pointer) => void
  textBufferGetLineInfo: (buffer: Pointer) => LineInfo
  textBufferGetSelection: (buffer: Pointer) => { start: number; end: number } | null
  getSelectedTextBytes: (buffer: Pointer, maxLength: number) => Uint8Array | null
  getPlainTextBytes: (buffer: Pointer, maxLength: number) => Uint8Array | null
  readonly encoder: TextEncoder
  readonly decoder: TextDecoder
  bufferDrawTextBuffer: (
    buffer: Pointer,
    textBuffer: Pointer,
    x: number,
    y: number,
    clipRect?: { x: number; y: number; width: number; height: number },
  ) => void
  bufferPushScissorRect: (buffer: Pointer, x: number, y: number, width: number, height: number) => void
  bufferPopScissorRect: (buffer: Pointer) => void
  bufferClearScissorRects: (buffer: Pointer) => void

  textBufferInsertChunkGroup: (
    buffer: Pointer,
    index: number,
    textBytes: Uint8Array,
    fg: RGBA | null,
    bg: RGBA | null,
    attributes: number | null,
  ) => number
  textBufferRemoveChunkGroup: (buffer: Pointer, index: number) => number
  textBufferReplaceChunkGroup: (
    buffer: Pointer,
    index: number,
    textBytes: Uint8Array,
    fg: RGBA | null,
    bg: RGBA | null,
    attributes: number | null,
  ) => number
  textBufferGetChunkGroupCount: (buffer: Pointer) => number
  textBufferSetWrapWidth: (buffer: Pointer, width: number) => void
  textBufferSetWrapMode: (buffer: Pointer, mode: "char" | "word") => void

  getArenaAllocatedBytes: () => number

  getTerminalCapabilities: (renderer: Pointer) => any
  processCapabilityResponse: (renderer: Pointer, response: string) => void
}

class FFIRenderLib implements RenderLib {
  private opentui: ReturnType<typeof getOpenTUILib>
  public readonly encoder: TextEncoder = new TextEncoder()
  public readonly decoder: TextDecoder = new TextDecoder()
  private logCallbackWrapper: any // Store the FFI callback wrapper

  constructor(libPath?: string) {
    this.opentui = getOpenTUILib(libPath)
    this.setupLogging()
  }

  private setupLogging() {
    if (this.logCallbackWrapper) {
      return
    }

    const logCallback = new JSCallback(
      (level: number, msgPtr: Pointer, msgLenBigInt: bigint | number) => {
        try {
          const msgLen = typeof msgLenBigInt === "bigint" ? Number(msgLenBigInt) : msgLenBigInt

          if (msgLen === 0 || !msgPtr) {
            return
          }

          const msgBuffer = toArrayBuffer(msgPtr, 0, msgLen)
          const msgBytes = new Uint8Array(msgBuffer)
          const message = this.decoder.decode(msgBytes)

          switch (level) {
            case LogLevel.Error:
              console.error(message)
              break
            case LogLevel.Warn:
              console.warn(message)
              break
            case LogLevel.Info:
              console.info(message)
              break
            case LogLevel.Debug:
              console.debug(message)
              break
            default:
              console.log(message)
          }
        } catch (error) {
          console.error("Error in Zig log callback:", error)
        }
      },
      {
        args: ["u8", "ptr", "usize"],
        returns: "void",
      },
    )

    this.logCallbackWrapper = logCallback

    if (!logCallback.ptr) {
      throw new Error("Failed to create log callback")
    }

    this.setLogCallback(logCallback.ptr)
  }

  private setLogCallback(callbackPtr: Pointer) {
    this.opentui.symbols.setLogCallback(callbackPtr)
  }

  public createRenderer(width: number, height: number, options: { testing: boolean } = { testing: false }) {
    return this.opentui.symbols.createRenderer(width, height, options.testing)
  }

  public destroyRenderer(renderer: Pointer): void {
    this.opentui.symbols.destroyRenderer(renderer)
  }

  public setUseThread(renderer: Pointer, useThread: boolean) {
    this.opentui.symbols.setUseThread(renderer, useThread)
  }

  public setBackgroundColor(renderer: Pointer, color: RGBA) {
    this.opentui.symbols.setBackgroundColor(renderer, color.buffer)
  }

  public setRenderOffset(renderer: Pointer, offset: number) {
    this.opentui.symbols.setRenderOffset(renderer, offset)
  }

  public updateStats(renderer: Pointer, time: number, fps: number, frameCallbackTime: number) {
    this.opentui.symbols.updateStats(renderer, time, fps, frameCallbackTime)
  }

  public updateMemoryStats(renderer: Pointer, heapUsed: number, heapTotal: number, arrayBuffers: number) {
    this.opentui.symbols.updateMemoryStats(renderer, heapUsed, heapTotal, arrayBuffers)
  }

  public getNextBuffer(renderer: Pointer): OptimizedBuffer {
    const bufferPtr = this.opentui.symbols.getNextBuffer(renderer)
    if (!bufferPtr) {
      throw new Error("Failed to get next buffer")
    }

    const width = this.opentui.symbols.getBufferWidth(bufferPtr)
    const height = this.opentui.symbols.getBufferHeight(bufferPtr)

    return new OptimizedBuffer(this, bufferPtr, width, height, { id: "next buffer" })
  }

  public getCurrentBuffer(renderer: Pointer): OptimizedBuffer {
    const bufferPtr = this.opentui.symbols.getCurrentBuffer(renderer)
    if (!bufferPtr) {
      throw new Error("Failed to get current buffer")
    }

    const width = this.opentui.symbols.getBufferWidth(bufferPtr)
    const height = this.opentui.symbols.getBufferHeight(bufferPtr)

    return new OptimizedBuffer(this, bufferPtr, width, height, { id: "current buffer" })
  }

  public bufferGetCharPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.bufferGetCharPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get char pointer")
    }
    return ptr
  }

  public bufferGetFgPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.bufferGetFgPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get fg pointer")
    }
    return ptr
  }

  public bufferGetBgPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.bufferGetBgPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get bg pointer")
    }
    return ptr
  }

  public bufferGetAttributesPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.bufferGetAttributesPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get attributes pointer")
    }
    return ptr
  }

  public bufferGetRespectAlpha(buffer: Pointer): boolean {
    return this.opentui.symbols.bufferGetRespectAlpha(buffer)
  }

  public bufferSetRespectAlpha(buffer: Pointer, respectAlpha: boolean): void {
    this.opentui.symbols.bufferSetRespectAlpha(buffer, respectAlpha)
  }

  public bufferGetId(buffer: Pointer): string {
    const maxLen = 256
    const outBuffer = new Uint8Array(maxLen)
    const actualLen = this.opentui.symbols.bufferGetId(buffer, outBuffer, maxLen)
    const len = typeof actualLen === "bigint" ? Number(actualLen) : actualLen
    return this.decoder.decode(outBuffer.slice(0, len))
  }

  public bufferGetRealCharSize(buffer: Pointer): number {
    return this.opentui.symbols.bufferGetRealCharSize(buffer)
  }

  public bufferWriteResolvedChars(buffer: Pointer, outputBuffer: Uint8Array, addLineBreaks: boolean): number {
    const bytesWritten = this.opentui.symbols.bufferWriteResolvedChars(
      buffer,
      outputBuffer,
      outputBuffer.length,
      addLineBreaks,
    )
    return typeof bytesWritten === "bigint" ? Number(bytesWritten) : bytesWritten
  }

  public getBufferWidth(buffer: Pointer): number {
    return this.opentui.symbols.getBufferWidth(buffer)
  }

  public getBufferHeight(buffer: Pointer): number {
    return this.opentui.symbols.getBufferHeight(buffer)
  }

  public bufferClear(buffer: Pointer, color: RGBA) {
    this.opentui.symbols.bufferClear(buffer, color.buffer)
  }

  public bufferDrawText(
    buffer: Pointer,
    text: string,
    x: number,
    y: number,
    color: RGBA,
    bgColor?: RGBA,
    attributes?: number,
  ) {
    const textBytes = this.encoder.encode(text)
    const textLength = textBytes.byteLength
    const bg = bgColor ? bgColor.buffer : null
    const fg = color.buffer

    this.opentui.symbols.bufferDrawText(buffer, textBytes, textLength, x, y, fg, bg, attributes ?? 0)
  }

  public bufferSetCellWithAlphaBlending(
    buffer: Pointer,
    x: number,
    y: number,
    char: string,
    color: RGBA,
    bgColor: RGBA,
    attributes?: number,
  ) {
    const charPtr = char.codePointAt(0) ?? " ".codePointAt(0)!
    const bg = bgColor.buffer
    const fg = color.buffer

    this.opentui.symbols.bufferSetCellWithAlphaBlending(buffer, x, y, charPtr, fg, bg, attributes ?? 0)
  }

  public bufferSetCell(
    buffer: Pointer,
    x: number,
    y: number,
    char: string,
    color: RGBA,
    bgColor: RGBA,
    attributes?: number,
  ) {
    const charPtr = char.codePointAt(0) ?? " ".codePointAt(0)!
    const bg = bgColor.buffer
    const fg = color.buffer

    this.opentui.symbols.bufferSetCell(buffer, x, y, charPtr, fg, bg, attributes ?? 0)
  }

  public bufferFillRect(buffer: Pointer, x: number, y: number, width: number, height: number, color: RGBA) {
    const bg = color.buffer
    this.opentui.symbols.bufferFillRect(buffer, x, y, width, height, bg)
  }

  public bufferDrawSuperSampleBuffer(
    buffer: Pointer,
    x: number,
    y: number,
    pixelDataPtr: Pointer,
    pixelDataLength: number,
    format: "bgra8unorm" | "rgba8unorm",
    alignedBytesPerRow: number,
  ): void {
    const formatId = format === "bgra8unorm" ? 0 : 1
    this.opentui.symbols.bufferDrawSuperSampleBuffer(
      buffer,
      x,
      y,
      pixelDataPtr,
      pixelDataLength,
      formatId,
      alignedBytesPerRow,
    )
  }

  public bufferDrawPackedBuffer(
    buffer: Pointer,
    dataPtr: Pointer,
    dataLen: number,
    posX: number,
    posY: number,
    terminalWidthCells: number,
    terminalHeightCells: number,
  ): void {
    this.opentui.symbols.bufferDrawPackedBuffer(
      buffer,
      dataPtr,
      dataLen,
      posX,
      posY,
      terminalWidthCells,
      terminalHeightCells,
    )
  }

  public bufferDrawBox(
    buffer: Pointer,
    x: number,
    y: number,
    width: number,
    height: number,
    borderChars: Uint32Array,
    packedOptions: number,
    borderColor: RGBA,
    backgroundColor: RGBA,
    title: string | null,
  ): void {
    const titleBytes = title ? this.encoder.encode(title) : null
    const titleLen = title ? titleBytes!.length : 0
    const titlePtr = title ? titleBytes : null

    this.opentui.symbols.bufferDrawBox(
      buffer,
      x,
      y,
      width,
      height,
      borderChars,
      packedOptions,
      borderColor.buffer,
      backgroundColor.buffer,
      titlePtr,
      titleLen,
    )
  }

  public bufferResize(buffer: Pointer, width: number, height: number): void {
    this.opentui.symbols.bufferResize(buffer, width, height)
  }

  public resizeRenderer(renderer: Pointer, width: number, height: number) {
    this.opentui.symbols.resizeRenderer(renderer, width, height)
  }

  public setCursorPosition(renderer: Pointer, x: number, y: number, visible: boolean) {
    this.opentui.symbols.setCursorPosition(renderer, x, y, visible)
  }

  public setCursorStyle(renderer: Pointer, style: CursorStyle, blinking: boolean) {
    const stylePtr = this.encoder.encode(style)
    this.opentui.symbols.setCursorStyle(renderer, stylePtr, style.length, blinking)
  }

  public setCursorColor(renderer: Pointer, color: RGBA) {
    this.opentui.symbols.setCursorColor(renderer, color.buffer)
  }

  public render(renderer: Pointer, force: boolean) {
    this.opentui.symbols.render(renderer, force)
  }

  public createOptimizedBuffer(
    width: number,
    height: number,
    widthMethod: WidthMethod,
    respectAlpha: boolean = false,
    id?: string,
  ): OptimizedBuffer {
    if (Number.isNaN(width) || Number.isNaN(height)) {
      console.error(new Error(`Invalid dimensions for OptimizedBuffer: ${width}x${height}`).stack)
    }

    const widthMethodCode = widthMethod === "wcwidth" ? 0 : 1
    const idToUse = id || "unnamed buffer"
    const idBytes = this.encoder.encode(idToUse)
    const bufferPtr = this.opentui.symbols.createOptimizedBuffer(
      width,
      height,
      respectAlpha,
      widthMethodCode,
      idBytes,
      idBytes.length,
    )
    if (!bufferPtr) {
      throw new Error(`Failed to create optimized buffer: ${width}x${height}`)
    }

    return new OptimizedBuffer(this, bufferPtr, width, height, { respectAlpha, id })
  }

  public destroyOptimizedBuffer(bufferPtr: Pointer) {
    this.opentui.symbols.destroyOptimizedBuffer(bufferPtr)
  }

  public drawFrameBuffer(
    targetBufferPtr: Pointer,
    destX: number,
    destY: number,
    bufferPtr: Pointer,
    sourceX?: number,
    sourceY?: number,
    sourceWidth?: number,
    sourceHeight?: number,
  ) {
    const srcX = sourceX ?? 0
    const srcY = sourceY ?? 0
    const srcWidth = sourceWidth ?? 0
    const srcHeight = sourceHeight ?? 0
    this.opentui.symbols.drawFrameBuffer(targetBufferPtr, destX, destY, bufferPtr, srcX, srcY, srcWidth, srcHeight)
  }

  public setDebugOverlay(renderer: Pointer, enabled: boolean, corner: DebugOverlayCorner) {
    this.opentui.symbols.setDebugOverlay(renderer, enabled, corner)
  }

  public clearTerminal(renderer: Pointer) {
    this.opentui.symbols.clearTerminal(renderer)
  }

  public setTerminalTitle(renderer: Pointer, title: string) {
    const titleBytes = this.encoder.encode(title)
    this.opentui.symbols.setTerminalTitle(renderer, titleBytes, titleBytes.length)
  }

  public addToHitGrid(renderer: Pointer, x: number, y: number, width: number, height: number, id: number) {
    this.opentui.symbols.addToHitGrid(renderer, x, y, width, height, id)
  }

  public checkHit(renderer: Pointer, x: number, y: number): number {
    return this.opentui.symbols.checkHit(renderer, x, y)
  }

  public dumpHitGrid(renderer: Pointer): void {
    this.opentui.symbols.dumpHitGrid(renderer)
  }

  public dumpBuffers(renderer: Pointer, timestamp?: number): void {
    const ts = timestamp ?? Date.now()
    this.opentui.symbols.dumpBuffers(renderer, ts)
  }

  public dumpStdoutBuffer(renderer: Pointer, timestamp?: number): void {
    const ts = timestamp ?? Date.now()
    this.opentui.symbols.dumpStdoutBuffer(renderer, ts)
  }

  public enableMouse(renderer: Pointer, enableMovement: boolean): void {
    this.opentui.symbols.enableMouse(renderer, enableMovement)
  }

  public disableMouse(renderer: Pointer): void {
    this.opentui.symbols.disableMouse(renderer)
  }

  public enableKittyKeyboard(renderer: Pointer, flags: number): void {
    this.opentui.symbols.enableKittyKeyboard(renderer, flags)
  }

  public disableKittyKeyboard(renderer: Pointer): void {
    this.opentui.symbols.disableKittyKeyboard(renderer)
  }

  public setupTerminal(renderer: Pointer, useAlternateScreen: boolean): void {
    this.opentui.symbols.setupTerminal(renderer, useAlternateScreen)
  }

  // TextBuffer methods
  public createTextBuffer(widthMethod: WidthMethod): TextBuffer {
    const widthMethodCode = widthMethod === "wcwidth" ? 0 : 1
    const bufferPtr = this.opentui.symbols.createTextBuffer(widthMethodCode)
    if (!bufferPtr) {
      throw new Error(`Failed to create TextBuffer`)
    }

    return new TextBuffer(this, bufferPtr)
  }

  public destroyTextBuffer(buffer: Pointer): void {
    this.opentui.symbols.destroyTextBuffer(buffer)
  }

  public textBufferGetLength(buffer: Pointer): number {
    return this.opentui.symbols.textBufferGetLength(buffer)
  }

  public textBufferReset(buffer: Pointer): void {
    this.opentui.symbols.textBufferReset(buffer)
  }

  public textBufferSetSelection(
    buffer: Pointer,
    start: number,
    end: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ): void {
    const bg = bgColor ? bgColor.buffer : null
    const fg = fgColor ? fgColor.buffer : null
    this.opentui.symbols.textBufferSetSelection(buffer, start, end, bg, fg)
  }

  public textBufferResetSelection(buffer: Pointer): void {
    this.opentui.symbols.textBufferResetSelection(buffer)
  }

  public textBufferSetDefaultFg(buffer: Pointer, fg: RGBA | null): void {
    const fgPtr = fg ? fg.buffer : null
    this.opentui.symbols.textBufferSetDefaultFg(buffer, fgPtr)
  }

  public textBufferSetDefaultBg(buffer: Pointer, bg: RGBA | null): void {
    const bgPtr = bg ? bg.buffer : null
    this.opentui.symbols.textBufferSetDefaultBg(buffer, bgPtr)
  }

  public textBufferSetDefaultAttributes(buffer: Pointer, attributes: number | null): void {
    const attrValue = attributes === null ? null : new Uint8Array([attributes])
    this.opentui.symbols.textBufferSetDefaultAttributes(buffer, attrValue)
  }

  public textBufferResetDefaults(buffer: Pointer): void {
    this.opentui.symbols.textBufferResetDefaults(buffer)
  }

  public textBufferWriteChunk(
    buffer: Pointer,
    textBytes: Uint8Array,
    fg: RGBA | null,
    bg: RGBA | null,
    attributes: number | null,
  ): number {
    // Create attribute buffer - null means use default, otherwise pass the u8 value
    const attrValue = attributes === null ? null : new Uint8Array([attributes])
    return this.opentui.symbols.textBufferWriteChunk(
      buffer,
      textBytes,
      textBytes.length,
      fg ? fg.buffer : null,
      bg ? bg.buffer : null,
      attrValue,
    )
  }

  public textBufferFinalizeLineInfo(buffer: Pointer): void {
    this.opentui.symbols.textBufferFinalizeLineInfo(buffer)
  }

  public textBufferGetLineCount(buffer: Pointer): number {
    return this.opentui.symbols.textBufferGetLineCount(buffer)
  }

  public textBufferGetLineInfoDirect(buffer: Pointer, lineStartsPtr: Pointer, lineWidthsPtr: Pointer): number {
    return this.opentui.symbols.textBufferGetLineInfoDirect(buffer, lineStartsPtr, lineWidthsPtr)
  }

  public textBufferGetSelection(buffer: Pointer): { start: number; end: number } | null {
    const packedInfo = this.textBufferGetSelectionInfo(buffer)

    // Check for no selection marker (0xFFFFFFFF_FFFFFFFF)
    if (packedInfo === 0xffff_ffff_ffff_ffffn) {
      return null
    }

    const start = Number(packedInfo >> 32n)
    const end = Number(packedInfo & 0xffff_ffffn)

    return { start, end }
  }

  private textBufferGetSelectionInfo(buffer: Pointer): bigint {
    return this.opentui.symbols.textBufferGetSelectionInfo(buffer)
  }

  private textBufferGetSelectedText(buffer: Pointer, outPtr: Pointer, maxLen: number): number {
    const result = this.opentui.symbols.textBufferGetSelectedText(buffer, outPtr, maxLen)
    return typeof result === "bigint" ? Number(result) : result
  }

  private textBufferGetPlainText(buffer: Pointer, outPtr: Pointer, maxLen: number): number {
    const result = this.opentui.symbols.textBufferGetPlainText(buffer, outPtr, maxLen)
    return typeof result === "bigint" ? Number(result) : result
  }

  public getSelectedTextBytes(buffer: Pointer, maxLength: number): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)

    const actualLen = this.textBufferGetSelectedText(buffer, ptr(outBuffer), maxLength)

    if (actualLen === 0) {
      return null
    }

    return outBuffer.slice(0, actualLen)
  }

  public getPlainTextBytes(buffer: Pointer, maxLength: number): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)

    const actualLen = this.textBufferGetPlainText(buffer, ptr(outBuffer), maxLength)

    if (actualLen === 0) {
      return null
    }

    return outBuffer.slice(0, actualLen)
  }

  public textBufferSetLocalSelection(
    buffer: Pointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ): boolean {
    const bg = bgColor ? bgColor.buffer : null
    const fg = fgColor ? fgColor.buffer : null
    return this.opentui.symbols.textBufferSetLocalSelection(buffer, anchorX, anchorY, focusX, focusY, bg, fg)
  }

  public textBufferResetLocalSelection(buffer: Pointer): void {
    this.opentui.symbols.textBufferResetLocalSelection(buffer)
  }

  public textBufferInsertChunkGroup(
    buffer: Pointer,
    index: number,
    textBytes: Uint8Array,
    fg: RGBA | null,
    bg: RGBA | null,
    attributes: number | null,
  ): number {
    const fgPtr = fg ? fg.buffer : null
    const bgPtr = bg ? bg.buffer : null
    const attr = attributes ?? 255
    return this.opentui.symbols.textBufferInsertChunkGroup(
      buffer,
      index,
      textBytes,
      textBytes.length,
      fgPtr,
      bgPtr,
      attr,
    )
  }

  public textBufferRemoveChunkGroup(buffer: Pointer, index: number): number {
    return this.opentui.symbols.textBufferRemoveChunkGroup(buffer, index)
  }

  public textBufferReplaceChunkGroup(
    buffer: Pointer,
    index: number,
    textBytes: Uint8Array,
    fg: RGBA | null,
    bg: RGBA | null,
    attributes: number | null,
  ): number {
    const fgPtr = fg ? fg.buffer : null
    const bgPtr = bg ? bg.buffer : null
    const attr = attributes ?? 255
    return this.opentui.symbols.textBufferReplaceChunkGroup(
      buffer,
      index,
      textBytes,
      textBytes.length,
      fgPtr,
      bgPtr,
      attr,
    )
  }

  public textBufferGetChunkGroupCount(buffer: Pointer): number {
    const result = this.opentui.symbols.textBufferGetChunkGroupCount(buffer)
    return typeof result === "bigint" ? Number(result) : result
  }

  public textBufferSetWrapWidth(buffer: Pointer, width: number): void {
    this.opentui.symbols.textBufferSetWrapWidth(buffer, width)
  }

  public textBufferSetWrapMode(buffer: Pointer, mode: "char" | "word"): void {
    const modeValue = mode === "char" ? 0 : 1
    this.opentui.symbols.textBufferSetWrapMode(buffer, modeValue)
  }

  public getArenaAllocatedBytes(): number {
    const result = this.opentui.symbols.getArenaAllocatedBytes()
    return typeof result === "bigint" ? Number(result) : result
  }

  public textBufferGetLineInfo(buffer: Pointer): LineInfo {
    const lineCount = this.textBufferGetLineCount(buffer)

    if (lineCount === 0) {
      return { lineStarts: [], lineWidths: [], maxLineWidth: 0 }
    }

    const lineStarts = new Uint32Array(lineCount)
    const lineWidths = new Uint32Array(lineCount)

    const maxLineWidth = this.textBufferGetLineInfoDirect(buffer, ptr(lineStarts), ptr(lineWidths))

    return {
      maxLineWidth,
      lineStarts: Array.from(lineStarts),
      lineWidths: Array.from(lineWidths),
    }
  }

  public bufferDrawTextBuffer(
    buffer: Pointer,
    textBuffer: Pointer,
    x: number,
    y: number,
    clipRect?: { x: number; y: number; width: number; height: number },
  ): void {
    const hasClipRect = clipRect !== undefined && clipRect !== null
    const clipX = clipRect?.x ?? 0
    const clipY = clipRect?.y ?? 0
    const clipWidth = clipRect?.width ?? 0
    const clipHeight = clipRect?.height ?? 0

    this.opentui.symbols.bufferDrawTextBuffer(
      buffer,
      textBuffer,
      x,
      y,
      clipX,
      clipY,
      clipWidth,
      clipHeight,
      hasClipRect,
    )
  }

  public bufferPushScissorRect(buffer: Pointer, x: number, y: number, width: number, height: number): void {
    this.opentui.symbols.bufferPushScissorRect(buffer, x, y, width, height)
  }

  public bufferPopScissorRect(buffer: Pointer): void {
    this.opentui.symbols.bufferPopScissorRect(buffer)
  }

  public bufferClearScissorRects(buffer: Pointer): void {
    this.opentui.symbols.bufferClearScissorRects(buffer)
  }

  public getTerminalCapabilities(renderer: Pointer): any {
    const capsBuffer = new Uint8Array(64)
    this.opentui.symbols.getTerminalCapabilities(renderer, capsBuffer)

    let offset = 0
    const capabilities = {
      kitty_keyboard: capsBuffer[offset++] !== 0,
      kitty_graphics: capsBuffer[offset++] !== 0,
      rgb: capsBuffer[offset++] !== 0,
      unicode: capsBuffer[offset++] === 0 ? "wcwidth" : "unicode",
      sgr_pixels: capsBuffer[offset++] !== 0,
      color_scheme_updates: capsBuffer[offset++] !== 0,
      explicit_width: capsBuffer[offset++] !== 0,
      scaled_text: capsBuffer[offset++] !== 0,
      sixel: capsBuffer[offset++] !== 0,
      focus_tracking: capsBuffer[offset++] !== 0,
      sync: capsBuffer[offset++] !== 0,
      bracketed_paste: capsBuffer[offset++] !== 0,
      hyperlinks: capsBuffer[offset++] !== 0,
    }

    return capabilities
  }

  public processCapabilityResponse(renderer: Pointer, response: string): void {
    const responseBytes = this.encoder.encode(response)
    this.opentui.symbols.processCapabilityResponse(renderer, responseBytes, responseBytes.length)
  }
}

let opentuiLibPath: string | undefined
let opentuiLib: RenderLib | undefined

export function setRenderLibPath(libPath: string) {
  if (opentuiLibPath !== libPath) {
    opentuiLibPath = libPath
    opentuiLib = undefined
  }
}

export function resolveRenderLib(): RenderLib {
  if (!opentuiLib) {
    try {
      opentuiLib = new FFIRenderLib(opentuiLibPath)
    } catch (error) {
      throw new Error(
        `Failed to initialize OpenTUI render library: ${error instanceof Error ? error.message : "Unknown error"}`,
      )
    }
  }
  return opentuiLib
}

// Try eager loading
try {
  opentuiLib = new FFIRenderLib(opentuiLibPath)
} catch (error) {}
