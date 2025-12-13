import { EventEmitter } from "events"
import { Console } from "node:console"
import fs from "node:fs"
import path from "node:path"
import util from "node:util"
import type { CliRenderer, ColorInput } from "."
import { OptimizedBuffer } from "./buffer"
import { Capture, CapturedWritableStream } from "./lib/output.capture"
import { parseColor, RGBA } from "./lib/RGBA"
import { singleton } from "./lib/singleton"
import { env, registerEnvVar } from "./lib/env"
import type { KeyEvent } from "./lib/KeyHandler"

interface CallerInfo {
  functionName: string
  fullPath: string
  fileName: string
  lineNumber: number
  columnNumber: number
}

function getCallerInfo(): CallerInfo | null {
  const err = new Error()
  const stackLines = err.stack?.split("\n").slice(5) || []
  if (!stackLines.length) return null

  const callerLine = stackLines[0].trim()

  const regex = /at\s+(?:([\w$.<>]+)\s+\()?((?:\/|[A-Za-z]:\\)[^:]+):(\d+):(\d+)\)?/
  const match = callerLine.match(regex)

  if (!match) return null

  // Extract details from the match.
  const functionName = match[1] || "<anonymous>"
  const fullPath = match[2]
  const fileName = fullPath.split(/[\\/]/).pop() || "<unknown>"
  const lineNumber = parseInt(match[3], 10) || 0
  const columnNumber = parseInt(match[4], 10) || 0

  return { functionName, fullPath, fileName, lineNumber, columnNumber }
}

enum LogLevel {
  LOG = "LOG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

export const capture = singleton("ConsoleCapture", () => new Capture())

registerEnvVar({
  name: "OTUI_USE_CONSOLE",
  description: "Whether to use the console. Will not capture console output if set to false.",
  type: "boolean",
  default: true,
})

registerEnvVar({
  name: "SHOW_CONSOLE",
  description: "Show the console at startup if set to true.",
  type: "boolean",
  default: false,
})

class TerminalConsoleCache extends EventEmitter {
  private _cachedLogs: [Date, LogLevel, any[], CallerInfo | null][] = []
  private readonly MAX_CACHE_SIZE = 1000
  private _collectCallerInfo: boolean = false
  private _cachingEnabled: boolean = true
  private _originalConsole: typeof console | null = null

  get cachedLogs(): [Date, LogLevel, any[], CallerInfo | null][] {
    return this._cachedLogs
  }

  constructor() {
    super()

    // Note: Console activation will be handled by the renderer when needed
    // Don't activate on import to avoid hiding console.log globally
  }

  public activate(): void {
    if (!this._originalConsole) {
      this._originalConsole = global.console
    }
    this.setupConsoleCapture()
    this.overrideConsoleMethods()
  }

  private setupConsoleCapture(): void {
    if (!env.OTUI_USE_CONSOLE) return

    const mockStdout = new CapturedWritableStream("stdout", capture)
    const mockStderr = new CapturedWritableStream("stderr", capture)

    global.console = new Console({
      stdout: mockStdout,
      stderr: mockStderr,
      colorMode: true,
      inspectOptions: {
        compact: false,
        breakLength: 80,
        depth: 2,
      },
    })
  }

  private overrideConsoleMethods(): void {
    console.log = (...args: any[]) => {
      this.appendToConsole(LogLevel.LOG, ...args)
    }

    console.info = (...args: any[]) => {
      this.appendToConsole(LogLevel.INFO, ...args)
    }

    console.warn = (...args: any[]) => {
      this.appendToConsole(LogLevel.WARN, ...args)
    }

    console.error = (...args: any[]) => {
      this.appendToConsole(LogLevel.ERROR, ...args)
    }

    console.debug = (...args: any[]) => {
      this.appendToConsole(LogLevel.DEBUG, ...args)
    }
  }

  public setCollectCallerInfo(enabled: boolean): void {
    this._collectCallerInfo = enabled
  }

  public clearConsole(): void {
    this._cachedLogs = []
  }

  public setCachingEnabled(enabled: boolean): void {
    this._cachingEnabled = enabled
  }

  public deactivate(): void {
    this.restoreOriginalConsole()
  }

  private restoreOriginalConsole(): void {
    if (this._originalConsole) {
      global.console = this._originalConsole
    }

    this.setupConsoleCapture()
  }

  public addLogEntry(level: LogLevel, ...args: any[]) {
    const callerInfo = this._collectCallerInfo ? getCallerInfo() : null
    const logEntry: [Date, LogLevel, any[], CallerInfo | null] = [new Date(), level, args, callerInfo]

    if (this._cachingEnabled) {
      if (this._cachedLogs.length >= this.MAX_CACHE_SIZE) {
        this._cachedLogs.shift()
      }
      this._cachedLogs.push(logEntry)
    }

    return logEntry
  }

  private appendToConsole(level: LogLevel, ...args: any[]): void {
    if (this._cachedLogs.length >= this.MAX_CACHE_SIZE) {
      this._cachedLogs.shift()
    }
    const entry = this.addLogEntry(level, ...args)
    this.emit("entry", entry)
  }

  public destroy(): void {
    this.deactivate()
  }
}

const terminalConsoleCache = singleton("TerminalConsoleCache", () => {
  const terminalConsoleCache = new TerminalConsoleCache()
  process.on("exit", () => {
    terminalConsoleCache.destroy()
  })
  return terminalConsoleCache
})

export enum ConsolePosition {
  TOP = "top",
  BOTTOM = "bottom",
  LEFT = "left",
  RIGHT = "right",
}

interface ConsoleSelection {
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

interface CopyShortcut {
  key: string
  ctrl?: boolean
  shift?: boolean
}

export interface ConsoleOptions {
  position?: ConsolePosition
  sizePercent?: number
  zIndex?: number
  colorInfo?: ColorInput
  colorWarn?: ColorInput
  colorError?: ColorInput
  colorDebug?: ColorInput
  colorDefault?: ColorInput
  backgroundColor?: ColorInput
  startInDebugMode?: boolean
  title?: string
  titleBarColor?: ColorInput
  titleBarTextColor?: ColorInput
  cursorColor?: ColorInput
  maxStoredLogs?: number
  maxDisplayLines?: number
  onCopySelection?: (text: string) => void
  copyShortcut?: CopyShortcut
  selectionColor?: ColorInput
  copyButtonColor?: ColorInput
}

const DEFAULT_CONSOLE_OPTIONS: Required<Omit<ConsoleOptions, "onCopySelection">> & { onCopySelection?: (text: string) => void } = {
  position: ConsolePosition.BOTTOM,
  sizePercent: 30,
  zIndex: Infinity,
  colorInfo: "#00FFFF", // Cyan
  colorWarn: "#FFFF00", // Yellow
  colorError: "#FF0000", // Red
  colorDebug: "#808080", // Gray
  colorDefault: "#FFFFFF", // White
  backgroundColor: RGBA.fromValues(0.1, 0.1, 0.1, 0.7),
  startInDebugMode: false,
  title: "Console",
  titleBarColor: RGBA.fromValues(0.05, 0.05, 0.05, 0.7),
  titleBarTextColor: "#FFFFFF",
  cursorColor: "#00A0FF",
  maxStoredLogs: 2000,
  maxDisplayLines: 3000,
  onCopySelection: undefined,
  copyShortcut: { key: "c", ctrl: true, shift: true },
  selectionColor: RGBA.fromValues(0.3, 0.5, 0.8, 0.5),
  copyButtonColor: "#00A0FF",
}

const INDENT_WIDTH = 2

interface DisplayLine {
  text: string
  level: LogLevel
  indent: boolean
}

export class TerminalConsole extends EventEmitter {
  private isVisible: boolean = false
  private isFocused: boolean = false
  private renderer: CliRenderer
  private keyHandler: (event: KeyEvent) => void
  private options: Required<Omit<ConsoleOptions, "onCopySelection">> & { onCopySelection?: (text: string) => void }
  private _debugModeEnabled: boolean = false

  private frameBuffer: OptimizedBuffer | null = null
  private consoleX: number = 0
  private consoleY: number = 0
  private consoleWidth: number = 0
  private consoleHeight: number = 0
  private scrollTopIndex: number = 0
  private isScrolledToBottom: boolean = true
  private currentLineIndex: number = 0
  private _displayLines: DisplayLine[] = []
  private _allLogEntries: [Date, LogLevel, any[], CallerInfo | null][] = []
  private _needsFrameBufferUpdate: boolean = false
  private _entryListener: (logEntry: [Date, LogLevel, any[], CallerInfo | null]) => void

  private _selectionStart: { line: number; col: number } | null = null
  private _selectionEnd: { line: number; col: number } | null = null
  private _isSelecting: boolean = false
  private _copyButtonBounds: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 0, height: 0 }

  private markNeedsRerender(): void {
    this._needsFrameBufferUpdate = true
    this.renderer.requestRender()
  }

  private _rgbaInfo: RGBA
  private _rgbaWarn: RGBA
  private _rgbaError: RGBA
  private _rgbaDebug: RGBA
  private _rgbaDefault: RGBA
  private backgroundColor: RGBA
  private _rgbaTitleBar: RGBA
  private _rgbaTitleBarText: RGBA
  private _title: string
  private _rgbaCursor: RGBA
  private _rgbaSelection: RGBA
  private _rgbaCopyButton: RGBA

  private _positions: ConsolePosition[] = [
    ConsolePosition.TOP,
    ConsolePosition.RIGHT,
    ConsolePosition.BOTTOM,
    ConsolePosition.LEFT,
  ]

  constructor(renderer: CliRenderer, options: ConsoleOptions = {}) {
    super()
    this.renderer = renderer
    this.options = { ...DEFAULT_CONSOLE_OPTIONS, ...options }
    this.keyHandler = this.handleKeyPress.bind(this)
    this._debugModeEnabled = this.options.startInDebugMode
    terminalConsoleCache.setCollectCallerInfo(this._debugModeEnabled)

    this._rgbaInfo = parseColor(this.options.colorInfo)
    this._rgbaWarn = parseColor(this.options.colorWarn)
    this._rgbaError = parseColor(this.options.colorError)
    this._rgbaDebug = parseColor(this.options.colorDebug)
    this._rgbaDefault = parseColor(this.options.colorDefault)
    this.backgroundColor = parseColor(this.options.backgroundColor)
    this._rgbaTitleBar = parseColor(this.options.titleBarColor)
    this._rgbaTitleBarText = parseColor(this.options.titleBarTextColor || this.options.colorDefault)
    this._title = this.options.title
    this._rgbaCursor = parseColor(this.options.cursorColor)
    this._rgbaSelection = parseColor(this.options.selectionColor)
    this._rgbaCopyButton = parseColor(this.options.copyButtonColor)

    this._updateConsoleDimensions()
    this._scrollToBottom(true)

    this._entryListener = (logEntry: [Date, LogLevel, any[], CallerInfo | null]) => {
      this._handleNewLog(logEntry)
    }
    terminalConsoleCache.on("entry", this._entryListener)

    if (env.SHOW_CONSOLE) {
      this.show()
    }
  }

  public activate(): void {
    terminalConsoleCache.activate()
  }

  public deactivate(): void {
    terminalConsoleCache.deactivate()
  }

  // Handles a single new log entry *while the console is visible*
  private _handleNewLog(logEntry: [Date, LogLevel, any[], CallerInfo | null]): void {
    if (!this.isVisible) return

    this._allLogEntries.push(logEntry)

    if (this._allLogEntries.length > this.options.maxStoredLogs) {
      this._allLogEntries.splice(0, this._allLogEntries.length - this.options.maxStoredLogs)
    }

    const newDisplayLines = this._processLogEntry(logEntry)
    this._displayLines.push(...newDisplayLines)

    if (this._displayLines.length > this.options.maxDisplayLines) {
      this._displayLines.splice(0, this._displayLines.length - this.options.maxDisplayLines)
      const linesRemoved = this._displayLines.length - this.options.maxDisplayLines
      this.scrollTopIndex = Math.max(0, this.scrollTopIndex - linesRemoved)
    }

    if (this.isScrolledToBottom) {
      this._scrollToBottom()
    }
    this.markNeedsRerender()
  }

  private _updateConsoleDimensions(termWidth?: number, termHeight?: number): void {
    const width = termWidth ?? this.renderer.width
    const height = termHeight ?? this.renderer.height
    const sizePercent = this.options.sizePercent / 100

    switch (this.options.position) {
      case ConsolePosition.TOP:
        this.consoleX = 0
        this.consoleY = 0
        this.consoleWidth = width
        this.consoleHeight = Math.max(1, Math.floor(height * sizePercent))
        break
      case ConsolePosition.BOTTOM:
        this.consoleHeight = Math.max(1, Math.floor(height * sizePercent))
        this.consoleWidth = width
        this.consoleX = 0
        this.consoleY = height - this.consoleHeight
        break
      case ConsolePosition.LEFT:
        this.consoleWidth = Math.max(1, Math.floor(width * sizePercent))
        this.consoleHeight = height
        this.consoleX = 0
        this.consoleY = 0
        break
      case ConsolePosition.RIGHT:
        this.consoleWidth = Math.max(1, Math.floor(width * sizePercent))
        this.consoleHeight = height
        this.consoleY = 0
        this.consoleX = width - this.consoleWidth
        break
    }
    this.currentLineIndex = Math.max(0, Math.min(this.currentLineIndex, this.consoleHeight - 1))
  }

  private handleKeyPress(event: KeyEvent): void {
    let needsRedraw = false
    const displayLineCount = this._displayLines.length
    const logAreaHeight = Math.max(1, this.consoleHeight - 1)
    const maxScrollTop = Math.max(0, displayLineCount - logAreaHeight)
    const currentPositionIndex = this._positions.indexOf(this.options.position)

    if (event.name === "escape") {
      this.blur()
      return
    }

    if (event.name === "up" && event.shift) {
      // Shift+UpArrow - Scroll to top
      if (this.scrollTopIndex > 0 || this.currentLineIndex > 0) {
        this.scrollTopIndex = 0
        this.currentLineIndex = 0
        this.isScrolledToBottom = this._displayLines.length <= Math.max(1, this.consoleHeight - 1)
        needsRedraw = true
      }
    } else if (event.name === "down" && event.shift) {
      // Shift+DownArrow - Scroll to bottom
      const logAreaHeightForScroll = Math.max(1, this.consoleHeight - 1)
      const maxScrollPossible = Math.max(0, this._displayLines.length - logAreaHeightForScroll)
      if (this.scrollTopIndex < maxScrollPossible || !this.isScrolledToBottom) {
        this._scrollToBottom(true)
        needsRedraw = true
      }
    } else if (event.name === "up") {
      // Up arrow
      if (this.currentLineIndex > 0) {
        this.currentLineIndex--
        needsRedraw = true
      } else if (this.scrollTopIndex > 0) {
        this.scrollTopIndex--
        this.isScrolledToBottom = false
        needsRedraw = true
      }
    } else if (event.name === "down") {
      // Down arrow
      const canCursorMoveDown =
        this.currentLineIndex < logAreaHeight - 1 && this.scrollTopIndex + this.currentLineIndex < displayLineCount - 1

      if (canCursorMoveDown) {
        this.currentLineIndex++
        needsRedraw = true
      } else if (this.scrollTopIndex < maxScrollTop) {
        this.scrollTopIndex++
        this.isScrolledToBottom = this.scrollTopIndex === maxScrollTop
        needsRedraw = true
      }
    } else if (event.name === "p" && event.ctrl) {
      // Ctrl+p (Previous position)
      const prevIndex = (currentPositionIndex - 1 + this._positions.length) % this._positions.length
      this.options.position = this._positions[prevIndex]
      this.resize(this.renderer.width, this.renderer.height)
    } else if (event.name === "o" && event.ctrl) {
      // Ctrl+o (Next/Other position)
      const nextIndex = (currentPositionIndex + 1) % this._positions.length
      this.options.position = this._positions[nextIndex]
      this.resize(this.renderer.width, this.renderer.height)
    } else if (event.name === "+" || (event.name === "=" && event.shift)) {
      this.options.sizePercent = Math.min(100, this.options.sizePercent + 5)
      this.resize(this.renderer.width, this.renderer.height)
    } else if (event.name === "-") {
      this.options.sizePercent = Math.max(10, this.options.sizePercent - 5)
      this.resize(this.renderer.width, this.renderer.height)
    } else if (event.name === "s" && event.ctrl) {
      // Ctrl+s (Save logs)
      this.saveLogsToFile()
    } else if (
      this.options.copyShortcut &&
      event.name === this.options.copyShortcut.key &&
      event.ctrl === (this.options.copyShortcut.ctrl ?? false) &&
      event.shift === (this.options.copyShortcut.shift ?? false)
    ) {
      this.triggerCopy()
    }

    if (needsRedraw) {
      this.markNeedsRerender()
    }
  }

  private attachStdin(): void {
    if (this.isFocused) return
    this.renderer.keyInput.on("keypress", this.keyHandler)
    this.isFocused = true
  }

  private detachStdin(): void {
    if (!this.isFocused) return
    this.renderer.keyInput.off("keypress", this.keyHandler)
    this.isFocused = false
  }

  private formatTimestamp(date: Date): string {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date)
  }

  private formatArguments(args: any[]): string {
    return args
      .map((arg) => {
        if (arg instanceof Error) {
          const errorProps = arg
          return `Error: ${errorProps.message}\n` + (errorProps.stack ? `${errorProps.stack}\n` : "")
        }
        if (typeof arg === "object" && arg !== null) {
          try {
            return util.inspect(arg, { depth: 2 })
          } catch (e) {
            return String(arg)
          }
        }
        try {
          return util.inspect(arg, { depth: 2 })
        } catch (e) {
          return String(arg)
        }
      })
      .join(" ")
  }

  public resize(width: number, height: number): void {
    this._updateConsoleDimensions(width, height)

    if (this.frameBuffer) {
      this.frameBuffer.resize(this.consoleWidth, this.consoleHeight)

      const displayLineCount = this._displayLines.length
      const logAreaHeight = Math.max(1, this.consoleHeight - 1)
      const maxScrollTop = Math.max(0, displayLineCount - logAreaHeight)
      this.scrollTopIndex = Math.min(this.scrollTopIndex, maxScrollTop)
      this.isScrolledToBottom = this.scrollTopIndex === maxScrollTop
      const visibleLineCount = Math.min(logAreaHeight, displayLineCount - this.scrollTopIndex)
      this.currentLineIndex = Math.max(0, Math.min(this.currentLineIndex, visibleLineCount - 1))

      if (this.isVisible) {
        this.markNeedsRerender()
      }
    }
  }

  public clear(): void {
    terminalConsoleCache.clearConsole()
    this._allLogEntries = []
    this._displayLines = []
    this.markNeedsRerender()
  }

  public toggle(): void {
    if (this.isVisible) {
      if (this.isFocused) {
        this.hide()
      } else {
        this.focus()
      }
    } else {
      this.show()
    }
    if (!this.renderer.isRunning) {
      this.renderer.requestRender()
    }
  }

  public focus(): void {
    this.attachStdin()
    this._scrollToBottom(true)
    this.markNeedsRerender()
  }

  public blur(): void {
    this.detachStdin()
    this.markNeedsRerender()
  }

  public show(): void {
    if (!this.isVisible) {
      this.isVisible = true
      this._processCachedLogs()
      terminalConsoleCache.setCachingEnabled(false)

      if (!this.frameBuffer) {
        this.frameBuffer = OptimizedBuffer.create(this.consoleWidth, this.consoleHeight, this.renderer.widthMethod, {
          respectAlpha: this.backgroundColor.a < 1,
          id: "console framebuffer",
        })
      }
      const logCount = terminalConsoleCache.cachedLogs.length
      const visibleLogLines = Math.min(this.consoleHeight, logCount)
      this.currentLineIndex = Math.max(0, visibleLogLines - 1)
      this.scrollTopIndex = 0
      this._scrollToBottom(true)

      this.focus()
      this.markNeedsRerender()
    }
  }

  public hide(): void {
    if (this.isVisible) {
      this.isVisible = false
      this.blur()
      terminalConsoleCache.setCachingEnabled(true)
    }
  }

  public destroy(): void {
    this.hide()
    this.deactivate()
    terminalConsoleCache.off("entry", this._entryListener)
  }

  public getCachedLogs(): string {
    return terminalConsoleCache.cachedLogs
      .map((logEntry) => logEntry[0].toISOString() + " " + logEntry.slice(1).join(" "))
      .join("\n")
  }

  private updateFrameBuffer(): void {
    if (!this.frameBuffer) return

    this.frameBuffer.clear(this.backgroundColor)

    const displayLines = this._displayLines
    const displayLineCount = displayLines.length
    const logAreaHeight = Math.max(1, this.consoleHeight - 1)

    // --- Draw Title Bar ---
    this.frameBuffer.fillRect(0, 0, this.consoleWidth, 1, this._rgbaTitleBar)
    const dynamicTitle = `${this._title}${this.isFocused ? " (Focused)" : ""}`
    const titleX = Math.max(0, Math.floor((this.consoleWidth - dynamicTitle.length) / 2))
    this.frameBuffer.drawText(dynamicTitle, titleX, 0, this._rgbaTitleBarText, this._rgbaTitleBar)

    // --- Draw [Copy] Button ---
    const copyLabel = "[Copy]"
    const copyButtonX = this.consoleWidth - copyLabel.length - 1
    if (copyButtonX >= 0) {
      const copyButtonEnabled = this.hasSelection()
      const disabledColor = RGBA.fromInts(100, 100, 100, 255)
      const copyColor = copyButtonEnabled ? this._rgbaCopyButton : disabledColor
      this.frameBuffer.drawText(copyLabel, copyButtonX, 0, copyColor, this._rgbaTitleBar)
      this._copyButtonBounds = { x: copyButtonX, y: 0, width: copyLabel.length, height: 1 }
    } else {
      this._copyButtonBounds = { x: -1, y: -1, width: 0, height: 0 }
    }

    const startIndex = this.scrollTopIndex
    const endIndex = Math.min(startIndex + logAreaHeight, displayLineCount)
    const visibleDisplayLines = displayLines.slice(startIndex, endIndex)

    let lineY = 1
    for (let i = 0; i < visibleDisplayLines.length; i++) {
      if (lineY >= this.consoleHeight) break

      const displayLine = visibleDisplayLines[i]
      const absoluteLineIndex = startIndex + i

      let levelColor = this._rgbaDefault
      switch (displayLine.level) {
        case LogLevel.INFO:
          levelColor = this._rgbaInfo
          break
        case LogLevel.WARN:
          levelColor = this._rgbaWarn
          break
        case LogLevel.ERROR:
          levelColor = this._rgbaError
          break
        case LogLevel.DEBUG:
          levelColor = this._rgbaDebug
          break
      }

      const linePrefix = displayLine.indent ? " ".repeat(INDENT_WIDTH) : ""
      const textToDraw = displayLine.text
      const textAvailableWidth = this.consoleWidth - 1 - (displayLine.indent ? INDENT_WIDTH : 0)
      const showCursor = this.isFocused && lineY - 1 === this.currentLineIndex

      if (showCursor) {
        this.frameBuffer.drawText(">", 0, lineY, this._rgbaCursor, this.backgroundColor)
      } else {
        this.frameBuffer.drawText(" ", 0, lineY, this._rgbaDefault, this.backgroundColor)
      }

      const fullText = `${linePrefix}${textToDraw.substring(0, textAvailableWidth)}`
      const selectionRange = this.getLineSelectionRange(absoluteLineIndex)

      if (selectionRange) {
        const adjustedStart = Math.max(0, selectionRange.start)
        const adjustedEnd = Math.min(fullText.length, selectionRange.end)

        if (adjustedStart > 0) {
          this.frameBuffer.drawText(fullText.substring(0, adjustedStart), 1, lineY, levelColor)
        }

        if (adjustedStart < adjustedEnd) {
          this.frameBuffer.fillRect(1 + adjustedStart, lineY, adjustedEnd - adjustedStart, 1, this._rgbaSelection)
          this.frameBuffer.drawText(fullText.substring(adjustedStart, adjustedEnd), 1 + adjustedStart, lineY, levelColor, this._rgbaSelection)
        }

        if (adjustedEnd < fullText.length) {
          this.frameBuffer.drawText(fullText.substring(adjustedEnd), 1 + adjustedEnd, lineY, levelColor)
        }
      } else {
        this.frameBuffer.drawText(fullText, 1, lineY, levelColor)
      }

      lineY++
    }
  }

  public renderToBuffer(buffer: OptimizedBuffer): void {
    if (!this.isVisible || !this.frameBuffer) return

    if (this._needsFrameBufferUpdate) {
      this.updateFrameBuffer()
      this._needsFrameBufferUpdate = false
    }

    buffer.drawFrameBuffer(this.consoleX, this.consoleY, this.frameBuffer)
  }

  public setDebugMode(enabled: boolean): void {
    this._debugModeEnabled = enabled
    terminalConsoleCache.setCollectCallerInfo(enabled)
    if (this.isVisible) {
      this.markNeedsRerender()
    }
  }

  public toggleDebugMode(): void {
    this.setDebugMode(!this._debugModeEnabled)
  }

  private _scrollToBottom(forceCursorToLastLine: boolean = false): void {
    const displayLineCount = this._displayLines.length
    const logAreaHeight = Math.max(1, this.consoleHeight - 1)
    const maxScrollTop = Math.max(0, displayLineCount - logAreaHeight)
    this.scrollTopIndex = maxScrollTop
    this.isScrolledToBottom = true

    const visibleLineCount = Math.min(logAreaHeight, displayLineCount - this.scrollTopIndex)
    if (forceCursorToLastLine || this.currentLineIndex >= visibleLineCount) {
      this.currentLineIndex = Math.max(0, visibleLineCount - 1)
    }
  }

  private _processLogEntry(logEntry: [Date, LogLevel, any[], CallerInfo | null]): DisplayLine[] {
    const [date, level, args, callerInfo] = logEntry
    const displayLines: DisplayLine[] = []

    const timestamp = this.formatTimestamp(date)
    const callerSource = callerInfo ? `${callerInfo.fileName}:${callerInfo.lineNumber}` : "unknown"
    const prefix = `[${timestamp}] [${level}]` + (this._debugModeEnabled ? ` [${callerSource}]` : "") + " "

    const formattedArgs = this.formatArguments(args)
    const initialLines = formattedArgs.split("\n")

    for (let i = 0; i < initialLines.length; i++) {
      const lineText = initialLines[i]
      const isFirstLineOfEntry = i === 0
      const availableWidth = this.consoleWidth - 1 - (isFirstLineOfEntry ? 0 : INDENT_WIDTH)
      const linePrefix = isFirstLineOfEntry ? prefix : " ".repeat(INDENT_WIDTH)
      const textToWrap = isFirstLineOfEntry ? linePrefix + lineText : lineText

      let currentPos = 0
      while (currentPos < textToWrap.length || (isFirstLineOfEntry && currentPos === 0 && textToWrap.length === 0)) {
        const segment = textToWrap.substring(currentPos, currentPos + availableWidth)
        const isFirstSegmentOfLine = currentPos === 0

        displayLines.push({
          text: isFirstSegmentOfLine && !isFirstLineOfEntry ? linePrefix + segment : segment,
          level: level,
          indent: !isFirstLineOfEntry || !isFirstSegmentOfLine,
        })

        currentPos += availableWidth
        if (isFirstLineOfEntry && currentPos === 0 && textToWrap.length === 0) break
      }
    }

    return displayLines
  }

  private _processCachedLogs(): void {
    const logsToProcess = [...terminalConsoleCache.cachedLogs]
    terminalConsoleCache.clearConsole()

    this._allLogEntries.push(...logsToProcess)

    if (this._allLogEntries.length > this.options.maxStoredLogs) {
      this._allLogEntries.splice(0, this._allLogEntries.length - this.options.maxStoredLogs)
    }

    for (const logEntry of logsToProcess) {
      const processed = this._processLogEntry(logEntry)
      this._displayLines.push(...processed)
    }

    if (this._displayLines.length > this.options.maxDisplayLines) {
      this._displayLines.splice(0, this._displayLines.length - this.options.maxDisplayLines)
    }
  }

  private hasSelection(): boolean {
    return this._selectionStart !== null && this._selectionEnd !== null
  }

  private normalizeSelection(): ConsoleSelection | null {
    if (!this._selectionStart || !this._selectionEnd) return null

    const start = this._selectionStart
    const end = this._selectionEnd

    const startBeforeEnd =
      start.line < end.line || (start.line === end.line && start.col <= end.col)

    if (startBeforeEnd) {
      return {
        startLine: start.line,
        startCol: start.col,
        endLine: end.line,
        endCol: end.col,
      }
    } else {
      return {
        startLine: end.line,
        startCol: end.col,
        endLine: start.line,
        endCol: start.col,
      }
    }
  }

  private getSelectedText(): string {
    const selection = this.normalizeSelection()
    if (!selection) return ""

    const lines: string[] = []
    for (let i = selection.startLine; i <= selection.endLine; i++) {
      if (i < 0 || i >= this._displayLines.length) continue
      const line = this._displayLines[i]
      // Build full text as rendered (including indent prefix)
      const linePrefix = line.indent ? " ".repeat(INDENT_WIDTH) : ""
      const textAvailableWidth = this.consoleWidth - 1 - (line.indent ? INDENT_WIDTH : 0)
      const fullText = linePrefix + line.text.substring(0, textAvailableWidth)
      let text = fullText

      if (i === selection.startLine && i === selection.endLine) {
        text = fullText.substring(selection.startCol, selection.endCol)
      } else if (i === selection.startLine) {
        text = fullText.substring(selection.startCol)
      } else if (i === selection.endLine) {
        text = fullText.substring(0, selection.endCol)
      }

      lines.push(text)
    }

    return lines.join("\n")
  }

  private clearSelection(): void {
    this._selectionStart = null
    this._selectionEnd = null
    this._isSelecting = false
  }

  private triggerCopy(): void {
    if (!this.hasSelection()) return
    const text = this.getSelectedText()
    if (text && this.options.onCopySelection) {
      this.options.onCopySelection(text)
      this.clearSelection()
      this.markNeedsRerender()
    }
  }

  private getLineSelectionRange(lineIndex: number): { start: number; end: number } | null {
    const selection = this.normalizeSelection()
    if (!selection) return null

    if (lineIndex < selection.startLine || lineIndex > selection.endLine) {
      return null
    }

    const line = this._displayLines[lineIndex]
    if (!line) return null

    // Calculate the full text length as rendered (including indent prefix)
    const linePrefix = line.indent ? " ".repeat(INDENT_WIDTH) : ""
    const textAvailableWidth = this.consoleWidth - 1 - (line.indent ? INDENT_WIDTH : 0)
    const fullTextLength = linePrefix.length + Math.min(line.text.length, textAvailableWidth)

    let start = 0
    let end = fullTextLength

    if (lineIndex === selection.startLine) {
      start = Math.max(0, selection.startCol)
    }
    if (lineIndex === selection.endLine) {
      end = Math.min(fullTextLength, selection.endCol)
    }

    if (start >= end) return null
    return { start, end }
  }

  public handleMouse(x: number, y: number, type: "down" | "drag" | "up", button: number): boolean {
    if (!this.isVisible) return false

    const localX = x - this.consoleX
    const localY = y - this.consoleY

    if (localX < 0 || localX >= this.consoleWidth || localY < 0 || localY >= this.consoleHeight) {
      return false
    }

    if (localY === 0) {
      if (
        type === "down" &&
        button === 0 &&
        localX >= this._copyButtonBounds.x &&
        localX < this._copyButtonBounds.x + this._copyButtonBounds.width
      ) {
        this.triggerCopy()
        return true
      }
      return true
    }

    const lineIndex = this.scrollTopIndex + (localY - 1)
    const colIndex = Math.max(0, localX - 1)

    if (type === "down" && button === 0) {
      this.clearSelection()
      this._selectionStart = { line: lineIndex, col: colIndex }
      this._selectionEnd = { line: lineIndex, col: colIndex }
      this._isSelecting = true
      this.markNeedsRerender()
      return true
    }

    if (type === "drag" && this._isSelecting) {
      this._selectionEnd = { line: lineIndex, col: colIndex }
      this.markNeedsRerender()
      return true
    }

    if (type === "up") {
      if (this._isSelecting) {
        this._selectionEnd = { line: lineIndex, col: colIndex }
        this._isSelecting = false
        this.markNeedsRerender()
      }
      return true
    }

    return true
  }

  public get visible(): boolean {
    return this.isVisible
  }

  public get bounds(): { x: number; y: number; width: number; height: number } {
    return {
      x: this.consoleX,
      y: this.consoleY,
      width: this.consoleWidth,
      height: this.consoleHeight,
    }
  }

  private saveLogsToFile(): void {
    try {
      const timestamp = Date.now()
      const filename = `_console_${timestamp}.log`
      const filepath = path.join(process.cwd(), filename)

      const allLogEntries = [...this._allLogEntries, ...terminalConsoleCache.cachedLogs]

      const logLines: string[] = []

      for (const [date, level, args, callerInfo] of allLogEntries) {
        const timestampStr = this.formatTimestamp(date)
        const callerSource = callerInfo ? `${callerInfo.fileName}:${callerInfo.lineNumber}` : "unknown"
        const prefix = `[${timestampStr}] [${level}]` + (this._debugModeEnabled ? ` [${callerSource}]` : "") + " "
        const formattedArgs = this.formatArguments(args)
        logLines.push(prefix + formattedArgs)
      }

      const content = logLines.join("\n")
      fs.writeFileSync(filepath, content, "utf8")

      console.info(`Console logs saved to: ${filename}`)
    } catch (error) {
      console.error(`Failed to save console logs:`, error)
    }
  }
}
