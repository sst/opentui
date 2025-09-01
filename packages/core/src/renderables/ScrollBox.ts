import { type ParsedKey } from "../lib"
import type { MouseEvent } from "../renderer"
import type { Timeout } from "../types"
import type { RenderContext } from "../types"
import { BoxRenderable, type BoxOptions } from "./Box"
import { ScrollBarRenderable, type ScrollUnit } from "./ScrollBar"

export interface ScrollBoxOptions extends BoxOptions<ScrollBarRenderable> {
  rootOptions?: BoxOptions
  wrapperOptions?: BoxOptions
  viewportOptions?: BoxOptions
  contentOptions?: BoxOptions
  trackOptions?: BoxOptions
  thumbOptions?: BoxOptions
  arrowOptions?: BoxOptions
  showArrows?: boolean
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
      trackOptions,
      thumbOptions,
      rootOptions,
      arrowOptions,
      showArrows,
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
      overflow: "hidden",
      ...viewportOptions,
    })
    this.wrapper.add(this.viewport)

    this.content = new BoxRenderable(ctx, {
      minWidth: "100%",
      minHeight: "100%",
      alignSelf: "flex-start",
      ...contentOptions,
    })
    this.viewport.add(this.content)

    this.verticalScrollBar = new ScrollBarRenderable(ctx, {
      orientation: "vertical",
      trackOptions,
      thumbOptions,
      arrowOptions,
      showArrows,
    })
    this.add(this.verticalScrollBar)

    this.horizontalScrollBar = new ScrollBarRenderable(ctx, {
      orientation: "horizontal",
      trackOptions,
      thumbOptions,
      arrowOptions,
      showArrows,
    })

    this.wrapper.add(this.horizontalScrollBar)

    this.viewport.on("resize", () => {
      this.recalculateBarProps()
    })

    this.content.on("resize", () => {
      this.recalculateBarProps()
    })

    this.verticalScrollBar.on("change", ({ position }: { position: number }) => {
      this.content.translateY = -position
    })

    this.horizontalScrollBar.on("change", ({ position }: { position: number }) => {
      this.content.translateX = -position
    })

    this.setupDragToScroll()

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

  /**
   * When user brings mouse closer to the edges while dragging, scroll the content.
   */
  private setupDragToScroll(): void {
    let contentMouseDownTimer: Timeout = undefined
    let mouseX = 0
    let mouseY = 0
    let isDragging = false
    this.content.onMouseDown = (ev) => {
      const startMouseX = (mouseX = ev.x)
      const startMouseY = (mouseY = ev.y)
      isDragging = true

      contentMouseDownTimer = setInterval(() => {
        if (!isDragging) return

        let scrollX = 0
        let scrollY = 0

        if (startMouseX !== mouseX) {
          if (mouseX - this.viewport.x < 8) scrollX = -1
          if (mouseX - this.viewport.x > this.viewport.width - 8) scrollX = 1
        }

        if (startMouseY !== mouseY) {
          if (mouseY - this.viewport.y < 4) scrollY = -1
          if (mouseY - this.viewport.y > this.viewport.height - 4) scrollY = 1
        }

        if (scrollX !== 0 || scrollY !== 0) this.scrollBy({ x: scrollX, y: scrollY })
      }, 100)
    }

    this.content.onMouseDrag = (ev) => {
      if (!isDragging) return
      mouseX = ev.x
      mouseY = ev.y
    }

    this.content.onMouseUp = () => {
      isDragging = false
      clearInterval(contentMouseDownTimer)
    }
  }

  public handleKeyPress(key: ParsedKey | string): boolean {
    if (this.verticalScrollBar.handleKeyPress(key)) return true;
    if (this.horizontalScrollBar.handleKeyPress(key)) return true;
    return false
  }

  private recalculateBarProps(): void {
    this.verticalScrollBar.scrollSize = this.content.height
    this.verticalScrollBar.viewportSize = this.viewport.height
    this.horizontalScrollBar.scrollSize = this.content.width
    this.horizontalScrollBar.viewportSize = this.viewport.width
  }
}
