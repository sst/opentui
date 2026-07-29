import { describe, expect, it } from "bun:test"
import { NativeImage } from "../image.js"
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

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==",
    "base64",
  ),
)

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

    const results = await Promise.all([
      host.read({ preferredTypes: ["text/plain"] }),
      host.writeText("text"),
      host.clear(),
    ])
    expect(results.map(({ status }) => status)).toEqual(["timed-out", "timed-out", "timed-out"])
    expect([fake.reads.length, fake.writes.length, fake.clears.length]).toEqual([0, 0, 0])
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
    const options = {
      timeoutMs: 9,
      maxReadBytes: 10,
      maxWriteBytes: 11,
      maxImagePixels: 12,
      maxConversionBytes: 13,
      maxConcurrentOperations: 14,
      maxProviderTransfers: 15,
      maxWorkUnitsPerDrain: 16,
      waylandSeat: "seat0",
    }
    const host = createHostClipboardWithBackend(options, (normalized) => {
      received = normalized
      return fake.backend
    })

    expect(received).toEqual(options)
    await host.dispose()
  })

  it("validates and normalizes MIME preferences at native protocol boundaries", async () => {
    const fake = createBackend()
    const host = createHost(fake.backend)

    const invalidPreferences = [
      [[], TypeError],
      [["text/plain; charset=utf-8"], TypeError],
      [["text"], TypeError],
      [Array.from({ length: 65 }, (_, index) => `application/x-${index}`), RangeError],
      [[`application/${"a".repeat(244)}`], RangeError],
    ] as const
    for (const [preferredTypes, error] of invalidPreferences) {
      await expect(host.read({ preferredTypes: preferredTypes as unknown as [string, ...string[]] })).rejects.toThrow(
        error,
      )
    }
    expect(fake.reads).toHaveLength(0)
    const preferredTypes = Array.from({ length: 64 }, (_, index) => `Application/X-${index}`) as [string, ...string[]]
    preferredTypes[63] = `Application/${"A".repeat(243)}`

    await host.read({ preferredTypes })
    const normalizedTypes = preferredTypes.map((mimeType) => mimeType.toLowerCase()) as [string, ...string[]]
    expect(fake.reads).toHaveLength(1)
    expect(fake.reads[0]?.preferredTypes).toEqual(normalizedTypes)
    expect(fake.reads[0]?.preferredTypes[63]).toHaveLength(255)
    await host.read({ preferredTypes: ["Application/Foo*Bar"] })
    expect(fake.reads[1]?.preferredTypes).toEqual(["application/foo*bar"])
    await host.dispose()
  })

  it("keeps encoded PNG bytes and decoded images valid across disposal", async () => {
    const fake = createBackend({
      async read() {
        return { status: "read", representation: { mimeType: "image/png", bytes: PNG_1X1.slice() } }
      },
    })
    const host = createHost(fake.backend)
    try {
      const result = await host.read({ preferredTypes: ["image/png"] })
      expect(result.status).toBe("read")
      if (result.status !== "read") return

      const encoded = result.representation.bytes
      const expectedEncoded = encoded.slice()
      const image = NativeImage.decode(encoded)
      try {
        const expectedRaw = image.raw().data
        await host.dispose()
        expect(encoded).toEqual(expectedEncoded)

        encoded.fill(0)
        expect(image.raw().data).toEqual(expectedRaw)
      } finally {
        image.dispose()
      }
    } finally {
      await host.dispose()
    }
  })

  it("passes through MIME-tagged PNG bytes that fail image decoding", async () => {
    const malformed = PNG_1X1.slice()
    malformed[29] ^= 1
    const fake = createBackend({
      async read() {
        return { status: "read", representation: { mimeType: "image/png", bytes: malformed } }
      },
    })
    const host = createHost(fake.backend)
    try {
      const result = await host.read({ preferredTypes: ["image/png"] })
      expect(result).toEqual({ status: "read", representation: { mimeType: "image/png", bytes: malformed } })
      expect(() => NativeImage.decode(malformed)).toThrow("malformed image data")
    } finally {
      await host.dispose()
    }
  })

  it("validates UTF-8 text and the write limit before dispatch", async () => {
    const fake = createBackend()
    const host = createHost(fake.backend, { maxWriteBytes: 4 })

    for (const [text, error] of [
      ["", "non-empty"],
      ["a\0b", "NUL"],
      ["hello", RangeError],
      ["世界", RangeError],
      ["ééé", RangeError],
    ] as const) {
      await expect(host.writeText(text)).rejects.toThrow(error)
    }
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
