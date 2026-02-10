// Tests textarea input event wiring in the React renderer.

import { afterEach, describe, expect, it } from "bun:test"
import { act } from "react"
import { testRender } from "../src/test-utils"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("React Renderer | Textarea Events", () => {
  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  it("emits textarea onInput with the latest plain text", async () => {
    let latestValue = ""

    testSetup = await testRender(
      <textarea
        focused
        onInput={(value) => {
          latestValue = value
        }}
      />,
      {
        width: 20,
        height: 4,
      },
    )

    await act(async () => {
      await testSetup.renderOnce()
      testSetup.mockInput.typeText("abc")
      await new Promise((resolve) => setTimeout(resolve, 10))
      await testSetup.renderOnce()
    })

    expect(latestValue).toBe("abc")
  })

  it("emits textarea onInput after newline edits", async () => {
    let latestValue = ""

    testSetup = await testRender(
      <textarea
        focused
        onInput={(value) => {
          latestValue = value
        }}
      />,
      {
        width: 20,
        height: 4,
      },
    )

    await act(async () => {
      await testSetup.renderOnce()
      testSetup.mockInput.typeText("line")
      testSetup.mockInput.pressEnter()
      testSetup.mockInput.typeText("two")
      await new Promise((resolve) => setTimeout(resolve, 10))
      await testSetup.renderOnce()
    })

    expect(latestValue).toBe("line\ntwo")
  })
})
