import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../src/testing"
import React, { useState } from "react"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("React Renderer - Events & Interactions", () => {
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

  describe("Select Events", () => {
    it("should render select with onChange", async () => {
      const TestComponent = () => {
        const [selected, setSelected] = useState(0)
        return (
          <box>
            <select
              options={["Option A", "Option B", "Option C"]}
              value={selected}
              onChange={(index) => {
                setSelected(index)
              }}
            />
            <text>Selected: {selected}</text>
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Selected: 0")
    })

    it("should handle select focus events", async () => {
      const TestComponent = () => {
        const [focused, setFocused] = useState(false)
        return (
          <box>
            <select options={["A", "B"]} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
            <text>{focused ? "Focused" : "Blurred"}</text>
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 20,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Blurred")
    })
  })

  describe("Mouse Events", () => {
    it("should handle onMouseEnter and onMouseLeave", async () => {
      const TestComponent = () => {
        const [hovered, setHovered] = useState(false)
        return (
          <box onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
            <text>{hovered ? "Hovered" : "Not hovered"}</text>
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 20,
        height: 5,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Not hovered")
    })
  })
})
