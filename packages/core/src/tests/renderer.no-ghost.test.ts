import { afterEach, expect, spyOn, test } from "bun:test"
import {
  BoxRenderable,
  FrameBufferRenderable,
  ImageRenderable,
  NativeImage,
  OptimizedBuffer,
  Renderable,
  RGBA,
  TextRenderable,
  link,
  t,
} from "../index.js"
import { createTestRenderer, type TestRenderer } from "../testing.js"

const white = RGBA.fromInts(255, 255, 255)
const black = RGBA.fromInts(0, 0, 0)
let renderer: TestRenderer
afterEach(() => renderer?.destroy())

async function setup(alpha = 255) {
  const result = await createTestRenderer({ width: 12, height: 6, useMouse: true })
  renderer = result.renderer
  if (alpha >= 0) renderer.setBackgroundColor(RGBA.fromInts(0, 0, 0, alpha))
  return result
}

function snapshot() {
  const buffer = renderer.currentRenderBuffer
  return [buffer.getRealCharBytes(true), ...Object.values(buffer.buffers)].map((channel) => [...channel])
}

class Painter extends Renderable {
  paint: (buffer: OptimizedBuffer) => void = () => {}
  protected renderSelf(buffer: OptimizedBuffer) {
    this.paint(buffer)
  }
}

for (const phase of ["renderBefore", "renderAfter"] as const) {
  test(`${phase} compatibility overflow is erased when paint stops`, async () => {
    const { renderOnce, captureCharFrame } = await setup()
    const node = new Painter(renderer, { width: 1, height: 1 })
    node[phase] = (buffer) => buffer.drawText("HOOK", 2, 4, white, black)
    renderer.root.add(node)
    await renderOnce()
    expect(captureCharFrame()).toContain("HOOK")
    node[phase] = undefined
    await renderOnce()
    expect(captureCharFrame().trim()).toBe("")
    await renderOnce()
    expect(captureCharFrame().trim()).toBe("")
  })
}

test("buffered local bounds do not clip separately drawn overflowing children", async () => {
  const { renderOnce, captureCharFrame } = await setup()
  const parent = new Painter(renderer, { buffered: true, left: 2, top: 1, width: 2, height: 1 })
  parent.paint = (buffer) => buffer.drawText("PXXX", 0, 0, white, black)
  const child = new Painter(renderer, { position: "absolute", left: 5, top: 3, width: 1, height: 1 })
  child.paint = (buffer) => buffer.drawText("CXXX", child.screenX, child.screenY, white, black)
  parent.add(child)
  renderer.root.add(parent)
  await renderOnce()
  expect(captureCharFrame().replace(/\s/g, "")).toBe("PXC")
})

test("native placements copied from a framebuffer remain stable without dirty renderables", async () => {
  const { renderOnce } = await setup()
  const image = NativeImage.fromRgba(Uint8Array.of(0, 0, 255, 128), 1, 1)
  const node = new FrameBufferRenderable(renderer, { width: 2, height: 1 })
  renderer.root.add(node)
  try {
    await renderOnce()
    const source = node.frameBuffer
    // Exercise the public native placement path, not ImageRenderable's dirty state.
    source.lib.bufferDrawImage(source.ptr, image.ptr, 0, 0, 2, 1, 0, 0, 0, 0, 1, 1, "blocks")
    await renderOnce()
    expect(renderer.nextRenderBuffer.lib.bufferGetCompositionVersion(renderer.nextRenderBuffer.ptr)).toBe(0)
    const first = snapshot()
    for (let i = 0; i < 3; i++) {
      await renderOnce()
      expect(snapshot()).toEqual(first)
    }
    source.clear(black)
    await renderOnce()
    expect(snapshot()).not.toEqual(first)
  } finally {
    image.dispose()
  }
})

for (const operation of ["raw", "native-raw", "clear", "matrix", "uniform"] as const) {
  test(`external ${operation} invalidates an otherwise unchanged retained scene`, async () => {
    const { renderOnce } = await setup()
    renderer.root.add(new TextRenderable(renderer, { width: 2, height: 1, content: "OK" }))
    await renderOnce()
    const expected = snapshot()
    const buffer = renderer.nextRenderBuffer
    const matrix = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    const alias = operation === "raw" ? buffer.buffers.char : undefined
    if (operation === "native-raw") buffer.lib.bufferGetCharPtr(buffer.ptr)
    for (let i = 0; i < 2; i++) {
      if (alias) alias[4 * 12 + 10] = 88
      if (operation === "clear") buffer.clear(white)
      if (operation === "matrix") buffer.colorMatrix(matrix, new Float32Array([10, 4, 1]))
      if (operation === "uniform") buffer.colorMatrixUniform(matrix)
      await renderOnce()
      expect(snapshot()).toEqual(expected)
    }
    if (operation === "native-raw") expect(buffer.lib.bufferGetCompositionVersion(buffer.ptr)).toBe(0)
  })
}

test("opaque ordinary text retains unchanged rows without painting distant siblings", async () => {
  const { renderOnce, captureCharFrame } = await setup()
  const first = new TextRenderable(renderer, { left: 1, top: 1, width: 2, height: 1, content: "A" })
  const second = new TextRenderable(renderer, {
    position: "absolute",
    left: 8,
    top: 4,
    width: 2,
    height: 1,
    content: "S",
  })
  renderer.root.add(first)
  renderer.root.add(second)
  const paint = spyOn(renderer.nextRenderBuffer, "drawTextBuffer")
  await renderOnce()
  expect(paint).toHaveBeenCalledTimes(2)
  await renderOnce()
  expect(paint).toHaveBeenCalledTimes(2)
  first.content = "B"
  await renderOnce()
  expect(paint).toHaveBeenCalledTimes(3)
  expect(captureCharFrame()).toContain("B")
  expect(captureCharFrame()).toContain("S")
  paint.mockRestore()
})

for (const alpha of [-1, 0, 128, 255]) {
  test(`shortened text and links clear all channels, background alpha=${alpha}`, async () => {
    const { renderOnce, captureCharFrame } = await setup(alpha)
    const text = new TextRenderable(renderer, { left: 1, top: 1, width: 8, height: 1, content: "GHOST" })
    renderer.root.add(text)
    for (const content of ["B", t`${link("https://example.test")("\u754c\ud83d\udc69\u200d\ud83d\udcbb")}`, "x"]) {
      await renderOnce()
      text.content = content
      await renderOnce()
      expect(captureCharFrame()).not.toContain("HOST")
      const expected = snapshot()
      await renderOnce()
      expect(snapshot()).toEqual(expected)
      renderer.requestRender()
      await renderOnce()
      expect(snapshot()).toEqual(expected)
    }
  })
}

test("clearing selection restores the transparent underlay", async () => {
  const { renderOnce } = await setup(-1)
  const text = new TextRenderable(renderer, {
    left: 1,
    top: 1,
    width: 8,
    height: 1,
    content: "SELECT",
    selectable: true,
  })
  renderer.root.add(text)
  await renderOnce()
  const clean = snapshot()
  renderer.startSelection(text, 1, 1)
  renderer.updateSelection(text, 4, 1, { finishDragging: true })
  await renderOnce()
  expect(snapshot()).not.toEqual(clean)
  renderer.clearSelection()
  await renderOnce()
  expect(snapshot()).toEqual(clean)
})

for (const buffered of [false, true]) {
  test(`images replace, repeat unchanged, and disappear on a clean underlay, buffered=${buffered}`, async () => {
    const { renderOnce } = await setup()
    const red = NativeImage.fromRgba(Uint8Array.of(255, 0, 0, 255), 1, 1)
    const blue = NativeImage.fromRgba(Uint8Array.of(0, 0, 255, 128), 1, 1)
    try {
      const node = new ImageRenderable(renderer, { width: 2, height: 1, buffered, protocol: "blocks", source: red })
      renderer.root.add(node)
      await node.loadPromise
      await renderOnce()
      node.source = blue
      await node.loadPromise
      await renderOnce()
      const replaced = snapshot()
      const bg = renderer.currentRenderBuffer.buffers.bg
      expect(RGBA.fromArray(bg.slice(0, 4)).toInts()).toEqual([0, 0, 128, 255])
      for (let i = 0; i < 3; i++) {
        await renderOnce()
        expect(snapshot()).toEqual(replaced)
      }
      renderer.requestRender()
      await renderOnce()
      expect(snapshot()).toEqual(replaced)
      node.source = undefined
      await node.loadPromise
      await renderOnce()
      const removed = snapshot()
      await renderOnce()
      expect(snapshot()).toEqual(removed)
      expect(RGBA.fromArray(renderer.currentRenderBuffer.buffers.bg.slice(0, 4)).toInts()).toEqual([0, 0, 0, 255])
    } finally {
      red.dispose()
      blue.dispose()
    }
  })
}

for (const buffered of [false, true]) {
  test(`moving hooks run once and clear old rows, buffered=${buffered}`, async () => {
    const { renderOnce, captureCharFrame } = await setup()
    const node = new Painter(renderer, { left: 1, top: 1, width: 2, height: 1, buffered })
    let row = 0
    let hooks = 0
    node.renderBefore = function (buffer) {
      hooks++
      buffer.pushScissorRect(0, 0, 12, 6)
      this.translateY = row
      buffer.drawText("H", buffered ? 0 : this.screenX, buffered ? 0 : this.screenY, white, black)
      buffer.popScissorRect()
    }
    node.paint = (buffer) =>
      buffer.drawText("P", buffered ? 1 : node.screenX + 1, buffered ? 0 : node.screenY, white, black)
    renderer.root.add(node)
    for (; row < 3; row++) {
      node.requestRender()
      await renderOnce()
      expect(hooks).toBe(row + 1)
      expect(captureCharFrame().replace(/\s/g, "")).toBe("HP")
      expect(captureCharFrame().split("\n")[row + 1]?.slice(1, 3)).toBe("HP")
      expect(renderer.hitTest(1, row + 1)).toBe(node.num)
      if (row) expect(renderer.hitTest(1, row)).not.toBe(node.num)
    }
  })
}

for (const phase of ["renderSelf", "render"] as const) {
  for (const method of ["text", "cell", "box", "framebuffer"] as const) {
    test(`ordinary ${phase}/${method} stops at own bounds and leaves no residue`, async () => {
      const { renderOnce, captureCharFrame } = await setup()
      const source = OptimizedBuffer.create(4, 2, "unicode")
      const node = new Painter(renderer, { left: 2, top: 2, width: 2, height: 1 })
      source.drawText("ABCD", 0, 0, white, white)
      source.drawText("ABCD", 0, 1, white, white)
      let enabled = true
      const paint = (buffer: OptimizedBuffer) => {
        if (!enabled) return
        for (let y = 2; y < 4; y++) {
          if (method === "text") buffer.drawText("ABCD", 2, y, white, white)
          if (method === "cell") for (let x = 2; x < 6; x++) buffer.setCell(x, y, "A", white, white)
        }
        if (method === "box") buffer.fillRect(2, 2, 4, 2, white)
        if (method === "framebuffer") buffer.drawFrameBuffer(2, 2, source)
      }
      if (phase === "render") node.render = paint
      else node.paint = paint
      renderer.root.add(node)
      try {
        for (let i = 0; i < 2; i++) {
          node.requestRender()
          await renderOnce()
          for (let y = 0; y < 6; y++)
            for (let x = 0; x < 12; x++) {
              if (y === 2 && x >= 2 && x < 4) continue
              expect(renderer.currentRenderBuffer.buffers.char[y * 12 + x]).toBe(32)
              expect(renderer.currentRenderBuffer.buffers.bg[(y * 12 + x) * 4]).toBe(0)
            }
        }
        enabled = false
        node.requestRender()
        await renderOnce()
        expect(captureCharFrame().trim()).toBe("")
        const stopped = snapshot()
        await renderOnce()
        expect(snapshot()).toEqual(stopped)
      } finally {
        source.destroy()
      }
    })
  }
}

test("wide framebuffer copy cannot cross the command clip", async () => {
  const { renderOnce } = await setup()
  const source = OptimizedBuffer.create(2, 1, "unicode")
  source.drawText("\u754c", 0, 0, white, black)
  const node = new Painter(renderer, { left: 3, top: 2, width: 1, height: 1 })
  node.paint = (buffer) => buffer.drawFrameBuffer(3, 2, source)
  renderer.root.add(node)
  try {
    await renderOnce()
    expect(renderer.currentRenderBuffer.buffers.char[2 * 12 + 4]).toBe(32)
    node.paint = () => {}
    node.requestRender()
    await renderOnce()
    expect(renderer.currentRenderBuffer.buffers.char[2 * 12 + 3]).toBe(32)
  } finally {
    source.destroy()
  }
})

for (const operation of ["cached", "first-exposure", "clear", "matrix", "uniform"] as const) {
  test(`global ${operation} drawing uses full composition, including return to normal paint`, async () => {
    const { renderOnce, captureCharFrame } = await setup()
    const node = new Painter(renderer, { width: 1, height: 1 })
    let alias = operation === "cached" ? renderer.nextRenderBuffer.buffers.char : undefined
    const matrix = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    renderer.root.add(node)
    await renderOnce()
    node.paint = (buffer) => {
      if (operation === "cached" || operation === "first-exposure") {
        alias ??= buffer.buffers.char
        alias[4 * 12 + 10] = 88
      }
      if (operation === "clear") buffer.clear(white)
      if (operation === "matrix") buffer.colorMatrix(matrix, new Float32Array([10, 4, 1]))
      if (operation === "uniform") buffer.colorMatrixUniform(matrix)
    }
    node.requestRender()
    await renderOnce()
    const painted = snapshot()
    await renderOnce()
    expect(snapshot()).toEqual(painted)
    node.paint = (buffer) => buffer.setCell(0, 0, "N", white, black)
    node.requestRender()
    await renderOnce()
    expect(captureCharFrame().replace(/\s/g, "")).toBe("N")
    expect(renderer.currentRenderBuffer.buffers.bg[(4 * 12 + 10) * 4]).toBe(0)
    const clean = snapshot()
    await renderOnce()
    expect(snapshot()).toEqual(clean)
  })
}

test("ancestor and custom scissors intersect without clipping overflowing children to their parent", async () => {
  const { renderOnce, captureCharFrame } = await setup()
  const outer = new BoxRenderable(renderer, { width: 10, height: 6, overflow: "hidden" })
  const parent = new BoxRenderable(renderer, { width: 1, height: 1, overflow: "visible" })
  const child = new Painter(renderer, { left: 8, top: 3, width: 4, height: 1 })
  child.paint = (buffer) => {
    buffer.pushScissorRect(9, 0, 3, 6)
    try {
      buffer.drawText("ABCD", child.screenX, child.screenY, white, black)
    } finally {
      buffer.popScissorRect()
    }
  }
  parent.add(child)
  outer.add(parent)
  renderer.root.add(outer)
  await renderOnce()
  expect(captureCharFrame().replace(/\s/g, "")).toBe("B")
})
