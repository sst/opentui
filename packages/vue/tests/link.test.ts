import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { link, t, underline, blue } from "@opentui/core"
import { defineComponent, h } from "vue"
import { testRender } from "../src/test-utils"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Vue Renderer | Link Rendering Tests", () => {
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

  it("should render link with href correctly", async () => {
    const styledText = t`Visit ${link("https://opentui.com")("opentui.com")} for more info`

    const TestComponent = defineComponent({
      render() {
        return h("textRenderable", { content: styledText })
      },
    })

    testSetup = await testRender(TestComponent, {
      width: 50,
      height: 5,
    })

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("Visit opentui.com for more info")
  })

  it("should render styled link with underline", async () => {
    const styledText = t`${underline(blue(link("https://opentui.com")("opentui.com")))}`

    const TestComponent = defineComponent({
      render() {
        return h("textRenderable", { content: styledText })
      },
    })

    testSetup = await testRender(TestComponent, {
      width: 50,
      height: 5,
    })

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("opentui.com")
  })

  it("should render link inside text with other elements", async () => {
    const styledText = t`Check out ${link("https://github.com/sst/opentui")("GitHub")} and ${link("https://opentui.com")("our website")}`

    const TestComponent = defineComponent({
      render() {
        return h("textRenderable", { content: styledText })
      },
    })

    testSetup = await testRender(TestComponent, {
      width: 60,
      height: 5,
    })

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("GitHub")
    expect(frame).toContain("our website")
  })
})
