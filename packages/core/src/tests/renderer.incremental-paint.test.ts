import { describe, expect, test } from "bun:test"
import {
  BoxRenderable,
  LineNumberRenderable,
  OptimizedBuffer,
  Renderable,
  RGBA,
  ScrollBoxRenderable,
  TextRenderable,
  VRenderable,
  type RenderContext,
} from "../index.js"
import { createTestRenderer } from "../testing.js"

const fg = RGBA.fromInts(240, 240, 240, 255)
const bg = RGBA.fromInts(20, 24, 30, 255)

function cellFg(renderer: Awaited<ReturnType<typeof createTestRenderer>>["renderer"], x: number, y: number): number[] {
  const index = y * renderer.width + x
  return RGBA.fromArray(renderer.currentRenderBuffer.buffers.fg.slice(index * 4, index * 4 + 4)).toInts()
}

class PaintingRenderable extends Renderable {
  protected value: string
  public paintCount = 0

  constructor(ctx: RenderContext, id: string, value: string, x: number, y: number) {
    super(ctx, { id, width: 1, height: 1, position: "absolute", left: x, top: y, paintBounds: "layout" })
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

class UnboundedPaintingRenderable extends Renderable {
  private value: string

  constructor(
    ctx: RenderContext,
    id: string,
    value: string,
    private drawY: number,
  ) {
    super(ctx, { id, width: 1, height: 1, position: "absolute", left: 2, top: 2, paintBounds: "unbounded" })
    this.value = value
  }

  public setValue(value: string): void {
    this.value = value
    this.requestRender()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    buffer.setCell(this._screenX, this.drawY, this.value, fg, bg)
  }
}

class LegacyOutOfBoundsRenderable extends Renderable {
  private value: string

  constructor(ctx: RenderContext, value: string) {
    super(ctx, { id: "legacy-out-of-bounds", width: 1, height: 1, position: "absolute", left: 2, top: 2 })
    this.value = value
  }

  public setValue(value: string): void {
    this.value = value
    this.requestRender()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    buffer.setCell(this._screenX, 8, this.value, fg, bg)
  }
}

class LifecyclePaintingRenderable extends PaintingRenderable {
  private tick = 0

  constructor(ctx: RenderContext) {
    super(ctx, "lifecycle-paint", "A", 3, 3)
    this.onLifecyclePass = () => {
      this.tick += 1
      this.value = this.tick % 2 === 0 ? "A" : "B"
    }
  }
}

class CachedUpdatePaintingRenderable extends PaintingRenderable {
  public cachedUpdateCount = 0

  public override updateCachedRenderList(_deltaTime: number): void {
    this.cachedUpdateCount += 1
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
  test("preserves direct next-buffer drawing from frame callbacks", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 4,
      height: 2,
      useThread: false,
    })
    let callbackRuns = 0
    let drawDirectCell = true
    const callback = async () => {
      callbackRuns += 1
      if (drawDirectCell) renderer.nextRenderBuffer.setCell(1, 0, "X", fg, bg)
    }
    renderer.setFrameCallback(callback)

    await renderOnce()

    expect(callbackRuns).toBe(1)
    expect(captureCharFrame()).toContain("X")

    drawDirectCell = false
    await renderOnce()
    expect(callbackRuns).toBe(2)
    expect(captureCharFrame()).not.toContain("X")

    drawDirectCell = true
    await renderOnce()
    expect(captureCharFrame()).toContain("X")
    renderer.removeFrameCallback(callback)
    await renderOnce()
    expect(captureCharFrame()).not.toContain("X")
    renderer.destroy()
  })

  test("keeps incremental painting for frame callbacks declared buffer-free", async () => {
    const { renderer, renderOnce, root } = await setup()
    const staticNode = new PaintingRenderable(renderer, "buffer-free-callback-static", "S", 20, 6)
    const spinner = new PaintingRenderable(renderer, "buffer-free-callback-spinner", "|", 2, 1)
    root.add(staticNode)
    root.add(spinner)
    renderer.setFrameCallback(async () => {}, { drawsToBuffer: false })

    await renderOnce()
    const staticPaintsBeforeTick = staticNode.paintCount
    const spinnerPaintsBeforeTick = spinner.paintCount
    spinner.setValue("/")
    await renderOnce()

    expect(staticNode.paintCount).toBe(staticPaintsBeforeTick)
    expect(spinner.paintCount).toBe(spinnerPaintsBeforeTick + 1)
    expect(renderer.getNativeStats().cellsUpdated).toBe(1)
    renderer.destroy()
  })

  for (const [status, label] of [
    [1, "skipped"],
    [2, "failed"],
  ] as const) {
    test(`publishes the matching hit grid after a ${label} native frame`, async () => {
      const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
        width: 4,
        height: 2,
        useThread: false,
        useMouse: true,
      })
      const first = new TextRenderable(renderer, {
        id: `${label}-first-hit-target`,
        content: "A",
        width: 1,
        height: 1,
        position: "absolute",
        left: 0,
        top: 0,
      })
      renderer.root.add(first)
      await renderOnce()
      expect(renderer.hitTest(0, 0)).toBe(first.num)

      renderer.root.remove(first)
      const second = new TextRenderable(renderer, {
        id: `${label}-second-hit-target`,
        content: "B",
        width: 1,
        height: 1,
        position: "absolute",
        left: 0,
        top: 0,
      })
      renderer.root.add(second)

      const rendererLib = (renderer as any).lib
      const nativeRender = rendererLib.render
      try {
        rendererLib.render = () => status
        await renderOnce()
      } finally {
        rendererLib.render = nativeRender
      }

      await renderOnce()

      expect(captureCharFrame()).toContain("B")
      expect(renderer.hitTest(0, 0)).toBe(second.num)
      renderer.destroy()
    })
  }

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

  test("repaints one bounding band for independently changing spinners", async () => {
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
    expect(staticNode.paintCount).toBe(2)
    for (const spinner of spinners) expect(spinner.paintCount).toBe(2)
    renderer.destroy()
  })

  test("merges four dirty renderables on one row instead of forcing a full frame", async () => {
    const { renderer, renderOnce, root } = await setup()
    const staticNode = new PaintingRenderable(renderer, "same-row-static", "S", 20, 8)
    const spinners = [2, 4, 6, 8].map(
      (x, index) => new PaintingRenderable(renderer, `same-row-spinner-${index}`, "|", x, 3),
    )
    root.add(staticNode)
    for (const spinner of spinners) root.add(spinner)

    await renderOnce()
    for (const spinner of spinners) spinner.setValue("/")
    await renderOnce()

    expect(renderer.getNativeStats().cellsUpdated).toBe(4)
    expect(staticNode.paintCount).toBe(1)
    for (const spinner of spinners) expect(spinner.paintCount).toBe(2)
    renderer.destroy()
  })

  test("renders a clean spanning layer at most once for disjoint dirty rows", async () => {
    const { renderer, renderOnce, root } = await setup()
    const spanning = new PaintingRenderable(renderer, "spanning", "S", 15, 0)
    spanning.height = 12
    const spinners = [
      new PaintingRenderable(renderer, "disjoint-1", "|", 2, 1),
      new PaintingRenderable(renderer, "disjoint-2", "|", 4, 5),
      new PaintingRenderable(renderer, "disjoint-3", "|", 6, 9),
    ]
    root.add(spanning)
    for (const spinner of spinners) root.add(spinner)

    await renderOnce()
    for (const spinner of spinners) spinner.setValue("/")
    await renderOnce()

    expect(spanning.paintCount).toBe(2)
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

  test("falls back to full composition for unbounded custom painting", async () => {
    const { renderer, renderOnce, root, captureCharFrame } = await setup()
    const unbounded = new UnboundedPaintingRenderable(renderer, "unbounded", "A", 8)
    root.add(unbounded)

    await renderOnce()
    expect(captureCharFrame()).toContain("A")
    unbounded.setValue("B")
    await renderOnce()

    expect(captureCharFrame()).not.toContain("A")
    expect(captureCharFrame()).toContain("B")
    renderer.destroy()
  })

  test("preserves legacy custom painting outside omitted paint bounds", async () => {
    const { renderer, renderOnce, root, captureCharFrame } = await setup()
    const custom = new LegacyOutOfBoundsRenderable(renderer, "A")
    root.add(custom)

    await renderOnce()
    expect(captureCharFrame()).toContain("A")
    custom.setValue("B")
    await renderOnce()

    expect(captureCharFrame()).not.toContain("A")
    expect(captureCharFrame()).toContain("B")
    renderer.destroy()
  })

  test("preserves VRenderable painting outside omitted paint bounds", async () => {
    const { renderer, renderOnce, root, captureCharFrame } = await setup()
    let value = "A"
    const custom = new VRenderable(renderer, {
      id: "out-of-bounds-vrenderable",
      width: 1,
      height: 1,
      position: "absolute",
      left: 2,
      top: 2,
      render(buffer) {
        buffer.setCell(2, 8, value, fg, bg)
      },
    })
    root.add(custom)

    await renderOnce()
    expect(captureCharFrame()).toContain("A")
    value = "B"
    custom.requestRender()
    await renderOnce()

    expect(captureCharFrame()).not.toContain("A")
    expect(captureCharFrame()).toContain("B")
    renderer.destroy()
  })

  test("preserves lifecycle-driven visual updates", async () => {
    const { renderer, renderOnce, root, captureCharFrame } = await setup()
    const lifecycle = new LifecyclePaintingRenderable(renderer)
    root.add(lifecycle)

    await renderOnce()
    const first = captureCharFrame()
    await renderOnce()
    const second = captureCharFrame()

    expect(first).not.toBe(second)
    renderer.destroy()
  })

  test("skips obsolete cached updates when layout already requires a render-list rebuild", async () => {
    const { renderer, renderOnce, root } = await setup()
    const cached = new CachedUpdatePaintingRenderable(renderer, "cached-update", "A", 3, 3)
    root.add(cached)

    await renderOnce()
    await renderOnce()
    expect(cached.cachedUpdateCount).toBe(1)

    cached.width = 2
    await renderOnce()

    expect(cached.cachedUpdateCount).toBe(1)
    renderer.destroy()
  })

  test("keeps row-local painting with an unchanged ScrollBox render list", async () => {
    const { renderer, renderOnce, root } = await setup()
    const scrollBox = new ScrollBoxRenderable(renderer, {
      id: "incremental-scrollbox",
      width: 20,
      height: 5,
      position: "absolute",
      left: 1,
      top: 1,
      viewportCulling: true,
    })
    const scrollContent = new PaintingRenderable(renderer, "scroll-content", "S", 1, 1)
    scrollBox.add(scrollContent)
    const spinner = new PaintingRenderable(renderer, "scrollbox-sibling-spinner", "|", 30, 9)
    root.add(scrollBox)
    root.add(spinner)

    await renderOnce()
    while (Boolean(renderer.root.getLayoutNode().isDirty())) await renderOnce()
    const scrollPaintsBeforeTick = scrollContent.paintCount
    const spinnerPaintsBeforeTick = spinner.paintCount
    spinner.setValue("/")
    await renderOnce()

    expect(scrollContent.paintCount).toBe(scrollPaintsBeforeTick)
    expect(spinner.paintCount).toBe(spinnerPaintsBeforeTick + 1)
    expect(renderer.getNativeStats().cellsUpdated).toBe(1)
    renderer.destroy()
  })

  test("keeps row-local painting beside an unchanged line-number gutter", async () => {
    const { renderer, renderOnce, root, captureCharFrame } = await setup(40, 16)
    const code = new TextRenderable(renderer, {
      id: "line-number-code",
      content: "one\ntwo\nthree",
      width: 20,
    })
    const lineNumbers = new LineNumberRenderable(renderer, {
      id: "incremental-line-numbers",
      target: code,
      width: 24,
      position: "absolute",
      left: 1,
      top: 1,
    })
    const staticNode = new PaintingRenderable(renderer, "line-number-static", "S", 30, 7)
    const spinner = new PaintingRenderable(renderer, "line-number-spinner", "|", 30, 9)
    root.add(lineNumbers)
    root.add(staticNode)
    root.add(spinner)

    await renderOnce()
    while (Boolean(renderer.root.getLayoutNode().isDirty())) await renderOnce()
    const staticPaintsBeforeTick = staticNode.paintCount
    const spinnerPaintsBeforeTick = spinner.paintCount

    spinner.setValue("/")
    await renderOnce()

    expect(staticNode.paintCount).toBe(staticPaintsBeforeTick)
    expect(spinner.paintCount).toBe(spinnerPaintsBeforeTick + 1)
    expect(renderer.getNativeStats().cellsUpdated).toBe(1)

    const codeXBeforeDigitBoundary = code.screenX
    const staticPaintsBeforeDigitBoundary = staticNode.paintCount
    code.content = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n")
    await renderOnce()
    while (Boolean(renderer.root.getLayoutNode().isDirty())) await renderOnce()

    expect(code.screenX).toBe(codeXBeforeDigitBoundary + 1)
    expect(staticNode.paintCount).toBeGreaterThan(staticPaintsBeforeDigitBoundary)
    expect(captureCharFrame()).toContain("12")
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

  test("repaints an ancestor border when descendant focus changes", async () => {
    const { renderer, renderOnce, root } = await setup()
    const normalBorder = RGBA.fromInts(180, 30, 30, 255)
    const focusedBorder = RGBA.fromInts(30, 220, 80, 255)
    const parent = new BoxRenderable(renderer, {
      id: "focus-parent",
      width: 12,
      height: 6,
      position: "absolute",
      left: 1,
      top: 1,
      border: true,
      focusable: true,
      borderColor: normalBorder,
      focusedBorderColor: focusedBorder,
    })
    const child = new PaintingRenderable(renderer, "focus-child", "C", 1, 1)
    child.focusable = true
    parent.add(child)
    root.add(parent)

    await renderOnce()
    expect(cellFg(renderer, 1, 1)).toEqual(normalBorder.toInts())

    child.focus()
    await renderOnce()
    expect(cellFg(renderer, 1, 1)).toEqual(focusedBorder.toInts())
    renderer.destroy()
  })

  test("clears the retained scene when the renderer root is hidden", async () => {
    const { renderer, renderOnce, root, captureCharFrame } = await setup()
    root.add(new PaintingRenderable(renderer, "visible-before-root-hide", "V", 4, 3))
    await renderOnce()
    expect(captureCharFrame()).toContain("V")

    renderer.root.visible = false
    await renderOnce()
    expect(captureCharFrame().trim()).toBe("")
    renderer.destroy()
  })
})
