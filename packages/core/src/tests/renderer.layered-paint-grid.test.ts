import { expect, test } from "bun:test"
import { Renderable, type RenderableOptions } from "../Renderable.js"
import { OptimizedBuffer } from "../buffer.js"
import { RGBA } from "../lib/RGBA.js"
import { createTestRenderer } from "../testing.js"
import type { RenderContext } from "../types.js"

const white = RGBA.fromInts(255, 255, 255)
const blue = RGBA.fromInts(0, 0, 255)
const red = RGBA.fromInts(255, 0, 0)
const translucent = RGBA.fromValues(1, 0, 0, 0.5)
const transparent = RGBA.fromValues(0, 0, 0, 0)

class Paint extends Renderable {
  public calls = 0

  constructor(
    ctx: RenderContext,
    options: RenderableOptions,
    public paint: (buffer: OptimizedBuffer, self: Paint) => void,
  ) {
    super(ctx, options)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    this.calls++
    this.paint(buffer, this)
  }
}

function snapshot(buffer: OptimizedBuffer) {
  const { char, fg, bg, attributes } = buffer.buffers
  return { char: [...char], fg: [...fg], bg: [...bg], attributes: [...attributes] }
}

test("full reference repairs actual out-of-layout paint on move and removal", async () => {
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 14, height: 4 })
  const lower = new Paint(renderer, { width: 1, height: 1 }, (buffer, self) => {
    buffer.drawText("lower", self.x + 4, self.y + 2, white, blue)
  })
  const upper = new Paint(renderer, { width: 1, height: 1, position: "absolute" }, (buffer) => {
    buffer.fillRect(4, 2, 5, 1, translucent)
    buffer.drawText("!", 6, 2, white)
    buffer.fillRect(6, 2, 1, 1, translucent)
  })
  try {
    renderer.root.add(lower)
    renderer.root.add(upper)
    await renderOnce()
    expect(captureCharFrame().split("\n")[2]).toBe("    lo!er     ")
    const first = snapshot(renderer.currentRenderBuffer)
    await renderOnce()
    expect(snapshot(renderer.currentRenderBuffer)).toEqual(first)
    expect([lower.calls, upper.calls]).toEqual([2, 2])

    lower.paint = (buffer, self) => buffer.drawText("other", self.x + 4, self.y + 2, red, blue)
    lower.requestRender()
    await renderOnce()
    expect(captureCharFrame().split("\n")[2]).toBe("    ot!er     ")
    renderer.root.remove(upper)
    await renderOnce()
    expect(captureCharFrame().split("\n")[2]).toBe("    other     ")
    lower.translateX = 2
    await renderOnce()
    expect(captureCharFrame().split("\n")[2]).toBe("      other   ")
    renderer.root.remove(lower)
    await renderOnce()
    expect(captureCharFrame().trim()).toBe("")
  } finally {
    lower.destroy()
    upper.destroy()
    renderer.destroy()
  }
})

test("full reference preserves before/self/after then children and equal writes", async () => {
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 8, height: 2 })
  const order: string[] = []
  const parent = new Paint(
    renderer,
    {
      width: 1,
      height: 1,
      renderBefore(buffer) {
        order.push("before")
        buffer.drawText("A", 4, 0, white, blue)
      },
      renderAfter(buffer) {
        order.push("after")
        buffer.drawText("A", 4, 0, white, blue)
      },
    },
    (buffer) => {
      order.push("self")
      buffer.drawText("B", 4, 0, white, blue)
    },
  )
  const child = new Paint(renderer, { width: 1, height: 1 }, (buffer) => {
    order.push("child")
    buffer.drawText("C", 4, 0, white, blue)
  })
  try {
    parent.add(child)
    renderer.root.add(parent)
    await renderOnce()
    expect(order).toEqual(["before", "self", "after", "child"])
    expect(captureCharFrame().split("\n")[0]).toBe("    C   ")
    parent.remove(child)
    await renderOnce()
    expect(captureCharFrame().split("\n")[0]).toBe("    A   ")
  } finally {
    child.destroy()
    parent.destroy()
    renderer.destroy()
  }
})

test("full reference framebuffer copy is independent of unrelated destination graphemes", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ width: 12, height: 4 })
  const source = OptimizedBuffer.create(1, 1, "unicode", { respectAlpha: false })
  source.setCell(0, 0, "X", white, translucent)
  let wide = false
  const lower = new Paint(renderer, { width: 1, height: 1 }, (buffer) => {
    buffer.fillRect(4, 1, 1, 1, blue)
    if (wide) buffer.drawText("\u754c", 0, 3, white, blue)
  })
  const upper = new Paint(renderer, { width: 1, height: 1 }, (buffer) => {
    buffer.drawFrameBuffer(4, 1, source)
  })
  try {
    renderer.root.add(lower)
    renderer.root.add(upper)
    await renderOnce()
    const first = snapshot(renderer.currentRenderBuffer)
    wide = true
    lower.requestRender()
    await renderOnce()
    const second = snapshot(renderer.currentRenderBuffer)
    const offset = (1 * 12 + 4) * 4
    expect(first.bg.slice(offset, offset + 4)).toEqual([255, 0, 0, 128])
    expect(second.bg.slice(offset, offset + 4)).toEqual(first.bg.slice(offset, offset + 4))
    expect(second.char[1 * 12 + 4]).toBe(first.char[1 * 12 + 4])
  } finally {
    renderer.destroy()
    source.destroy()
  }
})

test("full reference transparent box respects explicit scissor with or without unrelated graphemes", async () => {
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 12, height: 4 })
  let wide = false
  const lower = new Paint(renderer, { width: 1, height: 1 }, (buffer) => {
    if (wide) buffer.drawText("\u754c", 0, 3, white, blue)
  })
  const clip = new Paint(
    renderer,
    { position: "absolute", left: 4, top: 1, width: 1, height: 1, overflow: "hidden" },
    () => {},
  )
  const upper = new Paint(renderer, { width: 1, height: 1 }, (buffer) => {
    buffer.drawBox({
      x: 4,
      y: 1,
      width: 3,
      height: 1,
      borderStyle: "single",
      border: true,
      borderColor: white,
      backgroundColor: transparent,
    })
  })
  try {
    renderer.root.add(lower)
    renderer.root.add(clip)
    clip.add(upper)
    await renderOnce()
    const first = captureCharFrame().split("\n")[1]
    wide = true
    lower.requestRender()
    await renderOnce()
    const second = captureCharFrame().split("\n")[1]
    expect(first.slice(4, 7)).toBe("\u2514  ")
    expect(second).toBe(first)
  } finally {
    renderer.destroy()
  }
})
