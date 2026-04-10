import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { render, testRender, useRenderer } from "@opentui/solid"
import { onMount } from "solid-js"

const initialDraft = "Welcome to the Solid dist test."

export function SolidDistTextareaDemo() {
  const renderer = useRenderer()

  onMount(() => {
    renderer.setBackgroundColor("#111827")
  })

  return (
    <box style={{ padding: 1, flexDirection: "column" }}>
      <box
        title="Solid Dist Textarea Demo"
        border
        borderColor="#6BCF7F"
        titleAlignment="left"
        paddingLeft={1}
        paddingRight={1}
        style={{ height: 8 }}
      >
        <textarea
          ref={(renderable) => {
            queueMicrotask(() => {
              if (renderable && !renderable.isDestroyed) {
                renderable.focus()
                renderable.gotoBufferEnd()
              }
            })
          }}
          focused
          initialValue={initialDraft}
          wrapMode="word"
          showCursor
          cursorColor="#7DD3FC"
          textColor="#E5E7EB"
          placeholder="Type here..."
          style={{ flexGrow: 1 }}
        />
      </box>
      <text style={{ fg: "#A5D6FF" }}>Solid textarea ready</text>
      <text style={{ fg: "#94A3B8" }}>Type in the textarea. Press Ctrl+C to exit.</text>
    </box>
  )
}

describe("@opentui/solid dist test (Node.js + TypeScript)", () => {
  it("imports solid public entrypoints", async () => {
    const solid = await import("@opentui/solid")

    assert.equal(typeof solid.render, "function")
    assert.equal(typeof solid.testRender, "function")
    assert.equal(typeof solid.useKeyboard, "function")
    assert.equal(typeof solid.useRenderer, "function")
  })

  it("renders the textarea demo", async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(SolidDistTextareaDemo, {
      width: 64,
      height: 14,
    })

    try {
      await renderOnce()
      const frame = captureCharFrame()
      assert.match(frame, /Solid Dist Textarea Demo/)
      assert.match(frame, /Welcome to the Solid dist test\./)
      assert.match(frame, /Solid textarea ready/)
      assert.match(frame, /Type in the textarea\. Press Ctrl\+C to exit\./)
    } finally {
      renderer.destroy()
    }
  })

  it("updates textarea state from keyboard input", async () => {
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(SolidDistTextareaDemo, {
      width: 72,
      height: 14,
    })

    try {
      await renderOnce()

      await mockInput.typeText(" Running under Node")
      await renderOnce()

      let frame = captureCharFrame()
      assert.match(frame, /Running under Node/)
      assert.match(frame, /Solid textarea ready/)
    } finally {
      renderer.destroy()
    }
  })
})

if (process.env.NODE_TEST_CONTEXT === undefined && import.meta.main) {
  await render(SolidDistTextareaDemo, { exitOnCtrlC: true })
}
