import type {
  ClipboardReadResult,
  ClipboardSelection,
  HostClipboardBackend,
  HostClipboardOptions,
  HostClipboardService,
} from "./clipboard.js"

const DEFAULT_CLIPBOARD_TIMEOUT_MS = 1_000
const DEFAULT_CLIPBOARD_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_CLIPBOARD_MAX_IMAGE_PIXELS = 64 * 1024 * 1024
const DEFAULT_CLIPBOARD_MAX_CONVERSION_BYTES = 512 * 1024 * 1024
const DEFAULT_CLIPBOARD_MAX_CONCURRENT_OPERATIONS = 16
const DEFAULT_CLIPBOARD_MAX_PROVIDER_TRANSFERS = 16
const DEFAULT_CLIPBOARD_MAX_WORK_UNITS_PER_DRAIN = 64
const MAX_U32 = 0xffff_ffff
const MIME_ESSENCE_PATTERN = /^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/i

export interface NormalizedHostClipboardOptions {
  readonly timeoutMs: number
  readonly maxReadBytes: number
  readonly maxWriteBytes: number
  readonly maxImagePixels: number
  readonly maxConversionBytes: number
  readonly maxConcurrentOperations: number
  readonly maxProviderTransfers: number
  readonly maxWorkUnitsPerDrain: number
  readonly waylandSeat?: string
}

export type HostClipboardBackendFactory = (options: NormalizedHostClipboardOptions) => HostClipboardBackend

export const normalizeRemainingTimeout = (timeoutMs: number, elapsedMs: number): number => {
  const exactRemainingMs = timeoutMs - elapsedMs
  return exactRemainingMs <= 0 ? 0 : Math.max(1, Math.floor(exactRemainingMs))
}

interface ActiveClipboardOperation {
  readonly controller: AbortController
  readonly settled: Promise<void>
  settle(): void
}

const validateU32 = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
    throw new RangeError(`${name} must be an integer from 0 through ${MAX_U32}`)
  }
  return value
}

const validatePositiveU32 = (name: string, value: number): number => {
  const validated = validateU32(name, value)
  if (validated === 0) throw new RangeError(`${name} must be greater than zero`)
  return validated
}

const normalizeOptions = (options: HostClipboardOptions): NormalizedHostClipboardOptions => {
  const waylandSeat = options.waylandSeat
  if (
    waylandSeat !== undefined &&
    (typeof waylandSeat !== "string" || waylandSeat.length === 0 || waylandSeat.includes("\0"))
  ) {
    throw new TypeError("waylandSeat must be a non-empty string without NUL characters")
  }
  return {
    timeoutMs: validateU32("timeoutMs", options.timeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS),
    maxReadBytes: validateU32("maxReadBytes", options.maxReadBytes ?? DEFAULT_CLIPBOARD_MAX_BYTES),
    maxWriteBytes: validateU32("maxWriteBytes", options.maxWriteBytes ?? DEFAULT_CLIPBOARD_MAX_BYTES),
    maxImagePixels: validateU32("maxImagePixels", options.maxImagePixels ?? DEFAULT_CLIPBOARD_MAX_IMAGE_PIXELS),
    maxConversionBytes: validateU32(
      "maxConversionBytes",
      options.maxConversionBytes ?? DEFAULT_CLIPBOARD_MAX_CONVERSION_BYTES,
    ),
    maxConcurrentOperations: validatePositiveU32(
      "maxConcurrentOperations",
      options.maxConcurrentOperations ?? DEFAULT_CLIPBOARD_MAX_CONCURRENT_OPERATIONS,
    ),
    maxProviderTransfers: validatePositiveU32(
      "maxProviderTransfers",
      options.maxProviderTransfers ?? DEFAULT_CLIPBOARD_MAX_PROVIDER_TRANSFERS,
    ),
    maxWorkUnitsPerDrain: validatePositiveU32(
      "maxWorkUnitsPerDrain",
      options.maxWorkUnitsPerDrain ?? DEFAULT_CLIPBOARD_MAX_WORK_UNITS_PER_DRAIN,
    ),
    waylandSeat,
  }
}

const normalizePreferredTypes = (preferredTypes: readonly [string, ...string[]]): readonly [string, ...string[]] => {
  if (!Array.isArray(preferredTypes) || preferredTypes.length === 0) {
    throw new TypeError("preferredTypes must contain at least one MIME essence type")
  }
  const normalized = preferredTypes.map((mimeType) => {
    if (typeof mimeType !== "string" || !MIME_ESSENCE_PATTERN.test(mimeType)) {
      throw new TypeError("preferredTypes must contain valid MIME essence types without parameters")
    }
    return mimeType.toLowerCase()
  })
  return normalized as [string, ...string[]]
}

const normalizeSelection = (selection: ClipboardSelection | undefined): ClipboardSelection => {
  const normalized = selection ?? "clipboard"
  if (normalized !== "clipboard" && normalized !== "primary") {
    throw new TypeError("selection must be clipboard or primary")
  }
  return normalized
}

export const validateClipboardText = (text: string, maxWriteBytes: number): void => {
  if (typeof text !== "string" || text.length === 0) throw new TypeError("writeText requires non-empty text")
  if (text.includes("\0")) throw new TypeError("writeText does not support NUL characters")
  const byteLimit = Math.min(maxWriteBytes, MAX_U32)
  let byteLength = 0
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index)
    if (codeUnit <= 0x7f) {
      byteLength += 1
    } else if (codeUnit <= 0x7ff) {
      byteLength += 2
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < text.length) {
      const nextCodeUnit = text.charCodeAt(index + 1)
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        byteLength += 4
        index += 1
      } else {
        byteLength += 3
      }
    } else {
      byteLength += 3
    }
    if (byteLength > byteLimit) {
      throw new RangeError(`writeText exceeds the configured ${maxWriteBytes} byte limit`)
    }
  }
}

const createActiveOperation = (callerSignal?: AbortSignal): ActiveClipboardOperation => {
  const controller = new AbortController()
  let settle = () => {}
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })
  if (callerSignal) {
    callerSignal.addEventListener("abort", () => controller.abort(callerSignal.reason), {
      once: true,
      signal: controller.signal,
    })
  }
  return { controller, settled, settle }
}

const runTrackedOperation = <T>(
  active: Set<ActiveClipboardOperation>,
  callerSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const state = createActiveOperation(callerSignal)
  active.add(state)
  let result: Promise<T>
  try {
    result = operation(state.controller.signal)
  } catch (error) {
    result = Promise.reject(error)
  }
  return result.finally(() => {
    active.delete(state)
    state.controller.abort()
    state.settle()
  })
}

export const createUnsupportedHostClipboardBackend: HostClipboardBackendFactory = () => ({
  async read() {
    return { status: "unsupported" }
  },
  async writeText() {
    return { status: "unsupported" }
  },
  async clear() {
    return { status: "unsupported" }
  },
  async dispose() {},
})

export const createHostClipboardWithBackend = (
  options: HostClipboardOptions,
  createBackend: HostClipboardBackendFactory,
): HostClipboardService => {
  const config = normalizeOptions(options)
  const backend = createBackend(config)
  const active = new Set<ActiveClipboardOperation>()
  let disposed = false
  let disposePromise: Promise<void> | undefined

  const assertUsable = (): void => {
    if (disposed) throw new Error("Host clipboard service is disposed")
  }
  const remainingTimeout = (startedAt: number): number =>
    normalizeRemainingTimeout(config.timeoutMs, performance.now() - startedAt)
  const atCapacity = (): { readonly status: "failed"; readonly error: Error } | undefined =>
    active.size >= config.maxConcurrentOperations
      ? { status: "failed", error: new Error("Host clipboard operation limit reached") }
      : undefined

  return {
    maxWriteBytes: config.maxWriteBytes,
    read(readOptions) {
      const startedAt = performance.now()
      try {
        assertUsable()
        const preferredTypes = normalizePreferredTypes(readOptions.preferredTypes)
        const selection = normalizeSelection(readOptions.selection)
        if (readOptions.signal?.aborted) return Promise.resolve({ status: "cancelled" })
        const capacityFailure = atCapacity()
        if (capacityFailure) return Promise.resolve(capacityFailure)
        const timeoutMs = remainingTimeout(startedAt)
        if (timeoutMs === 0) return Promise.resolve({ status: "timed-out" })
        return runTrackedOperation(active, readOptions.signal, async (signal) => {
          const result = await backend.read({
            preferredTypes,
            selection,
            maxBytes: config.maxReadBytes,
            timeoutMs,
            signal,
          })
          if (result.status !== "read") return result
          if (result.representation.bytes.byteLength > config.maxReadBytes) return { status: "limit-exceeded" }
          return {
            status: "read",
            representation: { mimeType: result.representation.mimeType, bytes: result.representation.bytes.slice() },
          }
        })
      } catch (error) {
        return Promise.reject(error)
      }
    },
    writeText(text, operationOptions = {}) {
      const startedAt = performance.now()
      try {
        assertUsable()
        validateClipboardText(text, config.maxWriteBytes)
        const selection = normalizeSelection(operationOptions.selection)
        if (operationOptions.signal?.aborted) return Promise.resolve({ status: "cancelled" })
        const capacityFailure = atCapacity()
        if (capacityFailure) return Promise.resolve(capacityFailure)
        const timeoutMs = remainingTimeout(startedAt)
        if (timeoutMs === 0) return Promise.resolve({ status: "timed-out" })
        return runTrackedOperation(active, operationOptions.signal, (signal) =>
          backend.writeText(text, { selection, timeoutMs, signal }),
        )
      } catch (error) {
        return Promise.reject(error)
      }
    },
    clear(operationOptions = {}) {
      const startedAt = performance.now()
      try {
        assertUsable()
        const selection = normalizeSelection(operationOptions.selection)
        if (operationOptions.signal?.aborted) return Promise.resolve({ status: "cancelled" })
        const capacityFailure = atCapacity()
        if (capacityFailure) return Promise.resolve(capacityFailure)
        const timeoutMs = remainingTimeout(startedAt)
        if (timeoutMs === 0) return Promise.resolve({ status: "timed-out" })
        return runTrackedOperation(active, operationOptions.signal, (signal) =>
          backend.clear({ selection, timeoutMs, signal }),
        )
      } catch (error) {
        return Promise.reject(error)
      }
    },
    dispose() {
      if (disposePromise) return disposePromise
      disposed = true
      for (const operation of active) operation.controller.abort()
      disposePromise = (async () => {
        await Promise.all([...active].map((operation) => operation.settled))
        await backend.dispose()
      })()
      return disposePromise
    },
  }
}
