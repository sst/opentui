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
  }

  public handleKeyPress(key: ParsedKey | string): boolean {
    if (this.verticalScrollBar.handleKeyPress(key)) return true
    if (this.horizontalScrollBar.handleKeyPress(key)) return true
    return false
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
}
