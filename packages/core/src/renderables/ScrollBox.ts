import { BoxRenderable, type BoxOptions } from "./Box"
import { type OptimizedBuffer } from "../buffer"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA"
import { TextBuffer } from "../text-buffer"
import { StyledText, stringToStyledText } from "../lib/styled-text"
import { GroupRenderable } from "./Group"
import { Renderable } from "../Renderable"
import { Direction } from "yoga-layout"

export interface ScrollBoxOptions extends BoxOptions {
  content?: StyledText | string
  textColor?: ColorInput
  showScrollIndicator?: boolean
  scrollStep?: number
}

export class ScrollBoxRenderable extends BoxRenderable {
  protected focusable: boolean = true

  private _showScrollIndicator: boolean
  private _scrollStep: number
  private scrollOffset: number = 0
  private _pendingScrollToBottom: boolean = false

  private contentRoot: GroupRenderable
  private textBuffer: TextBuffer
  private _content: StyledText
  private _textColor: RGBA
  private _lastTotalHeight: number = 0

  constructor(id: string, options: ScrollBoxOptions) {
    super(id, { ...options, buffered: false })

    this._showScrollIndicator = options.showScrollIndicator ?? true
    this._scrollStep = options.scrollStep ?? 1

    const content = options.content ?? ""
    this._content = typeof content === "string" ? stringToStyledText(content) : content
    this._textColor = parseColor(options.textColor || "#FFFFFF")
    this.textBuffer = TextBuffer.create(Math.max(256, this._content.toString().length + 32))
    this.textBuffer.setDefaultFg(this._textColor)
    this.textBuffer.setStyledText(this._content)

    this.contentRoot = new GroupRenderable(`${id}-content-root`, {
      flexDirection: "column",
      width: "auto",
      height: "auto",
    })
    super.add(this.contentRoot)
  }

  // Options
  public set content(value: StyledText | string) {
    this._content = typeof value === "string" ? stringToStyledText(value) : value
    this.textBuffer.setStyledText(this._content)
    this.needsUpdate()
  }
  public set textColor(color: ColorInput) {
    this._textColor = parseColor(color)
    this.textBuffer.setDefaultFg(this._textColor)
    this.needsUpdate()
  }
  public set scrollStep(step: number) {
    this._scrollStep = Math.max(1, step | 0)
  }
  public set showScrollIndicator(show: boolean) {
    this._showScrollIndicator = show
    this.needsUpdate()
  }

  // API
  public scrollBy(delta: number): void {
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset + delta, this.getMaxScroll()))
    this.needsUpdate()
    // Keep selection aligned to the same content while scrolling: shift both endpoints
    this.ctx?.moveSelectionBy?.(0, -delta)
    this.ctx?.requestSelectionUpdate?.()
  }
  public scrollToTop(): void {
    this.scrollOffset = 0
    this.needsUpdate()
    this.ctx?.requestSelectionUpdate?.()
  }
  public scrollToBottom(): void {
    this._pendingScrollToBottom = true
    this.needsUpdate()
    this.ctx?.requestSelectionUpdate?.()
  }

  // Child management
  public add(obj: Renderable, index?: number): number {
    const i = this.contentRoot.add(obj, index)
    this.needsUpdate()
    return i
  }
  public insertBefore(obj: Renderable, anchor?: Renderable): number {
    const i = this.contentRoot.insertBefore(obj, anchor)
    this.needsUpdate()
    return i
  }
  public remove(id: string): void {
    this.contentRoot.remove(id)
    this.needsUpdate()
  }

  protected onResize(): void {
    this.needsUpdate()
  }

  private getContentViewport(): { x: number; y: number; width: number; height: number } {
    const leftPad = this.borderSides.left ? 1 : 0
    const rightPad = this.borderSides.right ? 1 : 0
    const topPad = this.borderSides.top ? 1 : 0
    const bottomPad = this.borderSides.bottom ? 1 : 0
    return {
      x: leftPad,
      y: topPad,
      width: Math.max(0, this.width - leftPad - rightPad),
      height: Math.max(0, this.height - topPad - bottomPad),
    }
  }

  private getMaxScroll(): number {
    const { width: cw, height: ch } = this.getContentViewport()

    if (this.contentRoot.getChildren().length > 0) {
      const node = this.contentRoot.getLayoutNode().yogaNode
      this.contentRoot.getLayoutNode().setWidth(cw)
      this.contentRoot.getLayoutNode().setHeight("auto")
      node.calculateLayout(cw, undefined, Direction.LTR)
      const totalHeight = Math.max(0, Math.floor(node.getComputedHeight()))
      return Math.max(0, totalHeight - ch)
    }

    const lineCount = this.textBuffer.lineInfo.lineStarts.length
    return Math.max(0, lineCount - ch)
  }

  protected beforeRender(): void {
    const { x: cx, y: cy, width: cw, height: ch } = this.getContentViewport()
    const node = this.contentRoot.getLayoutNode().yogaNode
    this.contentRoot.getLayoutNode().setWidth(cw)
    this.contentRoot.getLayoutNode().setHeight("auto")
    node.calculateLayout(cw, undefined, Direction.LTR)

    const totalHeight = Math.max(0, Math.floor(node.getComputedHeight()))
    this._lastTotalHeight = totalHeight
    if (this._pendingScrollToBottom) {
      const newMax = Math.max(0, totalHeight - ch)
      this.scrollOffset = newMax
      this._pendingScrollToBottom = false
    }

    this.contentRoot.marginTop = 0 - this.scrollOffset
    this.contentRoot.marginLeft = 0
    node.calculateLayout(cw, undefined, Direction.LTR)

    const viewportAbs = { x: this.x + cx, y: this.y + cy, width: cw, height: ch }
    const clipCtx = {
      addToHitGrid: (x: number, y: number, width: number, height: number, id: number) => {
        const ix1 = Math.max(x, viewportAbs.x)
        const iy1 = Math.max(y, viewportAbs.y)
        const ix2 = Math.min(x + width, viewportAbs.x + viewportAbs.width)
        const iy2 = Math.min(y + height, viewportAbs.y + viewportAbs.height)
        const iw = Math.max(0, ix2 - ix1)
        const ih = Math.max(0, iy2 - iy1)
        if (iw > 0 && ih > 0) this.ctx?.addToHitGrid(ix1, iy1, iw, ih, id)
      },
      width: () => this.ctx?.width() ?? cw,
      height: () => this.ctx?.height() ?? ch,
      needsUpdate: () => this.ctx?.needsUpdate(),
      getClipRect: () => viewportAbs,
    }
    this.contentRoot.propagateContext(clipCtx)
  }

  // no special destroy

  public handleKeyPress(key: any): boolean {
    const keyName = typeof key === "string" ? key : key.name
    switch (keyName) {
      case "up":
      case "k":
        this.scrollBy(-this._scrollStep)
        return true
      case "down":
      case "j":
        this.scrollBy(this._scrollStep)
        return true
      case "pageup":
        this.scrollBy(-Math.max(1, this.getContentViewport().height - 1))
        return true
      case "pagedown":
        this.scrollBy(Math.max(1, this.getContentViewport().height - 1))
        return true
      case "home":
        this.scrollToTop()
        return true
      case "end":
        this.scrollToBottom()
        return true
      default:
        return false
    }
  }

  protected onMouseEvent(event: any): void {
    if (event.type === "scroll" && event.scroll?.direction) {
      const dir = event.scroll.direction
      if (dir === "up") this.scrollBy(-this._scrollStep)
      else if (dir === "down") this.scrollBy(this._scrollStep)
    }
  }

  // Draw scroll indicator on top after children rendered by base class
  public render(buffer: OptimizedBuffer, deltaTime: number): void {
    super.render(buffer, deltaTime)

    if (!this._showScrollIndicator) return

    const { x: cx, y: cy, width: cw, height: ch } = this.getContentViewport()
    const totalHeight = this._lastTotalHeight
    if (this.contentRoot.getChildren().length > 0) {
      if (totalHeight > ch && ch > 0 && cw > 0) {
        const maxScroll = Math.max(1, totalHeight - ch)
        const percent = this.scrollOffset / maxScroll
        const indicatorY = cy + Math.floor(percent * Math.max(0, ch - 1))
        const indicatorX = cx + cw - 1
        const scrollColor = parseColor("#666666")
        buffer.drawText("█", this.x + indicatorX, this.y + indicatorY, scrollColor)
      }
    } else {
      // Optional: text fallback indicator based on textBuffer lines
      const totalLines = this.textBuffer.lineInfo.lineStarts.length
      if (totalLines > ch && ch > 0 && cw > 0) {
        const maxScroll = Math.max(1, totalLines - ch)
        const percent = this.scrollOffset / maxScroll
        const indicatorY = cy + Math.floor(percent * Math.max(0, ch - 1))
        const indicatorX = cx + cw - 1
        const scrollColor = parseColor("#666666")
        buffer.drawText("█", this.x + indicatorX, this.y + indicatorY, scrollColor)
      }
    }
  }
}
