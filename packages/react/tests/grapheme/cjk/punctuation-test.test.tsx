import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../../../src/testing"
import React from "react"

let testSetup: Awaited<ReturnType<typeof testRender>>

// TODO: Unskip after fixing CJK grapheme rendering with punctuation
describe.skip("CJK Grapheme with Punctuation", () => {
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

  // Test rendering with various punctuation marks
  const punctuation = " !(),-./;:?"
  const cjkCounts = [1, 2, 3, 4, 5, 6]

  for (const count of cjkCounts) {
    const cjk = "你".repeat(count)

    for (const p of punctuation) {
      it(`${cjk}${p}`, async () => {
        const input = `${cjk}${p}`
        testSetup = await testRender(React.createElement("text", null, input))
        await testSetup.renderOnce()
        const frame = testSetup.captureCharFrame()
        const result = frame.split("\n")[0].trim()

        expect(frame).toContain(input)
      })
    }
  }
})
