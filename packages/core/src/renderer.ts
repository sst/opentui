import { ANSI } from "./ansi"
import { Renderable, RootRenderable } from "./Renderable"
import {
  type CursorStyle,
  DebugOverlayCorner,
  type RenderContext,
  type SelectionState,
  type WidthMethod,
} from "./types"
import { RGBA, parseColor, type ColorInput } from "./lib/RGBA"
import type { Pointer } from "bun:ffi"
import { OptimizedBuffer } from "./buffer"
import { resolveRenderLib, type RenderLib } from "./zig"
import { TerminalConsole, type ConsoleOptions, capture } from "./console"
import { MouseParser, type MouseEventType, type RawMouseEvent, type ScrollInfo } from "./lib/parse.mouse"
import { Selection } from "./lib/selection"
import { EventEmitter } from "events"
import { singleton } from "./singleton"

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
  public readonly scroll?: ScrollInfo
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
    this.scroll = attributes.scroll
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

singleton("ProcessExitSignals", () => {
  ;["SIGINT", "SIGTERM", "SIGQUIT", "SIGABRT"].forEach((signal) => {
    process.on(signal, () => {
      process.exit()
    })
  })
})

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

  // Disable threading on linux because there currently is currently an issue
  // might be just a missing dependency for the build or something, but threads crash on linux
  if (process.platform === "linux") {
    config.useThread = false
  }
  ziglib.setUseThread(rendererPtr, config.useThread)

  const renderer = new CliRenderer(ziglib, rendererPtr, stdin, stdout, width, height, config)
  await renderer.setupTerminal()
  return renderer
}

export enum CliRenderEvents {
  DEBUG_OVERLAY_TOGGLE = "debugOverlay:toggle",
}

enum RendererControlState {
  IDLE = "idle",
  AUTO_STARTED = "auto_started",
  EXPLICIT_STARTED = "explicit_started",
  EXPLICIT_PAUSED = "explicit_paused",
  EXPLICIT_STOPPED = "explicit_stopped",
}

export class CliRenderer extends EventEmitter implements RenderContext {
  private static animationFrameId = 0
  private lib: RenderLib
  public rendererPtr: Pointer
  private stdin: NodeJS.ReadStream
  private stdout: NodeJS.WriteStream
  private exitOnCtrlC: boolean
  private isDestroyed: boolean = false
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
  public readonly root: RootRenderable
  public width: number
  public height: number
  private _useThread: boolean = false
  private gatherStats: boolean = false
  private frameTimes: number[] = []
  private maxStatSamples: number = 300
  private postProcessFns: ((buffer: OptimizedBuffer, deltaTime: number) => void)[] = []
  private backgroundColor: RGBA = RGBA.fromHex("#000000")
  private waitingForPixelResolution: boolean = false

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

  private liveRequestCounter: number = 0
  private controlState: RendererControlState = RendererControlState.IDLE

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
  private _terminalIsSetup: boolean = false

  private realStdoutWrite: (chunk: any, encoding?: any, callback?: any) => boolean
  private captureCallback: () => void = () => {
    if (this._splitHeight > 0) {
      this.requestRender()
    }
  }

  private _useConsole: boolean = true
  private mouseParser: MouseParser = new MouseParser()
  private sigwinchHandler: (() => void) | null = null
  private _capabilities: any | null = null

  constructor(
    lib: RenderLib,
    rendererPtr: Pointer,
    stdin: NodeJS.ReadStream,
    stdout: NodeJS.WriteStream,
    width: number,
    height: number,
    config: CliRendererConfig = {},
  ) {
    super()

    this.stdin = stdin
    this.stdout = stdout
    this.realStdoutWrite = stdout.write
    this.lib = lib
    this._terminalWidth = stdout.columns
    this._terminalHeight = stdout.rows
    this.width = width
    this.height = height
    this._useThread = config.useThread === undefined ? false : config.useThread
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

    this.root = new RootRenderable(this)

    this.takeMemorySnapshot()

    if (this.memorySnapshotInterval > 0) {
      this.startMemorySnapshotTimer()
    }

    this.stdout.write = this.interceptStdoutWrite.bind(this)

    // Handle terminal resize
    this.sigwinchHandler = () => {
      const width = this.stdout.columns || 80
      const height = this.stdout.rows || 24
      this.handleResize(width, height)
    }
    process.on("SIGWINCH", this.sigwinchHandler)

    const handleError = (error: Error) => {
      this.stop()
      this.destroy()

      new Promise((resolve) => {
        setTimeout(() => {
          resolve(true)
        }, 100)
      }).then(() => {
        this.realStdoutWrite.call(this.stdout, "\n=== FATAL ERROR OCCURRED ===\n")
        this.realStdoutWrite.call(this.stdout, "Console cache:\n")
        this.realStdoutWrite.call(this.stdout, this.console.getCachedLogs())
        this.realStdoutWrite.call(this.stdout, "\nCaptured output:\n")
        const capturedOutput = capture.claimOutput()
        if (capturedOutput) {
          this.realStdoutWrite.call(this.stdout, capturedOutput + "\n")
        }
        this.realStdoutWrite.call(this.stdout, "\nError details:\n")
        this.realStdoutWrite.call(this.stdout, error.message || "unknown error")
        this.realStdoutWrite.call(this.stdout, "\n")
        this.realStdoutWrite.call(this.stdout, error.stack || error.toString())
        this.realStdoutWrite.call(this.stdout, "\n")

        process.exit(1)
      })
    }

    process.on("uncaughtException", handleError)
    process.on("unhandledRejection", handleError)
    process.on("exit", () => {
      this.destroy()
    })

    this._console = new TerminalConsole(this, config.consoleOptions)
    this.useConsole = config.useConsole ?? true

    global.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const id = CliRenderer.animationFrameId++
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

    // Prevents output from being written to the terminal, useful for debugging
    if (process.env.OTUI_NO_NATIVE_RENDER === "true") {
      this.renderNative = () => {
        if (this._splitHeight > 0) {
          this.flushStdoutCache(this._splitHeight)
        }
      }
    }
  }

  public addToHitGrid(x: number, y: number, width: number, height: number, id: number) {
    if (id !== this.capturedRenderable?.num) {
      this.lib.addToHitGrid(this.rendererPtr, x, y, width, height, id)
    }
  }

  public get widthMethod(): WidthMethod {
    const caps = this.capabilities
    return caps?.unicode === "unicode" ? "unicode" : "wcwidth"
  }

  private writeOut(chunk: any, encoding?: any, callback?: any): boolean {
    return this.realStdoutWrite.call(this.stdout, chunk, encoding, callback)
  }

  public requestRender() {
    if (!this.rendering && !this.updateScheduled && !this._isRunning) {
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

  public get liveRequestCount(): number {
    return this.liveRequestCounter
  }

  public get currentControlState(): string {
    return this.controlState
  }

  public get capabilities(): any | null {
    return this._capabilities
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
    this.root.resize(this.width, this.height)
    this.emit("resize", this.width, this.height)
    this.requestRender()
  }

  private interceptStdoutWrite = (chunk: any, encoding?: any, callback?: any): boolean => {
    const text = chunk.toString()

    capture.write("stdout", text)
    if (this._splitHeight > 0) {
      this.requestRender()
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

  // TODO: Move this to native
  private flushStdoutCache(space: number, force: boolean = false): boolean {
    if (capture.size === 0 && !force) return false

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
    this.lib.enableMouse(this.rendererPtr, this.enableMouseMovement)
  }

  private disableMouse(): void {
    this.capturedRenderable = undefined
    this.mouseParser.reset()
    this.lib.disableMouse(this.rendererPtr)
  }

  public enableKittyKeyboard(flags: number = 0b00001): void {
    this.lib.enableKittyKeyboard(this.rendererPtr, flags)
  }

  public disableKittyKeyboard(): void {
    this.lib.disableKittyKeyboard(this.rendererPtr)
  }

  public set useThread(useThread: boolean) {
    this._useThread = useThread
    this.lib.setUseThread(this.rendererPtr, useThread)
  }

  // TODO:All input management may move to native when zig finally has async io support again,
  // without rolling a full event loop
  public async setupTerminal(): Promise<void> {
    if (this._terminalIsSetup) return
    this._terminalIsSetup = true

    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(true)
    }
    this.stdin.resume()
    this.stdin.setEncoding("utf8")

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.stdin.off("data", capListener)
        resolve(true)
      }, 100)
      const capListener = (str: string) => {
        clearTimeout(timeout)
        this.lib.processCapabilityResponse(this.rendererPtr, str)
        this.stdin.off("data", capListener)
        resolve(true)
      }
      this.stdin.on("data", capListener)
      this.lib.setupTerminal(this.rendererPtr, this._useAlternateScreen)
    })

    this._capabilities = this.lib.getTerminalCapabilities(this.rendererPtr)

    if (this._useMouse) {
      this.enableMouse()
    }

    this.stdin.on("data", (data: Buffer) => {
      const str = data.toString()

      if (this.waitingForPixelResolution && /\x1b\[4;\d+;\d+t/.test(str)) {
        const match = str.match(/\x1b\[4;(\d+);(\d+)t/)
        if (match) {
          const resolution: PixelResolution = {
            width: parseInt(match[2]),
            height: parseInt(match[1]),
          }

          this._resolution = resolution
          this.waitingForPixelResolution = false
          return
        }
      }

      if (this.exitOnCtrlC && str === "\u0003") {
        process.nextTick(() => {
          process.exit()
        })
        return
      }

      if (this._useMouse && this.handleMouseData(data)) {
        return
      }

      this.emit("key", data)
    })

    this.queryPixelResolution()
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

      if (mouseEvent.type === "scroll") {
        const maybeRenderableId = this.lib.checkHit(this.rendererPtr, mouseEvent.x, mouseEvent.y)
        const maybeRenderable = Renderable.renderablesByNumber.get(maybeRenderableId)

        if (maybeRenderable) {
          const event = new MouseEvent(maybeRenderable, mouseEvent)
          maybeRenderable.processMouseEvent(event)
        }
        return true
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
        this.capturedRenderable.processMouseEvent(new MouseEvent(this.capturedRenderable, mouseEvent))
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
        // Dropping the renderable needs to push another frame when the renderer is not live
        // to update the hit grid, otherwise capturedRenderable won't be in the hit grid and will not receive mouse events
        this.requestRender()
      }

      if (maybeRenderable) {
        if (mouseEvent.type === "drag" && mouseEvent.button === MouseButton.LEFT) {
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

    return false
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
    if (this.isDestroyed) return
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

  private queryPixelResolution() {
    this.waitingForPixelResolution = true
    // TODO: should move to native, injecting the request in the next frame if running
    this.writeOut(ANSI.queryPixelSize)
  }

  private processResize(width: number, height: number): void {
    if (width === this._terminalWidth && height === this._terminalHeight) return

    const prevWidth = this._terminalWidth

    this._terminalWidth = width
    this._terminalHeight = height
    this.queryPixelResolution()

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

    this.lib.resizeRenderer(this.rendererPtr, this.width, this.height)
    this.nextRenderBuffer = this.lib.getNextBuffer(this.rendererPtr)
    this.currentRenderBuffer = this.lib.getCurrentBuffer(this.rendererPtr)
    this._console.resize(this.width, this.height)
    this.root.resize(this.width, this.height)
    this.emit("resize", this.width, this.height)
    this.requestRender()
  }

  public setBackgroundColor(color: ColorInput): void {
    const parsedColor = parseColor(color)
    this.lib.setBackgroundColor(this.rendererPtr, parsedColor as RGBA)
    this.backgroundColor = parsedColor as RGBA
    this.nextRenderBuffer.clear(parsedColor as RGBA)
    this.requestRender()
  }

  public toggleDebugOverlay(): void {
    this.debugOverlay.enabled = !this.debugOverlay.enabled
    this.lib.setDebugOverlay(this.rendererPtr, this.debugOverlay.enabled, this.debugOverlay.corner)
    this.emit(CliRenderEvents.DEBUG_OVERLAY_TOGGLE, this.debugOverlay.enabled)
    this.requestRender()
  }

  public configureDebugOverlay(options: { enabled?: boolean; corner?: DebugOverlayCorner }): void {
    this.debugOverlay.enabled = options.enabled ?? this.debugOverlay.enabled
    this.debugOverlay.corner = options.corner ?? this.debugOverlay.corner
    this.lib.setDebugOverlay(this.rendererPtr, this.debugOverlay.enabled, this.debugOverlay.corner)
    this.requestRender()
  }

  public clearTerminal(): void {
    this.lib.clearTerminal(this.rendererPtr)
  }

  public setTerminalTitle(title: string): void {
    this.lib.setTerminalTitle(this.rendererPtr, title)
  }

  public dumpHitGrid(): void {
    this.lib.dumpHitGrid(this.rendererPtr)
  }

  public dumpBuffers(timestamp?: number): void {
    this.lib.dumpBuffers(this.rendererPtr, timestamp)
  }

  public dumpStdoutBuffer(timestamp?: number): void {
    this.lib.dumpStdoutBuffer(this.rendererPtr, timestamp)
  }

  public static setCursorPosition(renderer: CliRenderer, x: number, y: number, visible: boolean = true): void {
    const lib = resolveRenderLib()
    lib.setCursorPosition(renderer.rendererPtr, x, y, visible)
  }

  public static setCursorStyle(
    renderer: CliRenderer,
    style: CursorStyle,
    blinking: boolean = false,
    color?: RGBA,
  ): void {
    const lib = resolveRenderLib()
    lib.setCursorStyle(renderer.rendererPtr, style, blinking)
    if (color) {
      lib.setCursorColor(renderer.rendererPtr, color)
    }
  }

  public static setCursorColor(renderer: CliRenderer, color: RGBA): void {
    const lib = resolveRenderLib()
    lib.setCursorColor(renderer.rendererPtr, color)
  }

  public setCursorPosition(x: number, y: number, visible: boolean = true): void {
    this.lib.setCursorPosition(this.rendererPtr, x, y, visible)
  }

  public setCursorStyle(style: CursorStyle, blinking: boolean = false, color?: RGBA): void {
    this.lib.setCursorStyle(this.rendererPtr, style, blinking)
    if (color) {
      this.lib.setCursorColor(this.rendererPtr, color)
    }
  }

  public setCursorColor(color: RGBA): void {
    this.lib.setCursorColor(this.rendererPtr, color)
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

  public requestLive(): void {
    this.liveRequestCounter++

    if (this.controlState === RendererControlState.IDLE && this.liveRequestCounter > 0) {
      this.controlState = RendererControlState.AUTO_STARTED
      this.internalStart()
    }
  }

  public dropLive(): void {
    this.liveRequestCounter = Math.max(0, this.liveRequestCounter - 1)

    if (this.controlState === RendererControlState.AUTO_STARTED && this.liveRequestCounter === 0) {
      this.controlState = RendererControlState.IDLE
      this.internalPause()
    }
  }

  public start(): void {
    this.controlState = RendererControlState.EXPLICIT_STARTED
    this.internalStart()
  }

  public auto(): void {
    this.controlState = this._isRunning ? RendererControlState.AUTO_STARTED : RendererControlState.IDLE
  }

  private internalStart(): void {
    if (!this._isRunning && !this.isDestroyed) {
      this._isRunning = true

      if (this.memorySnapshotInterval > 0) {
        this.startMemorySnapshotTimer()
      }

      this.startRenderLoop()
    }
  }

  public pause(): void {
    this.controlState = RendererControlState.EXPLICIT_PAUSED
    this.internalPause()
  }

  private internalPause(): void {
    this._isRunning = false
  }

  public stop(): void {
    this.controlState = RendererControlState.EXPLICIT_STOPPED
    this.internalStop()
  }

  private internalStop(): void {
    if (this.isRunning && !this.isDestroyed) {
      this._isRunning = false

      if (this.memorySnapshotTimer) {
        clearInterval(this.memorySnapshotTimer)
        this.memorySnapshotTimer = null
      }

      if (this.renderTimeout) {
        clearTimeout(this.renderTimeout)
        this.renderTimeout = null
      }
    }
  }

  public destroy(): void {
    this.stdin.setRawMode(false)

    if (this.isDestroyed) return
    this.isDestroyed = true

    this.waitingForPixelResolution = false
    this.capturedRenderable = undefined

    if (this.sigwinchHandler) {
      process.removeListener("SIGWINCH", this.sigwinchHandler)
      this.sigwinchHandler = null
    }

    this._console.deactivate()
    this.disableStdoutInterception()
    this.lib.destroyRenderer(this.rendererPtr, this._useAlternateScreen, this._splitHeight)
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
    if (this.rendering || this.isDestroyed) return
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

    const frameRequests = Array.from(this.animationRequest.values())
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
    this.root.render(this.nextRenderBuffer, deltaTime)

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
    // this.dumpStdoutBuffer(Date.now())
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
    this.selectionContainers.push(startRenderable.parent || this.root)

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
          const parentContainer = currentContainer.parent || this.root
          this.selectionContainers.push(parentContainer)
        } else if (currentRenderable && this.selectionContainers.length > 1) {
          let containerIndex = this.selectionContainers.indexOf(currentRenderable)

          if (containerIndex === -1) {
            const immediateParent = currentRenderable.parent || this.root
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
