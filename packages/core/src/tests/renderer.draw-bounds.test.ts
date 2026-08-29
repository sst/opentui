import { expect, test } from "bun:test"
import { BoxRenderable, OptimizedBuffer, Renderable, RGBA, type RenderContext } from "../index.js"
import { createTestRenderer } from "../testing.js"

const white = RGBA.fromInts(255, 255, 255)
const blue = RGBA.fromInts(0, 0, 80)

class Dot extends Renderable {
  value = "A"
  calls = 0
  constructor(ctx: RenderContext, y: number) {
    super(ctx, { position: "absolute", top: y, width: 1, height: 1, paintBounds: "layout" })
  }
  protected renderSelf(buffer: OptimizedBuffer) {
    this.calls++
    buffer.setCell(this.x, this.y, this.value, white, blue)
  }
}

function snapshot(buffer: OptimizedBuffer) {
  return Object.values(buffer.buffers).map((view) => Array.from(view))
}

test("draw bounds skip a sparse unchanged Box without changing any buffer channel", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ width: 20, height: 12, useThread: false })
  renderer.requestRender = (source) => renderer.root.invalidate(source)
  const box = new BoxRenderable(renderer, {
    width: 20,
    height: 12,
    border: ["top"],
    borderColor: white,
    shouldFill: false,
  })
  const dot = new Dot(renderer, 6)
  renderer.root.add(box)
  renderer.root.add(dot)
  const lib = renderer.nextRenderBuffer.lib
  const drawBox = lib.bufferDrawBox
  let boxDraws = 0
  lib.bufferDrawBox = (...args) => {
    boxDraws++
    return drawBox.apply(lib, args)
  }
  try {
    await renderOnce()
    expect(boxDraws).toBe(1)
    dot.value = "B"
    dot.requestRender()
    await renderOnce()
    expect(dot.calls).toBe(2)
    expect(boxDraws).toBe(1)
    const partial = snapshot(renderer.currentRenderBuffer)
    renderer.root.invalidate()
    await renderOnce()
    expect(snapshot(renderer.currentRenderBuffer)).toEqual(partial)
  } finally {
    lib.bufferDrawBox = drawBox
    renderer.destroy()
  }
})

test("partial paints cannot shrink a complete Box observation", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ width: 20, height: 12, useThread: false })
  renderer.requestRender = (source) => renderer.root.invalidate(source)
  const top = new Dot(renderer, 0)
  const bottom = new Dot(renderer, 11)
  renderer.root.add(top)
  renderer.root.add(bottom)
  const box = new BoxRenderable(renderer, {
    width: 20,
    height: 12,
    border: ["top", "bottom"],
    borderColor: RGBA.fromInts(255, 0, 0, 128),
    shouldFill: false,
  })
  renderer.root.add(box)
  try {
    await renderOnce()
    for (const dot of [top, bottom, top, bottom]) {
      dot.value = dot.value === "A" ? "B" : "A"
      dot.requestRender()
      await renderOnce()
    }
    const partial = snapshot(renderer.currentRenderBuffer)
    renderer.root.invalidate()
    await renderOnce()
    expect(snapshot(renderer.currentRenderBuffer)).toEqual(partial)
    box.translateY = 1
    await renderOnce()
    const moved = snapshot(renderer.currentRenderBuffer)
    renderer.root.invalidate()
    await renderOnce()
    expect(snapshot(renderer.currentRenderBuffer)).toEqual(moved)
    renderer.root.remove(box)
    await renderOnce()
    const removed = snapshot(renderer.currentRenderBuffer)
    renderer.root.invalidate()
    await renderOnce()
    expect(snapshot(renderer.currentRenderBuffer)).toEqual(removed)
    box.destroy()
  } finally {
    renderer.destroy()
  }
})

test("mutable fill and changed paint functions revoke sparse eligibility", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ width: 20, height: 12, useThread: false })
  renderer.requestRender = (source) => renderer.root.invalidate(source)
  const box = new BoxRenderable(renderer, {
    width: 20,
    height: 12,
    border: ["top"],
    backgroundColor: blue,
    shouldFill: false,
  })
  const dot = new Dot(renderer, 6)
  renderer.root.add(dot)
  renderer.root.add(box)
  try {
    await renderOnce()
    box.shouldFill = true
    dot.requestRender()
    await renderOnce()
    expect(renderer.currentRenderBuffer.buffers.char[6 * 20]).toBe(32)
    box.shouldFill = false
    let calls = 0
    ;(box as any).renderSelf = (buffer: OptimizedBuffer) => {
      calls++
      buffer.setCell(4, 6, "X", white, blue)
    }
    box.requestRender()
    dot.requestRender()
    await renderOnce()
    expect(calls).toBe(1)
    expect(renderer.currentRenderBuffer.buffers.char[6 * 20 + 4]).toBe(88)
    const partial = snapshot(renderer.currentRenderBuffer)
    renderer.root.invalidate()
    await renderOnce()
    expect(snapshot(renderer.currentRenderBuffer)).toEqual(partial)
  } finally {
    renderer.destroy()
  }
})

test("unknown changed footprints choose full before callbacks; unknown unchanged callbacks still run", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ width: 20, height: 12, useThread: false })
  renderer.requestRender = (source) => renderer.root.invalidate(source)
  const unknown = new BoxRenderable(renderer, { width: 1, height: 1 })
  let y = 8
  let calls = 0
  let rowClears = 0
  ;(unknown as any).renderSelf = (buffer: OptimizedBuffer) => {
    calls++
    buffer.drawText(y === 8 ? "old" : "longer text", 2, y, white)
  }
  const dot = new Dot(renderer, 4)
  renderer.root.add(unknown)
  renderer.root.add(dot)
  const lib = renderer.nextRenderBuffer.lib
  const clearRows = lib.bufferClearRows
  lib.bufferClearRows = (...args) => {
    rowClears++
    return clearRows.apply(lib, args)
  }
  try {
    await renderOnce()
    dot.requestRender()
    await renderOnce()
    expect(calls).toBe(2)
    expect(rowClears).toBe(1)
    y = 10
    unknown.requestRender()
    await renderOnce()
    expect(calls).toBe(3)
    expect(rowClears).toBe(1)
    const complete = snapshot(renderer.currentRenderBuffer)
    expect(complete[0][8 * 20 + 2]).toBe(32)
    expect(complete[0][10 * 20 + 2]).toBe(108)
    renderer.root.invalidate()
    await renderOnce()
    expect(snapshot(renderer.currentRenderBuffer)).toEqual(complete)
  } finally {
    lib.bufferClearRows = clearRows
    renderer.destroy()
  }
})

test("failed full paints discard observations and unwind native collection", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ width: 20, height: 12, useThread: false })
  renderer.requestRender = (source) => renderer.root.invalidate(source)
  const box = new BoxRenderable(renderer, { width: 20, height: 12, border: ["top"], shouldFill: false })
  renderer.root.add(box)
  const lib = renderer.nextRenderBuffer.lib
  const drawBox = lib.bufferDrawBox
  try {
    lib.bufferDrawBox = (...args) => {
      drawBox.apply(lib, args)
      throw new Error("paint failed")
    }
    // Root's error boundary is the unit under test; renderer may log/swallow errors.
    expect(() => renderer.root.render(renderer.nextRenderBuffer, 0, blue, true, true)).toThrow("paint failed")
    lib.bufferDrawBox = drawBox
    box.border = ["bottom"]
    await renderOnce()
    const recovered = snapshot(renderer.currentRenderBuffer)
    renderer.root.invalidate()
    await renderOnce()
    expect(snapshot(renderer.currentRenderBuffer)).toEqual(recovered)
  } finally {
    lib.bufferDrawBox = drawBox
    renderer.destroy()
  }
})
