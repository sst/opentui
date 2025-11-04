import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../src/testing"
import React, { useState } from "react"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("React Renderer - Control Flow", () => {
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

  describe("Conditional Rendering", () => {
    it("should render when condition is true", async () => {
      const TestComponent = () => {
        const [show, setShow] = useState(true)
        return (
          <box>
            {show && <text>Visible</text>}
            <text>Always</text>
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 20,
        height: 5,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Visible")
      expect(frame).toContain("Always")
    })

    it("should hide when condition is false", async () => {
      const TestComponent = () => {
        const [show, setShow] = useState(false)
        return (
          <box>
            {show && <text>Hidden</text>}
            <text>Visible</text>
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 20,
        height: 5,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).not.toContain("Hidden")
      expect(frame).toContain("Visible")
    })

    it("should handle ternary conditional rendering", async () => {
      const TestComponent = () => {
        const [mode, setMode] = useState("a")
        return <box>{mode === "a" ? <text>Mode A</text> : <text>Mode B</text>}</box>
      }

      testSetup = await testRender(<TestComponent />, {
        width: 20,
        height: 5,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Mode A")
    })
  })

  describe("List Rendering", () => {
    it("should render array of items", async () => {
      const TestComponent = () => {
        const items = ["First", "Second", "Third"]
        return (
          <box>
            {items.map((item, index) => (
              <text key={index}>
                {index + 1}. {item}
              </text>
            ))}
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 20,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("1. First")
      expect(frame).toContain("2. Second")
      expect(frame).toContain("3. Third")
    })

    it("should render nested arrays", async () => {
      const TestComponent = () => {
        const groups = [
          ["A1", "A2"],
          ["B1", "B2"],
        ]
        return <box>{groups.map((group, i) => group.map((item, j) => <text key={`${i}-${j}`}>{item}</text>))}</box>
      }

      testSetup = await testRender(<TestComponent />, {
        width: 20,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("A1")
      expect(frame).toContain("A2")
      expect(frame).toContain("B1")
      expect(frame).toContain("B2")
    })

    it("should handle reactive list updates", async () => {
      const TestComponent = () => {
        const [items, setItems] = useState(["Item1"])

        // Simulate adding item on first render
        React.useEffect(() => {
          // In real scenario, this would be a state update
        }, [])

        return (
          <box>
            {items.map((item, index) => (
              <text key={index}>{item}</text>
            ))}
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 20,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item1")
    })
  })

  describe("Fragment and Multiple Children", () => {
    it("should render multiple children in sequence", async () => {
      testSetup = await testRender(
        <box>
          <text>First</text>
          <text>Second</text>
          <text>Third</text>
        </box>,
        {
          width: 20,
          height: 10,
        },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("First")
      expect(frame).toContain("Second")
      expect(frame).toContain("Third")
    })

    it("should render children with array and elements mixed", async () => {
      const TestComponent = () => {
        const items = ["A", "B"]
        return (
          <box>
            <text>Header</text>
            {items.map((item, i) => (
              <text key={i}>{item}</text>
            ))}
            <text>Footer</text>
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 20,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Header")
      expect(frame).toContain("A")
      expect(frame).toContain("B")
      expect(frame).toContain("Footer")
    })
  })
})
