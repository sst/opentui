import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../../../src/testing"
import React from "react"

let testSetup: Awaited<ReturnType<typeof testRender>>

// TODO: Investigate and fix CJK grapheme rendering issue
describe.skip("CJK Grapheme Debug", () => {
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

  it("你你你你 - bytes", async () => {
    testSetup = await testRender(React.createElement("text", null, "你你你你 "))
    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()
    const line = frame.split("\n")[0].trim()
    const bytes = new TextEncoder().encode(line)

    console.log("Input: 你你你你 ")
    console.log(
      "Bytes:",
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" "),
    )
    console.log("String:", line)
    console.log(
      "Chars:",
      Array.from(line)
        .map((c) => `${c}(U+${c.charCodeAt(0).toString(16)})`)
        .join(" "),
    )

    expect(line).toBe("你你你你 ")
  })
})
