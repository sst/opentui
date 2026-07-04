import {
  NativeClipboardCopyStatus,
  NativeClipboardDestroyStatus,
  NativeClipboardOperationStatus,
  NativeClipboardShutdownStatus,
  NativeClipboardStartStatus,
  resolveRenderLib,
  type ClipboardOperationHandle,
  type ClipboardServiceHandle,
  type RenderLib,
} from "../zig.js"
import type {
  ClipboardReadResult,
  ClipboardSelection,
  HostClipboardBackend,
  HostClipboardClearResult,
  HostClipboardWriteResult,
} from "./clipboard.js"
import type { HostClipboardBackendFactory } from "./host-clipboard.internal.js"

type NativeResult = ClipboardReadResult | HostClipboardWriteResult | HostClipboardClearResult
const MAX_U32 = 0xffff_ffff
const OPERATION_POLL_INTERVAL_MS = 1
const PROVIDER_POLL_INTERVAL_MS = 8

interface PendingOperation {
  readonly handle: ClipboardOperationHandle
  readonly kind: "read" | "write" | "clear"
  readonly signal: AbortSignal
  readonly resolve: (result: NativeResult) => void
  terminalResult?: NativeResult
}

const selectionValue = (selection: ClipboardSelection): number => (selection === "clipboard" ? 0 : 1)

const schedule = (
  callback: () => void,
  delayMs = OPERATION_POLL_INTERVAL_MS,
  keepAlive = true,
): ReturnType<typeof setTimeout> => {
  const timer = setTimeout(callback, delayMs)
  if (!keepAlive && typeof timer === "object" && "unref" in timer) timer.unref()
  return timer
}

const encodeReadRequest = (preferredTypes: readonly [string, ...string[]]): Uint8Array => {
  if (preferredTypes.length > MAX_U32) throw new RangeError("Clipboard MIME preference count exceeds native u32 limit")
  let size = 4
  for (const mimeType of preferredTypes) {
    // MIME validation permits ASCII token bytes only, so code units equal UTF-8 bytes here.
    if (mimeType.length > MAX_U32 || size > MAX_U32 - 4 - mimeType.length) {
      throw new RangeError("Clipboard MIME preference request exceeds native u32 limit")
    }
    size += 4 + mimeType.length
  }
  const encoder = new TextEncoder()
  const encoded = preferredTypes.map((mimeType) => encoder.encode(mimeType))
  const request = new Uint8Array(size)
  const view = new DataView(request.buffer)
  view.setUint32(0, encoded.length, true)
  let offset = 4
  for (const mimeType of encoded) {
    view.setUint32(offset, mimeType.byteLength, true)
    offset += 4
    request.set(mimeType, offset)
    offset += mimeType.byteLength
  }
  return request
}

const startFailure = (status: NativeClipboardStartStatus): NativeResult => ({
  status: "failed",
  error: new Error(`Native clipboard operation failed to start (${NativeClipboardStartStatus[status]})`),
})

class NativeClipboardBackend implements HostClipboardBackend {
  private readonly library: RenderLib
  private readonly service: ClipboardServiceHandle
  private readonly pending = new Map<ClipboardOperationHandle, PendingOperation>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private providerActive = false
  private disposed = false
  private disposePromise: Promise<void> | undefined

  constructor(
    private readonly maxWorkUnitsPerDrain: number,
    maxConcurrentOperations: number,
    maxProviderTransfers: number,
    waylandSeat?: string,
  ) {
    this.library = resolveRenderLib()
    const service = this.library.clipboardServiceCreate(maxConcurrentOperations, maxProviderTransfers, waylandSeat)
    if (!service) throw new Error("Failed to create native clipboard service")
    this.service = service
  }

  read(options: Parameters<HostClipboardBackend["read"]>[0]): Promise<ClipboardReadResult> {
    const request = encodeReadRequest(options.preferredTypes)
    const started = this.library.clipboardReadOperationStart(
      this.service,
      request,
      selectionValue(options.selection),
      options.maxBytes,
      options.timeoutMs,
    )
    return this.track(started, options.signal, "read") as Promise<ClipboardReadResult>
  }

  writeText(
    text: string,
    options: Parameters<HostClipboardBackend["writeText"]>[1],
  ): Promise<HostClipboardWriteResult> {
    const started = this.library.clipboardWriteOperationStart(
      this.service,
      new TextEncoder().encode(text),
      selectionValue(options.selection),
      options.timeoutMs,
    )
    return this.track(started, options.signal, "write") as Promise<HostClipboardWriteResult>
  }

  clear(options: Parameters<HostClipboardBackend["clear"]>[0]): Promise<HostClipboardClearResult> {
    const started = this.library.clipboardClearOperationStart(
      this.service,
      selectionValue(options.selection),
      options.timeoutMs,
    )
    return this.track(started, options.signal, "clear") as Promise<HostClipboardClearResult>
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    this.disposePromise = this.shutdown()
    return this.disposePromise
  }

  private track(
    started: { status: NativeClipboardStartStatus; operation: ClipboardOperationHandle | null },
    signal: AbortSignal,
    kind: PendingOperation["kind"],
  ): Promise<NativeResult> {
    if (this.disposed) return Promise.reject(new Error("Native clipboard backend is disposed"))
    if (started.status !== NativeClipboardStartStatus.Ok || !started.operation) {
      return Promise.resolve(startFailure(started.status))
    }
    return new Promise((resolve) => {
      const operation: PendingOperation = { handle: started.operation!, kind, signal, resolve }
      this.pending.set(operation.handle, operation)
      signal.addEventListener("abort", () => this.requestCancel(operation), { once: true })
      this.ensureScheduled()
      this.drain()
    })
  }

  private requestCancel(operation: PendingOperation): void {
    if (!this.pending.has(operation.handle)) return
    this.library.clipboardOperationCancel(operation.handle)
    this.ensureScheduled()
  }

  private ensureScheduled(): void {
    if (this.timer) {
      if (this.pending.size > 0 && typeof this.timer === "object" && "ref" in this.timer) this.timer.ref()
      return
    }
    if (this.pending.size === 0 && !this.providerActive) return
    const hasPendingOperation = this.pending.size > 0
    this.timer = schedule(
      () => {
        this.timer = undefined
        this.drain()
      },
      hasPendingOperation ? OPERATION_POLL_INTERVAL_MS : PROVIDER_POLL_INTERVAL_MS,
      hasPendingOperation,
    )
  }

  private drain(): void {
    // A write can publish a provider before its operation becomes terminal while output is backpressured.
    this.providerActive = this.library.clipboardServiceDrain(this.service) === 1
    let workUnits = 0
    while (workUnits < this.maxWorkUnitsPerDrain && this.pending.size > 0) {
      const operation = this.pending.values().next().value
      if (!operation) break
      workUnits += 1
      if (operation.signal.aborted) this.library.clipboardOperationCancel(operation.handle)
      if (!operation.terminalResult) {
        const status = this.library.clipboardOperationPoll(operation.handle)
        if (status === NativeClipboardOperationStatus.Pending) {
          this.rotate(operation)
          continue
        }
        operation.terminalResult = this.readResult(operation.handle, operation.kind, status)
        if (status === NativeClipboardOperationStatus.Written || status === NativeClipboardOperationStatus.Cleared) {
          this.providerActive = true
        }
      }
      const destroyed = this.library.clipboardOperationDestroy(operation.handle)
      if (destroyed === NativeClipboardDestroyStatus.NotReady) {
        this.rotate(operation)
        continue
      }
      this.pending.delete(operation.handle)
      operation.resolve(
        destroyed === NativeClipboardDestroyStatus.Destroyed
          ? operation.terminalResult
          : { status: "failed", error: new Error("Native clipboard operation became invalid before destruction") },
      )
    }
    if (this.pending.size === 0 && !this.providerActive && this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    } else if (this.pending.size === 0 && this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref()
    } else {
      this.ensureScheduled()
    }
  }

  private rotate(operation: PendingOperation): void {
    this.pending.delete(operation.handle)
    this.pending.set(operation.handle, operation)
  }

  private readResult(
    handle: ClipboardOperationHandle,
    kind: PendingOperation["kind"],
    status: NativeClipboardOperationStatus,
  ): NativeResult {
    switch (status) {
      case NativeClipboardOperationStatus.Read:
        return kind === "read" ? this.readRepresentation(handle) : this.invalidResult(kind, status)
      case NativeClipboardOperationStatus.Empty:
        return kind === "read" ? { status: "empty" } : this.invalidResult(kind, status)
      case NativeClipboardOperationStatus.Written:
        return kind === "write" ? { status: "written" } : this.invalidResult(kind, status)
      case NativeClipboardOperationStatus.Cleared:
        return kind === "clear" ? { status: "cleared" } : this.invalidResult(kind, status)
      case NativeClipboardOperationStatus.Unsupported:
        return { status: "unsupported" }
      case NativeClipboardOperationStatus.Cancelled:
        return { status: "cancelled" }
      case NativeClipboardOperationStatus.TimedOut:
        return { status: "timed-out" }
      case NativeClipboardOperationStatus.LimitExceeded:
        return kind === "read" ? { status: "limit-exceeded" } : this.invalidResult(kind, status)
      case NativeClipboardOperationStatus.Failed:
        return { status: "failed", error: this.readError(handle) }
      default:
        return { status: "failed", error: new Error("Native clipboard operation returned an invalid status") }
    }
  }

  private invalidResult(kind: PendingOperation["kind"], status: NativeClipboardOperationStatus): NativeResult {
    return {
      status: "failed",
      error: new Error(
        `Native clipboard ${kind} returned inapplicable status ${NativeClipboardOperationStatus[status]}`,
      ),
    }
  }

  private readRepresentation(handle: ClipboardOperationHandle): ClipboardReadResult {
    const mimeLength = this.library.clipboardOperationResultMimeLength(handle)
    const dataLength = this.library.clipboardOperationResultDataLength(handle)
    if (mimeLength.status !== NativeClipboardCopyStatus.Ok || dataLength.status !== NativeClipboardCopyStatus.Ok) {
      return { status: "failed", error: new Error("Failed to read native clipboard result lengths") }
    }
    const mime = new Uint8Array(mimeLength.length)
    const bytes = new Uint8Array(dataLength.length)
    if (
      this.library.clipboardOperationResultMimeCopy(handle, mime) !== NativeClipboardCopyStatus.Ok ||
      this.library.clipboardOperationResultDataCopy(handle, bytes) !== NativeClipboardCopyStatus.Ok
    ) {
      return { status: "failed", error: new Error("Failed to copy native clipboard result") }
    }
    return { status: "read", representation: { mimeType: new TextDecoder().decode(mime), bytes } }
  }

  private readError(handle: ClipboardOperationHandle): Error {
    const code = this.library.clipboardOperationResultErrorCode(handle)
    const length = this.library.clipboardOperationResultDiagnosticLength(handle)
    if (code.status !== NativeClipboardCopyStatus.Ok || length.status !== NativeClipboardCopyStatus.Ok) {
      return new Error("Native clipboard operation failed without a readable diagnostic")
    }
    const diagnostic = new Uint8Array(length.length)
    if (this.library.clipboardOperationResultDiagnosticCopy(handle, diagnostic) !== NativeClipboardCopyStatus.Ok) {
      return new Error("Native clipboard operation failed without a readable diagnostic")
    }
    return Object.assign(new Error(new TextDecoder().decode(diagnostic)), { code: code.errorCode })
  }

  private async shutdown(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    let status = this.library.clipboardServiceBeginShutdown(this.service)
    while (status === NativeClipboardShutdownStatus.Pending) {
      await new Promise<void>((resolve) => schedule(resolve))
      status = this.library.clipboardServicePollShutdown(this.service)
    }
    if (status !== NativeClipboardShutdownStatus.Ready) throw new Error("Native clipboard service became invalid")
    if (this.library.clipboardServiceDestroy(this.service) !== NativeClipboardDestroyStatus.Destroyed) {
      throw new Error("Failed to destroy native clipboard service")
    }
  }
}

export const createNativeHostClipboardBackend: HostClipboardBackendFactory = (options) =>
  new NativeClipboardBackend(
    options.maxWorkUnitsPerDrain,
    options.maxConcurrentOperations,
    options.maxProviderTransfers,
    options.waylandSeat,
  )
