import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { TextRenderable } from "@opentui/core"
import { defineComponent, h, nextTick, ref } from "vue"
import { testRender } from "../src/test-utils"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Vue Renderer | TextNode Tests", () => {
  beforeEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  it("renders text nodes under non-text renderables", async () => {
    const TestComponent = defineComponent({
      render() {
        return h(
          "boxRenderable",
          { id: "container", style: { width: 20, height: 5, border: true } },
          "Hello",
        )
      },
    })

    testSetup = await testRender(TestComponent, { width: 22, height: 7 })
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    expect(frame).toContain("Hello")

    const container = testSetup.renderer.root.findDescendantById("container")!
    const children = container.getChildren()
    expect(children.length).toBe(1)
    expect(children[0]).toBeInstanceOf(TextRenderable)
  })

  it("removes text-ghost nodes when text is removed", async () => {
    const show = ref(true)

    const TestComponent = defineComponent({
      render() {
        return h(
          "boxRenderable",
          { id: "container", style: { width: 20, height: 5, border: true } },
          show.value ? "Hi" : undefined,
        )
      },
    })

    testSetup = await testRender(TestComponent, { width: 22, height: 7 })
    await testSetup.renderOnce()

    const container = testSetup.renderer.root.findDescendantById("container")!
    expect(container.getChildren().length).toBe(1)

    show.value = false
    await nextTick()
    await testSetup.renderOnce()

    const remaining = container.getChildren()
    if (remaining.length === 0) {
      return
    }

    expect(remaining.length).toBe(1)
    const ghost = remaining[0]!
    expect(ghost).toBeInstanceOf(TextRenderable)
    const textRenderable = ghost as TextRenderable
    const contentChunks = textRenderable.content.chunks
    const combinedText = contentChunks.map((c) => c.text).join("")
    const trimmedText = combinedText.trim()
    expect(trimmedText).toBe("")
  })
})
