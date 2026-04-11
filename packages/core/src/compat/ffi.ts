import { FFIType } from "./FFIType.js"

export { FFIType }

export type Pointer = number & { __pointer__: null }

interface FFITypeStringToType {
  ["char"]: FFIType.char
  ["int8_t"]: FFIType.int8_t
  ["i8"]: FFIType.i8
  ["uint8_t"]: FFIType.uint8_t
  ["u8"]: FFIType.u8
  ["int16_t"]: FFIType.int16_t
  ["i16"]: FFIType.i16
  ["uint16_t"]: FFIType.uint16_t
  ["u16"]: FFIType.u16
  ["int32_t"]: FFIType.int32_t
  ["i32"]: FFIType.i32
  ["int"]: FFIType.int
  ["uint32_t"]: FFIType.uint32_t
  ["u32"]: FFIType.u32
  ["int64_t"]: FFIType.int64_t
  ["i64"]: FFIType.i64
  ["uint64_t"]: FFIType.uint64_t
  ["u64"]: FFIType.u64
  ["double"]: FFIType.double
  ["f64"]: FFIType.f64
  ["float"]: FFIType.float
  ["f32"]: FFIType.f32
  ["bool"]: FFIType.bool
  ["ptr"]: FFIType.ptr
  ["pointer"]: FFIType.pointer
  ["void"]: FFIType.void
  ["cstring"]: FFIType.cstring
  ["function"]: FFIType.function
  ["usize"]: FFIType.uint64_t
  ["callback"]: FFIType.function
  ["napi_env"]: FFIType.napi_env
  ["napi_value"]: FFIType.napi_value
  ["buffer"]: FFIType.buffer
}

export type FFITypeOrString = FFIType | keyof FFITypeStringToType

export interface FFIFunction {
  readonly args?: readonly FFITypeOrString[]
  readonly returns?: FFITypeOrString
  readonly ptr?: Pointer | bigint
  readonly threadsafe?: boolean
}

type Symbols = Readonly<Record<string, FFIFunction>>
type ToFFIType<T extends FFITypeOrString> = T extends FFIType
  ? T
  : T extends keyof FFITypeStringToType
    ? FFITypeStringToType[T]
    : never
type NumericFFIType =
  | FFIType.char
  | FFIType.int8_t
  | FFIType.i8
  | FFIType.uint8_t
  | FFIType.u8
  | FFIType.int16_t
  | FFIType.i16
  | FFIType.uint16_t
  | FFIType.u16
  | FFIType.int32_t
  | FFIType.i32
  | FFIType.int
  | FFIType.uint32_t
  | FFIType.u32
  | FFIType.double
  | FFIType.f64
  | FFIType.float
  | FFIType.f32
type BigIntArgFFIType =
  | FFIType.int64_t
  | FFIType.i64
  | FFIType.uint64_t
  | FFIType.u64
  | FFIType.i64_fast
  | FFIType.u64_fast
type BigIntReturnFFIType = FFIType.int64_t | FFIType.i64 | FFIType.uint64_t | FFIType.u64
type PointerLike = NodeJS.TypedArray | DataView | Pointer | null
type BufferLike = NodeJS.TypedArray | DataView
type FFIArgValue<T extends FFIType> = T extends NumericFFIType
  ? number
  : T extends BigIntArgFFIType
    ? number | bigint
    : T extends FFIType.bool
      ? boolean
      : T extends FFIType.ptr | FFIType.pointer | FFIType.cstring
        ? PointerLike
        : T extends FFIType.void
          ? undefined
          : T extends FFIType.function
            ? Pointer | JSCallback
            : T extends FFIType.napi_env | FFIType.napi_value
              ? unknown
              : T extends FFIType.buffer
                ? BufferLike
                : never
type FFIReturnValue<T extends FFIType> = T extends NumericFFIType
  ? number
  : T extends BigIntReturnFFIType
    ? bigint
    : T extends FFIType.i64_fast | FFIType.u64_fast
      ? number | bigint
      : T extends FFIType.bool
        ? boolean
        : T extends FFIType.ptr | FFIType.pointer | FFIType.cstring | FFIType.function
          ? Pointer | null
          : T extends FFIType.void
            ? undefined
            : T extends FFIType.napi_env | FFIType.napi_value
              ? unknown
              : T extends FFIType.buffer
                ? BufferLike
                : never

declare const FFIFunctionCallableSymbol: unique symbol

export type ConvertFns<Fns extends Symbols> = {
  [K in keyof Fns]: {
    (
      ...args: Fns[K]["args"] extends infer A extends readonly FFITypeOrString[]
        ? { [L in keyof A]: FFIArgValue<ToFFIType<A[L]>> }
        : [unknown] extends [Fns[K]["args"]]
          ? []
          : never
    ): [unknown] extends [Fns[K]["returns"]] ? undefined : FFIReturnValue<ToFFIType<NonNullable<Fns[K]["returns"]>>>
    __ffi_function_callable: typeof FFIFunctionCallableSymbol
  }
}

export interface Library<Fns extends Symbols> {
  symbols: ConvertFns<Fns>
  close(): void
}

export interface JSCallback {
  readonly ptr: Pointer | null
  readonly threadsafe: boolean
  close(): void
}

export interface JSCallbackConstructor {
  new (callback: (...args: any[]) => any, definition: FFIFunction): JSCallback
}

export type DlopenFunction = <Fns extends Record<string, FFIFunction>>(name: string | URL, symbols: Fns) => Library<Fns>
export type PtrFunction = (value: ArrayBufferLike | ArrayBufferView) => Pointer
export type ToArrayBufferFunction = (pointer: Pointer, offset: number | undefined, length: number) => ArrayBuffer

type FfiModule = {
  JSCallback: JSCallbackConstructor
  dlopen: DlopenFunction
  ptr: PtrFunction
  suffix: string
  toArrayBuffer: ToArrayBufferFunction
}

const ffiModule: FfiModule = (
  process.versions.bun ? await import("bun:ffi") : await import("./nodejs/ffi.js")
) as FfiModule

export const JSCallback = ffiModule.JSCallback
export const dlopen = ffiModule.dlopen
export const ptr = ffiModule.ptr
export const suffix = ffiModule.suffix
export const toArrayBuffer = ffiModule.toArrayBuffer

export const __url = import.meta.url
