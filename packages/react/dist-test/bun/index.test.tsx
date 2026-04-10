import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { testRender } from "@opentui/react/test-utils"
import { act, useState, type ReactNode } from "react"

describe("@opentui/react dist test (Bun)", () => {
  test("imports react public entrypoints", async () => {
    const react = await import("@opentui/react")
    const testUtils = await import("@opentui/react/test-utils")

    expect(typeof react.createRoot).toBe("function")
    expect(typeof react.useKeyboard).toBe("function")
    expect(typeof react.useRenderer).toBe("function")
    expect(typeof testUtils.testRender).toBe("function")
  })

  test("renders simple text via testRender", async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <text>Hello from React Bun dist test</text>,
      { width: 40, height: 4 },
    )

    try {
      await renderOnce()
      expect(captureCharFrame()).toMatch(/Hello from React Bun dist test/)
    } finally {
      renderer.destroy()
    }
  })

  test("renders nested box layout", async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <box style={{ flexDirection: "column" }}>
        <text>Line A</text>
        <text>Line B</text>
      </box>,
      { width: 30, height: 6 },
    )

    try {
      await renderOnce()
      const frame = captureCharFrame()
      expect(frame).toMatch(/Line A/)
      expect(frame).toMatch(/Line B/)
    } finally {
      renderer.destroy()
    }
  })

  test("renders a stateful component", async () => {
    function Counter({ initial }: { initial: number }): ReactNode {
      const [count] = useState(initial)
      return <text>{`Count: ${count}`}</text>
    }

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Counter initial={42} />,
      { width: 20, height: 4 },
    )

    try {
      await renderOnce()
      expect(captureCharFrame()).toMatch(/Count: 42/)
    } finally {
      renderer.destroy()
    }
  })

  test("renders a box with border", async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <box title="Greetings" style={{ border: true, width: 25, height: 5 }}>
        <text>Boxed content</text>
      </box>,
      { width: 30, height: 8 },
    )

    try {
      await renderOnce()
      const frame = captureCharFrame()
      expect(frame).toMatch(/Greetings/)
      expect(frame).toMatch(/Boxed content/)
    } finally {
      renderer.destroy()
    }
  })

  test("uses createRoot directly with createTestRenderer", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 30,
      height: 4,
    })

    // @ts-expect-error - required for React act() to work in test environment
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const root = createRoot(renderer)

    try {
      act(() => {
        root.render(<text>Direct root render</text>)
      })
      await renderOnce()
      expect(captureCharFrame()).toMatch(/Direct root render/)
    } finally {
      act(() => {
        root.unmount()
      })
      renderer.destroy()
      // @ts-expect-error
      globalThis.IS_REACT_ACT_ENVIRONMENT = false
    }
  })
})
