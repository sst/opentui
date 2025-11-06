import { type KeyEvent } from "../lib"
import { getObjectsInViewport } from "../lib/objects-in-viewport"
import { LinearScrollAccel, MacOSScrollAccel, type ScrollAcceleration } from "../lib/scroll-acceleration"
import type { Renderable, RenderableOptions } from "../Renderable"
import type { MouseEvent } from "../renderer"
import type { RenderContext } from "../types"
import { BoxRenderable, type BoxOptions } from "./Box"
import type { VNode } from "./composition/vnode"
import { ScrollBarRenderable, type ScrollBarOptions, type ScrollUnit } from "./ScrollBar"

class ContentRenderable extends BoxRenderable {
  private viewport: BoxRenderable
  private _viewportCulling: boolean

  constructor(
    ctx: RenderContext,
    viewport: BoxRenderable,
    viewportCulling: boolean,
    options: RenderableOptions<BoxRenderable>,
  ) {
    super(ctx, options)
    this.viewport = viewport
    this._viewportCulling = viewportCulling
  }

  get viewportCulling(): boolean {
    return this._viewportCulling
  }

  set viewportCulling(value: boolean) {
    this._viewportCulling = value
  }

  protected _getChildren(): Renderable[] {
    if (this._viewportCulling) {
      return getObjectsInViewport(this.viewport, this.getChildrenSortedByPrimaryAxis(), this.primaryAxis)
    }
    return this.getChildrenSortedByPrimaryAxis()
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
  stickyScroll?: boolean
  stickyStart?: "bottom" | "top" | "left" | "right"
  scrollX?: boolean
  scrollY?: boolean
  scrollAcceleration?: ScrollAcceleration
  viewportCulling?: boolean
}

export class ScrollBoxRenderable extends BoxRenderable {
  static idCounter = 0
  private internalId = 0
  public readonly wrapper: BoxRenderable
  public readonly viewport: BoxRenderable
  public readonly content: ContentRenderable
  public readonly horizontalScrollBar: ScrollBarRenderable
  public readonly verticalScrollBar: ScrollBarRenderable

  protected _focusable: boolean = true
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

  private _stickyScroll: boolean
  private _stickyScrollTop: boolean = false
  private _stickyScrollBottom: boolean = false
  private _stickyScrollLeft: boolean = false
  private _stickyScrollRight: boolean = false
  private _stickyStart?: "bottom" | "top" | "left" | "right"
  private _hasManualScroll: boolean = false
  private scrollAccel: ScrollAcceleration

  get stickyScroll(): boolean {
    return this._stickyScroll
  }

  set stickyScroll(value: boolean) {
    this._stickyScroll = value
    this.updateStickyState()
  }

  get stickyStart(): "bottom" | "top" | "left" | "right" | undefined {
    return this._stickyStart
  }

  set stickyStart(value: "bottom" | "top" | "left" | "right" | undefined) {
    this._stickyStart = value
    this.updateStickyState()
  }

  get scrollTop(): number {
    return this.verticalScrollBar.scrollPosition
  }

  set scrollTop(value: number) {
    this.verticalScrollBar.scrollPosition = value
    this._hasManualScroll = true
    this.updateStickyState()
  }

  get scrollLeft(): number {
    return this.horizontalScrollBar.scrollPosition
  }

  set scrollLeft(value: number) {
    this.horizontalScrollBar.scrollPosition = value
    this._hasManualScroll = true
    this.updateStickyState()
  }

  get scrollWidth(): number {
    return this.horizontalScrollBar.scrollSize
  }

  get scrollHeight(): number {
    return this.verticalScrollBar.scrollSize
  }

  private updateStickyState(): void {
    if (!this._stickyScroll) return

    const maxScrollTop = Math.max(0, this.scrollHeight - this.viewport.height)
    const maxScrollLeft = Math.max(0, this.scrollWidth - this.viewport.width)

    if (this.scrollTop <= 0) {
      this._stickyScrollTop = true
      this._stickyScrollBottom = false
    } else if (this.scrollTop >= maxScrollTop) {
      this._stickyScrollTop = false
      this._stickyScrollBottom = true
    } else {
      this._stickyScrollTop = false
      this._stickyScrollBottom = false
    }

    if (this.scrollLeft <= 0) {
      this._stickyScrollLeft = true
      this._stickyScrollRight = false
    } else if (this.scrollLeft >= maxScrollLeft) {
      this._stickyScrollLeft = false
      this._stickyScrollRight = true
    } else {
      this._stickyScrollLeft = false
      this._stickyScrollRight = false
    }
  }

  private applyStickyStart(stickyStart: "bottom" | "top" | "left" | "right"): void {
    switch (stickyStart) {
      case "top":
        this._stickyScrollTop = true
        this._stickyScrollBottom = false
        this.verticalScrollBar.scrollPosition = 0
        break
      case "bottom":
        this._stickyScrollTop = false
        this._stickyScrollBottom = true
        this.verticalScrollBar.scrollPosition = Math.max(0, this.scrollHeight - this.viewport.height)
        break
      case "left":
        this._stickyScrollLeft = true
        this._stickyScrollRight = false
        this.horizontalScrollBar.scrollPosition = 0
        break
      case "right":
        this._stickyScrollLeft = false
        this._stickyScrollRight = true
        this.horizontalScrollBar.scrollPosition = Math.max(0, this.scrollWidth - this.viewport.width)
        break
    }
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
      stickyScroll = false,
      stickyStart,
      scrollX = false,
      scrollY = true,
      scrollAcceleration,
      viewportCulling = true,
      ...options
    }: ScrollBoxOptions,
  ) {
    // Root
    super(ctx, {
      flexDirection: "row",
      alignItems: "stretch",
      ...(options as BoxOptions),
      ...(rootOptions as BoxOptions),
    })

    this.internalId = ScrollBoxRenderable.idCounter++
    this._stickyScroll = stickyScroll
    this._stickyStart = stickyStart

    // Initialize scroll acceleration
    if (scrollAcceleration) {
      this.scrollAccel = scrollAcceleration
    } else if (process.platform === "darwin") {
      this.scrollAccel = new MacOSScrollAccel()
    }
    this.scrollAccel ??= new LinearScrollAccel()

    this.wrapper = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
      ...wrapperOptions,
      id: `scroll-box-wrapper-${this.internalId}`,
    })
    super.add(this.wrapper)

    this.viewport = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
      // NOTE: Overflow scroll makes the content size behave weird
      // when the scrollbox is in a container with max-width/height
      overflow: "hidden",
      onSizeChange: () => {
        this.recalculateBarProps()
      },
      ...viewportOptions,
      id: `scroll-box-viewport-${this.internalId}`,
    })
    this.wrapper.add(this.viewport)

    this.content = new ContentRenderable(ctx, this.viewport, viewportCulling, {
      alignSelf: "flex-start",
      flexShrink: 0,
      ...(scrollX ? { minWidth: "100%" } : { minWidth: "100%", maxWidth: "100%" }),
      ...(scrollY ? { minHeight: "100%" } : { minHeight: "100%", maxHeight: "100%" }),
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
        this._hasManualScroll = true
        this.updateStickyState()
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
        this._hasManualScroll = true
        this.updateStickyState()
      },
    })
    this.wrapper.add(this.horizontalScrollBar)

    this.recalculateBarProps()

    if (stickyStart && stickyScroll) {
      this.applyStickyStart(stickyStart)
    }

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
    this._hasManualScroll = true
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

  public insertBefore(obj: Renderable | VNode<any, any[]> | unknown, anchor?: Renderable | unknown): number {
    return this.content.insertBefore(obj, anchor)
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

      const baseDelta = event.scroll?.delta ?? 0
      const now = Date.now()
      const multiplier = this.scrollAccel.tick(now)

      if (dir === "up") {
        this.scrollTop -= baseDelta * multiplier
      } else if (dir === "down") {
        this.scrollTop += baseDelta * multiplier
      } else if (dir === "left") {
        this.scrollLeft -= baseDelta * multiplier
      } else if (dir === "right") {
        this.scrollLeft += baseDelta * multiplier
      }

      this._hasManualScroll = true
    }

    if (event.type === "drag" && event.isSelecting) {
      this.updateAutoScroll(event.x, event.y)
    } else if (event.type === "up") {
      this.stopAutoScroll()
    }
  }

  public handleKeyPress(key: KeyEvent | string): boolean {
    // Let scrollbars handle their own acceleration
    if (this.verticalScrollBar.handleKeyPress(key)) {
      this._hasManualScroll = true
      this.scrollAccel.reset()
      return true
    }
    if (this.horizontalScrollBar.handleKeyPress(key)) {
      this._hasManualScroll = true
      this.scrollAccel.reset()
      return true
    }
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

    if (this._stickyScroll) {
      const newMaxScrollTop = Math.max(0, this.scrollHeight - this.viewport.height)
      const newMaxScrollLeft = Math.max(0, this.scrollWidth - this.viewport.width)

      if (this._stickyStart && !this._hasManualScroll) {
        this.applyStickyStart(this._stickyStart)
      } else {
        if (this._stickyScrollTop) {
          this.scrollTop = 0
        } else if (this._stickyScrollBottom && newMaxScrollTop > 0) {
          this.scrollTop = newMaxScrollTop
        }

        if (this._stickyScrollLeft) {
          this.scrollLeft = 0
        } else if (this._stickyScrollRight && newMaxScrollLeft > 0) {
          this.scrollLeft = newMaxScrollLeft
        }
      }
    }

    // NOTE: This is obviously a workaround for something,
    // which is that the bar props are recalculated when the viewport is resized,
    // which intially happens onUpdate but is the viewport does not have the correct dimensions yet,
    // then when it does, no update is triggered and when we do we are in the middle of a render,
    // which just ignores the request. ¯\_(ツ)_/¯
    // TODO: Fix this properly. How? Move yoga to native, get all changes for elements in one go
    // and update all renderables in one go before rendering.
    // OR: Move this logic to the viewport. IMHO the wrapper and viewport are overkill and not necessary.
    //     The Scrollbox can be the viewport, we are using translations on the content anyway.
    process.nextTick(() => {
      this.requestRender()
    })
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

  public get scrollAcceleration(): ScrollAcceleration {
    return this.scrollAccel
  }

  public set scrollAcceleration(value: ScrollAcceleration) {
    this.scrollAccel = value
  }

  get viewportCulling(): boolean {
    return this.content.viewportCulling
  }

  set viewportCulling(value: boolean) {
    this.content.viewportCulling = value
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
