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
import { TerminalConsole, type ConsoleOptions } from "./console"
import { parseMouseEvent, type MouseEventType, type RawMouseEvent } from "./parse.mouse"
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
    stdout.write("\u001b[14t")
  })
}

export async function createCliRenderer(config: CliRendererConfig = {}): Promise<CliRenderer> {
  if (process.argv.includes("--delay-start")) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  const stdin = config.stdin || process.stdin
  const stdout = config.stdout || process.stdout

  // Get terminal dimensions
  const width = stdout.columns || 80
  const height = stdout.rows || 24
  const ziglib = resolveRenderLib()
  const rendererPtr = ziglib.createRenderer(width, height)
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
  private capturedRenderable?: Renderable
  private lastOverRenderableNum: number = 0
  private lastOverRenderable?: Renderable

  private currentSelection: Selection | null = null
  private selectionState: SelectionState | null = null
  private selectionContainers: Renderable[] = []
  
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
    this.lib = lib
    this.width = width
    this.height = height
    this._useThread = config.useThread === undefined ? false : config.useThread
    this._resolution = config.resolution || null

    this.rendererPtr = rendererPtr
    this.exitOnCtrlC = config.exitOnCtrlC === undefined ? true : config.exitOnCtrlC
    this.resizeDebounceDelay = config.debounceDelay || 100
    this.targetFps = config.targetFps || 30
    this.memorySnapshotInterval = config.memorySnapshotInterval || 5000
    this.gatherStats = config.gatherStats || false
    this.maxStatSamples = config.maxStatSamples || 300
    this.enableMouseMovement = config.enableMouseMovement || true
    this._useMouse = config.useMouse ?? true
    this.nextRenderBuffer = this.lib.getNextBuffer(this.rendererPtr)
    this.postProcessFns = config.postProcessFns || []

    this.setupTerminal()
    this.takeMemorySnapshot()

    if (this.memorySnapshotInterval > 0) {
      this.startMemorySnapshotTimer()
    }

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

  public add(obj: Renderable): void {
    obj.propagateContext(this.renderContext)
    super.add(obj)
  }

  public set needsUpdate(value: boolean) {
    if (!this.updateScheduled && !this._isRunning && value) {
      this.updateScheduled = true
      process.nextTick(() => {
        this.renderOnce()
        this.updateScheduled = false
      })
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
    return this.width
  }

  public get terminalHeight(): number {
    return this.height
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

  private enableMouse(): void {
    this.stdout.write(ANSI.enableSGRMouseMode)
    this.stdout.write(ANSI.enableMouseTracking)
    this.stdout.write(ANSI.enableButtonEventTracking)
    
    if (this.enableMouseMovement) {
      this.stdout.write(ANSI.enableAnyEventTracking)
    }
  }

  private disableMouse(): void {
    if (this.enableMouseMovement) {
      this.stdout.write(ANSI.disableAnyEventTracking)
    }
    this.stdout.write(ANSI.disableButtonEventTracking)
    this.stdout.write(ANSI.disableMouseTracking)
    this.stdout.write(ANSI.disableSGRMouseMode)
  }

  public set useThread(useThread: boolean) {
    this._useThread = useThread
    this.lib.setUseThread(this.rendererPtr, useThread)
  }

  public setTerminalSize(width: number, height: number): void {
    this.handleResize(width, height)
  }

  private setupTerminal(): void {
    this.stdout.write(ANSI.saveCursorState)
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
  
    this.stdout.write(ANSI.switchToAlternateScreen)
    this.setCursorPosition(0, 0, false)
  }

  private handleMouseData(data: Buffer): boolean {
    const mouseEvent = parseMouseEvent(data)

    if (mouseEvent) {
      const maybeRenderableId = this.lib.checkHit(this.rendererPtr, mouseEvent.x, mouseEvent.y)
      const sameElement = maybeRenderableId === this.lastOverRenderableNum
      this.lastOverRenderableNum = maybeRenderableId
      const maybeRenderable = Renderable.renderablesByNumber.get(maybeRenderableId)

      if (mouseEvent.type === 'down' && mouseEvent.button === MouseButton.LEFT) {
        if (maybeRenderable && maybeRenderable.selectable && 
            maybeRenderable.shouldStartSelection(mouseEvent.x, mouseEvent.y)) {
          this.startSelection(maybeRenderable, mouseEvent.x, mouseEvent.y)
          return true
        }
      }

      if (mouseEvent.type === 'drag' && this.selectionState?.isSelecting) {
        this.updateSelection(maybeRenderable, mouseEvent.x, mouseEvent.y)
        return true
      }

      if (mouseEvent.type === 'up' && this.selectionState?.isSelecting) {
        this.finishSelection()
        return true
      }

      if (mouseEvent.type === 'down' && mouseEvent.button === MouseButton.LEFT && this.selectionState) {
        this.clearSelection()
      }

      if (!sameElement && (mouseEvent.type === 'drag' || mouseEvent.type === 'move')) {
        if (this.lastOverRenderable && this.lastOverRenderable !== this.capturedRenderable) {
          const event = new MouseEvent(this.lastOverRenderable, { ...mouseEvent, type: 'out' })
          this.lastOverRenderable.processMouseEvent(event)
        }
        this.lastOverRenderable = maybeRenderable
        if (maybeRenderable) {
          const event = new MouseEvent(maybeRenderable, { ...mouseEvent, type: 'over', source: this.capturedRenderable })
          maybeRenderable.processMouseEvent(event)
        }
      }

      if (this.capturedRenderable && mouseEvent.type !== 'up') {
        const event = new MouseEvent(this.capturedRenderable, mouseEvent)
        this.capturedRenderable.processMouseEvent(event)
        return true
      }

      if (this.capturedRenderable && mouseEvent.type === 'up') {
        const event = new MouseEvent(this.capturedRenderable, { ...mouseEvent, type: 'drag-end' })
        this.capturedRenderable.processMouseEvent(event)
        if (maybeRenderable) {
          const event = new MouseEvent(maybeRenderable, { ...mouseEvent, type: 'drop', source: this.capturedRenderable })
          maybeRenderable.processMouseEvent(event)
        }
        this.lastOverRenderable = this.capturedRenderable
        this.lastOverRenderableNum = this.capturedRenderable.num
        this.capturedRenderable = undefined
      }

      if (maybeRenderable) {
        if (mouseEvent.type === 'drag') {
          this.capturedRenderable = maybeRenderable
        }
        const event = new MouseEvent(maybeRenderable, mouseEvent)
        maybeRenderable.processMouseEvent(event)
        return true
      }

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
    if (width === this.width && height === this.height) return

    this.width = width
    this.height = height
    this._resolution = await getTerminalPixelResolution(this.stdin, this.stdout)
    this.lib.resizeRenderer(this.rendererPtr, this.width, this.height)
    this.nextRenderBuffer = this.lib.getNextBuffer(this.rendererPtr)
    this._console.resize(width, height)
    this.emit("resize", width, height)
    this.renderOnce()
  }

  public setBackgroundColor(color: ColorInput): void {
    const parsedColor = parseColor(color)
    this.lib.setBackgroundColor(this.rendererPtr, parsedColor as RGBA)
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

    if (this._useMouse) {
      this.disableMouse()
    }
    this.stdout.write(ANSI.resetCursorColor)
    this.stdout.write(ANSI.showCursor)

    this.stdout.write(ANSI.switchToMainScreen)
  }

  public async renderOnce(): Promise<void> {
    this.loop()
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
    this.lib.clearHitGrid(this.rendererPtr)
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
    this.renderingNative = true
    this.lib.render(this.rendererPtr)
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
      isSelecting: true
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
      this.emit('selection', this.currentSelection)
    }
  }

  private notifySelectablesOfSelectionChange(): void {
    let normalizedSelection: SelectionState | null = null
    if (this.selectionState) {
      normalizedSelection = { ...this.selectionState }
      
      if (normalizedSelection.anchor.y > normalizedSelection.focus.y || 
          (normalizedSelection.anchor.y === normalizedSelection.focus.y && 
          normalizedSelection.anchor.x > normalizedSelection.focus.x)) {
        const temp = normalizedSelection.anchor
        normalizedSelection.anchor = normalizedSelection.focus
        normalizedSelection.focus = {
          x: temp.x + 1,
          y: temp.y
        }
      }
    }
    
    const selectedRenderables: Renderable[] = []
    
    for (const [, renderable] of Renderable.renderablesByNumber) {
      if (renderable.visible && renderable.selectable) {
        const currentContainer = this.selectionContainers.length > 0 ? this.selectionContainers[this.selectionContainers.length - 1] : null
        let hasSelection = false
        if (!currentContainer || this.isWithinContainer(renderable, currentContainer)) {
          hasSelection = renderable.onSelectionChanged(normalizedSelection)
        } else {
          hasSelection = renderable.onSelectionChanged(normalizedSelection ? { ...normalizedSelection, isActive: false } : null)
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
