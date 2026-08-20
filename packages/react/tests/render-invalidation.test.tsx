import { afterEach, expect, test } from "bun:test"
import { OptimizedBuffer, Renderable, RGBA, type RenderableOptions, type RenderContext } from "@opentui/core"
import { act, useState } from "react"
import { extend } from "../src/index.js"
import { testRender } from "../src/test-utils.js"

const fg = RGBA.fromInts(240, 240, 240, 255)
const bg = RGBA.fromInts(20, 24, 30, 255)

class PlainGlyphRenderable extends Renderable {
  public static instances = new Map<string, PlainGlyphRenderable>()
  public glyph: string
  public paintCount = 0

  constructor(ctx: RenderContext, options: RenderableOptions & { glyph?: string }) {
    super(ctx, { ...options, paintBounds: "layout" })
    this.glyph = options.glyph ?? " "
    PlainGlyphRenderable.instances.set(this.id, this)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    this.paintCount += 1
    buffer.setCell(this._screenX, this._screenY, this.glyph, fg, bg)
  }
}

declare module "../src/types/components.js" {
  interface OpenTUIComponents {
    "plain-glyph": typeof PlainGlyphRenderable
  }
}

extend({ "plain-glyph": PlainGlyphRenderable })

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(async () => {
  if (testSetup) await act(async () => testSetup?.renderer.destroy())
  testSetup = undefined
  PlainGlyphRenderable.instances.clear()
})

test("React schedules an incremental frame for a changed plain custom property", async () => {
  let setGlyph: ((value: string) => void) | undefined

  function App() {
    const [glyph, updateGlyph] = useState("A")
    setGlyph = updateGlyph
    return (
      <>
        <plain-glyph
          id="changing-glyph"
          glyph={glyph}
          style={{ width: 1, height: 1, position: "absolute", left: 0, top: 0 }}
        />
        <plain-glyph
          id="static-glyph"
          glyph="S"
          style={{ width: 1, height: 1, position: "absolute", left: 0, top: 1 }}
        />
      </>
    )
  }

  testSetup = await testRender(<App />, { width: 4, height: 2, useThread: false })
  await testSetup.waitForFrame((frame) => frame.includes("A"))
  const changing = PlainGlyphRenderable.instances.get("changing-glyph")!
  const staticNode = PlainGlyphRenderable.instances.get("static-glyph")!
  expect(changing.screenY).not.toBe(staticNode.screenY)
  const changingPaintsBefore = changing.paintCount
  const staticPaintsBefore = staticNode.paintCount

  await act(async () => setGlyph?.("B"))

  await testSetup.waitForFrame((frame) => frame.includes("B"))
  expect(testSetup.captureCharFrame()).toContain("B")
  expect(changing.paintCount).toBe(changingPaintsBefore + 1)
  expect(staticNode.paintCount).toBe(staticPaintsBefore)
})
