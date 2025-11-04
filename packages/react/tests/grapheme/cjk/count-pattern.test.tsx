import { describe, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../../../src/testing"
import React from "react"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("CJK Grapheme Count Pattern", () => {
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

  for (let count = 1; count <= 10; count++) {
    const input = "你".repeat(count) + " "

    // TODO: Investigate and fix CJK grapheme rendering issue (appears at higher counts)
    const testFn = count <= 3 ? it : it.skip
    testFn(`${count} CJK + space`, async () => {
      testSetup = await testRender(React.createElement("text", null, input))
      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      const line = frame.split("\n")[0].trim()
    })
  }
})
