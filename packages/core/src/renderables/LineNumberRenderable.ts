import { Renderable, type RenderableOptions } from "../Renderable"
import { OptimizedBuffer } from "../buffer"
import type { RenderContext, LineInfoProvider } from "../types"
import { RGBA, parseColor } from "../lib/RGBA"

export interface LineNumberOptions extends RenderableOptions<LineNumberRenderable> {
  target: Renderable & LineInfoProvider
  fg?: string | RGBA
  bg?: string | RGBA
  minWidth?: number
  paddingRight?: number
}

class GutterRenderable extends Renderable {
  private target: Renderable & LineInfoProvider
  private _fg: RGBA
  private _bg: RGBA
  private _minWidth: number
  private _paddingRight: number

  constructor(
    ctx: RenderContext,
    target: Renderable & LineInfoProvider,
    options: { fg: RGBA; bg: RGBA; minWidth: number; paddingRight: number; id?: string; buffered?: boolean },
  ) {
    super(ctx, {
      id: options.id,
      width: "auto",
      height: "auto",
      flexGrow: 0,
      flexShrink: 0,
      buffered: options.buffered,
    })
    this.target = target
    this._fg = options.fg
    this._bg = options.bg
    this._minWidth = options.minWidth
    this._paddingRight = options.paddingRight
    this.width = this.calculateWidth()
  }

  private calculateWidth(): number {
    const totalLines = this.target.lineCount
    const digits = totalLines > 0 ? Math.floor(Math.log10(totalLines)) + 1 : 1
    return Math.max(this._minWidth, digits + this._paddingRight + 1) // +1 for left padding
  }

  protected onUpdate(deltaTime: number): void {
    const newWidth = this.calculateWidth()

    if (this.width !== newWidth) {
      this.width = newWidth
    }
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const startX = this.buffered ? 0 : this.x
    const startY = this.buffered ? 0 : this.y

    // Fill background
    // Note: this.height might be determined by parent (flex stretch)
    if (this._bg.a > 0) {
      buffer.fillRect(startX, startY, this.width, this.height, this._bg)
    }

    const lineInfo = this.target.lineInfo
    if (!lineInfo || !lineInfo.lineSources) return

    const sources = lineInfo.lineSources
    let lastSource = -1

    // lineSources contains the logical line index for each visual line
    // We start iterating from the scroll offset (first visible line)
    const startLine = this.target.scrollY

    // If scrolled past content (shouldn't happen normally but good to be safe)
    if (startLine >= sources.length) return

    // Get the logical line index of the line *before* the first visible line
    // This helps determine if the first visible line is a wrapped continuation
    lastSource = startLine > 0 ? sources[startLine - 1] : -1

    for (let i = 0; i < this.height; i++) {
      const visualLineIndex = startLine + i
      if (visualLineIndex >= sources.length) break

      const logicalLine = sources[visualLineIndex]

      // Draw line number only for the first visual line of a logical line (wrapping)
      if (logicalLine === lastSource) {
        // Continuation line, maybe draw a dot or nothing
      } else {
        const lineNumStr = (logicalLine + 1).toString()
        // Draw right aligned
        const x = startX + this.width - this._paddingRight - lineNumStr.length
        if (x >= startX) {
          buffer.drawText(lineNumStr, x, startY + i, this._fg, this._bg)
        }
      }

      lastSource = logicalLine
    }
  }
}

export class LineNumberRenderable extends Renderable {
  private gutter: GutterRenderable
  private target: Renderable & LineInfoProvider

  constructor(ctx: RenderContext, options: LineNumberOptions) {
    super(ctx, {
      ...options,
      flexDirection: "row",
      alignItems: "stretch",
    })

    this.target = options.target

    const fg = parseColor(options.fg ?? "#888888")
    const bg = parseColor(options.bg ?? "transparent")

    this.gutter = new GutterRenderable(ctx, this.target, {
      fg,
      bg,
      minWidth: options.minWidth ?? 3,
      paddingRight: options.paddingRight ?? 1,
      id: options.id ? `${options.id}-gutter` : undefined,
      buffered: true,
    })

    this.add(this.gutter)
    this.add(this.target)

    // Hook requestRender to ensure gutter updates when target updates
    const originalRequestRender = this.target.requestRender.bind(this.target)
    this.target.requestRender = () => {
      originalRequestRender()
      this.gutter.requestRender()
    }
  }

  public set showLineNumbers(value: boolean) {
    this.gutter.visible = value
  }

  public get showLineNumbers(): boolean {
    return this.gutter.visible
  }
}
