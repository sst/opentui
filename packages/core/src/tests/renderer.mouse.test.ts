import { describe, expect, test } from "bun:test"
import { createTestRenderer, MouseButtons } from "../testing"
import { Renderable, type RenderableOptions } from "../Renderable"
import type { RenderContext } from "../types"
import type { Selection } from "../lib/selection"
import type { MouseEvent } from "../renderer"

class TestRenderable extends Renderable {
  public selectionActive = false

  constructor(ctx: RenderContext, options: RenderableOptions) {
    super(ctx, options)
  }

  public shouldStartSelection(_x: number, _y: number): boolean {
    return this.selectable
  }

  public onSelectionChanged(selection: Selection | null): boolean {
    this.selectionActive = !!selection?.isActive
    return this.selectionActive
  }
}

async function setupRenderer(options: Record<string, unknown> = {}) {
  return createTestRenderer({ width: 40, height: 20, ...options })
}

describe("renderer handleMouseData", () => {
  test("dispatches mouse down/up to hit-tested renderable", async () => {
    const { renderer, mockMouse, renderOnce } = await setupRenderer()
    try {
      const target = new TestRenderable(renderer, {
        id: "target",
        position: "absolute",
        left: 2,
        top: 3,
        width: 6,
        height: 4,
      })
      renderer.root.add(target)
      await renderOnce()

      const events: Array<{ type: string; x: number; y: number; button: number }> = []
      target.onMouseDown = (event) => {
        events.push({ type: event.type, x: event.x, y: event.y, button: event.button })
      }
      target.onMouseUp = (event) => {
        events.push({ type: event.type, x: event.x, y: event.y, button: event.button })
      }

      const clickX = target.x + 1
      const clickY = target.y + 1
      await mockMouse.click(clickX, clickY)

      expect(events).toHaveLength(2)
      expect(events[0]).toMatchObject({ type: "down", x: clickX, y: clickY, button: 0 })
      expect(events[1]).toMatchObject({ type: "up", x: clickX, y: clickY, button: 0 })
    } finally {
      renderer.destroy()
    }
  })

  test("emits over/out only when hover target changes", async () => {
    const { renderer, mockMouse, renderOnce } = await setupRenderer()
    try {
      const left = new TestRenderable(renderer, {
        id: "left",
        position: "absolute",
        left: 1,
        top: 1,
        width: 6,
        height: 4,
      })
      const right = new TestRenderable(renderer, {
        id: "right",
        position: "absolute",
        left: 10,
        top: 1,
        width: 6,
        height: 4,
      })
      renderer.root.add(left)
      renderer.root.add(right)
      await renderOnce()

      const hoverEvents: string[] = []
      left.onMouseOver = () => hoverEvents.push("over:left")
      left.onMouseOut = () => hoverEvents.push("out:left")
      right.onMouseOver = () => hoverEvents.push("over:right")
      right.onMouseOut = () => hoverEvents.push("out:right")

      await mockMouse.moveTo(left.x + 1, left.y + 1)
      await mockMouse.moveTo(right.x + 1, right.y + 1)
      await mockMouse.moveTo(right.x + 2, right.y + 1)

      expect(hoverEvents).toEqual(["over:left", "out:left", "over:right"])
    } finally {
      renderer.destroy()
    }
  })

  test("scroll events are delivered to the hit-tested renderable", async () => {
    const { renderer, mockMouse, renderOnce } = await setupRenderer()
    try {
      const target = new TestRenderable(renderer, {
        id: "scroll-target",
        position: "absolute",
        left: 4,
        top: 2,
        width: 8,
        height: 4,
      })
      renderer.root.add(target)
      await renderOnce()

      let scrollEvent: MouseEvent | null = null
      target.onMouseScroll = (event) => {
        scrollEvent = event
      }

      await mockMouse.scroll(target.x + 1, target.y + 1, "down")

      expect(scrollEvent?.type).toBe("scroll")
      expect(scrollEvent?.scroll?.direction).toBe("down")
      expect(scrollEvent?.scroll?.delta).toBe(1)
    } finally {
      renderer.destroy()
    }
  })

  test("split height offsets mouse coordinates and ignores events above render area", async () => {
    const baseHeight = 20
    const splitHeight = 6
    const { renderer, mockMouse, renderOnce } = await createTestRenderer({
      width: 40,
      height: baseHeight,
      experimental_splitHeight: splitHeight,
    })
    try {
      const target = new TestRenderable(renderer, {
        id: "split-target",
        position: "absolute",
        left: 2,
        top: 1,
        width: 6,
        height: 3,
      })
      renderer.root.add(target)
      await renderOnce()

      let downEvent: MouseEvent | null = null
      target.onMouseDown = (event) => {
        downEvent = event
      }

      const renderOffset = baseHeight - splitHeight
      await mockMouse.click(target.x + 1, Math.max(0, renderOffset - 1))
      expect(downEvent).toBeNull()

      const screenY = renderOffset + target.y + 1
      await mockMouse.click(target.x + 1, screenY)
      expect(downEvent?.y).toBe(target.y + 1)
    } finally {
      renderer.destroy()
    }
  })

  test("console mouse handling consumes events inside console bounds", async () => {
    const { renderer, mockMouse, renderOnce } = await setupRenderer()
    try {
      renderer.useConsole = true
      renderer.console.show()

      const target = new TestRenderable(renderer, {
        id: "background",
        position: "absolute",
        left: 0,
        top: 0,
        width: renderer.width,
        height: renderer.height,
      })
      renderer.root.add(target)
      await renderOnce()

      let clicks = 0
      target.onMouseDown = () => {
        clicks++
      }

      const bounds = renderer.console.bounds
      const insideX = Math.min(bounds.x + 1, renderer.width - 1)
      const insideY = Math.min(bounds.y + 1, renderer.height - 1)
      await mockMouse.click(insideX, insideY)
      expect(clicks).toBe(0)

      const outsideY = bounds.y > 0 ? bounds.y - 1 : Math.min(bounds.y + bounds.height, renderer.height - 1)
      await mockMouse.click(insideX, outsideY)
      expect(clicks).toBe(1)
    } finally {
      renderer.destroy()
    }
  })

  test("selection drag marks events as dragging and ends on mouse up", async () => {
    const { renderer, mockMouse, renderOnce } = await setupRenderer()
    try {
      const target = new TestRenderable(renderer, {
        id: "selectable",
        position: "absolute",
        left: 2,
        top: 2,
        width: 12,
        height: 6,
      })
      target.selectable = true
      renderer.root.add(target)
      await renderOnce()

      let dragEvent: MouseEvent | null = null
      let upEvent: MouseEvent | null = null
      target.onMouseDrag = (event) => {
        dragEvent = event
      }
      target.onMouseUp = (event) => {
        upEvent = event
      }

      const startX = target.x + 1
      const startY = target.y + 1
      const endX = target.x + 6
      const endY = target.y + 3

      await mockMouse.pressDown(startX, startY)
      await mockMouse.moveTo(endX, endY)
      await mockMouse.release(endX, endY)

      expect(renderer.hasSelection).toBe(true)
      expect(dragEvent?.isDragging).toBe(true)
      expect(upEvent?.isDragging).toBe(true)
      expect(renderer.getSelection()?.isDragging).toBe(false)
    } finally {
      renderer.destroy()
    }
  })

  test("ctrl+click extends selection instead of clearing", async () => {
    const { renderer, mockMouse, renderOnce } = await setupRenderer()
    try {
      const target = new TestRenderable(renderer, {
        id: "selectable-ctrl",
        position: "absolute",
        left: 2,
        top: 2,
        width: 12,
        height: 6,
      })
      target.selectable = true
      renderer.root.add(target)
      await renderOnce()

      await mockMouse.drag(target.x + 1, target.y + 1, target.x + 4, target.y + 1)
      const selectionBefore = renderer.getSelection()
      expect(selectionBefore).not.toBeNull()

      const nextX = target.x + 2
      const nextY = target.y + 4
      await mockMouse.pressDown(nextX, nextY, MouseButtons.LEFT, { modifiers: { ctrl: true } })
      await mockMouse.release(nextX, nextY, MouseButtons.LEFT, { modifiers: { ctrl: true } })

      const selectionAfter = renderer.getSelection()
      expect(selectionAfter).not.toBeNull()
      expect(selectionAfter?.focus).toEqual({ x: nextX, y: nextY })
      expect(renderer.hasSelection).toBe(true)
    } finally {
      renderer.destroy()
    }
  })

  test("preventDefault keeps selection while empty click clears it", async () => {
    const { renderer, mockMouse, renderOnce } = await setupRenderer()
    try {
      const selectable = new TestRenderable(renderer, {
        id: "selectable-main",
        position: "absolute",
        left: 2,
        top: 2,
        width: 12,
        height: 6,
      })
      selectable.selectable = true
      renderer.root.add(selectable)

      const blocker = new TestRenderable(renderer, {
        id: "blocker",
        position: "absolute",
        left: 20,
        top: 2,
        width: 8,
        height: 4,
      })
      renderer.root.add(blocker)
      await renderOnce()

      await mockMouse.drag(selectable.x + 1, selectable.y + 1, selectable.x + 4, selectable.y + 1)
      expect(renderer.hasSelection).toBe(true)

      blocker.onMouseDown = (event) => {
        event.preventDefault()
      }
      await mockMouse.click(blocker.x + 1, blocker.y + 1)
      expect(renderer.hasSelection).toBe(true)

      await mockMouse.click(renderer.width - 1, renderer.height - 1)
      expect(renderer.hasSelection).toBe(false)
    } finally {
      renderer.destroy()
    }
  })

  test("drag capture delivers drag-end and drop with source", async () => {
    const { renderer, mockMouse, renderOnce } = await setupRenderer()
    try {
      const source = new TestRenderable(renderer, {
        id: "source",
        position: "absolute",
        left: 1,
        top: 1,
        width: 6,
        height: 4,
      })
      const target = new TestRenderable(renderer, {
        id: "target",
        position: "absolute",
        left: 12,
        top: 1,
        width: 6,
        height: 4,
      })
      renderer.root.add(source)
      renderer.root.add(target)
      await renderOnce()

      const events: string[] = []
      let dropSource: Renderable | undefined
      let overSource: Renderable | undefined
      let targetDragged = false

      source.onMouseDrag = () => {
        events.push("drag:source")
      }
      source.onMouseDragEnd = () => {
        events.push("drag-end:source")
      }
      source.onMouseUp = () => {
        events.push("up:source")
      }
      target.onMouseDrop = (event) => {
        events.push("drop:target")
        dropSource = event.source
      }
      target.onMouseOver = (event) => {
        overSource = event.source
      }
      target.onMouseDrag = () => {
        targetDragged = true
      }

      await mockMouse.drag(source.x + 1, source.y + 1, target.x + 1, target.y + 1)

      expect(events).toContain("drag-end:source")
      expect(events).toContain("up:source")
      expect(events).toContain("drop:target")
      expect(dropSource).toBe(source)
      expect(overSource).toBe(source)
      expect(targetDragged).toBe(false)
    } finally {
      renderer.destroy()
    }
  })

  test("overflow hidden clips hit grid for mouse events", async () => {
    const { renderer, mockMouse, renderOnce } = await setupRenderer()
    try {
      const container = new TestRenderable(renderer, {
        id: "container",
        position: "absolute",
        left: 2,
        top: 2,
        width: 6,
        height: 4,
        overflow: "hidden",
      })
      const child = new TestRenderable(renderer, {
        id: "child",
        position: "absolute",
        left: 0,
        top: 0,
        width: 10,
        height: 4,
      })
      container.add(child)
      renderer.root.add(container)
      await renderOnce()

      let clicks = 0
      child.onMouseDown = () => {
        clicks++
      }

      await mockMouse.click(container.x + 1, container.y + 1)
      expect(clicks).toBe(1)

      const outsideX = container.x + container.width + 1
      await mockMouse.click(outsideX, container.y + 1)
      expect(clicks).toBe(1)
    } finally {
      renderer.destroy()
    }
  })
})
