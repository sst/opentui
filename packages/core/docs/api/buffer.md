# Buffer System (detailed API)

This page documents the OptimizedBuffer class in detail — method signatures, parameters, return values, and important behavior notes so code samples are precise and reliable.

Source reference: packages/core/src/buffer.ts

Important types used below:
- RGBA — color container (use `RGBA.fromValues`, `RGBA.fromHex`, etc.)
- Pointer — native pointer type (FFI-backed operations)
- OptimizedBuffer — the class documented here

---

## Class: OptimizedBuffer

Overview: a high-performance framebuffer abstraction that exposes typed-array access to characters, foreground colors, background colors, and per-cell attributes. Many heavy operations call into the native render library (FFI); the class exposes both FFI-backed and JS-local implementations.

Creation
```ts
// Static factory (preferred)
const buf = OptimizedBuffer.create(width: number, height: number, options?: { respectAlpha?: boolean }): OptimizedBuffer
```
- width, height: pixel/cell dimensions
- options.respectAlpha: if true, compositing from source buffers respects alpha channels; default false.

Properties
- ptr: Pointer — pointer to the native buffer object (used internally; exposed for advanced use)
- buffers: { char: Uint32Array; fg: Float32Array; bg: Float32Array; attributes: Uint8Array }
  - char: uint32 per cell (Unicode codepoints)
  - fg/bg: Float32Array with 4 floats per cell (r,g,b,a) in 0..1 range
  - attributes: Uint8Array per cell (bitflags for attributes)
- id: string — internal id string
- respectAlpha: boolean — whether this buffer respects alpha on draws

Basic size methods
```ts
getWidth(): number
getHeight(): number
resize(width: number, height: number): void
```
- `resize` will replace the internal typed arrays (via FFI in native mode) and update internal width/height.

Lifecycle
```ts
clear(bg?: RGBA, clearChar?: string): void
clearFFI(bg?: RGBA): void
clearLocal(bg?: RGBA, clearChar?: string): void
destroy(): void
```
- `clear()` delegates to the FFI implementation when available; `clearLocal` is the JS fallback.
- `destroy()` frees the native buffer via the RenderLib wrapper.

Per-cell operations
```ts
setCell(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes?: number): void
get(x: number, y: number): { char: number; fg: RGBA; bg: RGBA; attributes: number } | null
```
- Coordinates outside the buffer are ignored (setCell is a no-op; get returns null).
- char: first codepoint of provided string will be used; stored as numeric code.
- attributes: integer bitflags (project uses small integers for bold/underline/dim/etc).

Alpha-aware per-cell writes
```ts
setCellWithAlphaBlending(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes?: number): void
setCellWithAlphaBlendingFFI(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes?: number): void
setCellWithAlphaBlendingLocal(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes?: number): void
```
- `setCellWithAlphaBlending` routes to FFI when available; otherwise the local JS implementation performs perceptual alpha blending (`blendColors` logic inside buffer.ts).
- Behavior notes:
  - If bg/fg have alpha < 1, blending occurs against the destination cell.
  - When drawing a space character ' ' over a non-empty cell, the implementation preserves the destination character by default and blends colors accordingly.

Text drawing
```ts
// High-level
drawText(text: string, x: number, y: number, fg: RGBA, bg?: RGBA, attributes?: number, selection?: { start: number; end: number; bgColor?: RGBA; fgColor?: RGBA } | null): void

// FFI-level
drawTextFFI(text: string, x: number, y: number, fg?: RGBA, bg?: RGBA, attributes?: number): void
```
- drawText supports selection highlighting by splitting the text and drawing the selected portion with alternate fg/bg.
- Parameter order is (text, x, y, fg, bg?, attributes?, selection?).
- For performance, drawText calls into `drawTextFFI` when available.

TextBuffer rendering
```ts
drawTextBuffer(textBuffer: TextBuffer, x: number, y: number, clipRect?: { x: number; y: number; width: number; height: number }): void
```
- Use this to render a TextBuffer (rich/styled content) efficiently via the native helper.

Rectangles, boxes and compositing
```ts
fillRect(x: number, y: number, width: number, height: number, bg: RGBA): void
fillRectFFI(x: number, y: number, width: number, height: number, bg: RGBA): void
fillRectLocal(x: number, y: number, width: number, height: number, bg: RGBA): void

drawBox(options: {
  x: number
  y: number
  width: number
  height: number
  borderStyle?: BorderStyle
  customBorderChars?: Uint32Array
  border: boolean | BorderSides[]
  borderColor: RGBA
  backgroundColor: RGBA
  shouldFill?: boolean
  title?: string
  titleAlignment?: 'left' | 'center' | 'right'
}): void
```
- `drawBox` packs options and forwards to the native `bufferDrawBox` for speed.
- `fillRect` is alpha-aware; if `bg` has alpha < 1 the implementation blends per cell.

Framebuffer compositing (copying one buffer into another)
```ts
drawFrameBuffer(destX: number, destY: number, frameBuffer: OptimizedBuffer, sourceX?: number, sourceY?: number, sourceWidth?: number, sourceHeight?: number): void
drawFrameBufferLocal(destX: number, destY: number, frameBuffer: OptimizedBuffer, sourceX?: number, sourceY?: number, sourceWidth?: number, sourceHeight?: number): void
drawFrameBufferFFI(destX: number, destY: number, frameBuffer: OptimizedBuffer, sourceX?: number, sourceY?: number, sourceWidth?: number, sourceHeight?: number): void
```
- Preferred: `drawFrameBuffer` which delegates to FFI; `drawFrameBufferLocal` exists as a JS fallback.
- Behavior:
  - When `frameBuffer.respectAlpha` is false the copy is a straight copy of char/fg/bg/attributes.
  - When `respectAlpha` is true, transparent pixels (alpha 0) are skipped, and blended compositing occurs per cell.

Packed / supersampled drawing (advanced)
```ts
drawPackedBuffer(dataPtr: Pointer, dataLen: number, posX: number, posY: number, terminalWidthCells: number, terminalHeightCells: number): void
drawSuperSampleBuffer(x: number, y: number, pixelDataPtr: Pointer, pixelDataLength: number, format: 'bgra8unorm' | 'rgba8unorm', alignedBytesPerRow: number): void
drawSuperSampleBufferFFI(x: number, y: number, pixelDataPtr: Pointer, pixelDataLength: number, format: 'bgra8unorm' | 'rgba8unorm', alignedBytesPerRow: number): void
```
- Use these for WebGPU/WebGL-like pixel data uploads or packed buffer formats. These call into FFI for performance.

FFI helpers (when using native lib)
- clearFFI(bg)
- drawTextFFI(...)
- setCellWithAlphaBlendingFFI(...)
- fillRectFFI(...)
- drawFrameBufferFFI(...)
- drawPackedBuffer(...) / drawSuperSampleBufferFFI(...)

Notes and edge-cases
- Color format: RGBA floats in 0..1. Use `RGBA.fromHex('#rrggbb')` or `RGBA.fromValues(r,g,b,a)` to build colors.
- Performance:
  - Prefer FFI-backed methods (default when native library is loaded via `resolveRenderLib()`).
  - Avoid frequent calls to `resize`.
  - Use `drawFrameBuffer` for compositing pre-computed buffers rather than redrawing many primitives per frame.
- Selection support in drawText:
  - Provide selection `{ start, end, bgColor?, fgColor? }` to highlight segments. start/end indices are character indices in the string.

Example: alpha-aware text and compositing
```ts
const buf = OptimizedBuffer.create(80, 24, { respectAlpha: true });
const fg = RGBA.fromHex('#ffffff');
const transparentBg = RGBA.fromValues(0, 0, 0, 0.5);
buf.setCellWithAlphaBlending(10, 10, 'A', fg, transparentBg, 0);
```

---
