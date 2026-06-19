import { describe, expect, it, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { Clipboard, ClipboardTarget } from "./clipboard.js"
import type { RendererHandle, RenderLib } from "../zig.js"

describe("clipboard", () => {
  let renderer: TestRenderer | null = null

  const respondToOsc52Query = (testRenderer: TestRenderer, response: string) => {
    const lib = (testRenderer as unknown as { lib: RenderLib }).lib
    lib.processCapabilityResponse(testRenderer.rendererPtr, response)
  }

  afterEach(() => {
    renderer?.destroy()
    renderer = null
  })

  it("preserves the native selection target ABI", () => {
    expect(ClipboardTarget.Clipboard).toBe(0)
    expect(ClipboardTarget.Primary).toBe(1)
    expect(ClipboardTarget.Select).toBe(2)
    expect(ClipboardTarget.Secondary).toBe(3)
  })

  it("passes raw UTF-8 bytes to the native encoder", () => {
    let received: Uint8Array | undefined
    const lib = {
      encoder: new TextEncoder(),
      getTerminalCapabilities: () => ({ osc52_support: "unknown" }),
      copyToClipboardOSC52: (_renderer: RendererHandle, _target: number, textUtf8: Uint8Array) => {
        received = textUtf8
        return true
      },
    } as unknown as RenderLib
    const clipboard = new Clipboard(lib, 0 as unknown as RendererHandle)

    expect(clipboard.copyToClipboardOSC52("世界")).toBe(true)
    expect(received).toEqual(new TextEncoder().encode("世界"))
  })

  it("treats negative XTGETTCAP Ms replies as inconclusive", async () => {
    ;({ renderer } = await createTestRenderer({ remote: true }))

    expect(renderer.isOsc52Supported()).toBe(true)
    expect(renderer.copyToClipboardOSC52("test")).toBe(true)

    respondToOsc52Query(renderer, "\x1bP0+r\x1b\\")
    expect(renderer.copyToClipboardOSC52("test")).toBe(true)
    expect(renderer.clearClipboardOSC52()).toBe(true)

    respondToOsc52Query(renderer, "\x1bP0+r4d73\x1b\\")
    expect(renderer.copyToClipboardOSC52("test")).toBe(true)

    respondToOsc52Query(renderer, "\x1bP1+r4d73=2570312573\x1b\\")

    expect(renderer.copyToClipboardOSC52("test")).toBe(true)
    expect(renderer.copyToClipboardOSC52("test", ClipboardTarget.Primary)).toBe(true)
    expect(renderer.copyToClipboardOSC52("test", ClipboardTarget.Select)).toBe(true)
    expect(renderer.copyToClipboardOSC52("test", ClipboardTarget.Secondary)).toBe(true)
    expect(renderer.clearClipboardOSC52()).toBe(true)
  })
})
