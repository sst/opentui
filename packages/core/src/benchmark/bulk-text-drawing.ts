import { Buffer } from "node:buffer"
import { Renderable, type RenderableOptions } from "../Renderable.js"
import { TextRenderable } from "../renderables/Text.js"
import { BoxRenderable } from "../renderables/Box.js"
import { ScrollBoxRenderable } from "../renderables/ScrollBox.js"
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
  "scrollbox",
] as const
type Workload = (typeof workloads)[number]
const width = Number(process.env.PAINT_WIDTH ?? 120)
const height = Number(process.env.PAINT_HEIGHT ?? 40)
const overlapDepth = Number(process.env.PAINT_DEPTH ?? 1)
const repeats = Number(process.env.PAINT_REPEATS ?? 5)
const frameCount = Number(process.env.PAINT_FRAMES ?? 100)

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

async function scene(workload: Workload) {
  const setup = await createTestRenderer({ width, height })
  const { renderer } = setup
  const parent =
    workload === "scrollbox"
      ? new ScrollBoxRenderable(renderer, {
          width,
          height,
          position: "absolute",
          contentOptions: { height: height * 2 },
        })
      : new BoxRenderable(renderer, { width, height, position: "absolute" })
  renderer.root.add(parent)
  const nodes: (Text | Paint)[] = []
  for (let i = 0; i < height * 2; i++) {
    const left = workload === "scrollbox" ? 0 : Math.floor(i / height) * (width / 2)
    const top = workload === "scrollbox" ? i : i % height
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
    for (let i = 0; i < height * 2 * overlapDepth; i++) {
      const node = new Paint(
        renderer,
        {
          position: "absolute",
          left: Math.floor((i % (height * 2)) / height) * (width / 2),
          top: i % height,
          width: 1,
          height: 1,
        },
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
      if (image) buffer.drawImage(image, width - 5, height - 1, 1, 1)
      else {
        raw ??= buffer.buffers.char
        raw[(height - 1) * width + width - 5] = 88
      }
    })
    nodes.push(node)
    parent.add(node)
  }
  function mutate(frame: number) {
    if (parent instanceof ScrollBoxRenderable) parent.scrollTo(frame % height)
    else if (workload === "layout-move") parent.translateX = frame % 3
    else if (workload === "generic-request") renderer.requestRender()
    else if (workload === "localized-text" || workload === "transparent-outside" || workload === "all-changed") {
      const count = workload === "all-changed" ? height * 2 : 1
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
    calls: () => nodes.reduce((sum, node) => sum + node.calls, 0),
    destroy() {
      renderer.destroy()
      image?.dispose()
    },
  }
}

const selected = process.env.WORKLOAD ? [process.env.WORKLOAD as Workload] : workloads
const diagnostics = process.env.DIAGNOSTICS === "1"
const snapshots = process.env.SNAPSHOTS === "1"
const samples: any[] = []
const jsc = diagnostics ? await import("bun:jsc") : null
for (let repeat = 0; repeat < repeats; repeat++)
  for (const workload of selected) {
    const app = await scene(workload)
    const lib = app.renderer.nextRenderBuffer.lib
    const build = lib.getBuildOptions()
    if (!diagnostics && (build.gpaSafeStats || build.gpaMemoryLimitTracking)) throw new Error("instrumented CPU build")
    const memory = () =>
      diagnostics
        ? {
            allocator: lib.getAllocatorStats(),
            arena: lib.getArenaAllocatedBytes(),
            heap: jsc!.heapStats(),
            rss: process.memoryUsage().rss,
          }
        : undefined
    const created = memory()
    const times = new Float64Array(frameCount + 28)
    const frames: any[] = []
    const callsBefore = app.calls()
    for (let frame = 0; frame < times.length; frame++) {
      const start = performance.now()
      if (frame >= 3 && frame <= 10) app.mutate(frame)
      if (frame === 16) app.renderer.requestRender()
      if (frame === 22) {
        const node = app.nodes[0]
        if (node instanceof Text) node.content = "localized recovery"
        else {
          node.value++
          node.requestRender()
        }
      }
      if (frame >= 28) app.mutate(frame)
      await app.renderOnce()
      times[frame] = performance.now() - start
      if (snapshots)
        frames.push(
          snapshot(app.renderer.nextRenderBuffer).map((b) => new Bun.CryptoHasher("sha256").update(b).digest("hex")),
        )
    }
    const rendered = memory()
    const calls = app.calls() - callsBefore
    app.destroy()
    const destroyed = memory()
    const warm = Array.from(times.slice(28)).sort((a, b) => a - b)
    samples.push({
      repeat,
      workload,
      calls,
      times: Array.from(times),
      build,
      frames,
      cold: times[0],
      mixed: times.slice(0, 28).reduce((a, b) => a + b, 0),
      warm: {
        mean: warm.reduce((a, b) => a + b, 0) / warm.length,
        p50: warm[Math.floor(warm.length / 2)],
        min: warm[0],
        max: warm.at(-1),
      },
      memory: { created, rendered, destroyed },
    })
  }
await Bun.write(
  Bun.stdout,
  JSON.stringify({ dimensions: [width, height], overlapDepth, diagnostics, snapshots, samples }) + "\n",
)
