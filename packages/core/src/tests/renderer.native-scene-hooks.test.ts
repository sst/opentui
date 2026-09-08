import { afterEach, expect, spyOn, test } from "bun:test"
import { NativeScene } from "../NativeScene.js"
import { getYogaNode } from "../lib/renderable-layout.js"
import { Renderable } from "../Renderable.js"
import { RGBA } from "../lib/RGBA.js"
import { BoxRenderable } from "../renderables/Box.js"
import { TextRenderable } from "../renderables/Text.js"
import { ManualClock } from "../testing/manual-clock.js"
import { createTestRenderer, type TestRendererSetup } from "../testing/test-renderer.js"

const setups: TestRendererSetup[] = []
afterEach(async () => {
  for (const { renderer } of setups.splice(0)) {
    renderer.destroy()
    await renderer.closed
  }
})

async function setup() {
  const result = await createTestRenderer({ width: 12, height: 4, clock: new ManualClock(), maxFps: 1000 })
  setups.push(result)
  return result
}

const hookNames = ["selectable", "onLifecyclePass", "renderBefore", "renderAfter"] as const

test("box and text keep hook accessors on the prototype", async () => {
  const { renderer } = await setup()
  const box = new BoxRenderable(renderer, { width: 2, height: 1 })
  const text = new TextRenderable(renderer, { content: "hi", width: 2, height: 1 })

  for (const name of hookNames) {
    expect(Object.hasOwn(box, name)).toBe(false)
    expect(Object.hasOwn(text, name)).toBe(false)
    expect(Object.getOwnPropertyDescriptor(Renderable.prototype, name)?.get).toBeTypeOf("function")
  }

  expect(getYogaNode(box)).toBe(box)
  expect(getYogaNode(text)).toBe(text)
  expect(box.selectable).toBe(false)
  expect(box.renderBefore).toBeUndefined()
  expect(box.renderAfter).toBeUndefined()
  expect(box.onLifecyclePass).toBeNull()
})

test("leaf box and text constructors skip deferred hook discovery", async () => {
  const { renderer } = await setup()
  const scan = spyOn(NativeScene.prototype, "scheduleHookScan")
  try {
    new BoxRenderable(renderer, { width: 2, height: 1 })
    new TextRenderable(renderer, { content: "hi", width: 2, height: 1 })
    expect(scan).not.toHaveBeenCalled()

    class GrowsHooks extends BoxRenderable {}
    new GrowsHooks(renderer, { width: 2, height: 1 })
    expect(scan).toHaveBeenCalledTimes(1)
  } finally {
    scan.mockRestore()
  }
})

test("option and assigned paint hooks still run without own accessors", async () => {
  const { renderer, renderOnce, captureCharFrame } = await setup()
  const color = RGBA.fromInts(255, 255, 255)
  const box = new BoxRenderable(renderer, {
    width: 3,
    height: 1,
    renderBefore(buffer) {
      buffer.drawText("AB", this.x, this.y, color)
    },
  })
  renderer.root.add(box)
  await renderOnce()
  expect(captureCharFrame().split("\n")[0]!.trimEnd()).toBe("AB")

  box.renderAfter = function (buffer) {
    buffer.drawText("C", this.x + 2, this.y, color)
  }
  box.requestRender()
  await renderOnce()
  expect(captureCharFrame().split("\n")[0]!.trimEnd()).toBe("ABC")
})

test("Object.assign onUpdate publishes without an instance accessor", async () => {
  const { renderer, renderOnce } = await setup()
  const box = new BoxRenderable(renderer, { width: 2, height: 1 })
  const calls: string[] = []
  Object.assign(box, { onUpdate: () => calls.push("update") })
  renderer.root.add(box)
  await renderOnce()
  expect(calls).toEqual(["update"])
})

test("destroy skips layout reads unless selection needs local coordinates", async () => {
  const { renderer, renderOnce } = await setup()
  const box = new BoxRenderable(renderer, { width: 2, height: 1, left: 3, top: 1 })
  const selected = new TextRenderable(renderer, {
    content: "hi",
    width: 2,
    height: 1,
    left: 4,
    top: 2,
    position: "absolute",
  })
  const idle = new TextRenderable(renderer, {
    content: "no",
    width: 2,
    height: 1,
    selectable: false,
    left: 5,
    top: 3,
    position: "absolute",
  })
  renderer.root.add(box)
  renderer.root.add(selected)
  renderer.root.add(idle)
  await renderOnce()

  const getLayout = spyOn(renderer.nativeScene, "getLayout")
  box.destroy()
  expect(getLayout).not.toHaveBeenCalled()

  idle.destroy()
  expect(getLayout).not.toHaveBeenCalled()

  const left = selected.x
  selected.destroy()
  expect(getLayout).toHaveBeenCalled()
  expect(selected.x).toBe(left)
})

test("idle nodes do not keep a local geometry copy", async () => {
  const { renderer, renderOnce } = await setup()
  const box = new BoxRenderable(renderer, { width: 4, height: 2, left: 1, top: 1, position: "absolute" })
  renderer.root.add(box)
  await renderOnce()
  expect(box.x).toBe(1)
  expect(box.y).toBe(1)
  expect(box.width).toBe(4)
  expect(box.height).toBe(2)
  box.destroy()
  expect(box.width).toBe(4)
})
