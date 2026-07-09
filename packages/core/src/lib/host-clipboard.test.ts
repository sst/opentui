import { describe, expect, it } from "bun:test"
import {
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
    const expectInvalidNumbers = (names: readonly (keyof HostClipboardOptions)[], values: readonly number[]) => {
      for (const name of names) {
        for (const value of values) {
          expect(() => createHost(backend, { [name]: value } as HostClipboardOptions)).toThrow(RangeError)
        }
      }
    }

    const invalidU32 = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000]
    expectInvalidNumbers(
      [
        "timeoutMs",
        "maxReadBytes",
        "maxWriteBytes",
        "maxImagePixels",
        "maxConversionBytes",
        "maxConcurrentOperations",
        "maxProviderTransfers",
        "maxWorkUnitsPerDrain",
      ],
      invalidU32,
    )
    expectInvalidNumbers(["maxConcurrentOperations", "maxProviderTransfers", "maxWorkUnitsPerDrain"], [0])
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

  it("rejects invalid MIME preferences without dispatch", async () => {
    const fake = createBackend()
    const host = createHost(fake.backend)

    for (const preferredTypes of [[], ["text/plain; charset=utf-8"], ["text"]]) {
      await expect(host.read({ preferredTypes: preferredTypes as [string, ...string[]] })).rejects.toThrow(TypeError)
    }
    expect(fake.reads).toHaveLength(0)
    await host.dispose()
  })

  it("rejects MIME preferences beyond native protocol capacities without dispatch", async () => {
    const fake = createBackend()
    const host = createHost(fake.backend)
    const tooManyTypes = Array.from({ length: 65 }, (_, index) => `application/x-${index}`) as [string, ...string[]]
    const tooLongType = `application/${"a".repeat(244)}`

    await expect(host.read({ preferredTypes: tooManyTypes })).rejects.toThrow(RangeError)
    await expect(host.read({ preferredTypes: [tooLongType] })).rejects.toThrow(RangeError)
    expect(fake.reads).toHaveLength(0)
    await host.dispose()
  })

  it("accepts MIME preferences at native protocol capacities", async () => {
    const fake = createBackend()
    const host = createHost(fake.backend)
    const preferredTypes = Array.from({ length: 64 }, (_, index) => `Application/X-${index}`) as [string, ...string[]]
    preferredTypes[63] = `Application/${"A".repeat(243)}`

    await host.read({ preferredTypes })
    const normalizedTypes = preferredTypes.map((mimeType) => mimeType.toLowerCase()) as [string, ...string[]]
    expect(fake.reads).toHaveLength(1)
    expect(fake.reads[0]?.preferredTypes).toEqual(normalizedTypes)
    expect(fake.reads[0]?.preferredTypes[63]).toHaveLength(255)
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

  it("preserves a tighter caller operation limit", async () => {
    let release: (() => void) | undefined
    let readCount = 0
    const fake = createBackend({
      async read() {
        readCount += 1
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { status: "empty" }
      },
    })
    const host = createHost(fake.backend, { maxConcurrentOperations: 1 })
    const first = host.read({ preferredTypes: ["text/plain"] })

    const second = await host.read({ preferredTypes: ["text/plain"] })
    expect(second.status).toBe("failed")
    if (second.status === "failed") expect(second.error.message).toContain("operation limit")
    expect(readCount).toBe(1)

    release?.()
    await first
    await host.dispose()
  })

  it("returns the stable caller-owned bytes supplied by the backend", async () => {
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
      expect(result.representation.bytes).toBe(bytes)
    }
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
