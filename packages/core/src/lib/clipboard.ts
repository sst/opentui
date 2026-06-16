// OSC 52 clipboard support for terminal applications.
// Delegates to native Zig implementation for ANSI sequence generation.

import type { RendererHandle, RenderLib } from "../zig.js"

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
