import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../src/testing"
import React from "react"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("React Renderer - Basic Text Rendering", () => {
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

  describe("Simple Text", () => {
    it("should render simple text correctly", async () => {
      testSetup = await testRender(<text>Hello World</text>, {
        width: 20,
        height: 5,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Hello World")
    })

    it("should render multiline text correctly", async () => {
      testSetup = await testRender(
        <box>
          <text>{"Line 1\nLine 2\nLine 3"}</text>
        </box>,
        {
          width: 15,
          height: 5,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Line 1")
      expect(frame).toContain("Line 2")
      expect(frame).toContain("Line 3")
    })
  })
})
