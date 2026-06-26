import { describe, expect, it } from "bun:test"
import {
  createClipboard,
  createRendererClipboardAdapter,
  type HostClipboardBackend,
  type HostClipboardWriteOptions,
  type TerminalClipboardAdapter,
} from "./clipboard.js"
import { createHostClipboardWithBackend } from "./host-clipboard.internal.js"

const createHost = (backend: HostClipboardBackend, maxWriteBytes?: number) =>
  createHostClipboardWithBackend({ maxWriteBytes }, () => backend)

const createServices = (
  options: {
    remote?: boolean
    hostStatus?: "written" | "unsupported" | "cancelled"
    maxWriteBytes?: number
  } = {},
) => {
  const events: string[] = []
  let hostDisposeCount = 0
  const backend: HostClipboardBackend = {
    async read() {
      events.push("host-read")
      return { status: "empty" }
    },
    async writeText(_text, _operation) {
      events.push("host-write")
      return { status: options.hostStatus ?? "written" }
    },
    async clear() {
      events.push("host-clear")
      return { status: options.hostStatus === "cancelled" ? "cancelled" : "cleared" }
    },
    async dispose() {
      hostDisposeCount++
    },
  }
  const terminal: TerminalClipboardAdapter = {
    remote: options.remote ?? false,
    writeText() {
      events.push("terminal-write")
      return { status: "attempted", capability: "supported" }
    },
    clear() {
      events.push("terminal-clear")
      return { status: "attempted", capability: "supported" }
    },
  }
  const clipboard = createClipboard({
    host: createHost(backend, options.maxWriteBytes),
    terminal,
  })
  return {
    clipboard,
    events,
    get hostDisposeCount() {
      return hostDisposeCount
    },
  }
}

describe("createClipboard", () => {
  it("applies local destination policies and best-available fallback", async () => {
    const local = createServices()
    expect((await local.clipboard.writeText("one", { destination: "terminal-only" })).host.status).toBe("not-attempted")
    expect((await local.clipboard.writeText("two", { destination: "host-only" })).terminal.status).toBe("not-attempted")
    const best = await local.clipboard.writeText("three", { destination: "best-available" })
    expect(best.host.status).toBe("written")
    expect(best.terminal.status).toBe("not-attempted")
    await local.clipboard.clear({ destination: "all-available" })
    expect(local.events).toEqual(["terminal-write", "host-write", "host-write", "host-clear", "terminal-clear"])
    await local.clipboard.dispose()

    const fallback = createServices({ hostStatus: "unsupported" })
    const result = await fallback.clipboard.writeText("fallback", { destination: "best-available" })
    expect(result.host.status).toBe("unsupported")
    expect(result.terminal.status).toBe("attempted")
    expect(fallback.events).toEqual(["host-write", "terminal-write"])
    await fallback.clipboard.dispose()
  })

  it("enforces remote host authorization for every policy", async () => {
    const remote = createServices({ remote: true })
    const deniedHost = await remote.clipboard.writeText("one", { destination: "host-only" })
    const best = await remote.clipboard.writeText("two", { destination: "best-available", allowRemoteHost: true })
    const deniedAll = await remote.clipboard.writeText("three", { destination: "all-available" })
    const allowedAll = await remote.clipboard.writeText("four", {
      destination: "all-available",
      allowRemoteHost: true,
    })

    expect(deniedHost.host.status).toBe("not-attempted")
    expect(deniedHost.terminal.status).toBe("not-attempted")
    expect(best.host.status).toBe("not-attempted")
    expect(best.terminal.status).toBe("attempted")
    expect(deniedAll.host.status).toBe("not-attempted")
    expect(allowedAll.host.status).toBe("written")
    expect(remote.events).toEqual(["terminal-write", "terminal-write", "host-write", "terminal-write"])
    await remote.clipboard.dispose()
  })

  it("rejects invalid text before either destination", async () => {
    const service = createServices({ maxWriteBytes: 4 })
    await expect(service.clipboard.writeText("", { destination: "all-available" })).rejects.toThrow("non-empty")
    await expect(service.clipboard.writeText("bad\0text", { destination: "all-available" })).rejects.toThrow("NUL")
    await expect(service.clipboard.writeText("hello", { destination: "terminal-only" })).rejects.toThrow(RangeError)
    expect(service.events).toEqual([])
    await service.clipboard.dispose()
  })

  it("attempts neither destination for pre-aborted all-available operations", async () => {
    const service = createServices()
    const signal = AbortSignal.abort()
    const write = await service.clipboard.writeText("text", { destination: "all-available", signal })
    const clear = await service.clipboard.clear({ destination: "all-available", signal })

    expect(write).toEqual({
      host: { status: "not-attempted" },
      terminal: { status: "not-attempted", capability: "unknown" },
    })
    expect(clear).toEqual({
      host: { status: "not-attempted" },
      terminal: { status: "not-attempted", capability: "unknown" },
    })
    expect(service.events).toEqual([])
    await service.clipboard.dispose()
  })

  it("preserves terminal dispatch when all-available host work is later cancelled", async () => {
    let operation: HostClipboardWriteOptions | undefined
    const backend: HostClipboardBackend = {
      async read() {
        return { status: "empty" }
      },
      async writeText(_text, options) {
        operation = options
        return await new Promise((resolve) => {
          options.signal.addEventListener("abort", () => resolve({ status: "cancelled" }), { once: true })
        })
      },
      async clear() {
        return { status: "cleared" }
      },
      async dispose() {},
    }
    let terminalCalls = 0
    const terminal: TerminalClipboardAdapter = {
      remote: false,
      writeText() {
        terminalCalls++
        return { status: "attempted", capability: "unknown" }
      },
      clear() {
        return { status: "attempted", capability: "unknown" }
      },
    }
    const clipboard = createClipboard({ host: createHost(backend), terminal })
    const controller = new AbortController()
    const pending = clipboard.writeText("text", { destination: "all-available", signal: controller.signal })
    expect(terminalCalls).toBe(1)
    controller.abort()
    expect(operation?.signal.aborted).toBe(true)
    expect(await pending).toEqual({
      host: { status: "cancelled" },
      terminal: { status: "attempted", capability: "unknown" },
    })
    await clipboard.dispose()
  })

  it("owns host disposal, waits for active composition, and rejects later operations", async () => {
    let release: (() => void) | undefined
    let disposeCount = 0
    const backend: HostClipboardBackend = {
      async read(options) {
        await new Promise<void>((resolve) => {
          options.signal.addEventListener(
            "abort",
            () => {
              release = resolve
            },
            { once: true },
          )
        })
        return { status: "cancelled" }
      },
      async writeText() {
        return { status: "written" }
      },
      async clear() {
        return { status: "cleared" }
      },
      async dispose() {
        disposeCount++
      },
    }
    const terminal: TerminalClipboardAdapter = {
      remote: false,
      writeText() {
        return { status: "attempted", capability: "unknown" }
      },
      clear() {
        return { status: "attempted", capability: "unknown" }
      },
    }
    const clipboard = createClipboard({ host: createHost(backend), terminal })
    const read = clipboard.read({ preferredTypes: ["text/plain"] })
    const firstDispose = clipboard.dispose()
    expect(clipboard.dispose()).toBe(firstDispose)
    await Promise.resolve()
    expect(disposeCount).toBe(0)
    release?.()
    await read
    await firstDispose
    expect(disposeCount).toBe(1)
    await expect(clipboard.read({ preferredTypes: ["text/plain"] })).rejects.toThrow("disposed")
    await expect(clipboard.writeText("text", { destination: "host-only" })).rejects.toThrow("disposed")
    await expect(clipboard.clear({ destination: "host-only" })).rejects.toThrow("disposed")
  })
})

describe("createRendererClipboardAdapter", () => {
  it("maps selections, capabilities, results, and conservative remote state", () => {
    const calls: Array<[string, number]> = []
    const renderer = {
      capabilities: null as null | { remote: boolean; osc52_support: "supported" | "unsupported" | "unknown" },
      copyToClipboardOSC52(_text: string, target: number) {
        calls.push(["write", target])
        return true
      },
      clearClipboardOSC52(target: number) {
        calls.push(["clear", target])
        return false
      },
    }
    const adapter = createRendererClipboardAdapter(renderer)
    expect(adapter.remote).toBe(true)
    expect(adapter.writeText("text", "primary")).toEqual({ status: "attempted", capability: "unknown" })
    renderer.capabilities = { remote: false, osc52_support: "supported" }
    expect(adapter.remote).toBe(false)
    expect(adapter.clear("clipboard")).toEqual({ status: "local-failure", capability: "supported" })
    renderer.capabilities = { remote: false, osc52_support: "unsupported" }
    expect(adapter.writeText("ignored", "clipboard")).toEqual({
      status: "not-attempted",
      capability: "unsupported",
    })
    expect(calls).toEqual([
      ["write", 1],
      ["clear", 0],
    ])
  })
})
