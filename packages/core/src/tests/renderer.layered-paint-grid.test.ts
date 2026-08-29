import { expect, spyOn, test } from "bun:test"
import { Renderable, type RenderableOptions } from "../Renderable.js"
import { OptimizedBuffer } from "../buffer.js"
import { RGBA } from "../lib/RGBA.js"
import { createTestRenderer } from "../testing.js"
import type { RenderContext } from "../types.js"
import { CliRenderEvents } from "../renderer.js"
import { TextRenderable } from "../renderables/Text.js"
import { NativeImage } from "../image.js"

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

test("paint grid full-paint bursts recover useful skipping with exact output and single callbacks", async () => {
  async function run(experimentalPaintGrid: boolean) {
    const { renderer, renderOnce, resize } = await createTestRenderer({ width: 14, height: 4, experimentalPaintGrid })
    let value = "A"
    let effect = false
    const lower = new Paint(renderer, { width: 1, height: 1 }, (buffer, self) => {
      buffer.drawText(value, self.x + 4, 2, white, blue)
    })
    const upper = new Paint(renderer, { width: 1, height: 1, position: "absolute" }, (buffer) => {
      buffer.drawText("!", 5, 2, white)
      if (effect) buffer.colorMatrixUniform(new Float32Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
    })
    const frames = []
    const skipped = []
    try {
      renderer.root.add(lower)
      renderer.root.add(upper)
      for (let frame = 0; frame < 34; frame++) {
        if (frame >= 4 && frame <= 7) {
          value = String(frame)
          renderer.requestRender()
        }
        if (frame >= 11 && frame <= 14) lower.translateX = frame % 3
        if (frame === 18) resize(16, 5)
        if (frame === 24 || frame === 26) {
          effect = frame === 24
          upper.requestRender()
        }
        if (frame === 30) {
          value = "Z"
          lower.requestRender()
        }
        const before = [lower.calls, upper.calls]
        await renderOnce()
        expect(lower.calls - before[0]).toBeLessThanOrEqual(1)
        expect(upper.calls - before[1]).toBeLessThanOrEqual(1)
        if (frame >= 4 && frame <= 7) {
          expect(lower.calls - before[0]).toBe(1)
          expect(upper.calls - before[1]).toBe(1)
        }
        frames.push(snapshot(renderer.currentRenderBuffer))
        skipped.push(renderer.nextRenderBuffer.getPaintStats().skipped)
      }
      return { frames, skipped }
    } finally {
      renderer.destroy()
    }
  }
  const full = await run(false)
  const grid = await run(true)
  expect(grid.frames).toEqual(full.frames)
  for (const frame of [3, 10, 17, 23, 29, 33]) expect(grid.skipped[frame], `frame ${frame}`).toBeGreaterThan(0)
})

test("paint grid matches full rendering across unchanged, overlapping, moved and removed custom paint", async () => {
  async function run(experimentalPaintGrid: boolean) {
    const setup = await createTestRenderer({ width: 14, height: 4, experimentalPaintGrid })
    const { renderer, renderOnce } = setup
    let content = "lower"
    const lower = new Paint(renderer, { width: 1, height: 1 }, (buffer, self) => {
      buffer.drawText(content, self.x + 4, self.y + 2, white, blue)
    })
    const upper = new Paint(renderer, { width: 1, height: 1, position: "absolute" }, (buffer) => {
      buffer.fillRect(4, 2, 5, 1, translucent)
      buffer.drawText("!", 6, 2, white)
      buffer.fillRect(6, 2, 1, 1, translucent)
    })
    const frames: ReturnType<typeof snapshot>[] = []
    const counts: number[][] = []
    const stats: ReturnType<OptimizedBuffer["getPaintStats"]>[] = []
    async function frame() {
      await renderOnce()
      frames.push(snapshot(renderer.currentRenderBuffer))
      counts.push([lower.calls, upper.calls])
      stats.push(renderer.nextRenderBuffer.getPaintStats())
    }
    try {
      renderer.root.add(lower)
      renderer.root.add(upper)
      await frame()
      await frame()
      content = "other"
      lower.requestRender()
      await frame()
      renderer.root.remove(upper)
      await frame()
      lower.translateX = 2
      await frame()
      renderer.root.remove(lower)
      await frame()
      return { frames, counts, stats }
    } finally {
      lower.destroy()
      upper.destroy()
      renderer.destroy()
    }
  }
  const full = await run(false)
  const grid = await run(true)
  expect(grid.frames).toEqual(full.frames)
  expect(full.counts.slice(0, 3)).toEqual([
    [1, 1],
    [2, 2],
    [3, 3],
  ])
  expect(grid.counts.slice(0, 3)).toEqual([
    [1, 1],
    [1, 1],
    [2, 1],
  ])
  expect(grid.stats[1].recomposed).toBe(0)
  expect(grid.stats[2].recomposed).toBe(3)
  expect(grid.stats.slice(0, 3).every((frame) => frame.fallback === 0)).toBe(true)
})

test("paint grid skips text overrides but preserves hit targets and generic invalidation", async () => {
  const { renderer, renderOnce, mockMouse } = await createTestRenderer({
    width: 14,
    height: 4,
    experimentalPaintGrid: true,
  })
  let clicks = 0
  const text = new TextRenderable(renderer, { width: 5, height: 1, content: "hello", onMouseDown: () => clicks++ })
  let value = "A"
  const custom = new Paint(renderer, { width: 1, height: 1 }, (buffer) => buffer.drawText(value, 7, 2, white, blue))
  try {
    renderer.root.add(text)
    renderer.root.add(custom)
    await renderOnce()
    const first = snapshot(renderer.currentRenderBuffer)
    await renderOnce()
    expect(renderer.nextRenderBuffer.getPaintStats().skipped).toBe(2)
    expect(custom.calls).toBe(1)
    expect(snapshot(renderer.currentRenderBuffer)).toEqual(first)
    await mockMouse.click(1, 0)
    expect(clicks).toBe(1)
    value = "B"
    renderer.requestRender()
    await renderOnce()
    expect(renderer.currentRenderBuffer.buffers.char[2 * 14 + 7]).toBe("B".charCodeAt(0))
  } finally {
    renderer.destroy()
  }
})

test("paint grid preserves hooks and clears failed native stacks without losing error identity", async () => {
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
    width: 8,
    height: 3,
    experimentalPaintGrid: true,
  })
  const order: string[] = []
  let fail = false
  const painter = new Paint(
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
        buffer.drawText("C", 4, 0, white, blue)
      },
    },
    (buffer) => {
      order.push("self")
      if (fail) {
        buffer.pushScissorRect(0, 0, 1, 1)
        buffer.pushOpacity(0.1)
        throw new Error("layer failure")
      }
      buffer.drawText("B", 4, 0, white, blue)
    },
  )
  let failed: Renderable | undefined
  renderer.on(CliRenderEvents.RENDER_ERROR, (event) => {
    failed = event.renderable
  })
  try {
    renderer.root.add(painter)
    await renderOnce()
    await renderOnce()
    expect(order).toEqual(["before", "self", "after", "before", "self", "after"])
    expect(captureCharFrame().split("\n")[0]).toBe("    C   ")
    fail = true
    painter.requestRender()
    await renderOnce()
    expect(failed).toBe(painter)
    fail = false
    await renderOnce()
    expect(captureCharFrame().split("\n")[0]).toBe("    C   ")
    expect(renderer.nextRenderBuffer.getCurrentOpacity()).toBe(1)
  } finally {
    renderer.destroy()
  }
})

test("paint grid falls back for late retained raw views without invoking painters twice", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ width: 8, height: 2, experimentalPaintGrid: true })
  let expose = false
  let raw: Uint32Array | undefined
  const lower = new Paint(renderer, { width: 1, height: 1 }, (buffer) => buffer.drawText("ABC", 0, 0, white, blue))
  const upper = new Paint(renderer, { width: 1, height: 1 }, (buffer) => {
    buffer.drawText("D", 3, 0, white, blue)
    if (expose) {
      raw ??= buffer.buffers.char
      // A later full-paint decision must not reclassify unsupported access.
      buffer.fallbackPaint()
      expect([...raw.slice(0, 4)]).toEqual([65, 66, 67, 68])
      raw[4] = 69
    }
  })
  try {
    renderer.root.add(lower)
    renderer.root.add(upper)
    await renderOnce()
    const retained = renderer.nextRenderBuffer.getPaintStats().retainedBytes
    expose = true
    upper.requestRender()
    await renderOnce()
    expect([lower.calls, upper.calls]).toEqual([1, 2])
    expect(renderer.nextRenderBuffer.getPaintStats().fallback).toBe(1)
    expect(renderer.nextRenderBuffer.getPaintStats().retainedBytes).toBeLessThan(retained)
    await renderOnce()
    expect([lower.calls, upper.calls]).toEqual([2, 3])
    expect([...renderer.currentRenderBuffer.buffers.char.slice(0, 5)]).toEqual([65, 66, 67, 68, 69])
  } finally {
    renderer.destroy()
  }
})

test("paint grid retries a rejected frame, resizes, and changes background coherently", async () => {
  const { renderer, renderOnce, resize, captureCharFrame } = await createTestRenderer({
    width: 8,
    height: 2,
    experimentalPaintGrid: true,
  })
  const painter = new Paint(renderer, { width: 1, height: 1 }, (buffer) => buffer.drawText("test", 2, 0, white))
  const lib = renderer.nextRenderBuffer.lib
  const render = lib.render.bind(lib)
  let reject = false
  const nativeRender = spyOn(lib, "render").mockImplementation((handle, force) => {
    if (reject) {
      reject = false
      return 1
    }
    return render(handle, force)
  })
  try {
    renderer.root.add(painter)
    await renderOnce()
    reject = true
    await renderOnce()
    await renderOnce()
    expect(captureCharFrame().split("\n")[0]).toBe("  test  ")
    expect(painter.calls).toBe(2)
    resize(12, 3)
    renderer.setBackgroundColor(blue)
    await renderOnce()
    expect(captureCharFrame().split("\n")[0]).toBe("  test      ")
    expect([...renderer.currentRenderBuffer.buffers.bg.slice(0, 4)]).toEqual([...blue.buffer])
    for (let frame = 0; frame < 4; frame++) await renderOnce()
    expect(captureCharFrame().split("\n")[0]).toBe("  test      ")
    expect(renderer.nextRenderBuffer.getPaintStats().skipped).toBe(1)
  } finally {
    nativeRender.mockRestore()
    renderer.destroy()
  }
})

test("paint grid detects images, effects and arbitrary callbacks as full rendering", async () => {
  for (const path of ["image", "effect", "frame", "post"] as const) {
    async function run(experimentalPaintGrid: boolean) {
      const { renderer, renderOnce } = await createTestRenderer({ width: 8, height: 2, experimentalPaintGrid })
      const image = NativeImage.fromRgba(new Uint8Array([255, 0, 0, 255]), 1, 1)
      const painter = new Paint(renderer, { width: 1, height: 1 }, (buffer) => {
        buffer.drawText("ABC", 1, 0, white, blue)
        if (path === "image") buffer.drawImage(image, 5, 0, 1, 1)
        if (path === "effect")
          buffer.colorMatrixUniform(new Float32Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
      })
      let callbacks = 0
      if (path === "frame")
        renderer.setFrameCallback(async () => {
          callbacks++
        })
      if (path === "post")
        renderer.addPostProcessFn((buffer) => {
          callbacks++
          buffer.drawText("Z", 0, 0, white, blue)
        })
      try {
        renderer.root.add(painter)
        await renderOnce()
        await renderOnce()
        return {
          frame: snapshot(renderer.currentRenderBuffer),
          calls: painter.calls,
          callbacks,
          stats: renderer.nextRenderBuffer.getPaintStats(),
        }
      } finally {
        renderer.destroy()
        image.dispose()
      }
    }
    const full = await run(false)
    const grid = await run(true)
    expect(grid.frame).toEqual(full.frame)
    expect(grid.calls).toBe(2)
    expect(grid.callbacks).toBe(full.callbacks)
    expect(grid.stats.fallback).toBe(1)
  }
})

test("paint grid explicit clears and mutable offscreen samples remain observable", async () => {
  async function run(experimentalPaintGrid: boolean) {
    const { renderer, renderOnce } = await createTestRenderer({ width: 8, height: 3, experimentalPaintGrid })
    const source = OptimizedBuffer.create(2, 1, "unicode")
    source.drawText("XY", 0, 0, white, blue)
    let clear = false
    const lower = new Paint(renderer, { width: 1, height: 1 }, (buffer) => buffer.drawText("abc", 3, 2, white, blue))
    const upper = new Paint(renderer, { width: 1, height: 1 }, (buffer) => {
      if (clear) buffer.clear(red)
      buffer.drawFrameBuffer(4, 1, source)
    })
    const frames: ReturnType<typeof snapshot>[] = []
    try {
      renderer.root.add(lower)
      renderer.root.add(upper)
      for (let frame = 0; frame < 4; frame++) {
        if (frame === 1) source.drawText("ZZ", 0, 0, red, blue)
        if (frame === 2) {
          clear = true
          upper.requestRender()
        }
        if (frame === 3) renderer.root.remove(upper)
        await renderOnce()
        frames.push(snapshot(renderer.currentRenderBuffer))
      }
      for (let frame = 0; frame < 3; frame++) {
        await renderOnce()
        expect(snapshot(renderer.currentRenderBuffer)).toEqual(frames[3])
      }
      expect(renderer.nextRenderBuffer.getPaintStats().fallback).toBe(0)
      return frames
    } finally {
      upper.destroy()
      renderer.destroy()
      source.destroy()
    }
  }
  expect(await run(true)).toEqual(await run(false))
})

test("paint grid target readback materializes the current prefix and resumes after effects disappear", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ width: 8, height: 2, experimentalPaintGrid: true })
  const copy = OptimizedBuffer.create(8, 2, "unicode")
  let readback = false
  let effect = false
  const lower = new Paint(renderer, { width: 1, height: 1 }, (buffer) => buffer.drawText("ABC", 0, 0, white, blue))
  const upper = new Paint(renderer, { width: 1, height: 1 }, (buffer) => {
    if (readback) {
      copy.drawFrameBuffer(0, 0, buffer)
      expect([...copy.buffers.char.slice(0, 3)]).toEqual([65, 66, 67])
    }
    if (effect) buffer.colorMatrixUniform(new Float32Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
  })
  try {
    renderer.root.add(lower)
    renderer.root.add(upper)
    await renderOnce()
    readback = true
    upper.requestRender()
    await renderOnce()
    expect(renderer.nextRenderBuffer.getPaintStats().fallback).toBe(1)
    readback = false
    effect = true
    upper.requestRender()
    await renderOnce()
    expect(renderer.nextRenderBuffer.getPaintStats().fallback).toBe(1)
    effect = false
    upper.requestRender()
    await renderOnce()
    await renderOnce()
    await renderOnce()
    expect(renderer.nextRenderBuffer.getPaintStats().skipped).toBe(2)
    expect([...renderer.currentRenderBuffer.buffers.char.slice(0, 3)]).toEqual([65, 66, 67])
  } finally {
    renderer.destroy()
    copy.destroy()
  }
})

test("paint grid raw fallback preserves writes made between frames", async () => {
  async function run(experimentalPaintGrid: boolean) {
    const { renderer, renderOnce } = await createTestRenderer({ width: 8, height: 2, experimentalPaintGrid })
    const painter = new Paint(renderer, { width: 1, height: 1 }, (buffer) => buffer.drawText("A", 0, 0, white, blue))
    try {
      renderer.root.add(painter)
      await renderOnce()
      const raw = renderer.nextRenderBuffer.buffers.char
      const before = [...raw]
      raw[14] = 90
      await renderOnce()
      const first = snapshot(renderer.currentRenderBuffer)
      raw[14] = 89
      await renderOnce()
      return { before, first, second: snapshot(renderer.currentRenderBuffer) }
    } finally {
      renderer.destroy()
    }
  }
  const reference = await run(false)
  expect(await run(true)).toEqual(reference)
})

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
