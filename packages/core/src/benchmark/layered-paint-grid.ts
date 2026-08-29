// Run after the root ReleaseFast build:
// bun src/benchmark/layered-paint-grid.ts > results.json
// --off-only also runs against corrected full-render commit e14c2d6a.
import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { Renderable, type RenderableOptions } from "../Renderable.js"
import { TextRenderable } from "../renderables/Text.js"
import { BoxRenderable } from "../renderables/Box.js"
import { OptimizedBuffer } from "../buffer.js"
import { NativeImage } from "../image.js"
import { RGBA } from "../lib/RGBA.js"
import { createTestRenderer } from "../testing.js"
import type { RenderContext } from "../types.js"

const white = RGBA.fromInts(225, 230, 240)
const blue = RGBA.fromInts(20, 40, 90)
const changedForeground = RGBA.fromInts(255, 100, 100)
const overlay = RGBA.fromInts(200, 60, 20, 90)
const workloads = [
  "unchanged",
  "localized-text",
  "transparent-outside",
  "layout-move",
  "all-changed",
  "generic-request",
  "raw-fallback",
  "image-fallback",
] as const
type Workload = (typeof workloads)[number]

class Text extends TextRenderable {
  calls = 0
  override render(buffer: OptimizedBuffer, delta: number) {
    this.calls++
    super.render(buffer, delta)
  }
}

class Paint extends Renderable {
  calls = 0
  value = 0
  constructor(
    ctx: RenderContext,
    options: RenderableOptions,
    private paint: (buffer: OptimizedBuffer, self: Paint) => void,
  ) {
    super(ctx, options)
  }
  protected renderSelf(buffer: OptimizedBuffer) {
    this.calls++
    this.paint(buffer, this)
  }
}

function snapshot(buffer: OptimizedBuffer) {
  return Object.values(buffer.buffers).map((view) =>
    Buffer.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
  )
}

async function scene(workload: Workload, enabled: boolean) {
  const setup = await createTestRenderer({ width: 120, height: 40, experimentalPaintGrid: enabled })
  const { renderer } = setup
  const parent = new BoxRenderable(renderer, { width: 120, height: 40, position: "absolute" })
  renderer.root.add(parent)
  const nodes: (Text | Paint)[] = []
  for (let i = 0; i < 80; i++) {
    const left = Math.floor(i / 40) * 60
    const top = i % 40
    const node =
      workload === "transparent-outside"
        ? new Paint(renderer, { position: "absolute", left, top, width: 1, height: 1 }, (buffer, self) => {
            buffer.fillRect(self.x + 3, self.y, 52, 1, self.value % 2 ? overlay : blue)
            buffer.drawText(`ordinary custom paint ${self.value % 10}`, self.x + 5, self.y, white)
            buffer.fillRect(self.x + 10, self.y, 15, 1, overlay)
          })
        : new Text(renderer, {
            position: "absolute",
            left,
            top,
            width: 58,
            height: 1,
            content: `row ${i.toString().padStart(2, "0")} | retained cells and normal text rendering`,
            fg: white,
            bg: blue,
          })
    nodes.push(node)
    parent.add(node)
  }
  const image =
    workload === "image-fallback" ? NativeImage.fromRgba(new Uint8Array([220, 40, 50, 255]), 1, 1) : undefined
  if (workload === "transparent-outside") {
    for (let i = 0; i < 80; i++) {
      const node = new Paint(
        renderer,
        { position: "absolute", left: Math.floor(i / 40) * 60, top: i % 40, width: 1, height: 1 },
        (buffer, self) => {
          buffer.fillRect(self.x + 12, self.y, 15, 1, overlay)
          buffer.drawText("!", self.x + 18, self.y, white)
        },
      )
      nodes.push(node)
      parent.add(node)
    }
  }
  if (workload === "raw-fallback" || image) {
    let raw: Uint32Array | undefined
    const node = new Paint(renderer, { width: 1, height: 1, position: "absolute" }, (buffer) => {
      if (image) buffer.drawImage(image, 115, 39, 1, 1)
      else {
        raw ??= buffer.buffers.char
        raw[39 * 120 + 115] = 88
      }
    })
    nodes.push(node)
    parent.add(node)
  }
  let compositionMs = 0
  const render = renderer.root.render.bind(renderer.root)
  renderer.root.render = (buffer, delta) => {
    const start = performance.now()
    try {
      render(buffer, delta)
    } finally {
      compositionMs += performance.now() - start
    }
  }
  if (enabled) {
    const end = renderer.nextRenderBuffer.endPaint.bind(renderer.nextRenderBuffer)
    renderer.nextRenderBuffer.endPaint = (abort) => {
      const start = performance.now()
      try {
        end(abort)
      } finally {
        compositionMs += performance.now() - start
      }
    }
  }
  function mutate(frame: number) {
    if (workload === "layout-move") parent.translateX = frame % 3
    else if (workload === "generic-request") renderer.requestRender()
    else if (workload === "localized-text" || workload === "transparent-outside" || workload === "all-changed") {
      const count = workload === "all-changed" ? 80 : 1
      for (let i = 0; i < count; i++) {
        const node = nodes[i]
        if (node instanceof Text) {
          node.content = `update ${frame % 10} | retained cells and normal text rendering`
          if (workload === "all-changed") node.fg = frame % 2 ? white : changedForeground
        } else {
          node.value = frame
          node.requestRender()
        }
      }
    }
  }
  return {
    ...setup,
    nodes,
    mutate,
    composition: () => compositionMs,
    calls: () => nodes.reduce((sum, node) => sum + node.calls, 0),
    destroy() {
      renderer.destroy()
      image?.dispose()
    },
  }
}

const offOnly = process.argv.includes("--off-only")
const memoryOnly = process.argv.includes("--memory-only")
if (!offOnly && !memoryOnly) {
  for (const workload of workloads) {
    const full = await scene(workload, false)
    const grid = await scene(workload, true)
    try {
      for (let frame = 0; frame < 12; frame++) {
        full.mutate(frame)
        grid.mutate(frame)
        await full.renderOnce()
        await grid.renderOnce()
        const reference = snapshot(full.renderer.currentRenderBuffer)
        const actual = snapshot(grid.renderer.currentRenderBuffer)
        for (let channel = 0; channel < 4; channel++)
          assert(actual[channel].equals(reference[channel]), `${workload}: frame ${frame}, channel ${channel}`)
      }
    } finally {
      full.destroy()
      grid.destroy()
    }
  }
}

const samples = []
for (let repeat = 0; repeat < (memoryOnly ? 1 : 5); repeat++) {
  for (const workload of workloads) {
    for (const enabled of offOnly ? [false] : repeat % 2 ? [true, false] : [false, true]) {
      const app = await scene(workload, enabled)
      try {
        const before = app.renderer.nextRenderBuffer.lib.getAllocatorStats()
        let start = performance.now()
        await app.renderOnce()
        const coldMs = performance.now() - start
        const coldCompositionMs = app.composition()
        const coldStats = enabled ? app.renderer.nextRenderBuffer.getPaintStats() : null
        const coldAllocator = app.renderer.nextRenderBuffer.lib.getAllocatorStats()
        for (let frame = 0; frame < 20; frame++) {
          app.mutate(frame)
          await app.renderOnce()
        }
        const initialCalls = app.calls()
        const initialComposition = app.composition()
        const frames = memoryOnly ? 3 : 100
        const times: number[] = []
        let fallbackFrames = 0
        for (let frame = 20; frame < frames + 20; frame++) {
          start = performance.now()
          app.mutate(frame)
          await app.renderOnce()
          times.push(performance.now() - start)
          if (enabled) fallbackFrames += app.renderer.nextRenderBuffer.getPaintStats().fallback
        }
        const after = app.renderer.nextRenderBuffer.lib.getAllocatorStats()
        samples.push({
          workload,
          enabled,
          repeat,
          coldMs,
          coldCompositionMs,
          coldStats,
          frameMs: times.reduce((a, b) => a + b, 0) / frames,
          compositionMs: (app.composition() - initialComposition) / frames,
          callsPerFrame: (app.calls() - initialCalls) / frames,
          fallbackFrames,
          stats: enabled ? app.renderer.nextRenderBuffer.getPaintStats() : null,
          nativeActiveAllocationDelta: after.activeAllocations - before.activeAllocations,
          nativeColdAllocationDelta: coldAllocator.activeAllocations - before.activeAllocations,
          nativeColdRequestedByteDelta:
            coldAllocator.requestedBytesValid && before.requestedBytesValid
              ? coldAllocator.totalRequestedBytes - before.totalRequestedBytes
              : null,
          nativeRequestedByteDelta:
            after.requestedBytesValid && before.requestedBytesValid
              ? after.totalRequestedBytes - before.totalRequestedBytes
              : null,
          nativeBuildOptions: app.renderer.nextRenderBuffer.lib.getBuildOptions(),
          times,
        })
      } finally {
        app.destroy()
      }
    }
  }
}
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      bun: Bun.version,
      dimensions: [120, 40],
      frames: memoryOnly ? 3 : 100,
      repeats: memoryOnly ? 1 : 5,
      parity: offOnly
        ? "off-only control"
        : memoryOnly
          ? "memory instrumentation only"
          : "96 paired frames, exact four-channel bytes",
      samples,
    },
    null,
    2,
  ),
)
