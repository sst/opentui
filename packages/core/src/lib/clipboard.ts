// OSC 52 clipboard support for terminal applications.
// Delegates to native Zig implementation for ANSI sequence generation.

import type { RendererHandle, RenderLib } from "../zig.js"

export interface ClipboardRepresentation {
  // Identifies the content with a canonical, lowercase MIME essence without parameters.
  readonly mimeType: string
  // Contains stable, caller-owned data. The backend does not reuse or change these bytes.
  readonly bytes: Uint8Array
}

export type ClipboardSelection = "clipboard" | "primary"

export interface ClipboardReadOptions {
  // Lists accepted MIME types in preference order. Include at least one type.
  readonly preferredTypes: readonly [string, ...string[]]
  // Selects the standard clipboard by default. Reads always use the process host.
  readonly selection?: ClipboardSelection
  // Cancels the read when aborted.
  readonly signal?: AbortSignal
}

// Reports whether a read returned data or why it did not.
export type ClipboardReadResult =
  | { readonly status: "read"; readonly representation: ClipboardRepresentation }
  | { readonly status: "empty" | "unsupported" | "cancelled" | "timed-out" | "limit-exceeded" }
  | { readonly status: "failed"; readonly error: Error }

export interface HostClipboardReadOptions {
  // Lists accepted MIME types in preference order. Include at least one type.
  readonly preferredTypes: readonly [string, ...string[]]
  readonly selection: ClipboardSelection
  // Rejects representations larger than this number of bytes.
  readonly maxBytes: number
  readonly signal: AbortSignal
}

export interface HostClipboardWriteOptions {
  readonly selection: ClipboardSelection
  readonly signal: AbortSignal
}

export type HostClipboardWriteResult =
  | { readonly status: "written" | "unsupported" | "cancelled" | "timed-out" }
  | { readonly status: "failed"; readonly error: Error }

// `cleared` means the platform completed its clear operation. It does not guarantee durable erasure.
export type HostClipboardClearResult =
  | { readonly status: "cleared" | "unsupported" | "cancelled" | "timed-out" }
  | { readonly status: "failed"; readonly error: Error }

export interface HostClipboardBackend {
  // Returns the first usable representation from `preferredTypes`.
  read(options: HostClipboardReadOptions): Promise<ClipboardReadResult>
  // Writes validated, nonempty text without NUL characters.
  writeText(text: string, options: HostClipboardWriteOptions): Promise<HostClipboardWriteResult>
  // Clears the selection with the platform's clear operation, not an empty-text write.
  clear(options: HostClipboardWriteOptions): Promise<HostClipboardClearResult>
}

// Controls whether an operation uses the terminal, the process host, or both.
export type ClipboardWriteDestination = "terminal-only" | "host-only" | "best-available" | "all-available"

export interface ClipboardWriteOptions {
  readonly destination: ClipboardWriteDestination
  // Selects the standard clipboard by default.
  readonly selection?: ClipboardSelection
  // Allows a host write when the process runs through a remote terminal session.
  readonly allowRemoteHost?: boolean
  // Cancels unfinished work when aborted.
  readonly signal?: AbortSignal
}

export interface TerminalClipboardOperationResult {
  // `attempted` only confirms synchronous local dispatch, including for clear operations.
  readonly status: "attempted" | "local-failure" | "not-attempted"
  // Reports OSC 52 support. It does not guarantee support for the requested selection.
  readonly capability: "supported" | "unsupported" | "unknown"
}

export interface ClipboardWriteResult {
  readonly host: HostClipboardWriteResult | { readonly status: "not-attempted" }
  readonly terminal: TerminalClipboardOperationResult
}

export interface ClipboardClearResult {
  readonly host: HostClipboardClearResult | { readonly status: "not-attempted" }
  readonly terminal: TerminalClipboardOperationResult
}

export interface ClipboardService {
  // Reads the process host clipboard. It cannot read the terminal user's clipboard over SSH.
  read(options: ClipboardReadOptions): Promise<ClipboardReadResult>
  // Rejects empty text and NUL characters before trying any destination.
  writeText(text: string, options: ClipboardWriteOptions): Promise<ClipboardWriteResult>
  // Clears the selected destinations without treating empty text as a clear request.
  clear(options: ClipboardWriteOptions): Promise<ClipboardClearResult>
}

export enum ClipboardTarget {
  Clipboard = 0,
  Primary = 1,
  Select = 2,
  Secondary = 3,
}

export class Clipboard {
  private lib: RenderLib
  private rendererPtr: RendererHandle

  constructor(lib: RenderLib, rendererPtr: RendererHandle) {
    this.lib = lib
    this.rendererPtr = rendererPtr
  }

  public copyToClipboardOSC52(text: string, target: ClipboardTarget = ClipboardTarget.Clipboard): boolean {
    if (!this.isOsc52Supported()) {
      return false
    }
    const textUtf8 = this.lib.encoder.encode(text)
    return this.lib.copyToClipboardOSC52(this.rendererPtr, target, textUtf8)
  }

  public clearClipboardOSC52(target: ClipboardTarget = ClipboardTarget.Clipboard): boolean {
    if (!this.isOsc52Supported()) {
      return false
    }
    return this.lib.clearClipboardOSC52(this.rendererPtr, target)
  }

  public isOsc52Supported(): boolean {
    const caps = this.lib.getTerminalCapabilities(this.rendererPtr)
    return caps?.osc52_support !== "unsupported"
  }
}
