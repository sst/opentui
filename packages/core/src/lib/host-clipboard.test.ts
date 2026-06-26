import { describe, expect, it } from "bun:test"
import {
  createHostClipboard,
  type ClipboardReadResult,
  type HostClipboardBackend,
  type HostClipboardOptions,
  type HostClipboardReadOptions,
  type HostClipboardWriteOptions,
} from "./clipboard.js"
import {
  createHostClipboardWithBackend,
  normalizeRemainingTimeout,
  type NormalizedHostClipboardOptions,
} from "./host-clipboard.internal.js"

const createBackend = (overrides: Partial<HostClipboardBackend> = {}) => {
  const reads: HostClipboardReadOptions[] = []
  const writes: Array<{ text: string; options: HostClipboardWriteOptions }> = []
  const clears: HostClipboardWriteOptions[] = []
  let disposeCount = 0
  const backend: HostClipboardBackend = {
    async read(options) {
      reads.push(options)
      return { status: "empty" }
    },
    async writeText(text, options) {
      writes.push({ text, options })
      return { status: "written" }
    },
    async clear(options) {
      clears.push(options)
      return { status: "cleared" }
    },
    async dispose() {
      disposeCount++
    },
    ...overrides,
  }
  return {
    backend,
    reads,
    writes,
    clears,
    get disposeCount() {
      return disposeCount
    },
  }
}

const createHost = (backend: HostClipboardBackend, options: HostClipboardOptions = {}) =>
  createHostClipboardWithBackend(options, () => backend)

describe("createHostClipboard", () => {
  it("validates configuration before dispatch", () => {
    const { backend } = createBackend()
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000]) {
      expect(() => createHost(backend, { timeoutMs: value })).toThrow(RangeError)
      expect(() => createHost(backend, { maxReadBytes: value })).toThrow(RangeError)
      expect(() => createHost(backend, { maxWriteBytes: value })).toThrow(RangeError)
      expect(() => createHost(backend, { maxImagePixels: value })).toThrow(RangeError)
      expect(() => createHost(backend, { maxConversionBytes: value })).toThrow(RangeError)
    }
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000]) {
      expect(() => createHost(backend, { maxConcurrentOperations: value })).toThrow(RangeError)
      expect(() => createHost(backend, { maxProviderTransfers: value })).toThrow(RangeError)
      expect(() => createHost(backend, { maxWorkUnitsPerDrain: value })).toThrow(RangeError)
    }
    for (const waylandSeat of ["", "seat\0name"]) {
      expect(() => createHost(backend, { waylandSeat })).toThrow(TypeError)
    }
  })

  it("does not dispatch backend work when the operation timeout is zero", async () => {
    const fake = createBackend()
    const host = createHost(fake.backend, { timeoutMs: 0 })

    expect(await host.read({ preferredTypes: ["text/plain"] })).toEqual({ status: "timed-out" })
    expect(await host.writeText("text")).toEqual({ status: "timed-out" })
    expect(await host.clear()).toEqual({ status: "timed-out" })
    expect(fake.reads).toHaveLength(0)
    expect(fake.writes).toHaveLength(0)
    expect(fake.clears).toHaveLength(0)
    await host.dispose()
  })

  it("preserves a one millisecond backend budget while an exact timeout remainder is positive", () => {
    expect(normalizeRemainingTimeout(1, 0.6)).toBe(1)
    expect(normalizeRemainingTimeout(1, 1)).toBe(0)
    expect(normalizeRemainingTimeout(1, 1.1)).toBe(0)
  })

  it("normalizes defaults, selections, MIME types, signals, and timeout values", async () => {
    const fake = createBackend()
    const host = createHost(fake.backend)

    await host.read({ preferredTypes: ["Image/PNG", "Text/Plain"] })
    await host.writeText("hello")
    await host.clear({ selection: "primary" })

    expect(fake.reads[0]?.preferredTypes).toEqual(["image/png", "text/plain"])
    expect(fake.reads[0]?.selection).toBe("clipboard")
    expect(fake.reads[0]?.maxBytes).toBe(8 * 1024 * 1024)
    expect(fake.reads[0]?.timeoutMs).toBeLessThanOrEqual(1_000)
    expect(fake.reads[0]?.timeoutMs).toBeGreaterThanOrEqual(0)
    expect(fake.reads[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(fake.writes[0]?.options.selection).toBe("clipboard")
    expect(fake.writes[0]?.options.timeoutMs).toBeLessThanOrEqual(1_000)
    expect(fake.clears[0]?.selection).toBe("primary")
    await host.dispose()
  })

  it("passes every normalized construction option to the internal backend factory", async () => {
    const fake = createBackend()
    let received: NormalizedHostClipboardOptions | undefined
    const host = createHostClipboardWithBackend(
      {
        timeoutMs: 9,
        maxReadBytes: 10,
        maxWriteBytes: 11,
        maxImagePixels: 12,
        maxConversionBytes: 13,
        maxConcurrentOperations: 14,
        maxProviderTransfers: 15,
        maxWorkUnitsPerDrain: 16,
        waylandSeat: "seat0",
      },
      (options) => {
        received = options
        return fake.backend
      },
    )

    expect(received).toEqual({
      timeoutMs: 9,
      maxReadBytes: 10,
      maxWriteBytes: 11,
      maxImagePixels: 12,
      maxConversionBytes: 13,
      maxConcurrentOperations: 14,
      maxProviderTransfers: 15,
      maxWorkUnitsPerDrain: 16,
      waylandSeat: "seat0",
    })
    await host.dispose()
  })

  it("constructs the public host service without exposing a backend", async () => {
    const host = createHostClipboard({ timeoutMs: 100, waylandSeat: "opentui-test-missing-seat" })
    expect(await host.read({ preferredTypes: ["text/plain"] })).toEqual({ status: "unsupported" })
    expect(await host.writeText("text")).toEqual({ status: "unsupported" })
    expect(await host.clear()).toEqual({ status: "unsupported" })
    await host.dispose()
  })

  it("rejects invalid MIME preferences without dispatch", async () => {
    const fake = createBackend()
    const host = createHost(fake.backend)

    for (const preferredTypes of [[], ["text/plain; charset=utf-8"], ["text"]]) {
      await expect(host.read({ preferredTypes: preferredTypes as [string, ...string[]] })).rejects.toThrow(TypeError)
    }
    expect(fake.reads).toHaveLength(0)
    await host.dispose()
  })

  it("accepts asterisks inside concrete MIME type tokens", async () => {
    const fake = createBackend()
    const host = createHost(fake.backend)

    await host.read({ preferredTypes: ["Application/Foo*Bar"] })
    expect(fake.reads[0]?.preferredTypes).toEqual(["application/foo*bar"])
    await host.dispose()
  })

  it("validates UTF-8 text and the write limit before dispatch", async () => {
    const fake = createBackend()
    const host = createHost(fake.backend, { maxWriteBytes: 4 })

    await expect(host.writeText("")).rejects.toThrow("non-empty")
    await expect(host.writeText("a\0b")).rejects.toThrow("NUL")
    await expect(host.writeText("hello")).rejects.toThrow(RangeError)
    await expect(host.writeText("世界")).rejects.toThrow(RangeError)
    await expect(host.writeText("ééé")).rejects.toThrow(RangeError)
    expect(fake.writes).toHaveLength(0)
    await host.writeText("four")
    await host.writeText("éé")
    expect(fake.writes).toHaveLength(2)
    await host.dispose()
  })

  it("does not dispatch a pre-aborted operation and composes later caller cancellation", async () => {
    let observedSignal: AbortSignal | undefined
    const fake = createBackend({
      async read(options) {
        observedSignal = options.signal
        return await new Promise<ClipboardReadResult>((resolve) => {
          options.signal.addEventListener("abort", () => resolve({ status: "cancelled" }), { once: true })
        })
      },
    })
    const host = createHost(fake.backend)
    const preAborted = AbortSignal.abort()

    expect(await host.read({ preferredTypes: ["text/plain"], signal: preAborted })).toEqual({ status: "cancelled" })
    expect(observedSignal).toBeUndefined()

    const controller = new AbortController()
    const pending = host.read({ preferredTypes: ["text/plain"], signal: controller.signal })
    controller.abort()
    expect(await pending).toEqual({ status: "cancelled" })
    expect(observedSignal?.aborted).toBe(true)
    await host.dispose()
  })

  it("copies returned bytes for caller ownership", async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const fake = createBackend({
      async read() {
        return { status: "read", representation: { mimeType: "image/png", bytes } }
      },
    })
    const host = createHost(fake.backend)
    const result = await host.read({ preferredTypes: ["image/png"] })

    expect(result.status).toBe("read")
    if (result.status === "read") {
      expect(result.representation.bytes).not.toBe(bytes)
      bytes[0] = 9
      expect(result.representation.bytes).toEqual(new Uint8Array([1, 2, 3]))
    }
    await host.dispose()
  })

  it("bounds concurrent operations and reuses capacity after cleanup", async () => {
    let finishRead: (() => void) | undefined
    const fake = createBackend({
      async read() {
        await new Promise<void>((resolve) => {
          finishRead = resolve
        })
        return { status: "empty" }
      },
    })
    const host = createHost(fake.backend, { maxConcurrentOperations: 1 })
    const activeRead = host.read({ preferredTypes: ["text/plain"] })

    const excessWrite = await host.writeText("text")
    const excessClear = await host.clear()
    expect(excessWrite.status).toBe("failed")
    expect(excessClear.status).toBe("failed")
    expect(fake.writes).toHaveLength(0)
    expect(fake.clears).toHaveLength(0)

    finishRead?.()
    await activeRead
    expect((await host.writeText("text")).status).toBe("written")
    await host.dispose()
  })

  it("aborts active operations, waits for cleanup, disposes once, and rejects later calls", async () => {
    let releaseCleanup: (() => void) | undefined
    let backendStarted = false
    const fake = createBackend({
      async read(options) {
        backendStarted = true
        await new Promise<void>((resolve) => {
          options.signal.addEventListener(
            "abort",
            () => {
              releaseCleanup = resolve
            },
            { once: true },
          )
        })
        return { status: "cancelled" }
      },
    })
    const host = createHost(fake.backend)
    const read = host.read({ preferredTypes: ["text/plain"] })
    expect(backendStarted).toBe(true)

    const firstDispose = host.dispose()
    const secondDispose = host.dispose()
    expect(firstDispose).toBe(secondDispose)
    await Promise.resolve()
    expect(fake.disposeCount).toBe(0)
    releaseCleanup?.()
    expect(await read).toEqual({ status: "cancelled" })
    await firstDispose
    expect(fake.disposeCount).toBe(1)
    await expect(host.read({ preferredTypes: ["text/plain"] })).rejects.toThrow("disposed")
    await expect(host.writeText("text")).rejects.toThrow("disposed")
    await expect(host.clear()).rejects.toThrow("disposed")
  })
})
