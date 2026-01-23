import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { createSignal } from "solid-js"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Box Component", () => {
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

  it("should support focusable prop and controlled focus state", async () => {
    let boxRef: any
    const [focused, setFocused] = createSignal(false)

    testSetup = await testRender(
      () => <box ref={boxRef} focusable focused={focused()} style={{ width: 10, height: 5, border: true }} />,
      { width: 15, height: 8 },
    )

    await testSetup.renderOnce()

    expect(boxRef.focusable).toBe(true)
    expect(boxRef.focused).toBe(false)

    setFocused(true)
    await testSetup.renderOnce()

    expect(boxRef.focused).toBe(true)

    setFocused(false)
    await testSetup.renderOnce()

    expect(boxRef.focused).toBe(false)
  })
})
