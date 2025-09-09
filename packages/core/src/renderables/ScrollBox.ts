import { type ParsedKey } from "../lib"
import type { Renderable, RenderableOptions } from "../Renderable"
import type { MouseEvent } from "../renderer"
import type { RenderContext } from "../types"
import { BoxRenderable, type BoxOptions } from "./Box"
import type { VNode } from "./composition/vnode"
import { ScrollBarRenderable, type ScrollBarOptions, type ScrollUnit } from "./ScrollBar"

class ContentRenderable extends BoxRenderable {
  private viewport: BoxRenderable

  constructor(ctx: RenderContext, viewport: BoxRenderable, options: RenderableOptions<BoxRenderable>) {
    super(ctx, options)
    this.viewport = viewport
  }

  protected _getChildren(): Renderable[] {
    return this.getChildrenInViewport(this.viewport)
  }
}

export interface ScrollBoxOptions extends BoxOptions<ScrollBoxRenderable> {
  rootOptions?: BoxOptions
  wrapperOptions?: BoxOptions
  viewportOptions?: BoxOptions
  contentOptions?: BoxOptions
  scrollbarOptions?: Omit<ScrollBarOptions, "orientation">
  verticalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">
  horizontalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">
}

export class ScrollBoxRenderable extends BoxRenderable {
  static idCounter = 0
  private internalId = 0
  public readonly wrapper: BoxRenderable
  public readonly viewport: BoxRenderable
  public readonly content: ContentRenderable
  public readonly horizontalScrollBar: ScrollBarRenderable
  public readonly verticalScrollBar: ScrollBarRenderable

  protected focusable: boolean = true
  private selectionListener?: () => void

  private autoScrollMouseX: number = 0
  private autoScrollMouseY: number = 0
  private readonly autoScrollThresholdVertical = 3
  private readonly autoScrollThresholdHorizontal = 3
  private readonly autoScrollSpeedSlow = 6
  private readonly autoScrollSpeedMedium = 36
  private readonly autoScrollSpeedFast = 72
  private isAutoScrolling: boolean = false
  private cachedAutoScrollSpeed: number = 3
  private autoScrollAccumulatorX: number = 0
  private autoScrollAccumulatorY: number = 0

  get scrollTop(): number {
    return this.verticalScrollBar.scrollPosition
  }

  set scrollTop(value: number) {
    this.verticalScrollBar.scrollPosition = value
  }

  get scrollLeft(): number {
    return this.horizontalScrollBar.scrollPosition
  }

  set scrollLeft(value: number) {
    this.horizontalScrollBar.scrollPosition = value
  }

  get scrollWidth(): number {
    return this.horizontalScrollBar.scrollSize
  }

  get scrollHeight(): number {
    return this.verticalScrollBar.scrollSize
  }

  constructor(
    ctx: RenderContext,
    {
      wrapperOptions,
      viewportOptions,
      contentOptions,
      rootOptions,
      scrollbarOptions,
      verticalScrollbarOptions,
      horizontalScrollbarOptions,
      ...options
    }: ScrollBoxOptions,
  ) {
    // Root
    super(ctx, {
      flexShrink: 1,
      flexGrow: 1,
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "stretch",
      ...(options as BoxOptions),
      ...(rootOptions as BoxOptions),
    })

    this.internalId = ScrollBoxRenderable.idCounter++

    this.wrapper = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: "auto",
      maxHeight: "100%",
      maxWidth: "100%",
      ...wrapperOptions,
      id: `scroll-box-wrapper-${this.internalId}`,
    })
    super.add(this.wrapper)

    this.viewport = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: "auto",
      maxHeight: "100%",
      maxWidth: "100%",
      overflow: "scroll",
      onSizeChange: () => {
        this.recalculateBarProps()
      },
      ...viewportOptions,
      id: `scroll-box-viewport-${this.internalId}`,
    })
    this.wrapper.add(this.viewport)

    this.content = new ContentRenderable(ctx, this.viewport, {
      alignSelf: "flex-start",
      minWidth: "100%",
      minHeight: "100%",
      onSizeChange: () => {
        this.recalculateBarProps()
      },
      ...contentOptions,
      id: `scroll-box-content-${this.internalId}`,
    })
    this.viewport.add(this.content)

    this.verticalScrollBar = new ScrollBarRenderable(ctx, {
      ...scrollbarOptions,
      ...verticalScrollbarOptions,
      arrowOptions: {
        ...scrollbarOptions?.arrowOptions,
        ...verticalScrollbarOptions?.arrowOptions,
      },
      id: `scroll-box-vertical-scrollbar-${this.internalId}`,
      orientation: "vertical",
      onChange: (position) => {
        this.content.translateY = -position
      },
    })
    super.add(this.verticalScrollBar)

    this.horizontalScrollBar = new ScrollBarRenderable(ctx, {
      ...scrollbarOptions,
      ...horizontalScrollbarOptions,
      arrowOptions: {
        ...scrollbarOptions?.arrowOptions,
        ...horizontalScrollbarOptions?.arrowOptions,
      },
      id: `scroll-box-horizontal-scrollbar-${this.internalId}`,
      orientation: "horizontal",
      onChange: (position) => {
        this.content.translateX = -position
      },
    })
    this.wrapper.add(this.horizontalScrollBar)

    this.recalculateBarProps()

    this.selectionListener = () => {
      const selection = this._ctx.getSelection()
      if (!selection || !selection.isSelecting) {
        this.stopAutoScroll()
      }
    }
    this._ctx.on("selection", this.selectionListener)
  }

  protected onUpdate(deltaTime: number): void {
    this.handleAutoScroll(deltaTime)
  }

  public scrollBy(delta: number | { x: number; y: number }, unit: ScrollUnit = "absolute"): void {
    if (typeof delta === "number") {
      this.verticalScrollBar.scrollBy(delta, unit)
    } else {
      this.verticalScrollBar.scrollBy(delta.y, unit)
      this.horizontalScrollBar.scrollBy(delta.x, unit)
    }
  }

  public scrollTo(position: number | { x: number; y: number }): void {
    if (typeof position === "number") {
      this.scrollTop = position
    } else {
      this.scrollTop = position.y
      this.scrollLeft = position.x
    }
  }

  public add(obj: Renderable | VNode<any, any[]>, index?: number): number {
    return this.content.add(obj, index)
  }

  public remove(id: string): void {
    this.content.remove(id)
  }

  public getChildren(): Renderable[] {
    return this.content.getChildren()
  }

  protected onMouseEvent(event: MouseEvent): void {
    if (event.type === "scroll") {
      let dir = event.scroll?.direction
      if (event.modifiers.shift)
        dir = dir === "up" ? "left" : dir === "down" ? "right" : dir === "right" ? "down" : "up"

      if (dir === "up") this.scrollTop -= event.scroll?.delta ?? 0
      else if (dir === "down") this.scrollTop += event.scroll?.delta ?? 0
      else if (dir === "left") this.scrollLeft -= event.scroll?.delta ?? 0
      else if (dir === "right") this.scrollLeft += event.scroll?.delta ?? 0
    }

    if (event.type === "drag" && event.isSelecting) {
      this.updateAutoScroll(event.x, event.y)
    } else if (event.type === "up") {
      this.stopAutoScroll()
    }
  }

  public handleKeyPress(key: ParsedKey | string): boolean {
    if (this.verticalScrollBar.handleKeyPress(key)) return true
    if (this.horizontalScrollBar.handleKeyPress(key)) return true
    return false
  }

  public startAutoScroll(mouseX: number, mouseY: number): void {
    this.stopAutoScroll()
    this.autoScrollMouseX = mouseX
    this.autoScrollMouseY = mouseY
    this.cachedAutoScrollSpeed = this.getAutoScrollSpeed(mouseX, mouseY)
    this.isAutoScrolling = true

    if (!this.live) {
      this.live = true
    }
  }

  public updateAutoScroll(mouseX: number, mouseY: number): void {
    this.autoScrollMouseX = mouseX
    this.autoScrollMouseY = mouseY

    // Cache the speed based on current mouse position
    this.cachedAutoScrollSpeed = this.getAutoScrollSpeed(mouseX, mouseY)

    const scrollX = this.getAutoScrollDirectionX(mouseX)
    const scrollY = this.getAutoScrollDirectionY(mouseY)

    if (scrollX === 0 && scrollY === 0) {
      this.stopAutoScroll()
    } else if (!this.isAutoScrolling) {
      this.startAutoScroll(mouseX, mouseY)
    }
  }

  public stopAutoScroll(): void {
    const wasAutoScrolling = this.isAutoScrolling
    this.isAutoScrolling = false
    this.autoScrollAccumulatorX = 0
    this.autoScrollAccumulatorY = 0

    // Only turn off live if no other features need it
    // For now, auto-scroll is the only feature using live, but this could be extended
    if (wasAutoScrolling && !this.hasOtherLiveReasons()) {
      this.live = false
    }
  }

  private hasOtherLiveReasons(): boolean {
    // Placeholder for future features that might need live mode
    // For now, always return false since auto-scroll is the only user
    return false
  }

  private handleAutoScroll(deltaTime: number): void {
    if (!this.isAutoScrolling) return

    const scrollX = this.getAutoScrollDirectionX(this.autoScrollMouseX)
    const scrollY = this.getAutoScrollDirectionY(this.autoScrollMouseY)
    const scrollAmount = this.cachedAutoScrollSpeed * (deltaTime / 1000)

    let scrolled = false

    if (scrollX !== 0) {
      this.autoScrollAccumulatorX += scrollX * scrollAmount
      const integerScrollX = Math.trunc(this.autoScrollAccumulatorX)
      if (integerScrollX !== 0) {
        this.scrollLeft += integerScrollX
        this.autoScrollAccumulatorX -= integerScrollX
        scrolled = true
      }
    }

    if (scrollY !== 0) {
      this.autoScrollAccumulatorY += scrollY * scrollAmount
      const integerScrollY = Math.trunc(this.autoScrollAccumulatorY)
      if (integerScrollY !== 0) {
        this.scrollTop += integerScrollY
        this.autoScrollAccumulatorY -= integerScrollY
        scrolled = true
      }
    }

    if (scrolled) {
      this._ctx.requestSelectionUpdate()
    }

    if (scrollX === 0 && scrollY === 0) {
      this.stopAutoScroll()
    }
  }

  private getAutoScrollDirectionX(mouseX: number): number {
    const relativeX = mouseX - this.x
    const distToLeft = relativeX
    const distToRight = this.width - relativeX

    if (distToLeft <= this.autoScrollThresholdHorizontal) {
      return this.scrollLeft > 0 ? -1 : 0
    } else if (distToRight <= this.autoScrollThresholdHorizontal) {
      const maxScrollLeft = this.scrollWidth - this.viewport.width
      return this.scrollLeft < maxScrollLeft ? 1 : 0
    }
    return 0
  }

  private getAutoScrollDirectionY(mouseY: number): number {
    const relativeY = mouseY - this.y
    const distToTop = relativeY
    const distToBottom = this.height - relativeY

    if (distToTop <= this.autoScrollThresholdVertical) {
      return this.scrollTop > 0 ? -1 : 0
    } else if (distToBottom <= this.autoScrollThresholdVertical) {
      const maxScrollTop = this.scrollHeight - this.viewport.height
      return this.scrollTop < maxScrollTop ? 1 : 0
    }
    return 0
  }

  private getAutoScrollSpeed(mouseX: number, mouseY: number): number {
    const relativeX = mouseX - this.x
    const relativeY = mouseY - this.y

    const distToLeft = relativeX
    const distToRight = this.width - relativeX
    const distToTop = relativeY
    const distToBottom = this.height - relativeY

    const minDistance = Math.min(distToLeft, distToRight, distToTop, distToBottom)

    if (minDistance <= 1) {
      return this.autoScrollSpeedFast
    } else if (minDistance <= 2) {
      return this.autoScrollSpeedMedium
    } else {
      return this.autoScrollSpeedSlow
    }
  }

  private recalculateBarProps(): void {
    this.verticalScrollBar.scrollSize = this.content.height
    this.verticalScrollBar.viewportSize = this.viewport.height
    this.horizontalScrollBar.scrollSize = this.content.width
    this.horizontalScrollBar.viewportSize = this.viewport.width
  }

  // Setters for reactive properties
  public set rootOptions(options: ScrollBoxOptions["rootOptions"]) {
    Object.assign(this, options)
    this.requestRender()
  }

  public set wrapperOptions(options: ScrollBoxOptions["wrapperOptions"]) {
    Object.assign(this.wrapper, options)
    this.requestRender()
  }

  public set viewportOptions(options: ScrollBoxOptions["viewportOptions"]) {
    Object.assign(this.viewport, options)
    this.requestRender()
  }

  public set contentOptions(options: ScrollBoxOptions["contentOptions"]) {
    Object.assign(this.content, options)
    this.requestRender()
  }

  public set scrollbarOptions(options: ScrollBoxOptions["scrollbarOptions"]) {
    Object.assign(this.verticalScrollBar, options)
    Object.assign(this.horizontalScrollBar, options)
    this.requestRender()
  }

  public set verticalScrollbarOptions(options: ScrollBoxOptions["verticalScrollbarOptions"]) {
    Object.assign(this.verticalScrollBar, options)
    this.requestRender()
  }

  public set horizontalScrollbarOptions(options: ScrollBoxOptions["horizontalScrollbarOptions"]) {
    Object.assign(this.horizontalScrollBar, options)
    this.requestRender()
  }

  protected destroySelf(): void {
    if (this.selectionListener) {
      this._ctx.off("selection", this.selectionListener)
      this.selectionListener = undefined
    }
    super.destroySelf()
  }
}
