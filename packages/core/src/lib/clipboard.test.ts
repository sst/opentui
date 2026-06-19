import { describe, expect, it, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import {
  Clipboard,
  ClipboardTarget,
  type ClipboardRepresentation,
  type ClipboardService,
  type HostClipboardBackend,
} from "./clipboard.js"
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

  it("represents one encoded clipboard value", () => {
    const representation: ClipboardRepresentation = {
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("hello"),
    }

    expect(representation.mimeType).toBe("text/plain")
    expect(new TextDecoder().decode(representation.bytes)).toBe("hello")
  })

  it("supports a host backend without platform-specific interfaces", async () => {
    const textBytes = new TextEncoder().encode("from Wayland")
    const backend: HostClipboardBackend = {
      async read(options) {
        expect(options.preferredTypes).toEqual(["image/png", "text/plain"])
        expect(options.selection).toBe("primary")
        expect(options.maxBytes).toBe(8 * 1024 * 1024)
        expect(options.signal).toBeInstanceOf(AbortSignal)
        return { status: "read", representation: { mimeType: "text/plain", bytes: textBytes } }
      },
      async writeText(text, options) {
        expect(text).toBe("copy me")
        expect(options.selection).toBe("primary")
        expect(options.signal).toBeInstanceOf(AbortSignal)
        return { status: "written" }
      },
      async clear(options) {
        expect(options.selection).toBe("primary")
        return { status: "cleared" }
      },
    }

    const controller = new AbortController()
    const read = await backend.read({
      preferredTypes: ["image/png", "text/plain"],
      selection: "primary",
      maxBytes: 8 * 1024 * 1024,
      signal: controller.signal,
    })
    const write = await backend.writeText("copy me", { selection: "primary", signal: controller.signal })
    const clear = await backend.clear({ selection: "primary", signal: controller.signal })

    expect(read.status).toBe("read")
    if (read.status === "read") {
      expect(new TextDecoder().decode(read.representation.bytes)).toBe("from Wayland")
    }
    expect(write.status).toBe("written")
    expect(clear.status).toBe("cleared")
  })

  it("supports the final application-facing read and write flow", async () => {
    const offered = [
      { mimeType: "image/png", bytes: new Uint8Array() },
      { mimeType: "text/plain", bytes: new TextEncoder().encode("fallback text") },
    ]
    const clipboard: ClipboardService = {
      async read(options) {
        expect(options.preferredTypes).toEqual(["image/png", "text/plain"])
        for (const mimeType of options.preferredTypes) {
          const representation = offered.find((candidate) => candidate.mimeType === mimeType)
          if (!representation) continue
          if (mimeType.startsWith("image/") && representation.bytes.length === 0) continue
          return { status: "read", representation }
        }
        return { status: "empty" }
      },
      async writeText(_text, options) {
        if (options.destination === "best-available") {
          return {
            host: { status: "not-attempted" },
            terminal: { status: "attempted", capability: "unknown" },
          }
        }
        expect(options).toEqual({ destination: "all-available", allowRemoteHost: true })
        return {
          host: { status: "written" },
          terminal: { status: "attempted", capability: "supported" },
        }
      },
      async clear() {
        return {
          host: { status: "cleared" },
          terminal: { status: "attempted", capability: "supported" },
        }
      },
    }

    const read = await clipboard.read({ preferredTypes: ["image/png", "text/plain"] })
    expect(read.status).toBe("read")
    if (read.status === "read") {
      expect(read.representation.mimeType).toBe("text/plain")
      expect(new TextDecoder().decode(read.representation.bytes)).toBe("fallback text")
    }

    const write = await clipboard.writeText("selected text", {
      destination: "all-available",
      allowRemoteHost: true,
    })
    expect(write.host.status).toBe("written")
    expect(write.terminal.status).toBe("attempted")

    const remoteWrite = await clipboard.writeText("remote text", { destination: "best-available" })
    expect(remoteWrite.host.status).toBe("not-attempted")
    expect(remoteWrite.terminal.status).toBe("attempted")

    const cleared = await clipboard.clear({ destination: "all-available" })
    expect(cleared.host.status).toBe("cleared")
    expect(cleared.terminal.status).toBe("attempted")
  })

  it("requires permission for remote host writes", async () => {
    const remoteClipboard: ClipboardService = {
      async read() {
        return { status: "empty" }
      },
      async writeText(_text, options) {
        const hostAllowed = options.allowRemoteHost === true
        return {
          host: hostAllowed ? { status: "written" } : { status: "not-attempted" },
          terminal: { status: "not-attempted", capability: "unknown" },
        }
      },
      async clear() {
        return {
          host: { status: "not-attempted" },
          terminal: { status: "not-attempted", capability: "unknown" },
        }
      },
    }

    const denied = await remoteClipboard.writeText("remote text", { destination: "host-only" })
    const allowed = await remoteClipboard.writeText("remote text", {
      destination: "host-only",
      allowRemoteHost: true,
    })

    expect(denied.host.status).toBe("not-attempted")
    expect(allowed.host.status).toBe("written")
  })

  it("sketches the default standard clipboard and explicit primary policy", async () => {
    const selections: string[] = []
    const clipboard: ClipboardService = {
      async read(options) {
        selections.push(options.selection ?? "clipboard")
        return { status: "empty" }
      },
      async writeText(_text, options) {
        selections.push(options.selection ?? "clipboard")
        return {
          host: { status: "written" },
          terminal: { status: "not-attempted", capability: "unknown" },
        }
      },
      async clear() {
        return {
          host: { status: "cleared" },
          terminal: { status: "not-attempted", capability: "unknown" },
        }
      },
    }

    await clipboard.read({ preferredTypes: ["text/plain"] })
    await clipboard.read({ preferredTypes: ["text/plain"], selection: "primary" })
    await clipboard.writeText("standard", { destination: "host-only" })
    await clipboard.writeText("primary", { destination: "host-only", selection: "primary" })

    expect(selections).toEqual(["clipboard", "primary", "clipboard", "primary"])
  })

  it("does not redirect an unsupported primary selection to the standard clipboard", async () => {
    const macosBackend: HostClipboardBackend = {
      async read(options) {
        expect(options.selection).toBe("primary")
        return { status: "unsupported" }
      },
      async writeText(_text, options) {
        expect(options.selection).toBe("primary")
        return { status: "unsupported" }
      },
      async clear(options) {
        expect(options.selection).toBe("primary")
        return { status: "unsupported" }
      },
    }
    const controller = new AbortController()

    const read = await macosBackend.read({
      preferredTypes: ["text/plain"],
      selection: "primary",
      maxBytes: 1024,
      signal: controller.signal,
    })
    const write = await macosBackend.writeText("text", { selection: "primary", signal: controller.signal })
    const clear = await macosBackend.clear({ selection: "primary", signal: controller.signal })

    expect(read.status).toBe("unsupported")
    expect(write.status).toBe("unsupported")
    expect(clear.status).toBe("unsupported")
  })

  it("falls back from a local host failure for best-available writes", async () => {
    const localClipboard: ClipboardService = {
      async read() {
        return { status: "empty" }
      },
      async writeText() {
        return {
          host: { status: "failed", error: new Error("host write failed") },
          terminal: { status: "attempted", capability: "unknown" },
        }
      },
      async clear() {
        return {
          host: { status: "failed", error: new Error("host clear failed") },
          terminal: { status: "attempted", capability: "unknown" },
        }
      },
    }

    const result = await localClipboard.writeText("local text", { destination: "best-available" })

    expect(result.host.status).toBe("failed")
    expect(result.terminal.status).toBe("attempted")
  })

  it("keeps empty text distinct from clearing", async () => {
    const clipboard: ClipboardService = {
      async read() {
        return { status: "empty" }
      },
      async writeText(text) {
        if (text.length === 0) throw new TypeError("writeText requires non-empty text")
        if (text.includes("\0")) throw new TypeError("writeText does not support NUL characters")
        return {
          host: { status: "written" },
          terminal: { status: "not-attempted", capability: "unknown" },
        }
      },
      async clear() {
        return {
          host: { status: "cleared" },
          terminal: { status: "not-attempted", capability: "unknown" },
        }
      },
    }

    await expect(clipboard.writeText("", { destination: "host-only" })).rejects.toThrow("non-empty text")
    await expect(clipboard.writeText("before\0after", { destination: "host-only" })).rejects.toThrow("NUL characters")
    expect((await clipboard.clear({ destination: "host-only" })).host.status).toBe("cleared")
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
