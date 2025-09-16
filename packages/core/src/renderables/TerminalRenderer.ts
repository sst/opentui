import { type RenderableOptions, Renderable } from "../Renderable"
import type { OptimizedBuffer } from "../buffer"
import type { RenderContext } from "../types"
import type { MouseEvent } from "../renderer"
import { RGBA, parseColor} from "../lib/RGBA"
import { type ParsedKey } from "../lib/parse.keypress"
import { resolveRenderLib } from "../zig"
import { type Selection as GlobalSelection, convertGlobalToLocalSelection } from "../lib/selection"
import { copyTextToClipboard, pasteTextFromClipboard } from "../lib/clipboard"

type SelectionRect = {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
  duration: number
}

export interface TerminalRendererOptions extends RenderableOptions<TerminalRenderer> {
  cols?: number
  rows?: number
  shell?: 'bash' | 'zsh' | 'fish' | 'sh' | 'cmd' | 'powershell'
  cwd?: string
  env?: Record<string, string>
  backgroundColor?: string | RGBA
  autoFocus?: boolean
  selectionForegroundColor?: string | RGBA
  selectionBackgroundColor?: string | RGBA
}

/**
 * TerminalRenderer - A full-featured terminal emulator using libvterm
 *
 * This class provides a complete terminal emulator that can be embedded
 * in OpenTUI applications as a regular UI component. It uses libvterm
 * for proper ANSI sequence processing and terminal emulation.
 */
export class TerminalRenderer extends Renderable {
  private ptySession: any
  private _cols: number
  private _rows: number
  private _shell: 'bash' | 'zsh' | 'fish' | 'sh' | 'cmd' | 'powershell'
  private _cwd?: string
  private _env?: Record<string, string>
  private _backgroundColor: RGBA
  private _hasLibvtermSupport: boolean
  private _selectionFg: RGBA
  private _selectionBg: RGBA
  private selectionRect: SelectionRect | null = null

  protected _defaultOptions = {
    cols: 80,
    rows: 24,
    shell: "bash" as const,
    backgroundColor: "#000000",
    autoFocus: true,
    selectionForegroundColor: "#000000",
    selectionBackgroundColor: "#6d9df1",
  }

  private static textDecoder = new TextDecoder()
  private static textEncoder = new TextEncoder()

  constructor(ctx: RenderContext, options: TerminalRendererOptions) {
    super(ctx, options)

    this._focusable = true
    this.selectable = true

    this._cols = options.cols ?? this._defaultOptions.cols
    this._rows = options.rows ?? this._defaultOptions.rows
    this._shell = options.shell ?? this._defaultOptions.shell
    this._cwd = options.cwd
    this._env = options.env
    this._backgroundColor = parseColor(options.backgroundColor ?? this._defaultOptions.backgroundColor)
    this._selectionFg = parseColor(options.selectionForegroundColor ?? this._defaultOptions.selectionForegroundColor)
    this._selectionBg = parseColor(options.selectionBackgroundColor ?? this._defaultOptions.selectionBackgroundColor)

    this._hasLibvtermSupport = this.checkLibvtermSupport()

    this.initializeLibvterm().catch(error => {
      console.error("Failed to initialize terminal:", error)
    })
    
    this.live = true

    this.onSizeChange = () => {
      this.onResize(this.width, this.height)
    }

    if (options.autoFocus ?? this._defaultOptions.autoFocus) {
      this.ctx.focusRenderable(this)
    }
  }

  private checkLibvtermSupport(): boolean {
    try {
      const renderLib = resolveRenderLib()
      return renderLib && typeof renderLib.libvtermRendererCreate === 'function'
    } catch {
      return false
    }
  }

  private async initializeLibvterm(): Promise<void> {
    try {
      const renderLib = resolveRenderLib()
      
      this.ptySession = renderLib.terminalSessionCreate(this._cols, this._rows)
      if (!this.ptySession) {
        throw new Error("Failed to create PTY session")
      }
      
      setTimeout(() => {
        if (this.width > 0 && this.height > 0) {
          this.onResize(this.width, this.height)
        }
      }, 100)
      
      setTimeout(() => {
        if (this.ptySession) {
          for (let i = 0; i < 5; i++) {
            renderLib.terminalSessionTick(this.ptySession)
          }
          this.requestRender()
        }
      }, 200)

    } catch (error) {
      throw new Error(`Failed to initialize terminal: ${error}`)
    }
  }


  // Terminal interaction methods
  public write(data: string | Uint8Array): number {
    try {
      const renderLib = resolveRenderLib()
      const dataBuffer = typeof data === 'string' ? TerminalRenderer.textEncoder.encode(data) : data

      this.clearSelectionHighlight()
      
      if (this.ptySession) {
        return renderLib.terminalSessionWrite(this.ptySession, dataBuffer)
      } else {
        return 0
      }
    } catch (error) {
      console.error("Failed to write to terminal:", error)
      return 0
    }
  }

  public get isRunning(): boolean {
    return !!this.ptySession
  }

  // Property getters and setters
  public get cols(): number {
    return this._cols
  }

  public set cols(value: number) {
    if (value !== this._cols) {
      this._cols = value
      this.resizePty()
      this.applySelectionRect(this.selectionRect)
    }
  }

  public get rows(): number {
    return this._rows
  }

  public set rows(value: number) {
    if (value !== this._rows) {
      this._rows = value
      this.resizePty()
      this.applySelectionRect(this.selectionRect)
    }
  }

  public get backgroundColor(): RGBA {
    return this._backgroundColor
  }

  public set backgroundColor(value: RGBA | string) {
    this._backgroundColor = typeof value === 'string' ? parseColor(value) : value
  }

  public get hasLibvtermSupport(): boolean {
    return this._hasLibvtermSupport
  }
  
  public get focused(): boolean {
    return this._focused
  }

  private resizePty(): void {
    try {
      const renderLib = resolveRenderLib()
      
      if (this.ptySession) {
        renderLib.terminalSessionResize(this.ptySession, this._cols, this._rows)
      }
    } catch (error) {
      console.error("Failed to resize terminal:", error)
    }
  }

  protected onResize(width: number, height: number): void {
    const contentWidth = Math.max(1, width)
    const contentHeight = Math.max(1, height)
    
    // Assume each character is 1 unit wide/tall for now
    // In a real implementation, this would depend on font metrics
    const newCols = Math.max(1, contentWidth)
    const newRows = Math.max(1, contentHeight)
    
    if (newCols !== this._cols || newRows !== this._rows) {
      this._cols = newCols
      this._rows = newRows
      this.resizePty()
    }
  }

  protected onUpdate(deltaTime: number): void {
    try {
      const renderLib = resolveRenderLib()
      
      // Tick PTY session to read shell output and process it
      // The terminal session internally uses libvterm when available
      if (this.ptySession) {
        const bytesRead = renderLib.terminalSessionTick(this.ptySession)
        if (bytesRead > 0) {
          this.requestRender()
        }
      }
    } catch (error) {
      console.error("Failed to update terminal:", error)
    }
  }

  public render(buffer: OptimizedBuffer, deltaTime: number): void {
    this.onUpdate(deltaTime)
    super.render(buffer, deltaTime)
  }

  // Override methods to prevent adding children to terminal
  public add(obj: any, index?: number): number {
    return -1
  }

  public insertBefore(obj: any, anchor?: any): number {
    return -1
  }

  public appendChild(obj: any): number {
    return -1
  }

  public removeChild(obj: any): void {
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const { x, y, width, height } = this.getScissorRect()
    
    if (width <= 0 || height <= 0) {
      return
    }

    buffer.pushScissorRect(x, y, width, height)

    try {
      buffer.fillRect(x, y, width, height, this._backgroundColor)
      this.renderTerminalContent(buffer)

    } finally {
      buffer.popScissorRect()
    }
  }

  protected onMouseEvent(event: MouseEvent): void {
    super.onMouseEvent(event)
  }

  public handleKeyPress(key: ParsedKey): boolean {
    if (!this.ptySession) {
      return false
    }

    try {
      if (this.tryHandleClipboardShortcut(key)) {
        return true
      }

      if (key.raw) {
        this.write(key.raw)
        return true
      } else if (key.sequence) {
        this.write(key.sequence)
        return true
      }

      return false
    } catch (error) {
      console.error("Failed to handle key press:", error)
      return false
    }
  }

  private tryHandleClipboardShortcut(key: ParsedKey): boolean {
    const isMac = process.platform === "darwin"

    // On macOS, since Cmd+C/V are intercepted by the system,
    // we can use Ctrl+Shift+C/V like other terminals (iTerm2, Terminal.app with settings)
    // Or use ESC+c/v as an alternative
    const isCopyShortcut =
      (key.ctrl && key.shift && key.name === "c") ||  // Works on all platforms
      (key.meta && key.name === "c") ||  // In case meta works
      (key.sequence === "\x1bc")  // ESC+c as alternative on Mac

    const isPasteShortcut =
      (key.ctrl && key.shift && key.name === "v") ||  // Works on all platforms
      (key.meta && key.name === "v") ||  // In case meta works
      (key.shift && key.name === "insert") ||
      (key.sequence === "\x1bv")  // ESC+v as alternative on Mac

    if (isCopyShortcut) {
      const selected = this.getSelectedText()
      if (selected) {
        copyTextToClipboard(selected)
      }
      // Always return true for copy shortcuts to prevent the raw sequence from being written
      return true
    }

    if (isPasteShortcut) {
      const text = pasteTextFromClipboard()
      if (text) {
        this.clearSelectionHighlight()
        this.write(text)
        return true
      }
    }

    return false
  }

  private renderTerminalContent(buffer: OptimizedBuffer): void {
    const { x, y, width, height } = this.getScissorRect()
    const contentX = x
    const contentY = y
    const contentWidth = width
    const contentHeight = height

    if (contentWidth <= 0 || contentHeight <= 0) {
      return
    }

    try {
      const renderLib = resolveRenderLib()

      if (this.ptySession) {
        renderLib.terminalSessionRender(this.ptySession, buffer.ptr, contentX, contentY)
      }
    } catch (error) {
      console.error("Failed to render terminal content:", error)
      
      buffer.drawText(
        "Terminal Error",
        contentX,
        contentY,
        RGBA.fromInts(255, 0, 0, 255),
        undefined,
        0
      )
    }
  }

  public shouldStartSelection(x: number, y: number): boolean {
    const { contentX, contentY, contentWidth, contentHeight } = this.getContentMetrics()
    const withinX = x >= contentX && x < contentX + contentWidth
    const withinY = y >= contentY && y < contentY + contentHeight
    return withinX && withinY
  }

  public onSelectionChanged(selection: GlobalSelection | null): boolean {
    const changed = this.updateSelectionFromGlobal(selection)
    if (changed) {
      this.requestRender()
    }
    return this.hasSelection()
  }

  public hasSelection(): boolean {
    return this.selectionRect !== null
  }

  public getSelectedText(): string {
    if (!this.selectionRect || !this.ptySession) return ""

    const { startRow, endRow, startCol, endCol } = this.selectionRect
    const rows = endRow - startRow
    const cols = endCol - startCol
    if (rows <= 0 || cols <= 0) return ""

    const renderLib = resolveRenderLib()
    if (!(renderLib as any).terminalSessionCopySelection) {
      return ""
    }

    const maxBytesPerRow = cols * 24 + 1
    const bufferSize = rows * maxBytesPerRow
    const buffer = new Uint8Array(bufferSize)
    const length = (renderLib as any).terminalSessionCopySelection(
      this.ptySession,
      startRow,
      startCol,
      endRow,
      endCol,
      buffer,
      bufferSize,
    )

    const lengthNum = typeof length === 'bigint' ? Number(length) : length
    if (lengthNum === 0) return ""
    const text = TerminalRenderer.textDecoder.decode(buffer.slice(0, lengthNum))
    return text
  }

  protected getScissorRect(): { x: number; y: number; width: number; height: number } {
    const computedWidth = this.width
    const computedHeight = this.height
    
    return {
      x: this.x,
      y: this.y,
      width: computedWidth > 0 ? computedWidth : this._cols,
      height: computedHeight > 0 ? computedHeight : this._rows,
    }
  }

  public destroy(): void {
    this.clearSelectionHighlight()
    try {
      const renderLib = resolveRenderLib()
      
      if (this.ptySession) {
        renderLib.terminalSessionDestroy(this.ptySession)
        this.ptySession = null
      }

    } catch (error) {
      console.error("Failed to destroy terminal:", error)
    }

    super.destroy()
  }

  private updateSelectionFromGlobal(selection: GlobalSelection | null): boolean {
    const metrics = this.getContentMetrics()
    if (!selection || !selection.isActive) {
      return this.applySelectionRect(null)
    }

    const localSelection = convertGlobalToLocalSelection(selection, this.x, this.y)
    if (!localSelection) {
      return this.applySelectionRect(null)
    }

    const adjustedAnchorX = localSelection.anchorX
    const adjustedFocusX = localSelection.focusX
    const adjustedAnchorY = localSelection.anchorY
    const adjustedFocusY = localSelection.focusY

    const rawStartCol = Math.min(adjustedAnchorX, adjustedFocusX)
    const rawEndCol = Math.max(adjustedAnchorX, adjustedFocusX)
    const rawStartRow = Math.min(adjustedAnchorY, adjustedFocusY)
    const rawEndRow = Math.max(adjustedAnchorY, adjustedFocusY)

    let startCol = Math.floor(rawStartCol)
    let endCol = Math.ceil(rawEndCol)
    let startRow = Math.floor(rawStartRow)
    let endRow = Math.ceil(rawEndRow)

    if (endCol === startCol) endCol = startCol + 1
    if (endRow === startRow) endRow = startRow + 1

    startCol = Math.max(0, Math.min(this._cols, startCol))
    endCol = Math.max(0, Math.min(this._cols, endCol))
    startRow = Math.max(0, Math.min(this._rows, startRow))
    endRow = Math.max(0, Math.min(this._rows, endRow))

    if (endCol <= startCol || endRow <= startRow) {
      return this.applySelectionRect(null)
    }

    return this.applySelectionRect({ startRow, endRow, startCol, endCol })
  }

  private applySelectionRect(rect: SelectionRect | null): boolean {
    if (rect && this.selectionRect &&
      rect.startRow === this.selectionRect.startRow &&
      rect.endRow === this.selectionRect.endRow &&
      rect.startCol === this.selectionRect.startCol &&
      rect.endCol === this.selectionRect.endCol) {
      return false
    }

    const renderLib = resolveRenderLib()
    if (this.ptySession) {
      if (rect) {
        if ((renderLib as any).terminalSessionSetSelection) {
          (renderLib as any).terminalSessionSetSelection(
            this.ptySession,
            rect.startRow,
            rect.startCol,
            rect.endRow,
            rect.endCol,
            this._selectionFg.buffer,
            this._selectionBg.buffer,
          )
        }
        this.selectionRect = rect
      } else {
        if ((renderLib as any).terminalSessionClearSelection) {
          (renderLib as any).terminalSessionClearSelection(this.ptySession)
        }
        this.selectionRect = null
      }
    }

    return true
  }

  private clearSelectionHighlight(): void {
    if (!this.selectionRect || !this.ptySession) return
    const renderLib = resolveRenderLib()
    if ((renderLib as any).terminalSessionClearSelection) {
      (renderLib as any).terminalSessionClearSelection(this.ptySession)
    }
    this.selectionRect = null
    this.requestRender()
  }

  private getContentMetrics(): { contentX: number; contentY: number; contentWidth: number; contentHeight: number } {
    const contentX = this.x
    const contentY = this.y
    return {
      contentX,
      contentY,
      contentWidth: this._cols,
      contentHeight: this._rows,
    }
  }
}
