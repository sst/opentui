import { defineStruct } from "bun-ffi-structs"
import { ptr, toArrayBuffer, type Pointer } from "bun:ffi"
import { RGBA } from "./lib/RGBA"

const rgbaPackTransform = (rgba?: RGBA) => (rgba ? ptr(rgba.buffer) : null)
const rgbaUnpackTransform = (ptr?: Pointer) => (ptr ? RGBA.fromArray(new Float32Array(toArrayBuffer(ptr))) : undefined)

export const StyledChunkStruct = defineStruct([
  ["text", "char*"],
  ["text_len", "u64", { lengthOf: "text" }],
  [
    "fg",
    "pointer",
    {
      optional: true,
      packTransform: rgbaPackTransform,
      unpackTransform: rgbaUnpackTransform,
    },
  ],
  [
    "bg",
    "pointer",
    {
      optional: true,
      packTransform: rgbaPackTransform,
      unpackTransform: rgbaUnpackTransform,
    },
  ],
  ["attributes", "u8", { optional: true }],
])

export const HighlightStruct = defineStruct([
  ["colStart", "u32"],
  ["colEnd", "u32"],
  ["styleId", "u32"],
  ["priority", "u8"],
  ["hlRef", "u16", { default: 0 }],
])
