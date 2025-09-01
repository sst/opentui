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

  return dlopen(resolvedLibPath, {
    // Logging
    setLogCallback: {
      args: ["ptr"],
      returns: "void",
    },
    // Renderer management
    createRenderer: {
      args: ["u32", "u32"],
      returns: "ptr",
    },
    destroyRenderer: {
      args: ["ptr", "bool", "u32"],
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

    bufferDrawText: {
      args: ["ptr", "ptr", "u32", "u32", "u32", "ptr", "ptr", "u8"],
      returns: "void",
    },
    bufferSetCellWithAlphaBlending: {
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
      args: ["u32", "u8"],
      returns: "ptr",
    },
    destroyTextBuffer: {
      args: ["ptr"],
      returns: "void",
    },
    textBufferGetCharPtr: {
      args: ["ptr"],
      returns: "ptr",
    },
    textBufferGetFgPtr: {
      args: ["ptr"],
      returns: "ptr",
    },
    textBufferGetBgPtr: {
      args: ["ptr"],
      returns: "ptr",
    },
    textBufferGetAttributesPtr: {
      args: ["ptr"],
      returns: "ptr",
    },
    textBufferGetLength: {
      args: ["ptr"],
      returns: "u32",
    },
    textBufferSetCell: {
      args: ["ptr", "u32", "u32", "ptr", "ptr", "u16"],
      returns: "void",
    },
    textBufferConcat: {
      args: ["ptr", "ptr"],
      returns: "ptr",
    },
    textBufferResize: {
      args: ["ptr", "u32"],
      returns: "void",
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
    textBufferGetCapacity: {
      args: ["ptr"],
      returns: "u32",
    },
    textBufferFinalizeLineInfo: {
      args: ["ptr"],
      returns: "void",
    },
    textBufferGetLineStartsPtr: {
      args: ["ptr"],
      returns: "ptr",
    },
    textBufferGetLineWidthsPtr: {
      args: ["ptr"],
      returns: "ptr",
    },
    textBufferGetLineCount: {
      args: ["ptr"],
      returns: "u32",
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
}

// Log levels matching Zig's LogLevel enum
export enum LogLevel {
  Error = 0,
  Warn = 1,
  Info = 2,
  Debug = 3,
}

export interface RenderLib {
  createRenderer: (width: number, height: number) => Pointer | null
  destroyRenderer: (renderer: Pointer, useAlternateScreen: boolean, splitHeight: number) => void
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
  bufferResize: (
    buffer: Pointer,
    width: number,
    height: number,
  ) => {
    char: Uint32Array
    fg: Float32Array
    bg: Float32Array
    attributes: Uint8Array
  }
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
  createTextBuffer: (capacity: number, widthMethod: WidthMethod) => TextBuffer
  destroyTextBuffer: (buffer: Pointer) => void
  textBufferGetCharPtr: (buffer: Pointer) => Pointer
  textBufferGetFgPtr: (buffer: Pointer) => Pointer
  textBufferGetBgPtr: (buffer: Pointer) => Pointer
  textBufferGetAttributesPtr: (buffer: Pointer) => Pointer
  textBufferGetLength: (buffer: Pointer) => number
  textBufferSetCell: (
    buffer: Pointer,
    index: number,
    char: number,
    fg: Float32Array,
    bg: Float32Array,
    attr: number,
  ) => void
  textBufferConcat: (buffer1: Pointer, buffer2: Pointer) => TextBuffer
  textBufferResize: (
    buffer: Pointer,
    newLength: number,
  ) => {
    char: Uint32Array
    fg: Float32Array
    bg: Float32Array
    attributes: Uint16Array
  }
  textBufferReset: (buffer: Pointer) => void
  textBufferSetSelection: (
    buffer: Pointer,
    start: number,
    end: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ) => void
  textBufferResetSelection: (buffer: Pointer) => void
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
  textBufferGetCapacity: (buffer: Pointer) => number
  textBufferFinalizeLineInfo: (buffer: Pointer) => void
  textBufferGetLineInfo: (buffer: Pointer) => { lineStarts: number[]; lineWidths: number[] }
  getTextBufferArrays: (
    buffer: Pointer,
    size: number,
  ) => {
    char: Uint32Array
    fg: Float32Array
    bg: Float32Array
    attributes: Uint16Array
  }
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

  getTerminalCapabilities: (renderer: Pointer) => any
  processCapabilityResponse: (renderer: Pointer, response: string) => void
}

class FFIRenderLib implements RenderLib {
  private opentui: ReturnType<typeof getOpenTUILib>
  private encoder: TextEncoder = new TextEncoder()
  private decoder: TextDecoder = new TextDecoder()
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

  public createRenderer(width: number, height: number) {
    return this.opentui.symbols.createRenderer(width, height)
  }

  public destroyRenderer(renderer: Pointer, useAlternateScreen: boolean, splitHeight: number) {
    this.opentui.symbols.destroyRenderer(renderer, useAlternateScreen, splitHeight)
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
    const size = width * height
    const buffers = this.getBuffer(bufferPtr, size)

    return new OptimizedBuffer(this, bufferPtr, buffers, width, height, { id: "next buffer" })
  }

  public getCurrentBuffer(renderer: Pointer): OptimizedBuffer {
    const bufferPtr = this.opentui.symbols.getCurrentBuffer(renderer)
    if (!bufferPtr) {
      throw new Error("Failed to get current buffer")
    }

    const width = this.opentui.symbols.getBufferWidth(bufferPtr)
    const height = this.opentui.symbols.getBufferHeight(bufferPtr)
    const size = width * height
    const buffers = this.getBuffer(bufferPtr, size)

    return new OptimizedBuffer(this, bufferPtr, buffers, width, height, { id: "current buffer" })
  }

  private getBuffer(
    bufferPtr: Pointer,
    size: number,
  ): {
    char: Uint32Array
    fg: Float32Array
    bg: Float32Array
    attributes: Uint8Array
  } {
    const charPtr = this.opentui.symbols.bufferGetCharPtr(bufferPtr)
    const fgPtr = this.opentui.symbols.bufferGetFgPtr(bufferPtr)
    const bgPtr = this.opentui.symbols.bufferGetBgPtr(bufferPtr)
    const attributesPtr = this.opentui.symbols.bufferGetAttributesPtr(bufferPtr)

    if (!charPtr || !fgPtr || !bgPtr || !attributesPtr) {
      throw new Error("Failed to get buffer pointers")
    }

    const buffers = {
      char: new Uint32Array(toArrayBuffer(charPtr, 0, size * 4)),
      fg: new Float32Array(toArrayBuffer(fgPtr, 0, size * 4 * 4)), // 4 floats per RGBA
      bg: new Float32Array(toArrayBuffer(bgPtr, 0, size * 4 * 4)), // 4 floats per RGBA
      attributes: new Uint8Array(toArrayBuffer(attributesPtr, 0, size)),
    }

    return buffers
  }

  private getTextBuffer(
    bufferPtr: Pointer,
    size: number,
  ): {
    char: Uint32Array
    fg: Float32Array
    bg: Float32Array
    attributes: Uint16Array
  } {
    const charPtr = this.opentui.symbols.textBufferGetCharPtr(bufferPtr)
    const fgPtr = this.opentui.symbols.textBufferGetFgPtr(bufferPtr)
    const bgPtr = this.opentui.symbols.textBufferGetBgPtr(bufferPtr)
    const attributesPtr = this.opentui.symbols.textBufferGetAttributesPtr(bufferPtr)

    if (!charPtr || !fgPtr || !bgPtr || !attributesPtr) {
      throw new Error("Failed to get text buffer pointers")
    }

    const buffers = {
      char: new Uint32Array(toArrayBuffer(charPtr, 0, size * 4)),
      fg: new Float32Array(toArrayBuffer(fgPtr, 0, size * 4 * 4)), // 4 floats per RGBA
      bg: new Float32Array(toArrayBuffer(bgPtr, 0, size * 4 * 4)), // 4 floats per RGBA
      attributes: new Uint16Array(toArrayBuffer(attributesPtr, 0, size * 2)), // 2 bytes per u16
    }

    return buffers
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

  public bufferResize(
    buffer: Pointer,
    width: number,
    height: number,
  ): {
    char: Uint32Array
    fg: Float32Array
    bg: Float32Array
    attributes: Uint8Array
  } {
    this.opentui.symbols.bufferResize(buffer, width, height)
    const buffers = this.getBuffer(buffer, width * height)
    return buffers
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
    const size = width * height
    const buffers = this.getBuffer(bufferPtr, size)

    return new OptimizedBuffer(this, bufferPtr, buffers, width, height, { respectAlpha, id })
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
  public createTextBuffer(capacity: number, widthMethod: WidthMethod): TextBuffer {
    const widthMethodCode = widthMethod === "wcwidth" ? 0 : 1
    const bufferPtr = this.opentui.symbols.createTextBuffer(capacity, widthMethodCode)
    if (!bufferPtr) {
      throw new Error(`Failed to create TextBuffer with capacity ${capacity}`)
    }

    const charPtr = this.textBufferGetCharPtr(bufferPtr)
    const fgPtr = this.textBufferGetFgPtr(bufferPtr)
    const bgPtr = this.textBufferGetBgPtr(bufferPtr)
    const attributesPtr = this.textBufferGetAttributesPtr(bufferPtr)

    const buffer = {
      char: new Uint32Array(toArrayBuffer(charPtr, 0, capacity * 4)),
      fg: new Float32Array(toArrayBuffer(fgPtr, 0, capacity * 4 * 4)),
      bg: new Float32Array(toArrayBuffer(bgPtr, 0, capacity * 4 * 4)),
      attributes: new Uint16Array(toArrayBuffer(attributesPtr, 0, capacity * 2)), // 2 bytes per u16
    }

    return new TextBuffer(this, bufferPtr, buffer, capacity)
  }

  public destroyTextBuffer(buffer: Pointer): void {
    this.opentui.symbols.destroyTextBuffer(buffer)
  }

  public textBufferGetCharPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.textBufferGetCharPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get TextBuffer char pointer")
    }
    return ptr
  }

  public textBufferGetFgPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.textBufferGetFgPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get TextBuffer fg pointer")
    }
    return ptr
  }

  public textBufferGetBgPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.textBufferGetBgPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get TextBuffer bg pointer")
    }
    return ptr
  }

  public textBufferGetAttributesPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.textBufferGetAttributesPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get TextBuffer attributes pointer")
    }
    return ptr
  }

  public textBufferGetLength(buffer: Pointer): number {
    return this.opentui.symbols.textBufferGetLength(buffer)
  }

  public textBufferSetCell(
    buffer: Pointer,
    index: number,
    char: number,
    fg: Float32Array,
    bg: Float32Array,
    attr: number,
  ): void {
    this.opentui.symbols.textBufferSetCell(buffer, index, char, fg, bg, attr)
  }

  public textBufferConcat(buffer1: Pointer, buffer2: Pointer): TextBuffer {
    const resultPtr = this.opentui.symbols.textBufferConcat(buffer1, buffer2)
    if (!resultPtr) {
      throw new Error("Failed to concatenate TextBuffers")
    }

    const length = this.textBufferGetLength(resultPtr)
    const charPtr = this.textBufferGetCharPtr(resultPtr)
    const fgPtr = this.textBufferGetFgPtr(resultPtr)
    const bgPtr = this.textBufferGetBgPtr(resultPtr)
    const attributesPtr = this.textBufferGetAttributesPtr(resultPtr)

    const buffer = {
      char: new Uint32Array(toArrayBuffer(charPtr, 0, length * 4)),
      fg: new Float32Array(toArrayBuffer(fgPtr, 0, length * 4 * 4)),
      bg: new Float32Array(toArrayBuffer(bgPtr, 0, length * 4 * 4)),
      attributes: new Uint16Array(toArrayBuffer(attributesPtr, 0, length * 2)),
    }

    return new TextBuffer(this, resultPtr, buffer, length)
  }

  public textBufferResize(
    buffer: Pointer,
    newLength: number,
  ): {
    char: Uint32Array
    fg: Float32Array
    bg: Float32Array
    attributes: Uint16Array
  } {
    this.opentui.symbols.textBufferResize(buffer, newLength)
    const buffers = this.getTextBuffer(buffer, newLength)
    return buffers
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

  public textBufferGetCapacity(buffer: Pointer): number {
    return this.opentui.symbols.textBufferGetCapacity(buffer)
  }

  public textBufferFinalizeLineInfo(buffer: Pointer): void {
    this.opentui.symbols.textBufferFinalizeLineInfo(buffer)
  }

  public textBufferGetLineInfo(buffer: Pointer): { lineStarts: number[]; lineWidths: number[] } {
    const lineCount = this.opentui.symbols.textBufferGetLineCount(buffer)
    if (lineCount === 0) {
      return { lineStarts: [], lineWidths: [] }
    }

    const lineStartsPtr = this.opentui.symbols.textBufferGetLineStartsPtr(buffer)
    const lineWidthsPtr = this.opentui.symbols.textBufferGetLineWidthsPtr(buffer)

    if (!lineStartsPtr || !lineWidthsPtr) {
      return { lineStarts: [], lineWidths: [] }
    }

    const lineStartsArray = new Uint32Array(toArrayBuffer(lineStartsPtr, 0, lineCount * 4))
    const lineWidthsArray = new Uint32Array(toArrayBuffer(lineWidthsPtr, 0, lineCount * 4))

    const lineStarts = Array.from(lineStartsArray)
    const lineWidths = Array.from(lineWidthsArray)

    return { lineStarts, lineWidths }
  }

  public getTextBufferArrays(
    buffer: Pointer,
    size: number,
  ): {
    char: Uint32Array
    fg: Float32Array
    bg: Float32Array
    attributes: Uint16Array
  } {
    return this.getTextBuffer(buffer, size)
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
