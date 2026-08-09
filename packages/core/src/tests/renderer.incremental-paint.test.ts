import { describe, expect, test } from "bun:test"
import { BoxRenderable, OptimizedBuffer, Renderable, RGBA, TextRenderable, type RenderContext } from "../index.js"
import { createTestRenderer } from "../testing.js"

const fg = RGBA.fromInts(240, 240, 240, 255)
const bg = RGBA.fromInts(20, 24, 30, 255)

class PaintingRenderable extends Renderable {
  private value: string
  public paintCount = 0

  constructor(ctx: RenderContext, id: string, value: string, x: number, y: number) {
    super(ctx, { id, width: 1, height: 1, position: "absolute", left: x, top: y })
    this.value = value
  }

  public setValue(value: string): void {
    if (this.value === value) return
    this.value = value
    this.requestRender()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    this.paintCount += 1
    buffer.setCell(this._screenX, this._screenY, this.value, fg, bg)
  }
}

async function setup(width = 40, height = 12) {
  const testRenderer = await createTestRenderer({ width, height, useThread: false, useMouse: true })
  const { renderer, renderOnce } = testRenderer
  renderer.requestRender = (renderable) => renderer.root.invalidate(renderable)

  const root = new BoxRenderable(renderer, {
    id: "incremental-root",
    width: "100%",
    height: "100%",
    backgroundColor: bg,
  })
  renderer.root.add(root)

  return { ...testRenderer, renderer, renderOnce, root }
}

describe("incremental paint", () => {
  test("skips all paints on an unchanged frame", async () => {
    const { renderer, renderOnce, root, captureCharFrame } = await setup()
    const first = new PaintingRenderable(renderer, "first", "A", 2, 2)
    const second = new PaintingRenderable(renderer, "second", "B", 30, 9)
    root.add(first)
    root.add(second)

    await renderOnce()
    const initialFrame = captureCharFrame()
    const firstIndex = first.screenY * renderer.width + first.screenX
    expect(first.paintCount).toBe(1)
    expect(second.paintCount).toBe(1)
    expect(renderer.nextRenderBuffer.buffers.char[firstIndex]).toBe(
      renderer.currentRenderBuffer.buffers.char[firstIndex],
    )
    expect(renderer.hitTest(first.screenX, first.screenY)).toBe(first.num)

    await renderOnce()

    expect(captureCharFrame()).toBe(initialFrame)
    expect(renderer.getNativeStats().cellsUpdated).toBe(0)
    expect(first.paintCount).toBe(1)
    expect(second.paintCount).toBe(1)
    expect(renderer.nextRenderBuffer.buffers.char[firstIndex]).toBe(
      renderer.currentRenderBuffer.buffers.char[firstIndex],
    )
    expect(renderer.hitTest(first.screenX, first.screenY)).toBe(first.num)
    renderer.destroy()
  })

  test("repaints only rows containing independently changing spinners", async () => {
    const { renderer, renderOnce, root } = await setup()
    const staticNode = new PaintingRenderable(renderer, "static", "S", 20, 6)
    const spinners = [
      new PaintingRenderable(renderer, "spinner-1", "|", 2, 1),
      new PaintingRenderable(renderer, "spinner-2", "|", 4, 4),
      new PaintingRenderable(renderer, "spinner-3", "|", 6, 9),
    ]
    root.add(staticNode)
    for (const spinner of spinners) root.add(spinner)

    await renderOnce()
    for (const spinner of spinners) spinner.setValue("/")
    await renderOnce()

    expect(renderer.getNativeStats().cellsUpdated).toBe(3)
    expect(staticNode.paintCount).toBe(1)
    for (const spinner of spinners) expect(spinner.paintCount).toBe(2)
    renderer.destroy()
  })

  test("recomposes a clean upper layer when a dirty lower layer intersects it", async () => {
    const { renderer, renderOnce, root, captureCharFrame } = await setup()
    const lower = new PaintingRenderable(renderer, "lower", "L", 8, 5)
    const upper = new PaintingRenderable(renderer, "upper", "U", 8, 5)
    const unrelated = new PaintingRenderable(renderer, "unrelated", "X", 30, 10)
    root.add(lower)
    root.add(upper)
    root.add(unrelated)

    await renderOnce()
    const initialFrame = captureCharFrame()
    lower.setValue("N")
    await renderOnce()

    expect(captureCharFrame()).toBe(initialFrame)
    expect(renderer.getNativeStats().cellsUpdated).toBe(0)
    expect(lower.paintCount).toBe(2)
    expect(upper.paintCount).toBe(2)
    expect(unrelated.paintCount).toBe(1)
    renderer.destroy()
  })

  test("preserves wide graphemes while recomposing another cell on the same row", async () => {
    const { renderer, renderOnce, root, captureCharFrame } = await setup()
    const text = new TextRenderable(renderer, {
      id: "wide-text",
      content: "wide: 界 stays intact",
      width: 20,
      height: 1,
      position: "absolute",
      left: 2,
      top: 4,
    })
    const spinner = new PaintingRenderable(renderer, "wide-row-spinner", "|", 30, 4)
    root.add(text)
    root.add(spinner)

    await renderOnce()
    const initialFrame = captureCharFrame()
    spinner.setValue("/")
    await renderOnce()

    expect(captureCharFrame().replace("/", "|")).toBe(initialFrame)
    expect(renderer.getNativeStats().cellsUpdated).toBe(1)
    renderer.destroy()
  })

  test("rebuilds the base scene for post-process callbacks without compounding", async () => {
    const { renderer, renderOnce, root } = await setup()
    const content = new PaintingRenderable(renderer, "post-content", "P", 5, 3)
    root.add(content)

    const overlay = RGBA.fromInts(200, 40, 20, 128)
    const process = (buffer: OptimizedBuffer) => {
      buffer.setCellWithAlphaBlending(5, 3, "P", overlay, overlay)
    }
    renderer.addPostProcessFn(process)

    await renderOnce()
    const index = 3 * renderer.width + 5
    const firstFg = [...renderer.currentRenderBuffer.buffers.fg.slice(index * 4, index * 4 + 4)]
    await renderOnce()
    const secondFg = [...renderer.currentRenderBuffer.buffers.fg.slice(index * 4, index * 4 + 4)]

    expect(secondFg).toEqual(firstFg)

    renderer.removePostProcessFn(process)
    await renderOnce()
    const restoredFg = [...renderer.currentRenderBuffer.buffers.fg.slice(index * 4, index * 4 + 4)]
    expect(restoredFg).not.toEqual(firstFg)
    renderer.destroy()
  })
})
