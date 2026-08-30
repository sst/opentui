import { describe, expect, test } from "bun:test"
import { ArrowRenderable, BoxRenderable, FrameBufferRenderable, OptimizedBuffer, Renderable, RGBA } from "../index.js"
import { createTestRenderer } from "../testing.js"
import type { RenderContext } from "../types.js"

const foreground = RGBA.fromInts(255, 255, 255)
const background = RGBA.fromInts(0, 0, 0)

class BoundedRenderable extends Renderable {
  public value = "A"
  public paints = 0

  constructor(ctx: RenderContext, id: string, x: number, y: number) {
    super(ctx, { id, position: "absolute", left: x, top: y, width: 1, height: 1 })
  }

  public update(value: string): void {
    this.value = value
    this.requestRender()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    this.paints += 1
    buffer.setCell(this.screenX, this.screenY, this.value, foreground, background)
  }
}

describe("bounded renderable composition", () => {
  test("custom paint conservatively recomposes distant siblings", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 12, height: 6 })
    const first = new BoundedRenderable(renderer, "first", 1, 1)
    const second = new BoundedRenderable(renderer, "second", 8, 4)
    renderer.root.add(first)
    renderer.root.add(second)

    await renderOnce()
    const siblingPaints = second.paints
    first.update("B")
    await renderOnce()

    expect(captureCharFrame().split("\n")[1]?.[1]).toBe("B")
    expect(second.paints).toBe(siblingPaints + 1)
    renderer.destroy()
  })

  test("keeps overflowing children visible outside their parent's own layout", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 12, height: 5 })
    const parent = new BoxRenderable(renderer, { id: "parent", width: 1, height: 1, overflow: "visible" })
    const child = new BoundedRenderable(renderer, "overflow-child", 4, 2)
    parent.add(child)
    renderer.root.add(parent)

    await renderOnce()
    child.update("B")
    await renderOnce()

    expect(captureCharFrame().split("\n")[2]?.[4]).toBe("B")
    renderer.destroy()
  })

  test("repaints dynamically added and removed bounded render hooks", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 8, height: 3 })
    const node = new BoundedRenderable(renderer, "dynamic-hook", 1, 1)
    renderer.root.add(node)
    await renderOnce()

    node.renderAfter = function (buffer) {
      buffer.setCell(this.screenX, this.screenY, "X", foreground, background)
    }
    await renderOnce()
    expect(captureCharFrame()).toContain("X")

    node.renderAfter = undefined
    await renderOnce()
    expect(captureCharFrame()).toContain("A")
    expect(captureCharFrame()).not.toContain("X")
    renderer.destroy()
  })

  test("preserves frame callback underlays and clears them after callback removal", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 8, height: 3 })
    const callback = async () => renderer.nextRenderBuffer.setCell(2, 1, "X", foreground, background)
    renderer.setFrameCallback(callback)
    await renderOnce()
    expect(captureCharFrame()).toContain("X")

    renderer.removeFrameCallback(callback)
    await renderOnce()
    expect(captureCharFrame()).not.toContain("X")
    renderer.destroy()
  })

  test("runs custom lifecycle mutations even without explicit invalidation", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 8, height: 3 })
    const node = new BoundedRenderable(renderer, "lifecycle", 1, 1)
    let tick = 0
    node.onLifecyclePass = () => {
      node.value = ++tick === 1 ? "A" : "B"
    }
    renderer.root.add(node)

    await renderOnce()
    await renderOnce()

    expect(tick).toBe(2)
    expect(captureCharFrame()).toContain("B")
    renderer.destroy()
  })

  test("executes custom update hooks on unchanged frames", async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 8, height: 3 })
    class UpdatingRenderable extends BoundedRenderable {
      public updates = 0
      protected override onUpdate(): void {
        this.updates += 1
      }
    }
    const node = new UpdatingRenderable(renderer, "updates", 1, 1)
    renderer.root.add(node)

    await renderOnce()
    await renderOnce()

    expect(node.updates).toBe(2)
    renderer.destroy()
  })

  test("removing a postprocess restores the unprocessed scene", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 8, height: 3 })
    const node = new BoundedRenderable(renderer, "processed", 1, 1)
    renderer.root.add(node)
    const effect = (buffer: OptimizedBuffer) => buffer.setCell(1, 1, "X", foreground, background)
    renderer.addPostProcessFn(effect)
    await renderOnce()
    expect(captureCharFrame()).toContain("X")

    renderer.removePostProcessFn(effect)
    await renderOnce()

    expect(captureCharFrame()).toContain("A")
    expect(captureCharFrame()).not.toContain("X")
    renderer.destroy()
  })

  test("framebuffer drawing is limited to the renderable's own layout", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 8, height: 3 })
    const node = new FrameBufferRenderable(renderer, { id: "framebuffer", width: 2, height: 1 })
    renderer.root.add(node)
    await renderOnce()
    node.frameBuffer.resize(4, 1)
    node.frameBuffer.drawText("ABCD", 0, 0, foreground, background)
    node.requestRender()

    await renderOnce()

    expect(captureCharFrame().split("\n")[0]?.slice(0, 4)).toBe("AB  ")
    node.width = 4
    await renderOnce()
    expect(node.frameBuffer.width).toBe(4)
    expect(captureCharFrame().split("\n")[0]?.slice(0, 4)).toBe("ABCD")
    renderer.destroy()
  })

  test("explicitly sized arrows clip characters to their own layout", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 8, height: 3 })
    const arrow = new ArrowRenderable(renderer, {
      id: "fixed-arrow",
      direction: "right",
      width: 1,
      height: 1,
      arrowChars: { right: ">>" },
    })
    renderer.root.add(arrow)

    await renderOnce()

    expect(arrow.width).toBe(1)
    expect(captureCharFrame().split("\n")[0]?.slice(0, 2)).toBe("> ")
    renderer.destroy()
  })

  test("changing arrow characters updates the intrinsic layout width", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 8, height: 3 })
    const arrow = new ArrowRenderable(renderer, { id: "arrow", direction: "right", height: 1 })
    renderer.root.add(arrow)
    await renderOnce()

    arrow.arrowChars = { right: ">>" }
    await renderOnce()

    expect(arrow.width).toBe(2)
    expect(captureCharFrame()).toContain(">>")
    renderer.destroy()
  })
})
