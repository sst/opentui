import { ANSI } from "./ansi"
import { FrameBufferRenderable, StyledTextRenderable, type FrameBufferOptions, type StyledTextOptions } from "./objects"
import { Renderable } from "./Renderable"
import {
  type ColorInput,
  type CursorStyle,
  DebugOverlayCorner,
  type RenderContext,
  RGBA,
  type SelectionState,
} from "./types"
import { parseColor } from "./utils"
import type { Pointer } from "bun:ffi"
import { OptimizedBuffer } from "./buffer"
import { resolveRenderLib, type RenderLib } from "./zig"
import { TerminalConsole, type ConsoleOptions, capture } from "./console"
import { MouseParser, type MouseEventType, type RawMouseEvent } from "./parse.mouse"
import { Selection } from "./selection"

export * from "./objects"
export * from "./Renderable"
export * from "./types"
export * from "./utils"
export * from "./buffer"
export * from "./3d"
export * as THREE from "three"
export * from "./post/filters"
export * from "./animation/Timeline"
export * from "./ui"
export * from "./parse.keypress"
export * from "./styled-text"
export * from "./selection"

export interface CliRendererConfig {
  stdin?: NodeJS.ReadStream
  stdout?: NodeJS.WriteStream
  exitOnCtrlC?: boolean
  debounceDelay?: number
  targetFps?: number
  memorySnapshotInterval?: number
  useThread?: boolean
  gatherStats?: boolean
  maxStatSamples?: number
  consoleOptions?: ConsoleOptions
  resolution?: PixelResolution | null
  postProcessFns?: ((buffer: OptimizedBuffer, deltaTime: number) => void)[]
  enableMouseMovement?: boolean
  useMouse?: boolean
  useAlternateScreen?: boolean
  useConsole?: boolean
  experimental_splitHeight?: number
}

export type PixelResolution = {
  width: number
  height: number
}

export class MouseEvent {
  public readonly type: MouseEventType
  public readonly button: number
  public readonly x: number
  public readonly y: number
  public readonly source?: Renderable
  public readonly modifiers: {
    shift: boolean
    alt: boolean
    ctrl: boolean
  }
  public readonly target: Renderable | null
  private _defaultPrevented: boolean = false

  public get defaultPrevented(): boolean {
    return this._defaultPrevented
  }

  constructor(target: Renderable | null, attributes: RawMouseEvent & { source?: Renderable }) {
    this.target = target
    this.type = attributes.type
    this.button = attributes.button
    this.x = attributes.x
    this.y = attributes.y
    this.modifiers = attributes.modifiers
    this.source = attributes.source
  }

  public preventDefault(): void {
    this._defaultPrevented = true
  }
}

export enum MouseButton {
  LEFT = 0,
  MIDDLE = 1,
  RIGHT = 2,
  WHEEL_UP = 4,
  WHEEL_DOWN = 5,
}

async function getTerminalPixelResolution(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
): Promise<PixelResolution | null> {
  return new Promise<PixelResolution | null>((resolve) => {
    stdin.setRawMode(true)
    const timeout = setTimeout(() => {
      resolve(null)
    }, 100)
    stdin.once("data", (data) => {
      clearTimeout(timeout)
      const str = data.toString()
      if (/\x1b\[4/.test(str)) {
        // <ESC>[4;<height>;<width>t
        const [, height, width] = str.split(";")
        const resolution: PixelResolution = {
          width: parseInt(width),
          height: parseInt(height),
        }
        resolve(resolution)
      }
    })
    stdout.write(ANSI.queryPixelSize)
  })
}

export async function createCliRenderer(config: CliRendererConfig = {}): Promise<CliRenderer> {
  if (process.argv.includes("--delay-start")) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  const stdin = config.stdin || process.stdin
  const stdout = config.stdout || process.stdout

  const width = stdout.columns || 80
  const height = stdout.rows || 24
  const renderHeight =
    config.experimental_splitHeight && config.experimental_splitHeight > 0 ? config.experimental_splitHeight : height

  const ziglib = resolveRenderLib()
  const rendererPtr = ziglib.createRenderer(width, renderHeight)
  if (!rendererPtr) {
    throw new Error("Failed to create renderer")
  }
  if (config.useThread === undefined) {
    config.useThread = true
  }

  const resolution = await getTerminalPixelResolution(stdin, stdout)

  // Disable threading on linux because there currently is currently an issue
  // might be just a missing dependency for the build or something, but threads crash on linux
  if (process.platform === "linux") {
    config.useThread = false
  }
  ziglib.setUseThread(rendererPtr, config.useThread)

  return new CliRenderer(ziglib, rendererPtr, stdin, stdout, width, height, {
    ...config,
    resolution,
  })
}

export enum CliRenderEvents {
  DEBUG_OVERLAY_TOGGLE = "debugOverlay:toggle",
}

let animationFrameId = 0

export class CliRenderer extends Renderable {
  private lib: RenderLib
  public rendererPtr: Pointer
  private stdin: NodeJS.ReadStream
  private stdout: NodeJS.WriteStream
  private exitOnCtrlC: boolean
  public nextRenderBuffer: OptimizedBuffer
  public currentRenderBuffer: OptimizedBuffer
  private _isRunning: boolean = false
  private targetFps: number = 30
  private memorySnapshotInterval: number
  private memorySnapshotTimer: Timer | null = null
  private lastMemorySnapshot: { heapUsed: number; heapTotal: number; arrayBuffers: number } = {
    heapUsed: 0,
    heapTotal: 0,
    arrayBuffers: 0,
  }
  private _useThread: boolean = false
  private gatherStats: boolean = false
  private frameTimes: number[] = []
  private maxStatSamples: number = 300
  private postProcessFns: ((buffer: OptimizedBuffer, deltaTime: number) => void)[] = []
  private backgroundColor: RGBA = RGBA.fromHex("#000000")

  private rendering: boolean = false
  private renderingNative: boolean = false
  private renderTimeout: Timer | null = null
  private lastTime: number = 0
  private frameCount: number = 0
  private lastFpsTime: number = 0
  private currentFps: number = 0
  private targetFrameTime: number = 0
  private immediateRerenderRequested: boolean = false
  private updateScheduled: boolean = false

  private frameCallbacks: ((deltaTime: number) => Promise<void>)[] = []
  private renderStats: {
    frameCount: number
    fps: number
    renderTime?: number
    frameCallbackTime: number
  } = {
    frameCount: 0,
    fps: 0,
    renderTime: 0,
    frameCallbackTime: 0,
  }
  public debugOverlay = {
    enabled: false,
    corner: DebugOverlayCorner.bottomRight,
  }

  private _console: TerminalConsole
  private _resolution: PixelResolution | null = null

  private animationRequest: Map<number, FrameRequestCallback> = new Map()

  private resizeTimeoutId: ReturnType<typeof setTimeout> | null = null
  private resizeDebounceDelay: number = 100

  private renderContext: RenderContext = {
    addToHitGrid: (x, y, width, height, id) => {
      if (id !== this.capturedRenderable?.num) {
        this.lib.addToHitGrid(this.rendererPtr, x, y, width, height, id)
      }
    },
    width: () => {
      return this.width
    },
    height: () => {
      return this.height
    },
  }

  private enableMouseMovement: boolean = false
  private _useMouse: boolean = true
  private _useAlternateScreen: boolean = true
  private capturedRenderable?: Renderable
  private lastOverRenderableNum: number = 0
  private lastOverRenderable?: Renderable

  private currentSelection: Selection | null = null
  private selectionState: SelectionState | null = null
  private selectionContainers: Renderable[] = []

  private _splitHeight: number = 0
  private renderOffset: number = 0

  private _terminalWidth: number = 0
  private _terminalHeight: number = 0

  private realStdoutWrite: (chunk: any, encoding?: any, callback?: any) => boolean
  private captureCallback: () => void = () => {
    if (this._splitHeight > 0) {
      this.needsUpdate = true
    }
  }

  private _useConsole: boolean = true
  private mouseParser: MouseParser = new MouseParser()

  constructor(
    lib: RenderLib,
    rendererPtr: Pointer,
    stdin: NodeJS.ReadStream,
    stdout: NodeJS.WriteStream,
    width: number,
    height: number,
    config: CliRendererConfig = {},
  ) {
    super("__cli_renderer__", { x: 0, y: 0, zIndex: 0, visible: true, width, height })

    this.stdin = stdin
    this.stdout = stdout
    this.realStdoutWrite = stdout.write
    this.lib = lib
    this._terminalWidth = stdout.columns
    this._terminalHeight = stdout.rows
    this.width = width
    this.height = height
    this._useThread = config.useThread === undefined ? false : config.useThread
    this._resolution = config.resolution || null
    this._splitHeight = config.experimental_splitHeight || 0

    if (this._splitHeight > 0) {
      capture.on("write", this.captureCallback)
      this.renderOffset = height - this._splitHeight
      this.height = this._splitHeight
      lib.setRenderOffset(rendererPtr, this.renderOffset)
    }

    this.rendererPtr = rendererPtr
    this.exitOnCtrlC = config.exitOnCtrlC === undefined ? true : config.exitOnCtrlC
    this.resizeDebounceDelay = config.debounceDelay || 100
    this.targetFps = config.targetFps || 30
    this.memorySnapshotInterval = config.memorySnapshotInterval || 5000
    this.gatherStats = config.gatherStats || false
    this.maxStatSamples = config.maxStatSamples || 300
    this.enableMouseMovement = config.enableMouseMovement || true
    this._useMouse = config.useMouse ?? true
    this._useAlternateScreen = config.useAlternateScreen ?? true
    this.nextRenderBuffer = this.lib.getNextBuffer(this.rendererPtr)
    this.currentRenderBuffer = this.lib.getCurrentBuffer(this.rendererPtr)
    this.postProcessFns = config.postProcessFns || []

    this.setupTerminal()
    this.takeMemorySnapshot()

    if (this.memorySnapshotInterval > 0) {
      this.startMemorySnapshotTimer()
    }

    this.stdout.write = this.interceptStdoutWrite.bind(this)

    // Handle terminal resize
    process.on("SIGWINCH", () => {
      const width = this.stdout.columns || 80
      const height = this.stdout.rows || 24
      this.handleResize(width, height)
    })

    const handleError = (error: Error) => {
      this.console.deactivate()
      this.stop()
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(true)
        }, 100)
      }).then(() => {
        console.log("console cache dump:")
        this.console.dumpCache()
        console.error(error)
        process.exit(1)
      })
    }

    process.on("uncaughtException", handleError)
    process.on("unhandledRejection", handleError)
    process.on("exit", (code: number) => {
      if (!code || code === 0) {
        this.stop()
      }
    })

    this._console = new TerminalConsole(this, config.consoleOptions)
    this.useConsole = config.useConsole ?? true

    global.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const id = animationFrameId++
      this.animationRequest.set(id, callback)
      return id
    }
    global.cancelAnimationFrame = (handle: number) => {
      this.animationRequest.delete(handle)
    }

    const window = global.window
    if (!window) {
      global.window = {} as Window & typeof globalThis
    }
    global.window.requestAnimationFrame = requestAnimationFrame
  }

  private writeOut(chunk: any, encoding?: any, callback?: any): boolean {
    return this.realStdoutWrite.call(this.stdout, chunk, encoding, callback)
  }

  public add(obj: Renderable): void {
    obj.propagateContext(this.renderContext)
    super.add(obj)
  }

  public set needsUpdate(value: boolean) {
    if (!this.updateScheduled && !this._isRunning && value) {
      this.updateScheduled = true
      process.nextTick(() => {
        this.loop()
        this.updateScheduled = false
      })
    }
  }

  public get useConsole(): boolean {
    return this._useConsole
  }

  public set useConsole(value: boolean) {
    this._useConsole = value
    if (value) {
      this.console.activate()
    } else {
      this.console.deactivate()
    }
  }

  public get isRunning(): boolean {
    return this._isRunning
  }

  public get resolution(): PixelResolution | null {
    return this._resolution
  }

  public get console(): TerminalConsole {
    return this._console
  }

  public get terminalWidth(): number {
    return this._terminalWidth
  }

  public get terminalHeight(): number {
    return this._terminalHeight
  }

  public get useThread(): boolean {
    return this._useThread
  }

  public get useMouse(): boolean {
    return this._useMouse
  }

  public set useMouse(useMouse: boolean) {
    if (this._useMouse === useMouse) return // No change needed

    this._useMouse = useMouse

    if (useMouse) {
      this.enableMouse()
    } else {
      this.disableMouse()
    }
  }

  public get experimental_splitHeight(): number {
    return this._splitHeight
  }

  public set experimental_splitHeight(splitHeight: number) {
    if (splitHeight < 0) splitHeight = 0

    const prevSplitHeight = this._splitHeight

    if (splitHeight > 0) {
      this._splitHeight = splitHeight
      this.renderOffset = this._terminalHeight - this._splitHeight
      this.height = this._splitHeight

      if (prevSplitHeight === 0) {
        this.useConsole = false
        capture.on("write", this.captureCallback)
        const freedLines = this._terminalHeight - this._splitHeight
        const scrollDown = ANSI.scrollDown(freedLines)
        this.writeOut(scrollDown)
      } else if (prevSplitHeight > this._splitHeight) {
        const freedLines = prevSplitHeight - this._splitHeight
        const scrollDown = ANSI.scrollDown(freedLines)
        this.writeOut(scrollDown)
      } else if (prevSplitHeight < this._splitHeight) {
        const additionalLines = this._splitHeight - prevSplitHeight
        const scrollUp = ANSI.scrollUp(additionalLines)
        this.writeOut(scrollUp)
      }
    } else {
      if (prevSplitHeight > 0) {
        this.flushStdoutCache(this._terminalHeight, true)

        capture.off("write", this.captureCallback)
        this.useConsole = true
      }

      this._splitHeight = 0
      this.renderOffset = 0
      this.height = this._terminalHeight
    }

    this.width = this._terminalWidth
    this.lib.setRenderOffset(this.rendererPtr, this.renderOffset)
    this.lib.resizeRenderer(this.rendererPtr, this.width, this.height)
    this.nextRenderBuffer = this.lib.getNextBuffer(this.rendererPtr)

    this._console.resize(this.width, this.height)
    this.emit("resize", this.width, this.height)
    this.needsUpdate = true
  }

  private interceptStdoutWrite = (chunk: any, encoding?: any, callback?: any): boolean => {
    const text = chunk.toString()

    capture.write("stdout", text)
    if (this._splitHeight > 0) {
      this.needsUpdate = true
    }

    if (typeof callback === "function") {
      process.nextTick(callback)
    }

    return true
  }

  private disableStdoutInterception(): void {
    this.flushStdoutCache(this._splitHeight)
    this.stdout.write = this.realStdoutWrite
  }

  private flushStdoutCache(space: number, force: boolean = false): boolean {
    if (capture.output.length === 0 && !force) return false

    const output = capture.claimOutput()

    const rendererStartLine = this._terminalHeight - this._splitHeight
    const flush = ANSI.moveCursorAndClear(rendererStartLine, 1)

    const outputLine = this._terminalHeight - this._splitHeight
    const move = ANSI.moveCursor(outputLine, 1)

    const backgroundColor = this.backgroundColor.toInts()
    const newlines = " ".repeat(this.width) + "\n".repeat(space)
    const clear =
      ANSI.setRgbBackground(backgroundColor[0], backgroundColor[1], backgroundColor[2]) +
      newlines +
      ANSI.resetBackground

    this.writeOut(flush + move + output + clear)

    return true
  }

  private enableMouse(): void {
    this.writeOut(ANSI.enableSGRMouseMode)
    this.writeOut(ANSI.enableMouseTracking)
    this.writeOut(ANSI.enableButtonEventTracking)

    if (this.enableMouseMovement) {
      this.writeOut(ANSI.enableAnyEventTracking)
    }
  }

  private disableMouse(): void {
    if (this.enableMouseMovement) {
      this.writeOut(ANSI.disableAnyEventTracking)
    }
    this.writeOut(ANSI.disableButtonEventTracking)
    this.writeOut(ANSI.disableMouseTracking)
    this.writeOut(ANSI.disableSGRMouseMode)

    this.capturedRenderable = undefined
    this.mouseParser.reset()
  }

  public set useThread(useThread: boolean) {
    this._useThread = useThread
    this.lib.setUseThread(this.rendererPtr, useThread)
  }

  public setTerminalSize(width: number, height: number): void {
    this.handleResize(width, height)
  }

  private setupTerminal(): void {
    this.writeOut(ANSI.saveCursorState)
    this.stdin.setRawMode(true)
    this.stdin.resume()
    this.stdin.setEncoding("utf8")

    if (this._useMouse) {
      this.enableMouse()
    }

    this.stdin.on("data", (data: Buffer) => {
      if (this.exitOnCtrlC && data.toString() === "\u0003") {
        this.stop()
        process.nextTick(() => {
          process.exit(0)
        })
        return
      }

      if (this._useMouse && this.handleMouseData(data)) {
        return
      }

      this.emit("key", data)
    })

    if (this._useAlternateScreen) {
      this.writeOut(ANSI.switchToAlternateScreen)
    }
    this.setCursorPosition(0, 0, false)
  }

  private handleMouseData(data: Buffer): boolean {
    const mouseEvent = this.mouseParser.parseMouseEvent(data)

    if (mouseEvent) {
      if (this._splitHeight > 0) {
        if (mouseEvent.y < this.renderOffset) {
          return false
        }
        mouseEvent.y -= this.renderOffset
      }

      const maybeRenderableId = this.lib.checkHit(this.rendererPtr, mouseEvent.x, mouseEvent.y)
      const sameElement = maybeRenderableId === this.lastOverRenderableNum
      this.lastOverRenderableNum = maybeRenderableId
      const maybeRenderable = Renderable.renderablesByNumber.get(maybeRenderableId)

      if (mouseEvent.type === "down" && mouseEvent.button === MouseButton.LEFT) {
        if (
          maybeRenderable &&
          maybeRenderable.selectable &&
          maybeRenderable.shouldStartSelection(mouseEvent.x, mouseEvent.y)
        ) {
          this.startSelection(maybeRenderable, mouseEvent.x, mouseEvent.y)
          return true
        }
      }

      if (mouseEvent.type === "drag" && this.selectionState?.isSelecting) {
        this.updateSelection(maybeRenderable, mouseEvent.x, mouseEvent.y)
        return true
      }

      if (mouseEvent.type === "up" && this.selectionState?.isSelecting) {
        this.finishSelection()
        return true
      }

      if (mouseEvent.type === "down" && mouseEvent.button === MouseButton.LEFT && this.selectionState) {
        this.clearSelection()
      }

      if (!sameElement && (mouseEvent.type === "drag" || mouseEvent.type === "move")) {
        if (this.lastOverRenderable && this.lastOverRenderable !== this.capturedRenderable) {
          const event = new MouseEvent(this.lastOverRenderable, { ...mouseEvent, type: "out" })
          this.lastOverRenderable.processMouseEvent(event)
        }
        this.lastOverRenderable = maybeRenderable
        if (maybeRenderable) {
          const event = new MouseEvent(maybeRenderable, {
            ...mouseEvent,
            type: "over",
            source: this.capturedRenderable,
          })
          maybeRenderable.processMouseEvent(event)
        }
      }

      if (this.capturedRenderable && mouseEvent.type !== "up") {
        const event = new MouseEvent(this.capturedRenderable, mouseEvent)
        this.capturedRenderable.processMouseEvent(event)
        return true
      }

      if (this.capturedRenderable && mouseEvent.type === "up") {
        const event = new MouseEvent(this.capturedRenderable, { ...mouseEvent, type: "drag-end" })
        this.capturedRenderable.processMouseEvent(event)
        if (maybeRenderable) {
          const event = new MouseEvent(maybeRenderable, {
            ...mouseEvent,
            type: "drop",
            source: this.capturedRenderable,
          })
          maybeRenderable.processMouseEvent(event)
        }
        this.lastOverRenderable = this.capturedRenderable
        this.lastOverRenderableNum = this.capturedRenderable.num
        this.capturedRenderable = undefined
      }

      if (maybeRenderable) {
        if (mouseEvent.type === "down" && mouseEvent.button === MouseButton.LEFT) {
          this.capturedRenderable = maybeRenderable
        } else {
          this.capturedRenderable = undefined
        }
        const event = new MouseEvent(maybeRenderable, mouseEvent)
        maybeRenderable.processMouseEvent(event)
        return true
      }

      this.capturedRenderable = undefined
      this.lastOverRenderable = undefined
      return true
    }

    return true
  }

  private takeMemorySnapshot(): void {
    const memoryUsage = process.memoryUsage()
    this.lastMemorySnapshot = {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      arrayBuffers: memoryUsage.arrayBuffers,
    }

    this.lib.updateMemoryStats(
      this.rendererPtr,
      this.lastMemorySnapshot.heapUsed,
      this.lastMemorySnapshot.heapTotal,
      this.lastMemorySnapshot.arrayBuffers,
    )

    this.emit("memory:snapshot", this.lastMemorySnapshot)
  }

  private startMemorySnapshotTimer(): void {
    if (this.memorySnapshotTimer) {
      clearInterval(this.memorySnapshotTimer)
    }

    this.memorySnapshotTimer = setInterval(() => {
      this.takeMemorySnapshot()
    }, this.memorySnapshotInterval)
  }

  public setMemorySnapshotInterval(interval: number): void {
    this.memorySnapshotInterval = interval

    if (this._isRunning && interval > 0) {
      this.startMemorySnapshotTimer()
    } else if (interval <= 0 && this.memorySnapshotTimer) {
      clearInterval(this.memorySnapshotTimer)
      this.memorySnapshotTimer = null
    }
  }

  private handleResize(width: number, height: number): void {
    if (this._splitHeight > 0) {
      this.processResize(width, height)
      return
    }

    if (this.resizeTimeoutId !== null) {
      clearTimeout(this.resizeTimeoutId)
      this.resizeTimeoutId = null
    }

    this.resizeTimeoutId = setTimeout(() => {
      this.resizeTimeoutId = null
      this.processResize(width, height)
    }, this.resizeDebounceDelay)
  }

  private async processResize(width: number, height: number): Promise<void> {
    if (width === this._terminalWidth && height === this._terminalHeight) return

    const prevWidth = this._terminalWidth

    this._terminalWidth = width
    this._terminalHeight = height

    this.capturedRenderable = undefined
    this.mouseParser.reset()

    if (this._splitHeight > 0) {
      // TODO: Handle resizing split mode properly
      if (width < prevWidth) {
        const start = this._terminalHeight - this._splitHeight * 2
        const flush = ANSI.moveCursorAndClear(start, 1)
        this.writeOut(flush)
      }
      this.renderOffset = height - this._splitHeight
      this.width = width
      this.height = this._splitHeight
      this.currentRenderBuffer.clearLocal(RGBA.fromHex("#000000"), "\u0a00")
      this.lib.setRenderOffset(this.rendererPtr, this.renderOffset)
    } else {
      this.width = width
      this.height = height
    }

    this._resolution = await getTerminalPixelResolution(this.stdin, this.stdout)
    this.lib.resizeRenderer(this.rendererPtr, this.width, this.height)
    this.nextRenderBuffer = this.lib.getNextBuffer(this.rendererPtr)
    this.currentRenderBuffer = this.lib.getCurrentBuffer(this.rendererPtr)
    this._console.resize(this.width, this.height)
    this.emit("resize", this.width, this.height)
    this.needsUpdate = true
  }

  public setBackgroundColor(color: ColorInput): void {
    const parsedColor = parseColor(color)
    this.lib.setBackgroundColor(this.rendererPtr, parsedColor as RGBA)
    this.backgroundColor = parsedColor as RGBA
    this.nextRenderBuffer.clear(parsedColor as RGBA)
    this.needsUpdate = true
  }

  public toggleDebugOverlay(): void {
    this.debugOverlay.enabled = !this.debugOverlay.enabled
    this.lib.setDebugOverlay(this.rendererPtr, this.debugOverlay.enabled, this.debugOverlay.corner)
    this.emit(CliRenderEvents.DEBUG_OVERLAY_TOGGLE, this.debugOverlay.enabled)
    this.needsUpdate = true
  }

  public configureDebugOverlay(options: { enabled?: boolean; corner?: DebugOverlayCorner }): void {
    this.debugOverlay.enabled = options.enabled ?? this.debugOverlay.enabled
    this.debugOverlay.corner = options.corner ?? this.debugOverlay.corner
    this.lib.setDebugOverlay(this.rendererPtr, this.debugOverlay.enabled, this.debugOverlay.corner)
    this.needsUpdate = true
  }

  public clearTerminal(): void {
    this.lib.clearTerminal(this.rendererPtr)
  }

  public dumpHitGrid(): void {
    this.lib.dumpHitGrid(this.rendererPtr)
  }

  public createFrameBuffer(id: string, options: Partial<FrameBufferOptions>) {
    if (this.getRenderable(id)) {
      this.remove(id)
    }
    const width = options.width ?? this.width
    const height = options.height ?? this.height
    const buffer = this.lib.createOptimizedBuffer(width, height, options.respectAlpha)
    const fbObj = new FrameBufferRenderable(id, buffer, {
      ...options,
      x: options.x ?? 0,
      y: options.y ?? 0,
      width,
      height,
      zIndex: options.zIndex ?? 1,
    })
    this.add(fbObj)
    return fbObj
  }

  public createStyledText(id: string, options: StyledTextOptions): StyledTextRenderable {
    if (!options.fragment) {
      throw new Error("StyledText requires a fragment")
    }

    const width = options.width ?? this.width
    const height = options.height ?? this.height
    const buffer = this.lib.createOptimizedBuffer(width, height, true)
    const stObj = new StyledTextRenderable(id, buffer, {
      ...options,
      x: options.x ?? 0,
      y: options.y ?? 0,
      width,
      height,
      zIndex: options.zIndex ?? 1,
    })

    return stObj
  }

  public static setCursorPosition(x: number, y: number, visible: boolean = true): void {
    const lib = resolveRenderLib()
    lib.setCursorPosition(x, y, visible)
  }

  public static setCursorStyle(style: CursorStyle, blinking: boolean = false, color?: RGBA): void {
    const lib = resolveRenderLib()
    lib.setCursorStyle(style, blinking)
    if (color) {
      lib.setCursorColor(color)
    }
  }

  public static setCursorColor(color: RGBA): void {
    const lib = resolveRenderLib()
    lib.setCursorColor(color)
  }

  // Instance cursor methods (delegate to static methods)
  public setCursorPosition(x: number, y: number, visible: boolean = true): void {
    CliRenderer.setCursorPosition(x, y, visible)
  }

  public setCursorStyle(style: CursorStyle, blinking: boolean = false, color?: RGBA): void {
    CliRenderer.setCursorStyle(style, blinking, color)
  }

  public setCursorColor(color: RGBA): void {
    CliRenderer.setCursorColor(color)
  }

  public addPostProcessFn(processFn: (buffer: OptimizedBuffer, deltaTime: number) => void): void {
    this.postProcessFns.push(processFn)
  }

  public removePostProcessFn(processFn: (buffer: OptimizedBuffer, deltaTime: number) => void): void {
    this.postProcessFns = this.postProcessFns.filter((fn) => fn !== processFn)
  }

  public clearPostProcessFns(): void {
    this.postProcessFns = []
  }

  public setFrameCallback(callback: (deltaTime: number) => Promise<void>): void {
    this.frameCallbacks.push(callback)
  }

  public removeFrameCallback(callback: (deltaTime: number) => Promise<void>): void {
    this.frameCallbacks = this.frameCallbacks.filter((cb) => cb !== callback)
  }

  public clearFrameCallbacks(): void {
    this.frameCallbacks = []
  }

  public start(): void {
    if (!this._isRunning) {
      this._isRunning = true

      if (this.memorySnapshotInterval > 0) {
        this.startMemorySnapshotTimer()
      }

      this.startRenderLoop()
    }
  }

  public pause(): void {
    this._isRunning = false
  }

  public stop(): void {
    this._isRunning = false
    this._console.deactivate()

    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout)
      this.renderTimeout = null
    }

    if (this.memorySnapshotTimer) {
      clearInterval(this.memorySnapshotTimer)
      this.memorySnapshotTimer = null
    }

    this.disableStdoutInterception()

    if (this._splitHeight > 0) {
      const consoleEndLine = this._terminalHeight - this._splitHeight
      this.writeOut(ANSI.moveCursor(consoleEndLine, 1))
    }

    this.capturedRenderable = undefined

    if (this._useMouse) {
      this.disableMouse()
    }
    this.writeOut(ANSI.resetCursorColor)
    this.writeOut(ANSI.showCursor)

    if (this._useAlternateScreen) {
      this.writeOut(ANSI.switchToMainScreen)
    }
  }

  private startRenderLoop(): void {
    if (!this._isRunning) return

    this.lastTime = Date.now()
    this.frameCount = 0
    this.lastFpsTime = this.lastTime
    this.currentFps = 0
    this.targetFrameTime = 1000 / this.targetFps

    this.loop()
  }

  private async loop(): Promise<void> {
    if (this.rendering) return
    this.rendering = true
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout)
      this.renderTimeout = null
    }

    const now = Date.now()
    const elapsed = now - this.lastTime

    const deltaTime = elapsed
    this.lastTime = now

    this.frameCount++
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = this.frameCount
      this.frameCount = 0
      this.lastFpsTime = now
    }

    this.renderStats.frameCount++
    this.renderStats.fps = this.currentFps
    const overallStart = performance.now()

    const frameRequests = this.animationRequest.values()
    this.animationRequest.clear()
    const animationRequestStart = performance.now()
    frameRequests.forEach((callback) => callback(deltaTime))
    const animationRequestEnd = performance.now()
    const animationRequestTime = animationRequestEnd - animationRequestStart

    const start = performance.now()
    for (const frameCallback of this.frameCallbacks) {
      try {
        await frameCallback(deltaTime)
      } catch (error) {
        console.error("Error in frame callback:", error)
      }
    }
    const end = performance.now()
    this.renderStats.frameCallbackTime = end - start

    // Render the renderable tree
    this.render(this.nextRenderBuffer, deltaTime)

    for (const postProcessFn of this.postProcessFns) {
      postProcessFn(this.nextRenderBuffer, deltaTime)
    }

    this._console.renderToBuffer(this.nextRenderBuffer)

    this.renderNative()

    const overallFrameTime = performance.now() - overallStart
    // TODO: Add animationRequestTime to stats
    this.lib.updateStats(this.rendererPtr, overallFrameTime, this.renderStats.fps, this.renderStats.frameCallbackTime)

    if (this.gatherStats) {
      this.collectStatSample(overallFrameTime)
    }

    if (this._isRunning) {
      const delay = Math.max(1, this.targetFrameTime - Math.floor(overallFrameTime))
      this.renderTimeout = setTimeout(() => this.loop(), delay)
    }
    this.rendering = false
    if (this.immediateRerenderRequested) {
      this.immediateRerenderRequested = false
      this.loop()
    }
  }

  public intermediateRender(): void {
    if (!this._isRunning) return
    this.immediateRerenderRequested = true
    this.loop()
  }

  private renderNative(): void {
    if (this.renderingNative) {
      console.error("Rendering called concurrently")
      throw new Error("Rendering called concurrently")
    }

    let force = false
    if (this._splitHeight > 0) {
      // TODO: Flickering could maybe be even more reduced by moving the flush to the native layer,
      // to output the flush with the buffered writer, after the render is done.
      force = this.flushStdoutCache(this._splitHeight)
    }

    this.renderingNative = true
    this.lib.render(this.rendererPtr, force)
    this.renderingNative = false
  }

  private collectStatSample(frameTime: number): void {
    this.frameTimes.push(frameTime)
    if (this.frameTimes.length > this.maxStatSamples) {
      this.frameTimes.shift()
    }
  }

  public getStats(): {
    fps: number
    frameCount: number
    frameTimes: number[]
    averageFrameTime: number
    minFrameTime: number
    maxFrameTime: number
  } {
    const frameTimes = [...this.frameTimes]
    const sum = frameTimes.reduce((acc, time) => acc + time, 0)
    const avg = frameTimes.length ? sum / frameTimes.length : 0
    const min = frameTimes.length ? Math.min(...frameTimes) : 0
    const max = frameTimes.length ? Math.max(...frameTimes) : 0

    return {
      fps: this.renderStats.fps,
      frameCount: this.renderStats.frameCount,
      frameTimes,
      averageFrameTime: avg,
      minFrameTime: min,
      maxFrameTime: max,
    }
  }

  public resetStats(): void {
    this.frameTimes = []
    this.renderStats.frameCount = 0
  }

  public setGatherStats(enabled: boolean): void {
    this.gatherStats = enabled
    if (!enabled) {
      this.frameTimes = []
    }
  }

  public getSelection(): Selection | null {
    return this.currentSelection
  }

  public getSelectionContainer(): Renderable | null {
    return this.selectionContainers.length > 0 ? this.selectionContainers[this.selectionContainers.length - 1] : null
  }

  public hasSelection(): boolean {
    return this.currentSelection !== null
  }

  public clearSelection(): void {
    if (this.selectionState) {
      this.selectionState = null
      this.notifySelectablesOfSelectionChange()
    }
    this.currentSelection = null
    this.selectionContainers = []
  }

  private startSelection(startRenderable: Renderable, x: number, y: number): void {
    this.clearSelection()
    this.selectionContainers.push(startRenderable.parent || this)

    this.selectionState = {
      anchor: { x, y },
      focus: { x, y },
      isActive: true,
      isSelecting: true,
    }

    this.currentSelection = new Selection({ x, y }, { x, y })
    this.notifySelectablesOfSelectionChange()
  }

  private updateSelection(currentRenderable: Renderable | undefined, x: number, y: number): void {
    if (this.selectionState) {
      this.selectionState.focus = { x, y }

      if (this.selectionContainers.length > 0) {
        const currentContainer = this.selectionContainers[this.selectionContainers.length - 1]

        if (!currentRenderable || !this.isWithinContainer(currentRenderable, currentContainer)) {
          const parentContainer = currentContainer.parent || this
          this.selectionContainers.push(parentContainer)
        } else if (currentRenderable && this.selectionContainers.length > 1) {
          let containerIndex = this.selectionContainers.indexOf(currentRenderable)

          if (containerIndex === -1) {
            const immediateParent = currentRenderable.parent || this
            containerIndex = this.selectionContainers.indexOf(immediateParent)
          }

          if (containerIndex !== -1 && containerIndex < this.selectionContainers.length - 1) {
            this.selectionContainers = this.selectionContainers.slice(0, containerIndex + 1)
          }
        }
      }

      if (this.currentSelection) {
        this.currentSelection = new Selection(this.selectionState.anchor, this.selectionState.focus)
      }

      this.notifySelectablesOfSelectionChange()
    }
  }

  private isWithinContainer(renderable: Renderable, container: Renderable): boolean {
    let current: Renderable | null = renderable
    while (current) {
      if (current === container) return true
      current = current.parent
    }
    return false
  }

  private finishSelection(): void {
    if (this.selectionState) {
      this.selectionState.isSelecting = false
      this.emit("selection", this.currentSelection)
    }
  }

  private notifySelectablesOfSelectionChange(): void {
    let normalizedSelection: SelectionState | null = null
    if (this.selectionState) {
      normalizedSelection = { ...this.selectionState }

      if (
        normalizedSelection.anchor.y > normalizedSelection.focus.y ||
        (normalizedSelection.anchor.y === normalizedSelection.focus.y &&
          normalizedSelection.anchor.x > normalizedSelection.focus.x)
      ) {
        const temp = normalizedSelection.anchor
        normalizedSelection.anchor = normalizedSelection.focus
        normalizedSelection.focus = {
          x: temp.x + 1,
          y: temp.y,
        }
      }
    }

    const selectedRenderables: Renderable[] = []

    for (const [, renderable] of Renderable.renderablesByNumber) {
      if (renderable.visible && renderable.selectable) {
        const currentContainer =
          this.selectionContainers.length > 0 ? this.selectionContainers[this.selectionContainers.length - 1] : null
        let hasSelection = false
        if (!currentContainer || this.isWithinContainer(renderable, currentContainer)) {
          hasSelection = renderable.onSelectionChanged(normalizedSelection)
        } else {
          hasSelection = renderable.onSelectionChanged(
            normalizedSelection ? { ...normalizedSelection, isActive: false } : null,
          )
        }

        if (hasSelection) {
          selectedRenderables.push(renderable)
        }
      }
    }

    if (this.currentSelection) {
      this.currentSelection.updateSelectedRenderables(selectedRenderables)
    }
  }
}
