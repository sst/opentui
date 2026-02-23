import { defineStruct, defineEnum } from "bun-ffi-structs"
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
  ["attributes", "u32", { optional: true }],
])

export const HighlightStruct = defineStruct([
  ["start", "u32"],
  ["end", "u32"],
  ["styleId", "u32"],
  ["priority", "u8", { default: 0 }],
  ["hlRef", "u16", { default: 0 }],
])

export const LogicalCursorStruct = defineStruct([
  ["row", "u32"],
  ["col", "u32"],
  ["offset", "u32"],
])

export const VisualCursorStruct = defineStruct([
  ["visualRow", "u32"],
  ["visualCol", "u32"],
  ["logicalRow", "u32"],
  ["logicalCol", "u32"],
  ["offset", "u32"],
])

const UnicodeMethodEnum = defineEnum({ wcwidth: 0, unicode: 1 }, "u8")

export const TerminalCapabilitiesStruct = defineStruct([
  ["kitty_keyboard", "bool_u8"],
  ["kitty_graphics", "bool_u8"],
  ["rgb", "bool_u8"],
  ["unicode", UnicodeMethodEnum],
  ["sgr_pixels", "bool_u8"],
  ["color_scheme_updates", "bool_u8"],
  ["explicit_width", "bool_u8"],
  ["scaled_text", "bool_u8"],
  ["sixel", "bool_u8"],
  ["focus_tracking", "bool_u8"],
  ["sync", "bool_u8"],
  ["bracketed_paste", "bool_u8"],
  ["hyperlinks", "bool_u8"],
  ["osc52", "bool_u8"],
  ["explicit_cursor_positioning", "bool_u8"],
  ["term_name", "char*"],
  ["term_name_len", "u64", { lengthOf: "term_name" }],
  ["term_version", "char*"],
  ["term_version_len", "u64", { lengthOf: "term_version" }],
  ["term_from_xtversion", "bool_u8"],
])

export const EncodedCharStruct = defineStruct([
  ["width", "u8"],
  ["char", "u32"],
])

export const LineInfoStruct = defineStruct([
  ["starts", ["u32"]],
  ["startsLen", "u32", { lengthOf: "starts" }],
  ["widths", ["u32"]],
  ["widthsLen", "u32", { lengthOf: "widths" }],
  ["sources", ["u32"]],
  ["sourcesLen", "u32", { lengthOf: "sources" }],
  ["wraps", ["u32"]],
  ["wrapsLen", "u32", { lengthOf: "wraps" }],
  ["maxWidth", "u32"],
])

export const MeasureResultStruct = defineStruct([
  ["lineCount", "u32"],
  ["maxWidth", "u32"],
])

export const CursorStateStruct = defineStruct([
  ["x", "u32"],
  ["y", "u32"],
  ["visible", "bool_u8"],
  ["style", "u8"],
  ["blinking", "bool_u8"],
  ["r", "f32"],
  ["g", "f32"],
  ["b", "f32"],
  ["a", "f32"],
])

export const CursorStyleOptionsStruct = defineStruct([
  ["style", "u8", { default: 255 }],
  ["blinking", "u8", { default: 255 }],
  [
    "color",
    "pointer",
    {
      optional: true,
      packTransform: rgbaPackTransform,
      unpackTransform: rgbaUnpackTransform,
    },
  ],
  ["cursor", "u8", { default: 255 }],
])

export const GridDrawOptionsStruct = defineStruct([
  ["drawInner", "bool_u8", { default: true }],
  ["drawOuter", "bool_u8", { default: true }],
])

export type GrowthPolicy = "grow" | "block"

export type NativeSpanFeedOptions = {
  chunkSize?: number
  initialChunks?: number
  maxBytes?: bigint
  growthPolicy?: GrowthPolicy
  autoCommitOnFull?: boolean
  spanQueueCapacity?: number
}

export type NativeSpanFeedStats = {
  bytesWritten: bigint
  spansCommitted: bigint
  chunks: number
  pendingSpans: number
}

export type SpanInfo = {
  chunkPtr: Pointer
  offset: number
  len: number
  chunkIndex: number
}

export type ReserveInfo = {
  ptr: Pointer
  len: number
}

const GrowthPolicyEnum = defineEnum({ grow: 0, block: 1 }, "u8")

export const NativeSpanFeedOptionsStruct = defineStruct([
  ["chunkSize", "u32", { default: 64 * 1024 }],
  ["initialChunks", "u32", { default: 2 }],
  ["maxBytes", "u64", { default: 0n }],
  ["growthPolicy", GrowthPolicyEnum, { default: "grow" }],
  ["autoCommitOnFull", "bool_u8", { default: true }],
  ["spanQueueCapacity", "u32", { default: 0 }],
])

export const NativeSpanFeedStatsStruct = defineStruct([
  ["bytesWritten", "u64"],
  ["spansCommitted", "u64"],
  ["chunks", "u32"],
  ["pendingSpans", "u32"],
])

export const SpanInfoStruct = defineStruct(
  [
    ["chunkPtr", "pointer"],
    ["offset", "u32"],
    ["len", "u32"],
    ["chunkIndex", "u32"],
    ["reserved", "u32", { default: 0 }],
  ],
  {
    reduceValue: (value: { chunkPtr: Pointer; offset: number; len: number; chunkIndex: number }) => ({
      chunkPtr: value.chunkPtr as Pointer,
      offset: value.offset,
      len: value.len,
      chunkIndex: value.chunkIndex,
    }),
  },
)

export const ReserveInfoStruct = defineStruct(
  [
    ["ptr", "pointer"],
    ["len", "u32"],
    ["reserved", "u32", { default: 0 }],
  ],
  {
    reduceValue: (value: { ptr: Pointer; len: number }) => ({
      ptr: value.ptr as Pointer,
      len: value.len,
    }),
  },
)
