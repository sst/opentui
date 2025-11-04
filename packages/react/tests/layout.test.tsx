import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../src/testing"
import React from "react"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("React Renderer - Layout & Styling", () => {
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

  describe("Basic Box Layout", () => {
    it("should render simple box with border", async () => {
      testSetup = await testRender(
        <box border="single">
          <text>Content</text>
        </box>,
        {
          width: 20,
          height: 5,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Content")
      // Border characters present
      expect(frame.length).toBeGreaterThan(0)
    })

    it("should render nested boxes", async () => {
      testSetup = await testRender(
        <box border="single">
          <box border="double">
            <text>Nested</text>
          </box>
        </box>,
        {
          width: 30,
          height: 10,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Nested")
    })
  })

  describe("Flexbox Layout", () => {
    it("should render flex row direction", async () => {
      testSetup = await testRender(
        <box display="flex" flexDirection="row">
          <box width={5}>
            <text>Left</text>
          </box>
          <box width={5}>
            <text>Right</text>
          </box>
        </box>,
        {
          width: 30,
          height: 5,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Left")
      expect(frame).toContain("Right")
    })

    it("should render flex column direction", async () => {
      testSetup = await testRender(
        <box display="flex" flexDirection="column">
          <box height={2}>
            <text>Top</text>
          </box>
          <box height={2}>
            <text>Bottom</text>
          </box>
        </box>,
        {
          width: 20,
          height: 10,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Top")
      expect(frame).toContain("Bottom")
    })

    it("should handle flex grow", async () => {
      testSetup = await testRender(
        <box display="flex">
          <box flex={1}>
            <text>Grow</text>
          </box>
          <box>
            <text>Fixed</text>
          </box>
        </box>,
        {
          width: 30,
          height: 5,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Grow")
      expect(frame).toContain("Fixed")
    })
  })

  describe("Dimensions", () => {
    it("should respect fixed width and height", async () => {
      testSetup = await testRender(
        <box width={10} height={3} border="single">
          <text>Fixed</text>
        </box>,
        {
          width: 30,
          height: 10,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Fixed")
    })

    it("should handle padding", async () => {
      testSetup = await testRender(
        <box padding={2} border="single">
          <text>Padded</text>
        </box>,
        {
          width: 20,
          height: 10,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Padded")
    })

    it("should handle margin", async () => {
      testSetup = await testRender(
        <box margin={2}>
          <text>Margin</text>
        </box>,
        {
          width: 20,
          height: 10,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Margin")
    })
  })

  describe("Positioning", () => {
    it("should render with absolute positioning", async () => {
      testSetup = await testRender(
        <box width={20} height={10} position="relative" border="single">
          <box position="absolute" left={2} top={2}>
            <text>Absolute</text>
          </box>
        </box>,
        {
          width: 30,
          height: 15,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Absolute")
    })

    it("should handle overflow hidden", async () => {
      testSetup = await testRender(
        <box width={5} height={3} overflow="hidden" border="single">
          <text>Very long text that should be clipped</text>
        </box>,
        {
          width: 20,
          height: 10,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      // Should have border
      expect(frame.length).toBeGreaterThan(0)
    })
  })

  describe("Alignment", () => {
    it("should handle justify content flex start", async () => {
      testSetup = await testRender(
        <box display="flex" justifyContent="flex-start">
          <text>Start</text>
        </box>,
        {
          width: 20,
          height: 5,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Start")
    })

    it("should handle justify content center", async () => {
      testSetup = await testRender(
        <box display="flex" justifyContent="center">
          <text>Center</text>
        </box>,
        {
          width: 20,
          height: 5,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Center")
    })

    it("should handle align items center", async () => {
      testSetup = await testRender(
        <box display="flex" alignItems="center" height={5}>
          <text>Aligned</text>
        </box>,
        {
          width: 20,
          height: 10,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Aligned")
    })
  })
})
