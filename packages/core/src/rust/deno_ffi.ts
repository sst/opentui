/**
 * OpenTUI Deno FFI Bindings
 *
 * Load the Rust-compiled native library with Deno.dlopen.
 *
 * Usage:
 *   deno run --allow-ffi --unstable-ffi deno_ffi.ts
 *
 * Build the native library first:
 *   cargo build --release
 */

const LIB_SUFFIX = Deno.build.os === "windows"
  ? "opentui.dll"
  : Deno.build.os === "darwin"
    ? "libopentui.dylib"
    : "libopentui.so";

const LIB_PATH = new URL(`./target/release/${LIB_SUFFIX}`, import.meta.url).pathname;

// Symbol definitions matching the C ABI exports in ffi.rs.
// Add more symbols as needed — this covers the most commonly used ones.
const symbols = {
  // --- Callbacks ---
  setLogCallback: { parameters: ["function"], result: "void" },
  setEventCallback: { parameters: ["function"], result: "void" },

  // --- Renderer ---
  createRenderer: {
    parameters: ["u32", "u32", "bool", "pointer"],
    result: "pointer",
  },
  destroyRenderer: { parameters: ["pointer"], result: "void" },
  rendererResize: { parameters: ["pointer", "u32", "u32"], result: "void" },
  rendererGetWidth: { parameters: ["pointer"], result: "u32" },
  rendererGetHeight: { parameters: ["pointer"], result: "u32" },

  // --- Buffer ---
  rendererGetBufferPtr: { parameters: ["pointer"], result: "pointer" },
  bufferGetWidth: { parameters: ["pointer"], result: "u32" },
  bufferGetHeight: { parameters: ["pointer"], result: "u32" },
  bufferClear: { parameters: ["pointer", "pointer"], result: "void" },

  // Buffer drawing
  bufferDrawText: {
    parameters: [
      "pointer", "u32", "u32", "pointer", "u32",
      "pointer", "pointer", "u32", "u8", "u8",
    ],
    result: "u32",
  },
  bufferDrawChar: {
    parameters: ["pointer", "u32", "u32", "u32", "pointer", "pointer", "u32"],
    result: "void",
  },
  bufferFillRect: {
    parameters: [
      "pointer", "u32", "u32", "u32", "u32",
      "u32", "pointer", "pointer", "u32",
    ],
    result: "void",
  },

  // Scissor
  bufferPushScissor: {
    parameters: ["pointer", "u32", "u32", "u32", "u32"],
    result: "void",
  },
  bufferPopScissor: { parameters: ["pointer"], result: "void" },

  // Buffer accessors
  bufferGetCharPtr: { parameters: ["pointer"], result: "pointer" },
  bufferGetFgPtr: { parameters: ["pointer"], result: "pointer" },
  bufferGetBgPtr: { parameters: ["pointer"], result: "pointer" },
  bufferGetAttributesPtr: { parameters: ["pointer"], result: "pointer" },

  // --- Render ---
  render: { parameters: ["pointer"], result: "void" },

  // --- Text Buffer ---
  createTextBuffer: { parameters: ["u8"], result: "pointer" },
  destroyTextBuffer: { parameters: ["pointer"], result: "void" },
  textBufferSetText: {
    parameters: ["pointer", "pointer", "u32"],
    result: "void",
  },
  textBufferGetLineCount: { parameters: ["pointer"], result: "u32" },

  // --- Terminal ---
  rendererSetupTerminal: { parameters: ["pointer"], result: "void" },
  rendererResetTerminal: { parameters: ["pointer"], result: "void" },

  // --- UTF-8 Utilities ---
  isAsciiOnly: { parameters: ["pointer", "u32"], result: "bool" },
  getWidthAt: {
    parameters: ["pointer", "u32", "u32", "u8", "u8"],
    result: "u8",
  },
} as const;

// Load the library
const lib = Deno.dlopen(LIB_PATH, symbols);

export default lib.symbols;

// --- Convenience helpers ---

const encoder = new TextEncoder();

/** Create a renderer and return its pointer. */
export function createRenderer(
  width: number,
  height: number,
  testing = false,
): Deno.PointerValue {
  return lib.symbols.createRenderer(width, height, testing, null);
}

/** Draw text at (x, y) in the buffer. */
export function drawText(
  buffer: Deno.PointerValue,
  x: number,
  y: number,
  text: string,
  fg: Float32Array,
  bg: Float32Array,
): number {
  const encoded = encoder.encode(text);
  return lib.symbols.bufferDrawText(
    buffer,
    x,
    y,
    Deno.UnsafePointer.of(encoded),
    encoded.length,
    Deno.UnsafePointer.of(fg),
    Deno.UnsafePointer.of(bg),
    0, // attributes
    4, // tab_width
    1, // width_method (Unicode)
  );
}
