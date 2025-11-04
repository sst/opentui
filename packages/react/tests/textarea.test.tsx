import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../src/testing"
import React, { useState } from "react"

let testSetup: Awaited<ReturnType<typeof testRender>>

// TODO: Unskip when textarea component is implemented
describe.skip("React Renderer - Textarea", () => {
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

  describe("Basic Textarea", () => {
    it("should render textarea with initial value", async () => {
      const TestComponent = () => {
        return (
          <box>
            <textarea value={"Line 1\nLine 2\nLine 3"} />
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 15,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Line 1")
      expect(frame).toContain("Line 2")
      expect(frame).toContain("Line 3")
    })

    it("should render textarea with placeholder", async () => {
      const TestComponent = () => {
        return (
          <box>
            <textarea placeholder="Enter text here" />
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      // Placeholder should be visible when empty
      expect(frame.length).toBeGreaterThan(0)
    })
  })

  describe("Textarea Events", () => {
    it("should handle onChange event", async () => {
      const TestComponent = () => {
        const [text, setText] = useState("Initial")
        return (
          <box>
            <textarea value={text} onChange={(value) => setText(value)} />
            <text>Length: {text.length}</text>
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Initial")
      expect(frame).toContain("Length: 7")
    })

    it("should handle onFocus event", async () => {
      const TestComponent = () => {
        const [focused, setFocused] = useState(false)
        return (
          <box>
            <textarea onFocus={() => setFocused(true)} />
            <text>{focused ? "Textarea focused" : "Textarea blurred"}</text>
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Textarea blurred")
    })

    it("should handle onBlur event", async () => {
      const TestComponent = () => {
        const [blurred, setBlurred] = useState(false)
        return (
          <box>
            <textarea onBlur={() => setBlurred(true)} />
            {blurred && <text>Blur event fired</text>}
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame.length).toBeGreaterThan(0)
    })

    it("should handle onSubmit event", async () => {
      const TestComponent = () => {
        const [submitted, setSubmitted] = useState(false)
        return (
          <box>
            <textarea
              value="Some text"
              onSubmit={() => {
                setSubmitted(true)
              }}
            />
            {submitted && <text>Submitted!</text>}
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Some text")
    })
  })

  describe("Textarea with Dimensions", () => {
    it("should respect textarea width and height", async () => {
      const TestComponent = () => {
        return (
          <box>
            <textarea width={20} height={5} value={"Line 1\nLine 2\nLine 3\nLine 4\nLine 5"} />
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 40,
        height: 15,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Line 1")
    })

    it("should handle textarea with flex grow", async () => {
      const TestComponent = () => {
        return (
          <box display="flex" flexDirection="column" height={15}>
            <text>Header</text>
            <textarea flex={1} value="Growing textarea" />
            <text>Footer</text>
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 20,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Header")
      expect(frame).toContain("Growing textarea")
      expect(frame).toContain("Footer")
    })
  })

  describe("Textarea Scrolling", () => {
    it("should handle horizontal scroll", async () => {
      const TestComponent = () => {
        return (
          <box>
            <textarea width={10} value="This is a very long line of text that should scroll" />
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame.length).toBeGreaterThan(0)
    })

    it("should handle vertical scroll", async () => {
      const TestComponent = () => {
        const longText = Array(30)
          .fill(0)
          .map((_, i) => `Line ${i + 1}`)
          .join("\n")

        return (
          <box>
            <textarea width={20} height={5} value={longText} />
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 15,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Line 1")
    })
  })

  describe("Textarea Controlled vs Uncontrolled", () => {
    it("should work as controlled component", async () => {
      const TestComponent = () => {
        const [value, setValue] = useState("Controlled")
        return (
          <box>
            <textarea value={value} onChange={(v) => setValue(v)} />
            <text>Current: {value}</text>
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Controlled")
      expect(frame).toContain("Current: Controlled")
    })

    it("should work as uncontrolled component with defaultValue", async () => {
      const TestComponent = () => {
        return (
          <box>
            <textarea defaultValue="Uncontrolled" />
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Uncontrolled")
    })
  })

  describe("Textarea Styling", () => {
    it("should render textarea with border", async () => {
      const TestComponent = () => {
        return (
          <box border="single">
            <textarea value="Bordered textarea" />
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Bordered textarea")
    })

    it("should handle textarea with padding", async () => {
      const TestComponent = () => {
        return (
          <box padding={1} border="single">
            <textarea value="Padded textarea" />
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Padded textarea")
    })
  })

  describe("Textarea Multiline Content", () => {
    it("should properly display multiline content", async () => {
      const TestComponent = () => {
        const multilineText = `First line
Second line
Third line
Fourth line`

        return (
          <box>
            <textarea value={multilineText} />
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("First line")
      expect(frame).toContain("Second line")
      expect(frame).toContain("Third line")
      expect(frame).toContain("Fourth line")
    })

    it("should handle empty lines in content", async () => {
      const TestComponent = () => {
        const textWithEmptyLines = `Line 1

Line 3`

        return (
          <box>
            <textarea value={textWithEmptyLines} />
          </box>
        )
      }

      testSetup = await testRender(<TestComponent />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Line 1")
      expect(frame).toContain("Line 3")
    })
  })
})
