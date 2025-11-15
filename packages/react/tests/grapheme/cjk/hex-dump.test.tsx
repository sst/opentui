import { describe, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../../../src/testing"
import React from "react"

let testSetup: Awaited<ReturnType<typeof testRender>>

// TODO: Unskip after fixing grapheme rendering. Output analysis in console.
describe.skip("CJK Grapheme Hex Dump", () => {
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

  it("dump 你你你你 ", async () => {
    testSetup = await testRender(React.createElement("text", null, "你你你你 "))
    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()
    const line = frame.split("\n")[0]

    const output = {
      input: "你你你你 ",
      output: line,
      trimmed: line.trim(),
      bytes: Array.from(new TextEncoder().encode(line.trim())).map((b) => `0x${b.toString(16).padStart(2, "0")}`),
      chars: Array.from(line.trim()).map((c, i) => ({
        index: i,
        char: c,
        code: `U+${c.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`,
      })),
    }

    console.log("CJK Grapheme Analysis:", JSON.stringify(output, null, 2))
  })
})
