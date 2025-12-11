import { afterEach, describe, expect, test } from "bun:test"
import { ImageRenderable } from "../renderables/Image"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import type { GraphicsSupport } from "../graphics/protocol"

describe("renderer image support", () => {
  let renderer: TestRenderer | null = null
  let renderOnce: (() => Promise<void>) | null = null
  let captureCharFrame: (() => string) | null = null

  afterEach(() => {
    if (renderer) {
      renderer.destroy()
      renderer = null
    }
  })

  test("flushes kitty image sequences", async () => {
    const setup = await createTestRenderer({ width: 20, height: 10 })
    renderer = setup.renderer
    renderOnce = setup.renderOnce
    captureCharFrame = setup.captureCharFrame

    const writes: string[] = []
    const testHarness = renderer as unknown as {
      writeOut: (chunk: string) => boolean
      loadImage: (src: Buffer, width: number, height: number, fit: string) => Promise<Buffer | null>
      _graphicsSupport: GraphicsSupport
    }

    testHarness.writeOut = (chunk: string) => {
      writes.push(chunk)
      return true
    }
    testHarness.loadImage = async () => Buffer.from("img")
    testHarness._graphicsSupport = { protocol: "kitty" }

    const image = new ImageRenderable(renderer, {
      src: Buffer.from("img"),
      width: 2,
      height: 3,
      left: 1,
      top: 1,
    })
    renderer.root.add(image)

    await renderOnce!()

    const expected = `\u001b[2;2H` + `\u001b_Gf=100,a=T,s=2,v=3,i=1;${Buffer.from("img").toString("base64")}\u001b\\`
    expect(writes).toContain(expected)
  })

  test("renders alt text when graphics are disabled", async () => {
    const setup = await createTestRenderer({ width: 20, height: 6 })
    renderer = setup.renderer
    renderOnce = setup.renderOnce
    captureCharFrame = setup.captureCharFrame

    const testHarness = renderer as unknown as { _graphicsSupport: GraphicsSupport }
    testHarness._graphicsSupport = { protocol: "none" }

    const image = new ImageRenderable(renderer, { alt: "Logo", width: 10, height: 2, left: 0, top: 0 })
    renderer.root.add(image)

    await renderOnce!()

    const frame = captureCharFrame!()
    expect(frame).toContain("Logo")
  })
})
