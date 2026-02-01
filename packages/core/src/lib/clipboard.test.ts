import { describe, expect, it, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import { ClipboardTarget, encodeOsc52Payload } from "./clipboard"
import type { RenderLib } from "../zig"

describe("clipboard", () => {
  let renderer: TestRenderer | null = null

  const enableOsc52 = (testRenderer: TestRenderer) => {
    const lib = (testRenderer as unknown as { lib: RenderLib }).lib
    lib.processCapabilityResponse(testRenderer.rendererPtr, "\x1bP>|kitty(0.40.1)\x1b\\")
  }

  afterEach(() => {
    renderer?.destroy()
    renderer = null
  })

  it("encodes payload as base64", () => {
    const payload = encodeOsc52Payload("hello")
    const decoded = new TextDecoder().decode(payload)
    expect(decoded).toBe(Buffer.from("hello").toString("base64"))
  })

  it("gates clipboard writes on OSC 52 support", async () => {
    ;({ renderer } = await createTestRenderer({ remote: true }))

    expect(renderer.isOsc52Supported()).toBe(false)
    expect(renderer.copyToClipboardOSC52("test")).toBe(false)
    expect(renderer.clearClipboardOSC52()).toBe(false)

    enableOsc52(renderer)

    expect(renderer.isOsc52Supported()).toBe(true)
    expect(renderer.copyToClipboardOSC52("test")).toBe(true)
    expect(renderer.copyToClipboardOSC52("test", ClipboardTarget.Primary)).toBe(true)
    expect(renderer.copyToClipboardOSC52("test", ClipboardTarget.Secondary)).toBe(true)
    expect(renderer.copyToClipboardOSC52("test", ClipboardTarget.Query)).toBe(true)
    expect(renderer.clearClipboardOSC52()).toBe(true)
  })
})
