import { dlopen, ptr, type Library } from "../platform/ffi.js"
import {
  NativeClipboardCancelStatus,
  NativeClipboardCopyStatus,
  NativeClipboardDestroyStatus,
  NativeClipboardOperationStatus,
  NativeClipboardShutdownStatus,
  NativeClipboardStartStatus,
  type ClipboardOperationHandle,
  type ClipboardServiceHandle,
} from "../zig.js"

const symbols = {
  clipboardServiceCreate: { args: ["u32", "u32", "ptr", "u32"], returns: "u32" },
  clipboardServiceBeginShutdown: { args: ["u32"], returns: "u8" },
  clipboardServicePollShutdown: { args: ["u32"], returns: "u8" },
  clipboardServiceDestroy: { args: ["u32"], returns: "u8" },
  clipboardServiceDrain: { args: ["u32"], returns: "u8" },
  clipboardTestOperationStart: { args: ["u32", "ptr", "u32", "u32", "ptr"], returns: "u8" },
  clipboardReadOperationStart: { args: ["u32", "ptr", "u32", "u8", "u32", "u32", "ptr"], returns: "u8" },
  clipboardWriteOperationStart: { args: ["u32", "ptr", "u32", "u8", "u32", "ptr"], returns: "u8" },
  clipboardClearOperationStart: { args: ["u32", "u8", "u32", "ptr"], returns: "u8" },
  clipboardOperationPoll: { args: ["u32"], returns: "u8" },
  clipboardOperationCancel: { args: ["u32"], returns: "u8" },
  clipboardOperationResultMimeLength: { args: ["u32", "ptr"], returns: "u8" },
  clipboardOperationResultMimeCopy: { args: ["u32", "ptr", "u32"], returns: "u8" },
  clipboardOperationResultDataLength: { args: ["u32", "ptr"], returns: "u8" },
  clipboardOperationResultDataCopy: { args: ["u32", "ptr", "u32"], returns: "u8" },
  clipboardOperationDestroy: { args: ["u32"], returns: "u8" },
} as const

type ClipboardWorkerLibrary = Library<typeof symbols>

const resolveNativeLibraryPath = async (): Promise<string> => {
  if (process.platform === "linux" && process.arch === "x64") {
    if (process.env.OPENTUI_LIBC === "musl") {
      // @ts-ignore Optional native package is present only for its matching target.
      return (await import("@opentui/core-linux-x64-musl")).default
    }
    // @ts-ignore Optional native package is present only for its matching target.
    return (await import("@opentui/core-linux-x64")).default
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    if (process.env.OPENTUI_LIBC === "musl") {
      // @ts-ignore Optional native package is present only for its matching target.
      return (await import("@opentui/core-linux-arm64-musl")).default
    }
    // @ts-ignore Optional native package is present only for its matching target.
    return (await import("@opentui/core-linux-arm64")).default
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    // @ts-ignore Optional native package is present only for its matching target.
    return (await import("@opentui/core-darwin-x64")).default
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    // @ts-ignore Optional native package is present only for its matching target.
    return (await import("@opentui/core-darwin-arm64")).default
  }
  if (process.platform === "win32" && process.arch === "x64") {
    // @ts-ignore Optional native package is present only for its matching target.
    return (await import("@opentui/core-win32-x64")).default
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    // @ts-ignore Optional native package is present only for its matching target.
    return (await import("@opentui/core-win32-arm64")).default
  }
  throw new Error(`Unsupported native worker test target: ${process.platform}-${process.arch}`)
}

const libraryPath = await resolveNativeLibraryPath()

export class ClipboardNativeWorkerTestLib {
  private readonly library: ClipboardWorkerLibrary
  private readonly services = new Set<ClipboardServiceHandle>()
  private readonly operations = new Set<ClipboardOperationHandle>()
  private disposed = false

  constructor() {
    this.library = dlopen(libraryPath, symbols)
  }

  createService(maxOperations: number): ClipboardServiceHandle | null {
    const handle = this.library.symbols.clipboardServiceCreate(maxOperations, 16, null, 0)
    if (handle === 0) return null
    const service = handle as ClipboardServiceHandle
    this.services.add(service)
    return service
  }

  beginShutdown(service: ClipboardServiceHandle): NativeClipboardShutdownStatus {
    if (!this.services.has(service)) return NativeClipboardShutdownStatus.InvalidHandle
    return this.library.symbols.clipboardServiceBeginShutdown(service)
  }

  pollShutdown(service: ClipboardServiceHandle): NativeClipboardShutdownStatus {
    if (!this.services.has(service)) return NativeClipboardShutdownStatus.InvalidHandle
    return this.library.symbols.clipboardServicePollShutdown(service)
  }

  destroyService(service: ClipboardServiceHandle): NativeClipboardDestroyStatus {
    if (!this.services.has(service)) return NativeClipboardDestroyStatus.InvalidHandle
    const status = this.library.symbols.clipboardServiceDestroy(service)
    if (status === NativeClipboardDestroyStatus.Destroyed) this.services.delete(service)
    return status
  }

  start(
    service: ClipboardServiceHandle,
    request: Uint8Array,
    delayMs: number,
  ): { status: NativeClipboardStartStatus; operation: ClipboardOperationHandle | null } {
    if (!this.services.has(service)) return { status: NativeClipboardStartStatus.InvalidService, operation: null }
    const output = new Uint32Array(1)
    const status = this.library.symbols.clipboardTestOperationStart(
      service,
      request.byteLength === 0 ? null : ptr(request),
      request.byteLength,
      delayMs,
      ptr(output),
    )
    const operation = output[0] === 0 ? null : (output[0] as ClipboardOperationHandle)
    if (operation) this.operations.add(operation)
    return { status, operation }
  }

  startRead(
    service: ClipboardServiceHandle,
    request: Uint8Array,
    selection: number,
    maxBytes: number,
    timeoutMs: number,
  ): { status: NativeClipboardStartStatus; operation: ClipboardOperationHandle | null } {
    return this.startOperation((output) =>
      this.library.symbols.clipboardReadOperationStart(
        service,
        request.byteLength === 0 ? null : ptr(request),
        request.byteLength,
        selection,
        maxBytes,
        timeoutMs,
        ptr(output),
      ),
    )
  }

  startWrite(
    service: ClipboardServiceHandle,
    text: Uint8Array,
    selection: number,
    timeoutMs: number,
  ): { status: NativeClipboardStartStatus; operation: ClipboardOperationHandle | null } {
    return this.startOperation((output) =>
      this.library.symbols.clipboardWriteOperationStart(
        service,
        text.byteLength === 0 ? null : ptr(text),
        text.byteLength,
        selection,
        timeoutMs,
        ptr(output),
      ),
    )
  }

  startClear(
    service: ClipboardServiceHandle,
    selection: number,
    timeoutMs: number,
  ): { status: NativeClipboardStartStatus; operation: ClipboardOperationHandle | null } {
    return this.startOperation((output) =>
      this.library.symbols.clipboardClearOperationStart(service, selection, timeoutMs, ptr(output)),
    )
  }

  poll(operation: ClipboardOperationHandle): NativeClipboardOperationStatus {
    if (!this.operations.has(operation)) return NativeClipboardOperationStatus.InvalidHandle
    return this.library.symbols.clipboardOperationPoll(operation)
  }

  cancel(operation: ClipboardOperationHandle): NativeClipboardCancelStatus {
    if (!this.operations.has(operation)) return NativeClipboardCancelStatus.InvalidHandle
    return this.library.symbols.clipboardOperationCancel(operation)
  }

  resultMimeLength(operation: ClipboardOperationHandle): { status: NativeClipboardCopyStatus; length: number } {
    return this.resultLength(this.library.symbols.clipboardOperationResultMimeLength, operation)
  }

  resultMimeCopy(operation: ClipboardOperationHandle, output: Uint8Array): NativeClipboardCopyStatus {
    if (!this.operations.has(operation)) return NativeClipboardCopyStatus.InvalidHandle
    return this.library.symbols.clipboardOperationResultMimeCopy(
      operation,
      output.byteLength === 0 ? null : ptr(output),
      output.byteLength,
    )
  }

  resultDataLength(operation: ClipboardOperationHandle): { status: NativeClipboardCopyStatus; length: number } {
    return this.resultLength(this.library.symbols.clipboardOperationResultDataLength, operation)
  }

  resultDataCopy(operation: ClipboardOperationHandle, output: Uint8Array): NativeClipboardCopyStatus {
    if (!this.operations.has(operation)) return NativeClipboardCopyStatus.InvalidHandle
    return this.library.symbols.clipboardOperationResultDataCopy(
      operation,
      output.byteLength === 0 ? null : ptr(output),
      output.byteLength,
    )
  }

  destroyOperation(operation: ClipboardOperationHandle): NativeClipboardDestroyStatus {
    if (!this.operations.has(operation)) return NativeClipboardDestroyStatus.InvalidHandle
    const status = this.library.symbols.clipboardOperationDestroy(operation)
    if (status === NativeClipboardDestroyStatus.Destroyed) this.operations.delete(operation)
    return status
  }

  dispose(): void {
    if (this.disposed) return
    if (this.services.size > 0) throw new Error("Cannot dispose native worker library while services are active")
    this.disposed = true
    this.operations.clear()
    this.library.close()
  }

  private resultLength(
    symbol: (operation: ClipboardOperationHandle, output: Uint32Array) => number,
    operation: ClipboardOperationHandle,
  ): { status: NativeClipboardCopyStatus; length: number } {
    if (!this.operations.has(operation)) return { status: NativeClipboardCopyStatus.InvalidHandle, length: 0 }
    const output = new Uint32Array(1)
    const status = symbol(operation, output)
    return { status, length: output[0] }
  }

  private startOperation(start: (output: Uint32Array) => number): {
    status: NativeClipboardStartStatus
    operation: ClipboardOperationHandle | null
  } {
    const output = new Uint32Array(1)
    const status = start(output)
    const operation = output[0] === 0 ? null : (output[0] as ClipboardOperationHandle)
    if (operation) this.operations.add(operation)
    return { status, operation }
  }
}
