import { dlopen, suffix, toArrayBuffer, type Pointer } from "bun:ffi"
import { join } from "path"
import { existsSync } from "fs"
import os from "os"
import type { CursorStyle, DebugOverlayCorner } from "./types"
import { RGBA } from "./types"
import { OptimizedBuffer } from "./buffer"

function getPlatformTarget(): string {
  const platform = os.platform()
  const arch = os.arch()

  const platformMap: Record<string, string> = {
    darwin: "macos",
    win32: "windows",
    linux: "linux",
  }

  const archMap: Record<string, string> = {
    x64: "x86_64",
    arm64: "aarch64",
  }

  const zigPlatform = platformMap[platform] || platform
  const zigArch = archMap[arch] || arch

  return `${zigArch}-${zigPlatform}`
}

function findLibrary(): string {
  const target = getPlatformTarget()
  const libDir = join(__dirname, "zig/lib")

  // First try target-specific directory
  const [arch, os] = target.split("-")
  const isWindows = os === "windows"
  const libraryName = isWindows ? "opentui" : "libopentui"
  const targetLibPath = join(libDir, target, `${libraryName}.${suffix}`)
  if (existsSync(targetLibPath)) {
    return targetLibPath
  }

  throw new Error(`Could not find opentui library for platform: ${target}`)
}

function getOpenTUILib(libPath?: string) {
  const resolvedLibPath = libPath || findLibrary()

  return dlopen(resolvedLibPath, {
    // Renderer management
    createRenderer: {
      args: ["u32", "u32"],
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
      args: ["u32", "u32", "bool"],
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

    // Global cursor functions
    setCursorPosition: {
      args: ["i32", "i32", "bool"],
      returns: "void",
    },
    setCursorStyle: {
      args: ["ptr", "u32", "bool"],
      returns: "void",
    },
    setCursorColor: {
      args: ["ptr"],
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

    bufferDrawSuperSampleBuffer: {
      args: ["ptr", "u32", "u32", "ptr", "usize", "u8", "u32"],
      returns: "void",
    },
    bufferDrawPackedBuffer: {
      args: ["ptr", "ptr", "usize", "u32", "u32", "u32", "u32"],
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
  })
}

export interface RenderLib {
  createRenderer: (width: number, height: number) => Pointer | null
  destroyRenderer: (renderer: Pointer) => void
  setUseThread: (renderer: Pointer, useThread: boolean) => void
  setBackgroundColor: (renderer: Pointer, color: RGBA) => void
  setRenderOffset: (renderer: Pointer, offset: number) => void
  updateStats: (renderer: Pointer, time: number, fps: number, frameCallbackTime: number) => void
  updateMemoryStats: (renderer: Pointer, heapUsed: number, heapTotal: number, arrayBuffers: number) => void
  render: (renderer: Pointer, force: boolean) => void
  getNextBuffer: (renderer: Pointer) => OptimizedBuffer
  getCurrentBuffer: (renderer: Pointer) => OptimizedBuffer
  createOptimizedBuffer: (width: number, height: number, respectAlpha?: boolean) => OptimizedBuffer
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
  setCursorPosition: (x: number, y: number, visible: boolean) => void
  setCursorStyle: (style: CursorStyle, blinking: boolean) => void
  setCursorColor: (color: RGBA) => void
  setDebugOverlay: (renderer: Pointer, enabled: boolean, corner: DebugOverlayCorner) => void
  clearTerminal: (renderer: Pointer) => void
  addToHitGrid: (renderer: Pointer, x: number, y: number, width: number, height: number, id: number) => void
  checkHit: (renderer: Pointer, x: number, y: number) => number
  dumpHitGrid: (renderer: Pointer) => void
}

class FFIRenderLib implements RenderLib {
  private opentui: ReturnType<typeof getOpenTUILib>
  private encoder: TextEncoder = new TextEncoder()

  constructor(libPath?: string) {
    this.opentui = getOpenTUILib(libPath)
  }

  public createRenderer(width: number, height: number) {
    return this.opentui.symbols.createRenderer(width, height)
  }

  public destroyRenderer(renderer: Pointer) {
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
    const size = width * height
    const buffers = this.getBuffer(bufferPtr, size)

    return new OptimizedBuffer(this, bufferPtr, buffers, width, height, {})
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

    return new OptimizedBuffer(this, bufferPtr, buffers, width, height, {})
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

  public setCursorPosition(x: number, y: number, visible: boolean) {
    this.opentui.symbols.setCursorPosition(x, y, visible)
  }

  public setCursorStyle(style: CursorStyle, blinking: boolean) {
    const stylePtr = this.encoder.encode(style)
    this.opentui.symbols.setCursorStyle(stylePtr, style.length, blinking)
  }

  public setCursorColor(color: RGBA) {
    this.opentui.symbols.setCursorColor(color.buffer)
  }

  public render(renderer: Pointer, force: boolean) {
    this.opentui.symbols.render(renderer, force)
  }

  public createOptimizedBuffer(width: number, height: number, respectAlpha: boolean = false): OptimizedBuffer {
    const bufferPtr = this.opentui.symbols.createOptimizedBuffer(width, height, respectAlpha)
    if (!bufferPtr) {
      throw new Error("Failed to create optimized buffer")
    }
    const size = width * height
    const buffers = this.getBuffer(bufferPtr, size)

    return new OptimizedBuffer(this, bufferPtr, buffers, width, height, { respectAlpha })
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

  public addToHitGrid(renderer: Pointer, x: number, y: number, width: number, height: number, id: number) {
    this.opentui.symbols.addToHitGrid(renderer, x, y, width, height, id)
  }

  public checkHit(renderer: Pointer, x: number, y: number): number {
    return this.opentui.symbols.checkHit(renderer, x, y)
  }

  public dumpHitGrid(renderer: Pointer): void {
    this.opentui.symbols.dumpHitGrid(renderer)
  }
}

let opentuiLibPath: string | undefined
let opentuiLib: RenderLib | undefined

export function setRenderLibPath(libPath: string) {
  opentuiLibPath = libPath
}

export function resolveRenderLib(): RenderLib {
  if (!opentuiLib) {
    opentuiLib = new FFIRenderLib(opentuiLibPath)
  }
  return opentuiLib
}
