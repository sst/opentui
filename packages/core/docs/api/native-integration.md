# Native Integration (detailed RenderLib API)

OpenTUI uses native code written in Zig for performance-critical operations. The JavaScript side exposes a RenderLib wrapper (packages/core/src/zig.ts) that converts JS types to the FFI layer and provides convenient helpers.

This page documents the RenderLib wrapper signatures and the TextBuffer/native buffer helpers in detail so examples can call them correctly.

Source reference: packages/core/src/zig.ts (FFIRenderLib / RenderLib interface)

---

## Getting the RenderLib

```ts
import { resolveRenderLib, type RenderLib } from '@opentui/core';

const lib: RenderLib = resolveRenderLib(); // throws if native lib cannot load
```

The `RenderLib` object provides both renderer-level and buffer-level helpers. Most application code should prefer the high-level JS API (OptimizedBuffer, TextBuffer) but the RenderLib helpers are useful for advanced/native usage.

---

## Renderer-level methods (selected)

- createRenderer(width: number, height: number): Pointer | null
- destroyRenderer(renderer: Pointer): void
- setUseThread(renderer: Pointer, useThread: boolean): void
- setBackgroundColor(renderer: Pointer, color: RGBA): void
- setRenderOffset(renderer: Pointer, offset: number): void
- updateStats(renderer: Pointer, time: number, fps: number, frameCallbackTime: number): void
- updateMemoryStats(renderer: Pointer, heapUsed: number, heapTotal: number, arrayBuffers: number): void
- render(renderer: Pointer, force: boolean): void
- getNextBuffer(renderer: Pointer): OptimizedBuffer
- getCurrentBuffer(renderer: Pointer): OptimizedBuffer
- resizeRenderer(renderer: Pointer, width: number, height: number): void
- setDebugOverlay(renderer: Pointer, enabled: boolean, corner: DebugOverlayCorner): void
- clearTerminal(renderer: Pointer): void
- addToHitGrid(renderer: Pointer, x: number, y: number, width: number, height: number, id: number): void
- checkHit(renderer: Pointer, x: number, y: number): number
- dumpHitGrid(renderer: Pointer): void
- dumpBuffers(renderer: Pointer, timestamp?: number): void
- dumpStdoutBuffer(renderer: Pointer, timestamp?: number): void

Notes:
- getNextBuffer/getCurrentBuffer return OptimizedBuffer instances that wrap native buffer pointers and typed arrays.

---

## Optimized buffer / buffer primitives (native-facing helpers)

These are the RenderLib wrapper methods that operate on native buffer pointers or wrapped OptimizedBuffer objects. Prefer the high-level OptimizedBuffer methods, but this lists the wrapper signatures for precise behavior.

- createOptimizedBuffer(width: number, height: number, respectAlpha?: boolean): OptimizedBuffer
  - Returns an OptimizedBuffer instance wrapping the native buffer pointer and typed arrays.
- destroyOptimizedBuffer(bufferPtr: Pointer): void

Buffer property helpers:
- getBufferWidth(buffer: Pointer): number
- getBufferHeight(buffer: Pointer): number
- bufferGetCharPtr(buffer: Pointer): Pointer
- bufferGetFgPtr(buffer: Pointer): Pointer
- bufferGetBgPtr(buffer: Pointer): Pointer
- bufferGetAttributesPtr(buffer: Pointer): Pointer
- bufferGetRespectAlpha(buffer: Pointer): boolean
- bufferSetRespectAlpha(buffer: Pointer, respectAlpha: boolean): void
- bufferClear(buffer: Pointer, color: RGBA): void

Drawing helpers (native/FFI-backed):
- bufferDrawText(buffer: Pointer, text: string, x: number, y: number, color: RGBA, bgColor?: RGBA, attributes?: number): void
  - In the wrapper, JS strings are encoded and forwarded to the native symbol with length.
  - Use RGBA instances for color arguments.
- bufferSetCellWithAlphaBlending(buffer: Pointer, x: number, y: number, char: string, color: RGBA, bgColor: RGBA, attributes?: number): void
  - Accepts a single-character string (the wrapper converts to codepoint).
- bufferFillRect(buffer: Pointer, x: number, y: number, width: number, height: number, color: RGBA): void
- bufferDrawSuperSampleBuffer(buffer: Pointer, x: number, y: number, pixelDataPtr: Pointer, pixelDataLength: number, format: 'bgra8unorm' | 'rgba8unorm', alignedBytesPerRow: number): void
  - Format argument in wrapper is converted to an internal format id.
- bufferDrawPackedBuffer(buffer: Pointer, dataPtr: Pointer, dataLen: number, posX: number, posY: number, terminalWidthCells: number, terminalHeightCells: number): void
- bufferDrawBox(buffer: Pointer, x: number, y: number, width: number, height: number, borderChars: Uint32Array, packedOptions: number, borderColor: RGBA, backgroundColor: RGBA, title: string | null): void
  - The wrapper accepts a JS string title and encodes it with a length.
- bufferResize(buffer: Pointer, width: number, height: number): { char: Uint32Array; fg: Float32Array; bg: Float32Array; attributes: Uint8Array }
  - Returns the new typed arrays mapped to the buffer.

Notes:
- The wrapper converts JS RGBA objects into underlying Float32Array pointers and encodes strings into Uint8Array payloads for the FFI call.
- There are no native helpers named drawHorizontalLine or drawVerticalLine; use bufferFillRect, bufferDrawText / bufferSetCellWithAlphaBlending, or bufferDrawBox to implement lines.

---

## TextBuffer native helpers (RenderLib wrapper)

`TextBuffer` is a native-backed rich text buffer; the RenderLib exposes wrapper methods:

- createTextBuffer(capacity: number): TextBuffer
  - Returns a TextBuffer instance wrapping a native pointer and typed arrays.
- destroyTextBuffer(buffer: Pointer): void
- textBufferGetCharPtr(buffer: Pointer): Pointer
- textBufferGetFgPtr(buffer: Pointer): Pointer
- textBufferGetBgPtr(buffer: Pointer): Pointer
- textBufferGetAttributesPtr(buffer: Pointer): Pointer
- textBufferGetLength(buffer: Pointer): number
- textBufferSetCell(buffer: Pointer, index: number, char: number, fg: Float32Array, bg: Float32Array, attr: number): void
- textBufferConcat(buffer1: Pointer, buffer2: Pointer): TextBuffer
- textBufferResize(buffer: Pointer, newLength: number): { char: Uint32Array; fg: Float32Array; bg: Float32Array; attributes: Uint16Array }
- textBufferReset(buffer: Pointer): void
- textBufferSetSelection(buffer: Pointer, start: number, end: number, bgColor: RGBA | null, fgColor: RGBA | null): void
- textBufferResetSelection(buffer: Pointer): void
- textBufferSetDefaultFg(buffer: Pointer, fg: RGBA | null): void
- textBufferSetDefaultBg(buffer: Pointer, bg: RGBA | null): void
- textBufferSetDefaultAttributes(buffer: Pointer, attributes: number | null): void
- textBufferResetDefaults(buffer: Pointer): void
- textBufferWriteChunk(buffer: Pointer, textBytes: Uint8Array, fg: RGBA | null, bg: RGBA | null, attributes: number | null): number
  - Returns number of bytes written / used by the chunk write operation.
- textBufferGetCapacity(buffer: Pointer): number
- textBufferFinalizeLineInfo(buffer: Pointer): void
- textBufferGetLineInfo(buffer: Pointer): { lineStarts: number[]; lineWidths: number[] }
- getTextBufferArrays(buffer: Pointer, size: number): { char: Uint32Array; fg: Float32Array; bg: Float32Array; attributes: Uint16Array }
- bufferDrawTextBuffer(buffer: Pointer, textBuffer: Pointer, x: number, y: number, clipRect?: { x: number; y: number; width: number; height: number }): void

Usage notes:
- The RenderLib wrapper encodes text and forwards typed arrays to native implementations.
- Use `createTextBuffer` and `bufferDrawTextBuffer` to render styled content efficiently.
- `textBufferWriteChunk` accepts a Uint8Array of UTF-8 bytes and optional RGBA buffers for default fg/bg; the wrapper handles encoding.

---

## Examples

Create an optimized buffer via RenderLib and draw text:
```ts
import { resolveRenderLib, RGBA } from '@opentui/core';

const lib = resolveRenderLib();
const fb = lib.createOptimizedBuffer(80, 24, false); // OptimizedBuffer instance
fb.drawText('Hello via FFI', 0, 0, RGBA.fromValues(1,1,1,1));
```

Create a TextBuffer and render it:
```ts
const tb = lib.createTextBuffer(128);
lib.textBufferWriteChunk(tb.ptr, new TextEncoder().encode('Hello TB'), null, null, 0);
lib.bufferDrawTextBuffer(fb.ptr, tb.ptr, 2, 2);
```

---
