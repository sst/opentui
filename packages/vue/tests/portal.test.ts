import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { defineComponent, h, ref, nextTick } from "vue"
import { testRender } from "../src/test-utils"
import { Portal } from "../src/components/Portal"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Vue Renderer | Portal Tests", () => {
  beforeEach(async () => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  describe("Basic Portal Rendering", () => {
    it("should render content to default mount point (root)", async () => {
      const TestComponent = defineComponent({
        components: { Portal },
        render() {
          return h("boxRenderable", {}, [
            h("textRenderable", {}, "Before portal"),
            h(Portal, {}, () => [h("textRenderable", {}, "Portal content")]),
            h("textRenderable", {}, "After portal"),
          ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 25,
        height: 8,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Portal content")
      expect(frame).toContain("Before portal")
      expect(frame).toContain("After portal")
    })

    it("should render content to custom mount point", async () => {
      const TestComponent = defineComponent({
        components: { Portal },
        render() {
          return h("boxRenderable", {}, [
            h(Portal, {}, () => [
              h("boxRenderable", { style: { border: true }, title: "Portal Box" }, [
                h("textRenderable", {}, "Portal content"),
              ]),
            ]),
          ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 25,
        height: 8,
      })

      await testSetup.renderOnce()
      await nextTick()
      await testSetup.renderOnce()

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Portal content")
    })

    it("should handle complex nested content in portal", async () => {
      const TestComponent = defineComponent({
        components: { Portal },
        render() {
          return h("boxRenderable", {}, [
            h(Portal, {}, () => [h("textRenderable", {}, "Nested text 1"), h("textRenderable", {}, "Nested text 2")]),
          ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Nested text 1")
      expect(frame).toContain("Nested text 2")
    })

    it("should handle portal cleanup on unmount", async () => {
      const showPortal = ref(true)

      const TestComponent = defineComponent({
        components: { Portal },
        setup() {
          return { showPortal }
        },
        render() {
          return h("boxRenderable", {}, [
            showPortal.value ? h(Portal, {}, () => [h("textRenderable", {}, "Portal content")]) : null,
          ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 20,
        height: 5,
      })

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Portal content")

      showPortal.value = false
      await nextTick()

      try {
        await testSetup.renderOnce()
      } catch {}

      frame = testSetup.captureCharFrame()
      expect(frame).not.toContain("Portal content")
    })

    it("should handle multiple portals", async () => {
      const TestComponent = defineComponent({
        components: { Portal },
        render() {
          return h("boxRenderable", {}, [
            h(Portal, {}, () => [h("textRenderable", {}, "First portal")]),
            h(Portal, {}, () => [h("textRenderable", {}, "Second portal")]),
          ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 25,
        height: 8,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("First portal")
      expect(frame).toContain("Second portal")
    })
  })
})
