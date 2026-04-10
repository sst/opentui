import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createCliRenderer } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { testRender } from "@opentui/react/test-utils"
import { useState, useEffect, type ReactNode } from "react"
// In React 18, act is exported from react-dom/test-utils
import { act } from "react-dom/test-utils"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("@opentui/react dist test (Node.js + TypeScript, vanilla React 18)", () => {
  it("imports react public entrypoints", async () => {
    const react = await import("@opentui/react")
    const testUtils = await import("@opentui/react/test-utils")

    assert.equal(typeof react.createRoot, "function")
    assert.equal(typeof react.useKeyboard, "function")
    assert.equal(typeof react.useRenderer, "function")
    assert.equal(typeof testUtils.testRender, "function")
  })

  it("renders simple text via testRender", async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <text>Hello from React 18 dist test</text>,
      { width: 40, height: 4 },
    )

    try {
      await renderOnce()
      const frame = captureCharFrame()
      assert.match(frame, /Hello from React 18 dist test/)
    } finally {
      renderer.destroy()
    }
  })

  it("renders nested box layout", async () => {
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
      assert.match(frame, /Line A/)
      assert.match(frame, /Line B/)
    } finally {
      renderer.destroy()
    }
  })

  it("renders a stateful component", async () => {
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
      const frame = captureCharFrame()
      assert.match(frame, /Count: 42/)
    } finally {
      renderer.destroy()
    }
  })

  it("renders a box with border", async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <box title="Greetings" style={{ border: true, width: 25, height: 5 }}>
        <text>Boxed content</text>
      </box>,
      { width: 30, height: 8 },
    )

    try {
      await renderOnce()
      const frame = captureCharFrame()
      assert.match(frame, /Greetings/)
      assert.match(frame, /Boxed content/)
    } finally {
      renderer.destroy()
    }
  })

  it("uses createRoot directly with createTestRenderer", async () => {
    let root: ReturnType<typeof createRoot> | null = null
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 30,
      height: 4,
      onDestroy() {
        act(() => {
          root?.unmount()
          root = null
        })
      },
    })

    // @ts-expect-error - required for React act() to work in test environment
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    root = createRoot(renderer)

    try {
      act(() => {
        root.render(<text>Direct root render</text>)
      })
      await renderOnce()
      const frame = captureCharFrame()
      assert.match(frame, /Direct root render/)
    } finally {
      renderer.destroy()
      // @ts-expect-error
      globalThis.IS_REACT_ACT_ENVIRONMENT = false
    }
  })
})

// ---------------------------------------------------------------------------
// Interactive app — runs when executed directly: node dist/index.js
// ---------------------------------------------------------------------------

function InteractiveApp(): ReactNode {
  const [counter, setCounter] = useState(0)
  const [dots, setDots] = useState("")

  useEffect(() => {
    const interval = setInterval(() => {
      setCounter((c) => c + 1)
      setDots((d) => (d.length >= 3 ? "" : d + "."))
    }, 500)
    return () => clearInterval(interval)
  }, [])

  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <box title="React 18 Dist Test" style={{ border: true, width: 40, height: 5 }}>
        <text>{`Counter: ${counter}${dots}`}</text>
      </box>
      <text style={{ fg: "#888888" }}>Press Ctrl+C to exit</text>
    </box>
  )
}

if (process.env.NODE_TEST_CONTEXT === undefined && import.meta.main) {
  const renderer = await createCliRenderer()
  createRoot(renderer).render(<InteractiveApp />)
}
