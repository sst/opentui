import { type ParsedKey } from "../lib"
import type { Renderable, RenderableOptions } from "../Renderable"
import type { MouseEvent } from "../renderer"
import type { RenderContext } from "../types"
import { BoxRenderable, type BoxOptions } from "./Box"
import type { VNode } from "./composition/vnode"
import { ScrollBarRenderable, type ScrollBarOptions, type ScrollUnit, type ArrowOptions } from "./ScrollBar"

class ContentRenderable extends BoxRenderable {
  private viewport: BoxRenderable

  constructor(ctx: RenderContext, viewport: BoxRenderable, options: RenderableOptions<BoxRenderable>) {
    super(ctx, options)
    this.viewport = viewport
  }

  protected shouldRenderChild(child: Renderable): boolean {
    const viewportLeft = this.viewport.x
    const viewportTop = this.viewport.y
    const viewportRight = this.viewport.x + this.viewport.width
    const viewportBottom = this.viewport.y + this.viewport.height

    const childLeft = child.x
    const childTop = child.y
    const childRight = child.x + child.width
    const childBottom = child.y + child.height

    // Check if child intersects with viewport (with some padding for safety)
    const padding = 10
    const intersects =
      childLeft < viewportRight + padding &&
      childRight > viewportLeft - padding &&
      childTop < viewportBottom + padding &&
      childBottom > viewportTop - padding

    return intersects
  }
}

export interface ScrollBoxOptions extends BoxOptions<ScrollBarRenderable> {
  rootOptions?: BoxOptions
  wrapperOptions?: BoxOptions
  viewportOptions?: BoxOptions
  contentOptions?: BoxOptions
  scrollbarOptions?: Omit<ScrollBarOptions, "orientation">
  verticalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">
  horizontalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">
  arrowOptions?: Omit<ArrowOptions, "direction">
}

export class ScrollBoxRenderable extends BoxRenderable {
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
      arrowOptions,
      ...options
    }: ScrollBoxOptions,
  ) {
    // Root
    super(ctx, {
      flexShrink: 1,
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "stretch",
      ...(options as BoxOptions),
      ...(rootOptions as BoxOptions),
    })

    this.wrapper = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: "auto",
      maxHeight: "100%",
      maxWidth: "100%",
      ...wrapperOptions,
    })
    super.add(this.wrapper)

    this.viewport = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: "auto",
      minWidth: 0,
      minHeight: 0,
      maxHeight: "100%",
      maxWidth: "100%",
      overflow: "scroll",
      onSizeChange: () => {
        this.recalculateBarProps()
      },
      ...viewportOptions,
    })
    this.wrapper.add(this.viewport)

    this.content = new ContentRenderable(ctx, this.viewport, {
      minWidth: "100%",
      minHeight: "100%",
      alignSelf: "flex-start",
      onSizeChange: () => {
        this.recalculateBarProps()
      },
      ...contentOptions,
    })
    this.viewport.add(this.content)

    this.verticalScrollBar = new ScrollBarRenderable(ctx, {
      ...scrollbarOptions,
      ...verticalScrollbarOptions,
      arrowOptions: {
        ...arrowOptions,
        ...scrollbarOptions?.arrowOptions,
        ...verticalScrollbarOptions?.arrowOptions,
      },
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
        ...arrowOptions,
        ...scrollbarOptions?.arrowOptions,
        ...horizontalScrollbarOptions?.arrowOptions,
      },
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
    console.log("adding", this.content)
    return this.content.add(obj, index)
  }

  public remove(id: string): void {
    this.content.remove(id)
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
}
