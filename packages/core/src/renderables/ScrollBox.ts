import { type ParsedKey } from "../lib"
import type { MouseEvent } from "../renderer"
import type { RenderContext } from "../types"
import { BoxRenderable, type BoxOptions } from "./Box"
import { ScrollBarRenderable, type ScrollBarOptions, type ScrollUnit } from "./ScrollBar"

export interface ScrollBoxOptions extends BoxOptions<ScrollBarRenderable> {
  rootOptions?: BoxOptions
  wrapperOptions?: BoxOptions
  viewportOptions?: BoxOptions
  contentOptions?: BoxOptions
  scrollbarOptions?: Omit<ScrollBarOptions, "orientation">
  verticalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">
  horizontalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">
}

export class ScrollBoxRenderable extends BoxRenderable {
  public readonly wrapper: BoxRenderable
  public readonly viewport: BoxRenderable
  public readonly content: BoxRenderable
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
    this.add(this.wrapper)

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

    this.content = new BoxRenderable(ctx, {
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
      orientation: "vertical",
      onChange: (position) => {
        this.content.translateY = -position
      },
    })
    this.add(this.verticalScrollBar)

    this.horizontalScrollBar = new ScrollBarRenderable(ctx, {
      ...scrollbarOptions,
      ...horizontalScrollbarOptions,
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
