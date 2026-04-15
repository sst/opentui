import { ANSI } from "./ansi.js"
import { Renderable, RootRenderable } from "./Renderable.js"
import {
  DebugOverlayCorner,
  type CursorStyleOptions,
  type MousePointerStyle,
  type RenderContext,
  type ThemeMode,
  type ViewportBounds,
  type WidthMethod,
} from "./types.js"
import { RGBA, parseColor, type ColorInput } from "./lib/RGBA.js"
import type { Pointer } from "bun:ffi"
import { OptimizedBuffer } from "./buffer.js"
import { resolveRenderLib, type RenderLib } from "./zig.js"
import { TerminalConsole, type ConsoleOptions, capture } from "./console.js"
import { type MouseEventType, type RawMouseEvent, type ScrollInfo } from "./lib/parse.mouse.js"
import { Selection } from "./lib/selection.js"
import { Clipboard, type ClipboardTarget } from "./lib/clipboard.js"
import { EventEmitter } from "events"
import { destroySingleton, hasSingleton, singleton } from "./lib/singleton.js"
import { getObjectsInViewport } from "./lib/objects-in-viewport.js"
import { KeyHandler, InternalKeyHandler } from "./lib/KeyHandler.js"
import { isEditBufferRenderable, type EditBufferRenderable } from "./renderables/EditBufferRenderable.js"
import { env, registerEnvVar } from "./lib/env.js"
import { getTreeSitterClient } from "./lib/tree-sitter/index.js"
import {
  createTerminalPalette,
  type TerminalPaletteDetector,
  type TerminalColors,
  type GetPaletteOptions,
} from "./lib/terminal-palette.js"
import {
  isCapabilityResponse,
  isPixelResolutionResponse,
  parsePixelResolution,
} from "./lib/terminal-capability-detection.js"
import { type Clock, type TimerHandle, SystemClock } from "./lib/clock.js"
import { StdinParser, type StdinEvent, type StdinParserProtocolContext } from "./lib/stdin-parser.js"
import { matchesKeyBinding } from "./lib/keymapping.js"

registerEnvVar({
  name: "OTUI_DUMP_CAPTURES",
  description: "Dump captured stdout and console caches when the renderer exit handler runs.",
  type: "boolean",
  default: false,
})

registerEnvVar({
  name: "OTUI_NO_NATIVE_RENDER",
  description:
    "Skip the Zig/native frame renderer. Useful for debugging the render loop; split-footer stdout flushing may still write ANSI.",
  type: "boolean",
  default: false,
})

registerEnvVar({
  name: "OTUI_USE_ALTERNATE_SCREEN",
  description: "When explicitly set, force screen mode selection: true=alternate-screen, false=main-screen.",
  type: "boolean",
  default: true,
})

registerEnvVar({
  name: "OTUI_OVERRIDE_STDOUT",
  description: "When explicitly set, force stdout routing: false=passthrough, true=capture in split-footer mode.",
  type: "boolean",
  default: true,
})

registerEnvVar({
  name: "OTUI_DEBUG",
  description: "Enable debug mode to capture all raw input for debugging purposes.",
  type: "boolean",
  default: false,
})

registerEnvVar({
  name: "OTUI_SHOW_STATS",
  description: "Show the debug overlay at startup.",
  type: "boolean",
  default: false,
})

export interface CliRendererConfig {
  // Read input from this stream. Defaults to process.stdin.
  stdin?: NodeJS.ReadStream

  // Use a custom stdout stream for size detection and stdout interception.
  // Native frame output still goes to the real TTY.
  stdout?: NodeJS.WriteStream

  // Tell the native renderer it is driving a remote terminal.
  remote?: boolean

  // Skip terminal setup. Useful in tests.
  testing?: boolean

  // Call renderer.destroy() when Ctrl+C is pressed. Defaults to true.
  exitOnCtrlC?: boolean

  // Clean up on these signals. Defaults to the common termination signals.
  exitSignals?: NodeJS.Signals[]

  // Forward these env var names to native terminal detection.
  forwardEnvKeys?: string[]

  // Wait this long before handling resize events. Defaults to 100 ms.
  debounceDelay?: number

  // Aim for this many frames per second in continuous mode. Defaults to 30.
  targetFps?: number

  // Cap immediate re-renders at this frame rate. Defaults to 60.
  maxFps?: number

  // Emit memory snapshots on this interval in ms. Set 0 to disable.
  memorySnapshotInterval?: number

  // Render from a separate thread when the platform supports it.
  useThread?: boolean

  // Collect frame timing stats for the debug overlay.
  gatherStats?: boolean

  // Keep this many timing samples. Defaults to 300.
  maxStatSamples?: number

  // Pass options to the built-in console overlay.
  consoleOptions?: Omit<ConsoleOptions, "clock">

  // Run these hooks after each render pass.
  postProcessFns?: ((buffer: OptimizedBuffer, deltaTime: number) => void)[]

  // Track mouse move events. Defaults to true.
  enableMouseMovement?: boolean

  // Enable mouse input. Defaults to true.
  useMouse?: boolean

  // Focus the nearest focusable renderable on left click. Defaults to true.
  autoFocus?: boolean

  // Choose where the renderer owns terminal space. Defaults to "alternate-screen".
  screenMode?: ScreenMode

  // Set the requested footer height for "split-footer". Defaults to 12.
  footerHeight?: number

  // Choose what happens to writes that go through `stdout.write`.
  externalOutputMode?: ExternalOutputMode

  // Choose what the built-in console overlay does.
  consoleMode?: ConsoleMode

  // Set Kitty keyboard protocol flags, or null to disable them.
  useKittyKeyboard?: KittyKeyboardOptions | null

  // Fill the render buffer with this background color. Default transparent.
  backgroundColor?: ColorInput

  // Open the console overlay on uncaught errors. Defaults to true in development.
  openConsoleOnError?: boolean

  // Run these input handlers before the built-in handlers.
  prependInputHandlers?: ((sequence: string) => boolean)[]

  // Cap the stdin parser buffer size in bytes. Defaults to 64 MB.
  stdinParserMaxBufferBytes?: number

  // Use a custom clock for timers and tests.
  clock?: Clock

  // Run after destroy() finishes cleanup.
  onDestroy?: () => void
}

// Controls how the renderer uses terminal space:
//
// - "alternate-screen": Use the terminal's alternate screen buffer.
//
// - "main-screen": Render on the main screen.
//
// - "split-footer": Keep the renderer in a reserved footer on the main screen.
export type ScreenMode = "alternate-screen" | "main-screen" | "split-footer"

// Controls writes that go through the configured `stdout.write`.
//
// - "capture-stdout": Queue stdout and replay it above the split footer.
//   Only valid with "split-footer".
//
// - "passthrough": Leave stdout alone.
export type ExternalOutputMode = "capture-stdout" | "passthrough"

// Controls the built-in console overlay:
//
// - "console-overlay": Capture `console.*` output and show the overlay.
//
// - "disabled": Hide the overlay. `OTUI_USE_CONSOLE` controls global console
//   capture.
export type ConsoleMode = "console-overlay" | "disabled"

export type PixelResolution = {
  width: number
  height: number
}

const DEFAULT_FOOTER_HEIGHT = 12

function normalizeFooterHeight(footerHeight: number | undefined): number {
  if (footerHeight === undefined) {
    return DEFAULT_FOOTER_HEIGHT
  }

  if (!Number.isFinite(footerHeight)) {
    throw new Error("footerHeight must be a finite number")
  }

  const normalizedFooterHeight = Math.trunc(footerHeight)
  if (normalizedFooterHeight <= 0) {
    throw new Error("footerHeight must be greater than 0")
  }

  return normalizedFooterHeight
}

function resolveModes(config: CliRendererConfig): {
  screenMode: ScreenMode
  footerHeight: number
  externalOutputMode: ExternalOutputMode
} {
  let screenMode = config.screenMode ?? "alternate-screen"
  if (process.env.OTUI_USE_ALTERNATE_SCREEN !== undefined) {
    screenMode = env.OTUI_USE_ALTERNATE_SCREEN ? "alternate-screen" : "main-screen"
  }

  const footerHeight =
    screenMode === "split-footer" ? normalizeFooterHeight(config.footerHeight) : DEFAULT_FOOTER_HEIGHT

  let externalOutputMode =
    config.externalOutputMode ?? (screenMode === "split-footer" ? "capture-stdout" : "passthrough")
  if (process.env.OTUI_OVERRIDE_STDOUT !== undefined) {
    externalOutputMode = env.OTUI_OVERRIDE_STDOUT && screenMode === "split-footer" ? "capture-stdout" : "passthrough"
  }

  if (externalOutputMode === "capture-stdout" && screenMode !== "split-footer") {
    throw new Error('externalOutputMode "capture-stdout" requires screenMode "split-footer"')
  }

  return {
    screenMode,
    footerHeight,
    externalOutputMode,
  }
}

const DEFAULT_FORWARDED_ENV_KEYS = [
  "TMUX",
  "TERM",
  "OPENTUI_GRAPHICS",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "ALACRITTY_SOCKET",
  "ALACRITTY_LOG",
  "COLORTERM",
  "TERMUX_VERSION",
  "VHS_RECORD",
  "OPENTUI_FORCE_WCWIDTH",
  "OPENTUI_FORCE_UNICODE",
  "OPENTUI_FORCE_NOZWJ",
  "OPENTUI_FORCE_EXPLICIT_WIDTH",
  "WT_SESSION",
  "STY",
  "WSL_DISTRO_NAME",
  "WSL_INTEROP",
] as const

// Kitty keyboard protocol flags
// See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
const KITTY_FLAG_DISAMBIGUATE = 0b1 // Report disambiguated escape codes
const KITTY_FLAG_EVENT_TYPES = 0b10 // Report event types (press/repeat/release)
const KITTY_FLAG_ALTERNATE_KEYS = 0b100 // Report alternate keys (e.g., numpad vs regular)
const KITTY_FLAG_ALL_KEYS_AS_ESCAPES = 0b1000 // Report all keys as escape codes
const KITTY_FLAG_REPORT_TEXT = 0b10000 // Report text associated with key events

const DEFAULT_STDIN_PARSER_MAX_BUFFER_BYTES = 64 * 1024 * 1024

/**
 * Kitty Keyboard Protocol configuration options
 * See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/#progressive-enhancement
 */
export interface KittyKeyboardOptions {
  /** Disambiguate escape codes (fixes ESC timing, alt+key ambiguity, ctrl+c as event). Default: true */
  disambiguate?: boolean
  /** Report alternate keys (numpad, shifted, base layout) for cross-keyboard shortcuts. Default: true */
  alternateKeys?: boolean
  /** Report event types (press/repeat/release). Default: false */
  events?: boolean
  /** Report all keys as escape codes. Default: false */
  allKeysAsEscapes?: boolean
  /** Report text associated with key events. Default: false */
  reportText?: boolean
}

/**
 * Build kitty keyboard protocol flags based on configuration
 * @param config Kitty keyboard configuration object (null/undefined = disabled)
 * @returns The combined flags value (0 = disabled, >0 = enabled)
 * @internal Exported for testing
 */
export function buildKittyKeyboardFlags(config: KittyKeyboardOptions | null | undefined): number {
  if (!config) {
    return 0
  }

  let flags = 0

  // Default: disambiguate + alternate keys (both default to true)
  // - Disambiguate (0b1): Fixes ESC timing issues, alt+key ambiguity, makes ctrl+c a key event
  // - Alternate keys (0b100): Reports shifted/base-layout keys for cross-keyboard shortcuts

  // disambiguate defaults to true unless explicitly set to false
  if (config.disambiguate !== false) {
    flags |= KITTY_FLAG_DISAMBIGUATE
  }

  // alternateKeys defaults to true unless explicitly set to false
  if (config.alternateKeys !== false) {
    flags |= KITTY_FLAG_ALTERNATE_KEYS
  }

  // Optional flags (default to false, only enabled when explicitly true)
  if (config.events === true) {
    flags |= KITTY_FLAG_EVENT_TYPES
  }

  if (config.allKeysAsEscapes === true) {
    flags |= KITTY_FLAG_ALL_KEYS_AS_ESCAPES
  }

  if (config.reportText === true) {
    flags |= KITTY_FLAG_REPORT_TEXT
  }

  return flags
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
  public readonly isDragging?: boolean
  private _propagationStopped: boolean = false
  private _defaultPrevented: boolean = false

  public get propagationStopped(): boolean {
    return this._propagationStopped
  }

  public get defaultPrevented(): boolean {
    return this._defaultPrevented
  }

  constructor(target: Renderable | null, attributes: RawMouseEvent & { source?: Renderable; isDragging?: boolean }) {
    this.target = target
    this.type = attributes.type
    this.button = attributes.button
    this.x = attributes.x
    this.y = attributes.y
    this.modifiers = attributes.modifiers
    this.scroll = attributes.scroll
    this.source = attributes.source
    this.isDragging = attributes.isDragging
  }

  public stopPropagation(): void {
    this._propagationStopped = true
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

const rendererTracker = singleton("RendererTracker", () => {
  const renderers = new Set<CliRenderer>()
  return {
    addRenderer: (renderer: CliRenderer) => {
      renderers.add(renderer)
    },
    removeRenderer: (renderer: CliRenderer) => {
      renderers.delete(renderer)
      if (renderers.size === 0) {
        process.stdin.pause()

        if (hasSingleton("tree-sitter-client")) {
          getTreeSitterClient().destroy()
          destroySingleton("tree-sitter-client")
        }
      }
    },
  }
})

export async function createCliRenderer(config: CliRendererConfig = {}): Promise<CliRenderer> {
  if (process.argv.includes("--delay-start")) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  const stdin = config.stdin || process.stdin
  const stdout = config.stdout || process.stdout
  const { screenMode, footerHeight } = resolveModes(config)

  const width = stdout.columns || 80
  const height = stdout.rows || 24
  const renderHeight = screenMode === "split-footer" ? footerHeight : height

  const ziglib = resolveRenderLib()
  const rendererPtr = ziglib.createRenderer(width, renderHeight, {
    remote: config.remote ?? false,
    testing: config.testing ?? false,
  })
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

  const kittyConfig = config.useKittyKeyboard ?? {}
  const kittyFlags = buildKittyKeyboardFlags(kittyConfig)

  ziglib.setKittyKeyboardFlags(rendererPtr, kittyFlags)

  const renderer = new CliRenderer(ziglib, rendererPtr, stdin, stdout, width, height, config)
  if (!config.testing) {
    await renderer.setupTerminal()
  }
  return renderer
}

export enum CliRenderEvents {
  RESIZE = "resize",
  FOCUS = "focus",
  BLUR = "blur",
  FOCUSED_EDITOR = "focused_editor",
  THEME_MODE = "theme_mode",
  CAPABILITIES = "capabilities",
  SELECTION = "selection",
  DEBUG_OVERLAY_TOGGLE = "debugOverlay:toggle",
  DESTROY = "destroy",
  MEMORY_SNAPSHOT = "memory:snapshot",
}

export enum RendererControlState {
  IDLE = "idle",
  AUTO_STARTED = "auto_started",
  EXPLICIT_STARTED = "explicit_started",
  EXPLICIT_PAUSED = "explicit_paused",
  EXPLICIT_SUSPENDED = "explicit_suspended",
  EXPLICIT_STOPPED = "explicit_stopped",
}

export class CliRenderer extends EventEmitter implements RenderContext {
  private static animationFrameId = 0
  private lib: RenderLib
  public rendererPtr: Pointer
  public stdin: NodeJS.ReadStream
  private stdout: NodeJS.WriteStream
  private exitOnCtrlC: boolean
  private exitSignals: NodeJS.Signals[]
  private _exitListenersAdded: boolean = false
  private _isDestroyed: boolean = false
  private _destroyPending: boolean = false
  private _destroyFinalized: boolean = false
  private _destroyCleanupPrepared: boolean = false
  public nextRenderBuffer: OptimizedBuffer
  public currentRenderBuffer: OptimizedBuffer
  private _isRunning: boolean = false
  private _targetFps: number = 30
  private _maxFps: number = 60
  private automaticMemorySnapshot: boolean = false
  private memorySnapshotInterval: number
  private memorySnapshotTimer: TimerHandle | null = null
  private lastMemorySnapshot: {
    heapUsed: number
    heapTotal: number
    arrayBuffers: number
  } = {
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
  private backgroundColor: RGBA = RGBA.fromInts(0, 0, 0, 0)
  private waitingForPixelResolution: boolean = false
  private readonly clock: Clock

  private rendering: boolean = false
  private renderingNative: boolean = false
  private renderTimeout: TimerHandle | null = null
  private lastTime: number = 0
  private frameCount: number = 0
  private lastFpsTime: number = 0
  private currentFps: number = 0
  private targetFrameTime: number = 1000 / this._targetFps
  private minTargetFrameTime: number = 1000 / this._maxFps
  private immediateRerenderRequested: boolean = false
  private updateScheduled: boolean = false

  private liveRequestCounter: number = 0
  private _controlState: RendererControlState = RendererControlState.IDLE

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
    enabled: env.OTUI_SHOW_STATS,
    corner: DebugOverlayCorner.bottomRight,
  }

  private _console: TerminalConsole
  private _resolution: PixelResolution | null = null
  private _keyHandler: InternalKeyHandler
  private stdinParser: StdinParser | null = null
  private readonly oscSubscribers = new Set<(sequence: string) => void>()
  private hasLoggedStdinParserError = false

  private animationRequest: Map<number, FrameRequestCallback> = new Map()

  private resizeTimeoutId: TimerHandle | null = null
  private capabilityTimeoutId: TimerHandle | null = null
  private resizeDebounceDelay: number = 100

  private enableMouseMovement: boolean = false
  private _useMouse: boolean = true
  private autoFocus: boolean = true
  private _screenMode: ScreenMode = "alternate-screen"
  private _footerHeight: number = DEFAULT_FOOTER_HEIGHT
  private _externalOutputMode: ExternalOutputMode = "passthrough"
  private _suspendedMouseEnabled: boolean = false
  private _previousControlState: RendererControlState = RendererControlState.IDLE
  private capturedRenderable?: Renderable
  private lastOverRenderableNum: number = 0
  private lastOverRenderable?: Renderable

  private currentSelection: Selection | null = null
  private selectionContainers: Renderable[] = []
  private clipboard: Clipboard

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
  private sigwinchHandler: () => void = (() => {
    const width = this.stdout.columns || 80
    const height = this.stdout.rows || 24
    this.handleResize(width, height)
  }).bind(this)
  private _capabilities: any | null = null
  private _latestPointer: { x: number; y: number } = { x: 0, y: 0 }
  private _hasPointer: boolean = false
  private _lastPointerModifiers: RawMouseEvent["modifiers"] = {
    shift: false,
    alt: false,
    ctrl: false,
  }
  private _currentMousePointerStyle: MousePointerStyle | undefined = undefined

  private _currentFocusedRenderable: Renderable | null = null
  private lifecyclePasses: Set<Renderable> = new Set()
  private _openConsoleOnError: boolean = true
  private _paletteDetector: TerminalPaletteDetector | null = null
  private _cachedPalette: TerminalColors | null = null
  private _paletteDetectionPromise: Promise<TerminalColors> | null = null
  private _onDestroy?: () => void
  private _themeMode: ThemeMode | null = null
  private _terminalFocusState: boolean | null = null

  private sequenceHandlers: ((sequence: string) => boolean)[] = []
  private prependedInputHandlers: ((sequence: string) => boolean)[] = []
  private shouldRestoreModesOnNextFocus: boolean = false

  private idleResolvers: (() => void)[] = []

  private _debugInputs: Array<{ timestamp: string; sequence: string }> = []
  private _debugModeEnabled: boolean = env.OTUI_DEBUG

  private handleError: (error: Error) => void = ((error: Error) => {
    console.error(error)

    if (this._openConsoleOnError) {
      this.console.show()
    }
  }).bind(this)

  private dumpOutputCache(optionalMessage: string = ""): void {
    const cachedLogs = this.console.getCachedLogs()
    const capturedOutput = capture.claimOutput()

    if (capturedOutput.length > 0 || cachedLogs.length > 0) {
      this.realStdoutWrite.call(this.stdout, optionalMessage)
    }

    if (cachedLogs.length > 0) {
      this.realStdoutWrite.call(this.stdout, "Console cache:\n")
      this.realStdoutWrite.call(this.stdout, cachedLogs)
    }

    if (capturedOutput.length > 0) {
      this.realStdoutWrite.call(this.stdout, "\nCaptured output:\n")
      this.realStdoutWrite.call(this.stdout, capturedOutput + "\n")
    }

    this.realStdoutWrite.call(this.stdout, ANSI.reset)
  }

  private exitHandler: () => void = (() => {
    this.destroy()
    if (env.OTUI_DUMP_CAPTURES) {
      Bun.sleep(100).then(() => {
        this.dumpOutputCache("=== CAPTURED OUTPUT ===\n")
      })
    }
  }).bind(this)

  private warningHandler: (warning: any) => void = ((warning: any) => {
    console.warn(JSON.stringify(warning.message, null, 2))
  }).bind(this)

  public get controlState(): RendererControlState {
    return this._controlState
  }

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

    rendererTracker.addRenderer(this)

    this.stdin = stdin
    this.stdout = stdout
    this.realStdoutWrite = stdout.write
    this.lib = lib
    this._terminalWidth = stdout.columns ?? width
    this._terminalHeight = stdout.rows ?? height
    this.width = width
    this.height = height
    this._useThread = config.useThread === undefined ? false : config.useThread
    const { screenMode, footerHeight, externalOutputMode } = resolveModes(config)

    this._footerHeight = footerHeight
    this._screenMode = screenMode

    this.rendererPtr = rendererPtr

    const forwardEnvKeys = config.forwardEnvKeys ?? [...DEFAULT_FORWARDED_ENV_KEYS]
    for (const key of forwardEnvKeys) {
      const value = process.env[key]
      if (value === undefined) continue
      this.lib.setTerminalEnvVar(this.rendererPtr, key, value)
    }

    this.exitOnCtrlC = config.exitOnCtrlC === undefined ? true : config.exitOnCtrlC
    this.exitSignals = config.exitSignals || [
      "SIGINT", // Ctrl+C
      "SIGTERM", // Termination signal
      "SIGQUIT", // Ctrl+\
      "SIGABRT", // Abort signal
      "SIGHUP", // Hangup (terminal closed)
      "SIGBREAK", // Ctrl+Break on Windows
      "SIGPIPE", // Broken pipe
      "SIGBUS", // Bus error
    ]

    this.clipboard = new Clipboard(this.lib, this.rendererPtr)
    this.resizeDebounceDelay = config.debounceDelay || 100
    this.targetFps = config.targetFps || 30
    this.maxFps = config.maxFps || 60
    this.clock = config.clock ?? new SystemClock()
    this.memorySnapshotInterval = config.memorySnapshotInterval ?? 0
    this.gatherStats = config.gatherStats || false
    this.maxStatSamples = config.maxStatSamples || 300
    this.enableMouseMovement = config.enableMouseMovement ?? true
    this._useMouse = config.useMouse ?? true
    this.autoFocus = config.autoFocus ?? true
    this.nextRenderBuffer = this.lib.getNextBuffer(this.rendererPtr)
    this.currentRenderBuffer = this.lib.getCurrentBuffer(this.rendererPtr)
    this.postProcessFns = config.postProcessFns || []
    this.prependedInputHandlers = config.prependInputHandlers || []

    this.root = new RootRenderable(this)

    if (this.memorySnapshotInterval > 0) {
      this.startMemorySnapshotTimer()
    }

    // Handle terminal resize
    process.on("SIGWINCH", this.sigwinchHandler)

    process.on("warning", this.warningHandler)

    process.on("uncaughtException", this.handleError)
    process.on("unhandledRejection", this.handleError)
    process.on("beforeExit", this.exitHandler)

    const kittyConfig = config.useKittyKeyboard ?? {}
    const useKittyForParsing = kittyConfig !== null
    this._keyHandler = new InternalKeyHandler()
    this._keyHandler.on("keypress", (event) => {
      // Use the shared matcher here too. Kitty can report a non-Latin
      // character plus a base-layout `c`, and Ctrl+C should still exit.
      if (this.exitOnCtrlC && matchesKeyBinding(event, { name: "c", ctrl: true })) {
        process.nextTick(() => {
          this.destroy()
        })
        return
      }
    })

    this.addExitListeners()

    const stdinParserMaxBufferBytes = config.stdinParserMaxBufferBytes ?? DEFAULT_STDIN_PARSER_MAX_BUFFER_BYTES
    this.stdinParser = new StdinParser({
      timeoutMs: 20,
      maxPendingBytes: stdinParserMaxBufferBytes,
      armTimeouts: true,
      onTimeoutFlush: () => {
        this.drainStdinParser()
      },
      useKittyKeyboard: useKittyForParsing,
      protocolContext: {
        kittyKeyboardEnabled: useKittyForParsing,
        privateCapabilityRepliesActive: false,
        pixelResolutionQueryActive: false,
        explicitWidthCprActive: false,
      },
      clock: this.clock,
    })

    this._console = new TerminalConsole(this, {
      ...(config.consoleOptions ?? {}),
      clock: this.clock,
    })
    this.consoleMode = config.consoleMode ?? "console-overlay"
    this.applyScreenMode(screenMode, false, false)
    this.externalOutputMode = externalOutputMode
    this._openConsoleOnError = config.openConsoleOnError ?? process.env.NODE_ENV !== "production"
    this._onDestroy = config.onDestroy

    global.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const id = CliRenderer.animationFrameId++
      this.animationRequest.set(id, callback)
      this.requestLive()
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
    if (env.OTUI_NO_NATIVE_RENDER) {
      this.renderNative = () => {
        if (this._splitHeight > 0) {
          this.flushStdoutCache(this._splitHeight)
        }
      }
    }

    this.setupInput()
  }

  private addExitListeners(): void {
    if (this._exitListenersAdded || this.exitSignals.length === 0) return

    this.exitSignals.forEach((signal) => {
      process.addListener(signal, this.exitHandler)
    })

    this._exitListenersAdded = true
  }

  private removeExitListeners(): void {
    if (!this._exitListenersAdded || this.exitSignals.length === 0) return

    this.exitSignals.forEach((signal) => {
      process.removeListener(signal, this.exitHandler)
    })

    this._exitListenersAdded = false
  }

  public get isDestroyed(): boolean {
    return this._isDestroyed
  }

  public registerLifecyclePass(renderable: Renderable) {
    this.lifecyclePasses.add(renderable)
  }

  public unregisterLifecyclePass(renderable: Renderable) {
    this.lifecyclePasses.delete(renderable)
  }

  public getLifecyclePasses() {
    return this.lifecyclePasses
  }

  public get currentFocusedRenderable(): Renderable | null {
    return this._currentFocusedRenderable
  }

  public get currentFocusedEditor(): EditBufferRenderable | null {
    if (!this._currentFocusedRenderable) return null
    if (!isEditBufferRenderable(this._currentFocusedRenderable)) return null
    return this._currentFocusedRenderable
  }

  private normalizeClockTime(now: number, fallback: number): number {
    if (Number.isFinite(now)) {
      return now
    }

    return Number.isFinite(fallback) ? fallback : 0
  }

  private getElapsedMs(now: number, then: number): number {
    if (!Number.isFinite(now) || !Number.isFinite(then)) {
      return 0
    }

    return Math.max(now - then, 0)
  }

  public focusRenderable(renderable: Renderable) {
    if (this._currentFocusedRenderable === renderable) return

    const prev = this.currentFocusedEditor

    this._currentFocusedRenderable?.blur()
    this._currentFocusedRenderable = renderable

    const next = this.currentFocusedEditor
    if (prev !== next) {
      this.emit(CliRenderEvents.FOCUSED_EDITOR, next, prev)
    }
  }

  public blurRenderable(renderable: Renderable): void {
    if (this._currentFocusedRenderable === renderable) {
      this._currentFocusedRenderable = null
    }
  }

  private setCapturedRenderable(renderable: Renderable | undefined): void {
    if (this.capturedRenderable === renderable) {
      return
    }
    this.capturedRenderable = renderable
  }

  public addToHitGrid(x: number, y: number, width: number, height: number, id: number) {
    if (id !== this.capturedRenderable?.num) {
      this.lib.addToHitGrid(this.rendererPtr, x, y, width, height, id)
    }
  }

  public pushHitGridScissorRect(x: number, y: number, width: number, height: number): void {
    this.lib.hitGridPushScissorRect(this.rendererPtr, x, y, width, height)
  }

  public popHitGridScissorRect(): void {
    this.lib.hitGridPopScissorRect(this.rendererPtr)
  }

  public clearHitGridScissorRects(): void {
    this.lib.hitGridClearScissorRects(this.rendererPtr)
  }

  public get widthMethod(): WidthMethod {
    const caps = this.capabilities
    return caps?.unicode === "wcwidth" ? "wcwidth" : "unicode"
  }

  private writeOut(chunk: any, encoding?: any, callback?: any): boolean {
    if (this.rendererPtr && this._useThread) {
      const data = typeof chunk === "string" ? chunk : (chunk?.toString() ?? "")
      this.lib.writeOut(this.rendererPtr, data)
      if (typeof callback === "function") {
        process.nextTick(callback)
      }
      return true
    }

    return this.realStdoutWrite.call(this.stdout, chunk, encoding, callback)
  }

  public requestRender() {
    if (this._controlState === RendererControlState.EXPLICIT_SUSPENDED) {
      return
    }

    if (this._isRunning) {
      return
    }

    // NOTE: Using a frame callback that causes a re-render while already rendering
    // leads to a continuous loop of renders.
    if (this.rendering) {
      this.immediateRerenderRequested = true
      return
    }

    if (!this.updateScheduled && !this.renderTimeout) {
      this.updateScheduled = true
      const now = this.normalizeClockTime(this.clock.now(), this.lastTime)
      const elapsed = this.getElapsedMs(now, this.lastTime)
      const delay = Math.max(this.minTargetFrameTime - elapsed, 0)

      if (delay === 0) {
        process.nextTick(() => this.activateFrame())
        return
      }

      this.clock.setTimeout(() => this.activateFrame(), delay)
    }
  }

  private async activateFrame() {
    if (!this.updateScheduled) {
      this.resolveIdleIfNeeded()
      return
    }

    try {
      await this.loop()
    } finally {
      this.updateScheduled = false
      this.resolveIdleIfNeeded()
    }
  }

  public get consoleMode(): ConsoleMode {
    return this._useConsole ? "console-overlay" : "disabled"
  }

  public set consoleMode(mode: ConsoleMode) {
    this._useConsole = mode === "console-overlay"
    if (this._useConsole) {
      this.console.activate()
    } else {
      this.console.deactivate()
    }
  }

  public get isRunning(): boolean {
    return this._isRunning
  }

  private isIdleNow(): boolean {
    return (
      !this._isRunning &&
      !this.rendering &&
      !this.renderTimeout &&
      !this.updateScheduled &&
      !this.immediateRerenderRequested
    )
  }

  private resolveIdleIfNeeded(): void {
    if (!this.isIdleNow()) return
    const resolvers = this.idleResolvers.splice(0)
    for (const resolve of resolvers) {
      resolve()
    }
  }

  public idle(): Promise<void> {
    if (this._isDestroyed) return Promise.resolve()
    if (this.isIdleNow()) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve)
    })
  }

  public get resolution(): PixelResolution | null {
    return this._resolution
  }

  public get console(): TerminalConsole {
    return this._console
  }

  public get keyInput(): KeyHandler {
    return this._keyHandler
  }

  public get _internalKeyInput(): InternalKeyHandler {
    return this._keyHandler
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

  public get targetFps(): number {
    return this._targetFps
  }

  public set targetFps(targetFps: number) {
    this._targetFps = targetFps
    this.targetFrameTime = 1000 / this._targetFps
  }

  public get maxFps(): number {
    return this._maxFps
  }

  public set maxFps(maxFps: number) {
    this._maxFps = maxFps
    this.minTargetFrameTime = 1000 / this._maxFps
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

  public get screenMode(): ScreenMode {
    return this._screenMode
  }

  public set screenMode(mode: ScreenMode) {
    if (this.externalOutputMode === "capture-stdout" && mode !== "split-footer") {
      throw new Error('externalOutputMode "capture-stdout" requires screenMode "split-footer"')
    }

    this.applyScreenMode(mode)
  }

  public get footerHeight(): number {
    return this._footerHeight
  }

  public set footerHeight(footerHeight: number) {
    const normalizedFooterHeight = normalizeFooterHeight(footerHeight)
    if (normalizedFooterHeight === this._footerHeight) {
      return
    }

    this._footerHeight = normalizedFooterHeight
    if (this.screenMode === "split-footer") {
      this.applyScreenMode("split-footer")
    }
  }

  public get externalOutputMode(): ExternalOutputMode {
    return this._externalOutputMode
  }

  public set externalOutputMode(mode: ExternalOutputMode) {
    if (mode === "capture-stdout" && this.screenMode !== "split-footer") {
      throw new Error('externalOutputMode "capture-stdout" requires screenMode "split-footer"')
    }

    this._externalOutputMode = mode
    this.stdout.write = mode === "capture-stdout" ? this.interceptStdoutWrite : this.realStdoutWrite
  }

  public get liveRequestCount(): number {
    return this.liveRequestCounter
  }

  public get currentControlState(): string {
    return this._controlState
  }

  public get capabilities(): any | null {
    return this._capabilities
  }

  public get themeMode(): ThemeMode | null {
    return this._themeMode
  }

  public getDebugInputs(): Array<{ timestamp: string; sequence: string }> {
    return [...this._debugInputs]
  }

  public get useKittyKeyboard(): boolean {
    return this.lib.getKittyKeyboardFlags(this.rendererPtr) > 0
  }

  public set useKittyKeyboard(use: boolean) {
    const flags = use ? KITTY_FLAG_DISAMBIGUATE | KITTY_FLAG_ALTERNATE_KEYS : 0
    this.lib.setKittyKeyboardFlags(this.rendererPtr, flags)
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

  private applyScreenMode(screenMode: ScreenMode, emitResize: boolean = true, requestRender: boolean = true): void {
    const prevScreenMode = this._screenMode
    const prevSplitHeight = this._splitHeight
    const nextSplitHeight = screenMode === "split-footer" ? this._footerHeight : 0

    if (prevScreenMode === screenMode && prevSplitHeight === nextSplitHeight) {
      return
    }

    const prevUseAlternateScreen = prevScreenMode === "alternate-screen"
    const nextUseAlternateScreen = screenMode === "alternate-screen"
    const terminalScreenModeChanged = this._terminalIsSetup && prevUseAlternateScreen !== nextUseAlternateScreen
    const leavingSplitFooter = prevSplitHeight > 0 && nextSplitHeight === 0

    if (this._terminalIsSetup && leavingSplitFooter) {
      this.flushStdoutCache(this._terminalHeight, true)
    }

    if (this._terminalIsSetup && !terminalScreenModeChanged) {
      if (prevSplitHeight === 0 && nextSplitHeight > 0) {
        const freedLines = this._terminalHeight - nextSplitHeight
        const scrollDown = ANSI.scrollDown(freedLines)
        this.writeOut(scrollDown)
      } else if (prevSplitHeight > nextSplitHeight && nextSplitHeight > 0) {
        const freedLines = prevSplitHeight - nextSplitHeight
        const scrollDown = ANSI.scrollDown(freedLines)
        this.writeOut(scrollDown)
      } else if (prevSplitHeight < nextSplitHeight && prevSplitHeight > 0) {
        const additionalLines = nextSplitHeight - prevSplitHeight
        const scrollUp = ANSI.scrollUp(additionalLines)
        this.writeOut(scrollUp)
      }
    }

    if (prevSplitHeight === 0 && nextSplitHeight > 0) {
      capture.on("write", this.captureCallback)
    } else if (prevSplitHeight > 0 && nextSplitHeight === 0) {
      capture.off("write", this.captureCallback)
    }

    this._screenMode = screenMode
    this._splitHeight = nextSplitHeight
    this.renderOffset = nextSplitHeight > 0 ? this._terminalHeight - nextSplitHeight : 0
    this.width = this._terminalWidth
    this.height = nextSplitHeight > 0 ? nextSplitHeight : this._terminalHeight

    this.lib.setRenderOffset(this.rendererPtr, this.renderOffset)
    this.lib.resizeRenderer(this.rendererPtr, this.width, this.height)
    this.nextRenderBuffer = this.lib.getNextBuffer(this.rendererPtr)
    this.currentRenderBuffer = this.lib.getCurrentBuffer(this.rendererPtr)

    this._console.resize(this.width, this.height)
    this.root.resize(this.width, this.height)

    if (terminalScreenModeChanged) {
      this.lib.suspendRenderer(this.rendererPtr)
      this.lib.setupTerminal(this.rendererPtr, nextUseAlternateScreen)

      if (this._useMouse) {
        this.enableMouse()
      }
    }

    if (emitResize) {
      this.emit(CliRenderEvents.RESIZE, this.width, this.height)
    }

    if (requestRender) {
      this.requestRender()
    }
  }

  // TODO: Move this to native
  private flushStdoutCache(space: number, force: boolean = false): boolean {
    if (capture.size === 0 && !force) return false

    const output = capture.claimOutput()

    const rendererStartLine = this._terminalHeight - this._splitHeight
    const flush = ANSI.moveCursorAndClear(rendererStartLine, 1)

    const outputLine = this._terminalHeight - this._splitHeight
    const move = ANSI.moveCursor(outputLine, 1)

    let clear = ""
    if (space > 0) {
      const backgroundColor = this.backgroundColor.toInts()
      const newlines = " ".repeat(this.width) + "\n".repeat(space)
      // Check if background is transparent (alpha = 0)
      if (backgroundColor[3] === 0) {
        clear = newlines
      } else {
        clear =
          ANSI.setRgbBackground(backgroundColor[0], backgroundColor[1], backgroundColor[2]) +
          newlines +
          ANSI.resetBackground
      }
    }

    this.writeOut(flush + move + output + clear)

    return true
  }

  private enableMouse(): void {
    this._useMouse = true
    this.lib.enableMouse(this.rendererPtr, this.enableMouseMovement)
  }

  private disableMouse(): void {
    this._useMouse = false
    this.setCapturedRenderable(undefined)
    this.stdinParser?.resetMouseState()
    this.lib.disableMouse(this.rendererPtr)
  }

  public enableKittyKeyboard(flags: number = 0b00011): void {
    this.lib.enableKittyKeyboard(this.rendererPtr, flags)
    this.updateStdinParserProtocolContext({ kittyKeyboardEnabled: true })
  }

  public disableKittyKeyboard(): void {
    this.lib.disableKittyKeyboard(this.rendererPtr)
    this.updateStdinParserProtocolContext({ kittyKeyboardEnabled: false }, true)
  }

  public set useThread(useThread: boolean) {
    this._useThread = useThread
    this.lib.setUseThread(this.rendererPtr, useThread)
  }

  // TODO: All input management may move to native when zig finally has async io support again,
  // without rolling a full event loop
  public async setupTerminal(): Promise<void> {
    if (this._terminalIsSetup) return
    this._terminalIsSetup = true

    this.updateStdinParserProtocolContext({
      privateCapabilityRepliesActive: true,
      explicitWidthCprActive: true,
    })
    this.lib.setupTerminal(this.rendererPtr, this._screenMode === "alternate-screen")
    this._capabilities = this.lib.getTerminalCapabilities(this.rendererPtr)

    if (this.debugOverlay.enabled) {
      this.lib.setDebugOverlay(this.rendererPtr, true, this.debugOverlay.corner)
      if (!this.memorySnapshotInterval) {
        this.memorySnapshotInterval = 3000
        this.startMemorySnapshotTimer()
        this.automaticMemorySnapshot = true
      }
    }

    this.capabilityTimeoutId = this.clock.setTimeout(() => {
      this.capabilityTimeoutId = null
      this.removeInputHandler(this.capabilityHandler)
      this.updateStdinParserProtocolContext(
        {
          privateCapabilityRepliesActive: false,
          explicitWidthCprActive: false,
        },
        true,
      )
    }, 5000)

    if (this._useMouse) {
      this.enableMouse()
    }

    this.queryPixelResolution()
  }

  private stdinListener: (chunk: Buffer | string) => void = ((chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (!this.stdinParser) return

    try {
      this.stdinParser.push(data)
      this.drainStdinParser()
    } catch (error) {
      this.handleStdinParserFailure(error)
    }
  }).bind(this)

  public addInputHandler(handler: (sequence: string) => boolean): void {
    this.sequenceHandlers.push(handler)
  }

  public prependInputHandler(handler: (sequence: string) => boolean): void {
    this.sequenceHandlers.unshift(handler)
  }

  public removeInputHandler(handler: (sequence: string) => boolean): void {
    this.sequenceHandlers = this.sequenceHandlers.filter((candidate) => candidate !== handler)
  }

  private updateStdinParserProtocolContext(patch: Partial<StdinParserProtocolContext>, drain = false): void {
    if (!this.stdinParser) return
    this.stdinParser.updateProtocolContext(patch)
    if (drain) this.drainStdinParser()
  }

  public subscribeOsc(handler: (sequence: string) => void): () => void {
    this.oscSubscribers.add(handler)
    return () => {
      this.oscSubscribers.delete(handler)
    }
  }

  private capabilityHandler: (sequence: string) => boolean = ((sequence: string) => {
    if (isCapabilityResponse(sequence)) {
      this.lib.processCapabilityResponse(this.rendererPtr, sequence)
      this._capabilities = this.lib.getTerminalCapabilities(this.rendererPtr)
      this.emit(CliRenderEvents.CAPABILITIES, this._capabilities)
      return true
    }
    return false
  }).bind(this)

  private focusHandler: (sequence: string) => boolean = ((sequence: string) => {
    if (sequence === "\x1b[I") {
      // When the terminal regains focus, some terminal emulators (notably
      // Windows Terminal / ConPTY) may have stripped DEC private modes like
      // mouse tracking, bracketed paste, and focus tracking itself while the
      // window was unfocused.
      if (this.shouldRestoreModesOnNextFocus) {
        this.lib.restoreTerminalModes(this.rendererPtr)
        this.shouldRestoreModesOnNextFocus = false
      }
      if (this._terminalFocusState !== true) {
        this._terminalFocusState = true
        this.emit(CliRenderEvents.FOCUS)
      }
      return true
    }
    if (sequence === "\x1b[O") {
      this.shouldRestoreModesOnNextFocus = true
      if (this._terminalFocusState !== false) {
        this._terminalFocusState = false
        this.emit(CliRenderEvents.BLUR)
      }
      return true
    }
    return false
  }).bind(this)

  private themeModeHandler: (sequence: string) => boolean = ((sequence: string) => {
    if (sequence === "\x1b[?997;1n") {
      if (this._themeMode !== "dark") {
        this._themeMode = "dark"
        this.emit(CliRenderEvents.THEME_MODE, "dark")
      }
      return true
    }
    if (sequence === "\x1b[?997;2n") {
      if (this._themeMode !== "light") {
        this._themeMode = "light"
        this.emit(CliRenderEvents.THEME_MODE, "light")
      }
      return true
    }
    return false
  }).bind(this)

  private dispatchSequenceHandlers(sequence: string): boolean {
    if (this._debugModeEnabled) {
      this._debugInputs.push({
        timestamp: new Date().toISOString(),
        sequence,
      })
    }

    for (const handler of this.sequenceHandlers) {
      if (handler(sequence)) {
        return true
      }
    }

    return false
  }

  private drainStdinParser(): void {
    if (!this.stdinParser) return

    this.stdinParser.drain((event) => {
      this.handleStdinEvent(event)
    })
  }

  private handleStdinEvent(event: StdinEvent): void {
    switch (event.type) {
      case "key":
        if (this.dispatchSequenceHandlers(event.raw)) {
          return
        }

        this._keyHandler.processParsedKey(event.key)
        return
      case "mouse":
        if (this._useMouse && this.processSingleMouseEvent(event.event)) {
          return
        }

        this.dispatchSequenceHandlers(event.raw)
        return
      case "paste":
        this._keyHandler.processPaste(event.bytes, event.metadata)
        return
      case "response":
        if (event.protocol === "osc") {
          for (const subscriber of this.oscSubscribers) {
            subscriber(event.sequence)
          }
        }

        this.dispatchSequenceHandlers(event.sequence)
        return
    }
  }

  private handleStdinParserFailure(error: unknown): void {
    if (!this.hasLoggedStdinParserError) {
      this.hasLoggedStdinParserError = true
      if (process.env.NODE_ENV !== "test") {
        console.error("[stdin-parser-error] parser failure, resetting parser", error)
      }
    }

    try {
      this.stdinParser?.reset()
    } catch (resetError) {
      console.error("stdin parser reset failed after parser error", resetError)
    }
  }

  private setupInput(): void {
    for (const handler of this.prependedInputHandlers) {
      this.addInputHandler(handler)
    }

    this.addInputHandler((sequence: string) => {
      if (isPixelResolutionResponse(sequence) && this.waitingForPixelResolution) {
        const resolution = parsePixelResolution(sequence)
        if (resolution) {
          this._resolution = resolution
        }
        this.waitingForPixelResolution = false
        this.updateStdinParserProtocolContext({ pixelResolutionQueryActive: false }, true)
        return true
      }
      return false
    })
    this.addInputHandler(this.capabilityHandler)
    this.addInputHandler(this.focusHandler)
    this.addInputHandler(this.themeModeHandler)

    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(true)
    }

    this.stdin.on("data", this.stdinListener)
    this.stdin.resume()
  }

  private dispatchMouseEvent(
    target: Renderable,
    attributes: RawMouseEvent & { source?: Renderable; isDragging?: boolean },
  ): MouseEvent {
    const event = new MouseEvent(target, attributes)
    target.processMouseEvent(event)

    if (this.autoFocus && event.type === "down" && event.button === MouseButton.LEFT && !event.defaultPrevented) {
      let current: Renderable | null = target
      while (current) {
        if (current.focusable) {
          current.focus()
          break
        }
        current = current.parent
      }
    }

    return event
  }

  private processSingleMouseEvent(mouseEvent: RawMouseEvent): boolean {
    if (this._splitHeight > 0) {
      if (mouseEvent.y < this.renderOffset) {
        return false
      }
      mouseEvent.y -= this.renderOffset
    }

    this._latestPointer.x = mouseEvent.x
    this._latestPointer.y = mouseEvent.y
    this._hasPointer = true
    this._lastPointerModifiers = mouseEvent.modifiers

    if (this._console.visible) {
      const consoleBounds = this._console.bounds
      if (
        mouseEvent.x >= consoleBounds.x &&
        mouseEvent.x < consoleBounds.x + consoleBounds.width &&
        mouseEvent.y >= consoleBounds.y &&
        mouseEvent.y < consoleBounds.y + consoleBounds.height
      ) {
        const event = new MouseEvent(null, mouseEvent)
        const handled = this._console.handleMouse(event)
        if (handled) return true
      }
    }

    if (mouseEvent.type === "scroll") {
      const maybeRenderableId = this.hitTest(mouseEvent.x, mouseEvent.y)
      const maybeRenderable = Renderable.renderablesByNumber.get(maybeRenderableId)
      const fallbackTarget =
        this._currentFocusedRenderable &&
        !this._currentFocusedRenderable.isDestroyed &&
        this._currentFocusedRenderable.focused
          ? this._currentFocusedRenderable
          : null
      const scrollTarget = maybeRenderable ?? fallbackTarget

      if (scrollTarget) {
        const event = new MouseEvent(scrollTarget, mouseEvent)
        scrollTarget.processMouseEvent(event)
      }
      return true
    }

    const maybeRenderableId = this.hitTest(mouseEvent.x, mouseEvent.y)
    const sameElement = maybeRenderableId === this.lastOverRenderableNum
    this.lastOverRenderableNum = maybeRenderableId
    const maybeRenderable = Renderable.renderablesByNumber.get(maybeRenderableId)

    if (
      mouseEvent.type === "down" &&
      mouseEvent.button === MouseButton.LEFT &&
      !this.currentSelection?.isDragging &&
      !mouseEvent.modifiers.ctrl
    ) {
      const canStartSelection = Boolean(
        maybeRenderable &&
        maybeRenderable.selectable &&
        !maybeRenderable.isDestroyed &&
        maybeRenderable.shouldStartSelection(mouseEvent.x, mouseEvent.y),
      )

      if (canStartSelection && maybeRenderable) {
        this.startSelection(maybeRenderable, mouseEvent.x, mouseEvent.y)
        this.dispatchMouseEvent(maybeRenderable, mouseEvent)
        return true
      }
    }

    if (mouseEvent.type === "drag" && this.currentSelection?.isDragging) {
      this.updateSelection(maybeRenderable, mouseEvent.x, mouseEvent.y)

      if (maybeRenderable) {
        const event = new MouseEvent(maybeRenderable, {
          ...mouseEvent,
          isDragging: true,
        })
        maybeRenderable.processMouseEvent(event)
      }

      return true
    }

    if (mouseEvent.type === "up" && this.currentSelection?.isDragging) {
      if (maybeRenderable) {
        const event = new MouseEvent(maybeRenderable, {
          ...mouseEvent,
          isDragging: true,
        })
        maybeRenderable.processMouseEvent(event)
      }

      this.finishSelection()
      return true
    }

    if (mouseEvent.type === "down" && mouseEvent.button === MouseButton.LEFT && this.currentSelection) {
      if (mouseEvent.modifiers.ctrl) {
        this.currentSelection.isDragging = true
        this.updateSelection(maybeRenderable, mouseEvent.x, mouseEvent.y)
        return true
      }
    }

    if (!sameElement && (mouseEvent.type === "drag" || mouseEvent.type === "move")) {
      if (
        this.lastOverRenderable &&
        this.lastOverRenderable !== this.capturedRenderable &&
        !this.lastOverRenderable.isDestroyed
      ) {
        const event = new MouseEvent(this.lastOverRenderable, {
          ...mouseEvent,
          type: "out",
        })
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
      const event = new MouseEvent(this.capturedRenderable, {
        ...mouseEvent,
        type: "drag-end",
      })
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
      this.setCapturedRenderable(undefined)
      // Dropping the renderable needs to push another frame when the renderer is not live
      // to update the hit grid, otherwise capturedRenderable won't be in the hit grid and will not receive mouse events
      this.requestRender()
    }

    let event: MouseEvent | undefined
    if (maybeRenderable) {
      if (mouseEvent.type === "drag" && mouseEvent.button === MouseButton.LEFT) {
        this.setCapturedRenderable(maybeRenderable)
      } else {
        this.setCapturedRenderable(undefined)
      }
      event = this.dispatchMouseEvent(maybeRenderable, mouseEvent)
    } else {
      this.setCapturedRenderable(undefined)
      this.lastOverRenderable = undefined
    }

    if (!event?.defaultPrevented && mouseEvent.type === "down" && this.currentSelection) {
      this.clearSelection()
    }

    return true
  }

  /**
   * Recheck hover state after hit grid changes.
   * Called after render when native code detects the hit grid changed.
   * Fires out/over events if the element under the cursor changed.
   */
  private recheckHoverState(): void {
    if (this._isDestroyed || !this._hasPointer) return
    if (this.capturedRenderable) return

    const hitId = this.hitTest(this._latestPointer.x, this._latestPointer.y)
    const hitRenderable = Renderable.renderablesByNumber.get(hitId)
    const lastOver = this.lastOverRenderable

    // No change
    if (lastOver?.num === hitId) {
      this.lastOverRenderableNum = hitId
      return
    }

    const baseEvent: RawMouseEvent = {
      type: "move",
      button: 0,
      x: this._latestPointer.x,
      y: this._latestPointer.y,
      modifiers: this._lastPointerModifiers,
    }

    // Fire out on old element
    if (lastOver && !lastOver.isDestroyed) {
      const event = new MouseEvent(lastOver, { ...baseEvent, type: "out" })
      lastOver.processMouseEvent(event)
    }

    this.lastOverRenderable = hitRenderable
    this.lastOverRenderableNum = hitId

    // Fire over on new element
    if (hitRenderable) {
      const event = new MouseEvent(hitRenderable, {
        ...baseEvent,
        type: "over",
      })
      hitRenderable.processMouseEvent(event)
    }
  }
  public setMousePointer(style: MousePointerStyle): void {
    this._currentMousePointerStyle = style
    this.lib.setCursorStyleOptions(this.rendererPtr, { cursor: style })
  }

  public hitTest(x: number, y: number): number {
    return this.lib.checkHit(this.rendererPtr, x, y)
  }

  private takeMemorySnapshot(): void {
    if (this._isDestroyed) return

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

    this.emit(CliRenderEvents.MEMORY_SNAPSHOT, this.lastMemorySnapshot)
  }

  private startMemorySnapshotTimer(): void {
    this.stopMemorySnapshotTimer()

    this.memorySnapshotTimer = this.clock.setInterval(() => {
      this.takeMemorySnapshot()
    }, this.memorySnapshotInterval)
  }

  private stopMemorySnapshotTimer(): void {
    if (this.memorySnapshotTimer) {
      this.clock.clearInterval(this.memorySnapshotTimer)
      this.memorySnapshotTimer = null
    }
  }

  public setMemorySnapshotInterval(interval: number): void {
    this.memorySnapshotInterval = interval

    if (this._isRunning && interval > 0) {
      this.startMemorySnapshotTimer()
    } else if (interval <= 0 && this.memorySnapshotTimer) {
      this.clock.clearInterval(this.memorySnapshotTimer)
      this.memorySnapshotTimer = null
    }
  }

  private handleResize(width: number, height: number): void {
    if (this._isDestroyed) return
    if (this._splitHeight > 0) {
      this.processResize(width, height)
      return
    }

    if (this.resizeTimeoutId !== null) {
      this.clock.clearTimeout(this.resizeTimeoutId)
      this.resizeTimeoutId = null
    }

    this.resizeTimeoutId = this.clock.setTimeout(() => {
      this.resizeTimeoutId = null
      this.processResize(width, height)
    }, this.resizeDebounceDelay)
  }

  private queryPixelResolution() {
    this.waitingForPixelResolution = true
    this.updateStdinParserProtocolContext({ pixelResolutionQueryActive: true })
    this.lib.queryPixelResolution(this.rendererPtr)
  }

  private processResize(width: number, height: number): void {
    if (width === this._terminalWidth && height === this._terminalHeight) return

    const prevWidth = this._terminalWidth

    this._terminalWidth = width
    this._terminalHeight = height
    this.queryPixelResolution()

    this.setCapturedRenderable(undefined)
    this.stdinParser?.resetMouseState()

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
      this.currentRenderBuffer.clear(this.backgroundColor)
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
    this.emit(CliRenderEvents.RESIZE, this.width, this.height)
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
    const willBeEnabled = !this.debugOverlay.enabled

    if (willBeEnabled && !this.memorySnapshotInterval) {
      this.memorySnapshotInterval = 3000
      this.startMemorySnapshotTimer()
      this.automaticMemorySnapshot = true
    } else if (!willBeEnabled && this.automaticMemorySnapshot) {
      this.stopMemorySnapshotTimer()
      this.memorySnapshotInterval = 0
      this.automaticMemorySnapshot = false
    }

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

  public setTerminalTitle(title: string): void {
    this.lib.setTerminalTitle(this.rendererPtr, title)
  }

  /**
   * Reset the terminal background color to its default via OSC 111.
   * Called automatically by destroy() and suspend(), but exposed for
   * consumers that need explicit control (e.g. before SIGTSTP).
   */
  public resetTerminalBgColor(): void {
    process.stdout.write("\x1b]111\x07")
  }

  public copyToClipboardOSC52(text: string, target?: ClipboardTarget): boolean {
    return this.clipboard.copyToClipboardOSC52(text, target)
  }

  public clearClipboardOSC52(target?: ClipboardTarget): boolean {
    return this.clipboard.clearClipboardOSC52(target)
  }

  public isOsc52Supported(): boolean {
    return this._capabilities?.osc52 ?? this.clipboard.isOsc52Supported()
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

  public static setCursorStyle(renderer: CliRenderer, options: CursorStyleOptions): void {
    const lib = resolveRenderLib()
    lib.setCursorStyleOptions(renderer.rendererPtr, options)
    if (options.cursor !== undefined) {
      renderer._currentMousePointerStyle = options.cursor
    }
  }

  public static setCursorColor(renderer: CliRenderer, color: RGBA): void {
    const lib = resolveRenderLib()
    lib.setCursorColor(renderer.rendererPtr, color)
  }

  public setCursorPosition(x: number, y: number, visible: boolean = true): void {
    this.lib.setCursorPosition(this.rendererPtr, x, y, visible)
  }

  public setCursorStyle(options: CursorStyleOptions): void {
    this.lib.setCursorStyleOptions(this.rendererPtr, options)
    if (options.cursor !== undefined) {
      this._currentMousePointerStyle = options.cursor
    }
  }

  public setCursorColor(color: RGBA): void {
    this.lib.setCursorColor(this.rendererPtr, color)
  }

  public getCursorState() {
    return this.lib.getCursorState(this.rendererPtr)
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

    if (this._controlState === RendererControlState.IDLE && this.liveRequestCounter > 0) {
      this._controlState = RendererControlState.AUTO_STARTED
      this.internalStart()
    }
  }

  public dropLive(): void {
    this.liveRequestCounter = Math.max(0, this.liveRequestCounter - 1)

    if (this._controlState === RendererControlState.AUTO_STARTED && this.liveRequestCounter === 0) {
      this._controlState = RendererControlState.IDLE
      this.internalPause()
    }
  }

  public start(): void {
    this._controlState = RendererControlState.EXPLICIT_STARTED
    this.internalStart()
  }

  public auto(): void {
    this._controlState = this._isRunning ? RendererControlState.AUTO_STARTED : RendererControlState.IDLE
  }

  private internalStart(): void {
    if (!this._isRunning && !this._isDestroyed) {
      this._isRunning = true

      // Invalidate any queued idle one-shot frame.
      // start()/live/resume transition to the continuous loop, so queued
      // activateFrame callbacks must no-op via !updateScheduled.
      this.updateScheduled = false

      if (this.memorySnapshotInterval > 0) {
        this.startMemorySnapshotTimer()
      }

      this.startRenderLoop()
    }
  }

  public pause(): void {
    this._controlState = RendererControlState.EXPLICIT_PAUSED
    this.internalPause()
  }

  public suspend(): void {
    this._previousControlState = this._controlState

    this._controlState = RendererControlState.EXPLICIT_SUSPENDED
    this.internalPause()

    this._suspendedMouseEnabled = this._useMouse

    this.disableMouse()
    this.removeExitListeners()
    this.waitingForPixelResolution = false
    this.updateStdinParserProtocolContext({
      privateCapabilityRepliesActive: false,
      pixelResolutionQueryActive: false,
      explicitWidthCprActive: false,
    })
    this.stdinParser?.reset()
    this.stdin.removeListener("data", this.stdinListener)
    this.lib.suspendRenderer(this.rendererPtr)

    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(false)
    }

    this.stdin.pause()
  }

  public resume(): void {
    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(true)
    }

    // Drain any input buffered during suspension before registering the
    // listener. Adding a "data" listener can auto-resume a Readable, so the
    // drain must come first while the stream is still paused and read()
    // pulls from the internal buffer rather than being a flowing-mode no-op.
    while (this.stdin.read() !== null) {}
    this.stdin.on("data", this.stdinListener)
    this.stdin.resume()
    this.addExitListeners()

    this.lib.resumeRenderer(this.rendererPtr)

    if (this._suspendedMouseEnabled) {
      this.enableMouse()
    }

    this.currentRenderBuffer.clear(this.backgroundColor)
    this._controlState = this._previousControlState

    if (
      this._previousControlState === RendererControlState.AUTO_STARTED ||
      this._previousControlState === RendererControlState.EXPLICIT_STARTED
    ) {
      this.internalStart()
    } else {
      this.requestRender()
    }
  }

  private internalPause(): void {
    this._isRunning = false

    if (this.renderTimeout) {
      this.clock.clearTimeout(this.renderTimeout)
      this.renderTimeout = null
    }

    if (!this.rendering) {
      this.resolveIdleIfNeeded()
    }
  }

  public stop(): void {
    this._controlState = RendererControlState.EXPLICIT_STOPPED
    this.internalStop()
  }

  private internalStop(): void {
    if (this.isRunning && !this._isDestroyed) {
      this._isRunning = false

      if (this.memorySnapshotTimer) {
        this.clock.clearInterval(this.memorySnapshotTimer)
        this.memorySnapshotTimer = null
      }

      if (this.renderTimeout) {
        this.clock.clearTimeout(this.renderTimeout)
        this.renderTimeout = null
      }

      // If we're currently rendering, the frame will resolve idle when it completes
      // Otherwise, resolve immediately
      if (!this.rendering) {
        this.resolveIdleIfNeeded()
      }
    }
  }

  public destroy(): void {
    if (this._isDestroyed) return
    this._isDestroyed = true
    this._destroyPending = true

    if (this.rendering) {
      // Restore terminal/input state immediately, but defer full native teardown until the frame unwinds.
      this.prepareDestroyDuringRender()
      return
    }

    this.finalizeDestroy()
  }

  private cleanupBeforeDestroy(): void {
    if (this._destroyCleanupPrepared) return
    this._destroyCleanupPrepared = true

    process.removeListener("SIGWINCH", this.sigwinchHandler)
    process.removeListener("uncaughtException", this.handleError)
    process.removeListener("unhandledRejection", this.handleError)
    process.removeListener("warning", this.warningHandler)
    process.removeListener("beforeExit", this.exitHandler)
    capture.removeListener("write", this.captureCallback)
    this.removeExitListeners()

    if (this.resizeTimeoutId !== null) {
      this.clock.clearTimeout(this.resizeTimeoutId)
      this.resizeTimeoutId = null
    }

    if (this.capabilityTimeoutId !== null) {
      this.clock.clearTimeout(this.capabilityTimeoutId)
      this.capabilityTimeoutId = null
    }

    if (this.memorySnapshotTimer) {
      this.clock.clearInterval(this.memorySnapshotTimer)
      this.memorySnapshotTimer = null
    }

    if (this.renderTimeout) {
      this.clock.clearTimeout(this.renderTimeout)
      this.renderTimeout = null
    }

    this._isRunning = false
    this.waitingForPixelResolution = false
    this.updateStdinParserProtocolContext(
      {
        privateCapabilityRepliesActive: false,
        pixelResolutionQueryActive: false,
        explicitWidthCprActive: false,
      },
      true,
    )
    this._useMouse = false
    this.setCapturedRenderable(undefined)

    this.stdin.removeListener("data", this.stdinListener)
    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(false)
    }

    this.externalOutputMode = "passthrough"

    if (this._splitHeight > 0) {
      this.flushStdoutCache(this._splitHeight, true)
    }
  }

  private prepareDestroyDuringRender(): void {
    this.cleanupBeforeDestroy()
    this.lib.suspendRenderer(this.rendererPtr)
  }

  private finalizeDestroy(): void {
    if (this._destroyFinalized) return

    this._destroyFinalized = true
    this._destroyPending = false

    this.cleanupBeforeDestroy()

    // Clean up palette detector
    if (this._paletteDetector) {
      this._paletteDetector.cleanup()
      this._paletteDetector = null
    }
    this._paletteDetectionPromise = null
    this._cachedPalette = null

    this.emit(CliRenderEvents.DESTROY)

    try {
      this.root.destroyRecursively()
    } catch (e) {
      console.error("Error destroying root renderable:", e instanceof Error ? e.stack : String(e))
    }

    this.stdinParser?.destroy()
    this.stdinParser = null
    this.oscSubscribers.clear()
    this._console.destroy()

    this.lib.destroyRenderer(this.rendererPtr)
    rendererTracker.removeRenderer(this)

    if (this._onDestroy) {
      try {
        this._onDestroy()
      } catch (e) {
        console.error("Error in onDestroy callback:", e instanceof Error ? e.stack : String(e))
      }
    }

    // Resolve any pending idle() calls
    this.resolveIdleIfNeeded()
  }

  private startRenderLoop(): void {
    if (!this._isRunning) return

    this.lastTime = this.normalizeClockTime(this.clock.now(), 0)
    this.frameCount = 0
    this.lastFpsTime = this.lastTime
    this.currentFps = 0

    this.loop()
  }

  private async loop(): Promise<void> {
    if (this.rendering || this._isDestroyed) return
    this.renderTimeout = null

    this.rendering = true
    if (this.renderTimeout) {
      this.clock.clearTimeout(this.renderTimeout)
      this.renderTimeout = null
    }
    try {
      const now = this.normalizeClockTime(this.clock.now(), this.lastTime)
      const elapsed = this.getElapsedMs(now, this.lastTime)

      const deltaTime = elapsed
      this.lastTime = now

      this.frameCount++
      if (this.getElapsedMs(now, this.lastFpsTime) >= 1000) {
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
      for (const callback of frameRequests) {
        callback(deltaTime)
        this.dropLive()
      }
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

      this.root.render(this.nextRenderBuffer, deltaTime)

      for (const postProcessFn of this.postProcessFns) {
        postProcessFn(this.nextRenderBuffer, deltaTime)
      }

      this._console.renderToBuffer(this.nextRenderBuffer)

      // If destroy() was requested during this frame, skip native work and scheduling.
      if (!this._isDestroyed) {
        this.renderNative()

        // Check if hit grid changed and recheck hover state if needed
        if (this._useMouse && this.lib.getHitGridDirty(this.rendererPtr)) {
          this.recheckHoverState()
        }

        const overallFrameTime = performance.now() - overallStart

        // TODO: Add animationRequestTime to stats
        this.lib.updateStats(
          this.rendererPtr,
          overallFrameTime,
          this.renderStats.fps,
          this.renderStats.frameCallbackTime,
        )

        if (this.gatherStats) {
          this.collectStatSample(overallFrameTime)
        }

        if (this._isRunning || this.immediateRerenderRequested) {
          const targetFrameTime = this.immediateRerenderRequested ? this.minTargetFrameTime : this.targetFrameTime
          const delay = Math.max(1, targetFrameTime - Math.floor(overallFrameTime))
          this.immediateRerenderRequested = false
          this.renderTimeout = this.clock.setTimeout(() => {
            this.renderTimeout = null
            this.loop()
          }, delay)
        } else {
          this.clock.clearTimeout(this.renderTimeout!)
          this.renderTimeout = null
        }
      }
    } finally {
      this.rendering = false
      if (this._destroyPending) {
        this.finalizeDestroy()
      }
      this.resolveIdleIfNeeded()
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

  public get hasSelection(): boolean {
    return !!this.currentSelection
  }

  public getSelectionContainer(): Renderable | null {
    return this.selectionContainers.length > 0 ? this.selectionContainers[this.selectionContainers.length - 1] : null
  }

  public clearSelection(): void {
    if (this.currentSelection) {
      for (const renderable of this.currentSelection.touchedRenderables) {
        if (renderable.selectable && !renderable.isDestroyed) {
          renderable.onSelectionChanged(null)
        }
      }
      this.currentSelection = null
    }
    this.selectionContainers = []
  }

  /**
   * Start a new selection at the given coordinates.
   * Used by both mouse and keyboard selection.
   */
  public startSelection(renderable: Renderable, x: number, y: number): void {
    if (!renderable.selectable) return

    this.clearSelection()
    this.selectionContainers.push(renderable.parent || this.root)
    this.currentSelection = new Selection(renderable, { x, y }, { x, y })
    this.currentSelection.isStart = true

    this.notifySelectablesOfSelectionChange()
  }

  public updateSelection(
    currentRenderable: Renderable | undefined,
    x: number,
    y: number,
    options?: { finishDragging?: boolean },
  ): void {
    if (this.currentSelection) {
      this.currentSelection.isStart = false
      this.currentSelection.focus = { x, y }

      if (options?.finishDragging) {
        this.currentSelection.isDragging = false
      }

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

      this.notifySelectablesOfSelectionChange()
    }
  }

  public requestSelectionUpdate(): void {
    if (this.currentSelection?.isDragging) {
      const pointer = this._latestPointer

      const maybeRenderableId = this.hitTest(pointer.x, pointer.y)
      const maybeRenderable = Renderable.renderablesByNumber.get(maybeRenderableId)

      this.updateSelection(maybeRenderable, pointer.x, pointer.y)
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
    if (this.currentSelection) {
      this.currentSelection.isDragging = false
      this.emit(CliRenderEvents.SELECTION, this.currentSelection)
      this.notifySelectablesOfSelectionChange()
    }
  }

  private notifySelectablesOfSelectionChange(): void {
    const selectedRenderables: Renderable[] = []
    const touchedRenderables: Renderable[] = []
    const currentContainer =
      this.selectionContainers.length > 0 ? this.selectionContainers[this.selectionContainers.length - 1] : this.root

    if (this.currentSelection) {
      this.walkSelectableRenderables(
        currentContainer,
        this.currentSelection.bounds,
        selectedRenderables,
        touchedRenderables,
      )

      for (const renderable of this.currentSelection.touchedRenderables) {
        if (!touchedRenderables.includes(renderable) && !renderable.isDestroyed) {
          renderable.onSelectionChanged(null)
        }
      }

      this.currentSelection.updateSelectedRenderables(selectedRenderables)
      this.currentSelection.updateTouchedRenderables(touchedRenderables)
    }
  }

  private walkSelectableRenderables(
    container: Renderable,
    selectionBounds: ViewportBounds,
    selectedRenderables: Renderable[],
    touchedRenderables: Renderable[],
  ): void {
    const children = getObjectsInViewport<Renderable>(
      selectionBounds,
      container.getChildrenSortedByPrimaryAxis(),
      container.primaryAxis,
      0, // padding
      0, // minTriggerSize - always perform overlap checks for selection
    )

    for (const child of children) {
      if (child.selectable) {
        const hasSelection = child.onSelectionChanged(this.currentSelection)
        if (hasSelection) {
          selectedRenderables.push(child)
        }
        touchedRenderables.push(child)
      }
      if (child.getChildrenCount() > 0) {
        this.walkSelectableRenderables(child, selectionBounds, selectedRenderables, touchedRenderables)
      }
    }
  }

  public get paletteDetectionStatus(): "idle" | "detecting" | "cached" {
    if (this._cachedPalette) return "cached"
    if (this._paletteDetectionPromise) return "detecting"
    return "idle"
  }

  public clearPaletteCache(): void {
    this._cachedPalette = null
  }

  /**
   * Detects the terminal's color palette
   *
   * @returns Promise resolving to TerminalColors object containing palette and special colors
   * @throws Error if renderer is suspended
   */
  public async getPalette(options?: GetPaletteOptions): Promise<TerminalColors> {
    if (this._controlState === RendererControlState.EXPLICIT_SUSPENDED) {
      throw new Error("Cannot detect palette while renderer is suspended")
    }

    const requestedSize = options?.size ?? 16

    if (this._cachedPalette && this._cachedPalette.palette.length !== requestedSize) {
      this._cachedPalette = null
    }

    if (this._cachedPalette) {
      return this._cachedPalette
    }

    if (this._paletteDetectionPromise) {
      return this._paletteDetectionPromise
    }

    if (!this._paletteDetector) {
      const isLegacyTmux =
        this.capabilities?.terminal?.name?.toLowerCase()?.includes("tmux") &&
        this.capabilities?.terminal?.version?.localeCompare("3.6") < 0
      this._paletteDetector = createTerminalPalette(
        this.stdin,
        this.stdout,
        this.writeOut.bind(this),
        isLegacyTmux,
        {
          subscribeOsc: this.subscribeOsc.bind(this),
        },
        this.clock,
      )
    }

    this._paletteDetectionPromise = this._paletteDetector.detect(options).then((result) => {
      this._cachedPalette = result
      this._paletteDetectionPromise = null
      return result
    })

    return this._paletteDetectionPromise
  }
}
