import type {
  dlopen as bunDlopen,
  JSCallback as BunJSCallback,
  ptr as bunPtr,
  toArrayBuffer as bunToArrayBuffer,
  ConvertFns,
  FFIFunction,
  FFITypeOrString,
  Pointer,
} from "bun:ffi"
import koffi from "koffi"
import { isArrayBufferView } from "node:util/types"

/** Copy of Bun's FFIType enum. */
export enum FFIType {
  char = 0,
  /**
   * 8-bit signed integer
   *
   * Must be a value between -127 and 127
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * signed char
   * char // on x64 & aarch64 macOS
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  int8_t = 1,
  /**
   * 8-bit signed integer
   *
   * Must be a value between -127 and 127
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * signed char
   * char // on x64 & aarch64 macOS
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  i8 = 1,

  /**
   * 8-bit unsigned integer
   *
   * Must be a value between 0 and 255
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * unsigned char
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  uint8_t = 2,
  /**
   * 8-bit unsigned integer
   *
   * Must be a value between 0 and 255
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * unsigned char
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  u8 = 2,

  /**
   * 16-bit signed integer
   *
   * Must be a value between -32768 and 32767
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * in16_t
   * short // on arm64 & x64
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  int16_t = 3,
  /**
   * 16-bit signed integer
   *
   * Must be a value between -32768 and 32767
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * in16_t
   * short // on arm64 & x64
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  i16 = 3,

  /**
   * 16-bit unsigned integer
   *
   * Must be a value between 0 and 65535, inclusive.
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * uint16_t
   * unsigned short // on arm64 & x64
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  uint16_t = 4,
  /**
   * 16-bit unsigned integer
   *
   * Must be a value between 0 and 65535, inclusive.
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * uint16_t
   * unsigned short // on arm64 & x64
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  u16 = 4,

  /**
   * 32-bit signed integer
   */
  int32_t = 5,

  /**
   * 32-bit signed integer
   *
   * Alias of {@link FFIType.int32_t}
   */
  i32 = 5,
  /**
   * 32-bit signed integer
   *
   * The same as `int` in C
   *
   * ```c
   * int
   * ```
   */
  int = 5,

  /**
   * 32-bit unsigned integer
   *
   * The same as `unsigned int` in C (on x64 & arm64)
   *
   * C:
   * ```c
   * unsigned int
   * ```
   * JavaScript:
   * ```js
   * ptr(new Uint32Array(1))
   * ```
   */
  uint32_t = 6,
  /**
   * 32-bit unsigned integer
   *
   * Alias of {@link FFIType.uint32_t}
   */
  u32 = 6,

  /**
   * int64 is a 64-bit signed integer
   */
  int64_t = 7,
  /**
   * i64 is a 64-bit signed integer
   */
  i64 = 7,

  /**
   * 64-bit unsigned integer
   */
  uint64_t = 8,
  /**
   * 64-bit unsigned integer
   */
  u64 = 8,

  /**
   * IEEE-754 double precision float
   */
  double = 9,

  /**
   * Alias of {@link FFIType.double}
   */
  f64 = 9,

  /**
   * IEEE-754 single precision float
   */
  float = 10,

  /**
   * Alias of {@link FFIType.float}
   */
  f32 = 10,

  /**
   * Boolean value
   *
   * Must be `true` or `false`. `0` and `1` type coercion is not supported.
   *
   * In C, this corresponds to:
   * ```c
   * bool
   * _Bool
   * ```
   */
  bool = 11,

  /**
   * Pointer value
   *
   * See {@link Bun.FFI.ptr} for more information
   *
   * In C:
   * ```c
   * void*
   * ```
   *
   * In JavaScript:
   * ```js
   * ptr(new Uint8Array(1))
   * ```
   */
  ptr = 12,
  /**
   * Pointer value
   *
   * alias of {@link FFIType.ptr}
   */
  pointer = 12,

  /**
   * void value
   *
   * void arguments are not supported
   *
   * void return type is the default return type
   *
   * In C:
   * ```c
   * void
   * ```
   */
  void = 13,

  /**
   * When used as a `returns`, this will automatically become a {@link CString}.
   *
   * When used in `args` it is equivalent to {@link FFIType.pointer}
   */
  cstring = 14,

  /**
   * Attempt to coerce `BigInt` into a `Number` if it fits. This improves performance
   * but means you might get a `BigInt` or you might get a `number`.
   *
   * In C, this always becomes `int64_t`
   *
   * In JavaScript, this could be number or it could be BigInt, depending on what
   * value is passed in.
   */
  i64_fast = 15,

  /**
   * Attempt to coerce `BigInt` into a `Number` if it fits. This improves performance
   * but means you might get a `BigInt` or you might get a `number`.
   *
   * In C, this always becomes `uint64_t`
   *
   * In JavaScript, this could be number or it could be BigInt, depending on what
   * value is passed in.
   */
  u64_fast = 16,
  function = 17,

  napi_env = 18,
  napi_value = 19,
  buffer = 20,
}

const FFITypeStringToType = {
  ["char"]: FFIType.char,
  ["int8_t"]: FFIType.int8_t,
  ["i8"]: FFIType.i8,
  ["uint8_t"]: FFIType.uint8_t,
  ["u8"]: FFIType.u8,
  ["int16_t"]: FFIType.int16_t,
  ["i16"]: FFIType.i16,
  ["uint16_t"]: FFIType.uint16_t,
  ["u16"]: FFIType.u16,
  ["int32_t"]: FFIType.int32_t,
  ["i32"]: FFIType.i32,
  ["int"]: FFIType.int,
  ["uint32_t"]: FFIType.uint32_t,
  ["u32"]: FFIType.u32,
  ["int64_t"]: FFIType.int64_t,
  ["i64"]: FFIType.i64,
  ["uint64_t"]: FFIType.uint64_t,
  ["u64"]: FFIType.u64,
  ["double"]: FFIType.double,
  ["f64"]: FFIType.f64,
  ["float"]: FFIType.float,
  ["f32"]: FFIType.f32,
  ["bool"]: FFIType.bool,
  ["ptr"]: FFIType.ptr,
  ["pointer"]: FFIType.pointer,
  ["void"]: FFIType.void,
  ["cstring"]: FFIType.cstring,
  ["function"]: FFIType.pointer, // for now
  ["usize"]: FFIType.uint64_t, // for now
  ["callback"]: FFIType.pointer, // for now
  ["napi_env"]: FFIType.napi_env,
  ["napi_value"]: FFIType.napi_value,
  ["buffer"]: FFIType.buffer,
} as const

const BunPtrType = koffi.opaque("BunPtr")
const NapiEnvType = koffi.opaque("NapiEnv")
const NapiValueType = koffi.opaque("NapiValue")
const BufferType = koffi.opaque("Buffer")

const ffiTypeToKoffiTypeMap: Record<FFIType, koffi.TypeSpec> = {
  [FFIType.char]: koffi.types.char,
  [FFIType.int8_t]: koffi.types.int8_t,
  [FFIType.uint8_t]: koffi.types.uint8_t,
  [FFIType.int16_t]: koffi.types.int16_t,
  [FFIType.uint16_t]: koffi.types.uint16_t,
  [FFIType.int32_t]: koffi.types.int32_t,
  [FFIType.uint32_t]: koffi.types.uint32_t,
  [FFIType.int64_t]: koffi.types.int64_t,
  [FFIType.uint64_t]: koffi.types.uint64_t,
  [FFIType.double]: koffi.types.double,
  [FFIType.float]: koffi.types.float,
  [FFIType.bool]: koffi.types.bool,
  [FFIType.ptr]: BunPtrType,
  [FFIType.void]: koffi.types.void,
  [FFIType.cstring]: koffi.types.string,
  [FFIType.i64_fast]: koffi.types.int64_t,
  [FFIType.u64_fast]: koffi.types.uint64_t,
  [FFIType.function]: BunPtrType,
  [FFIType.napi_env]: NapiEnvType,
  [FFIType.napi_value]: NapiValueType,
  [FFIType.buffer]: BufferType,
}

function ffiTypeToKoffiType(type: FFITypeOrString): koffi.TypeSpec {
  let numberType: FFIType
  if (typeof type === "number") {
    numberType = type
  } else {
    numberType = FFITypeStringToType[type]
  }

  if (numberType === FFIType.napi_env || numberType === FFIType.napi_value || numberType === FFIType.cstring) {
    throw new Error(`Unsupported FFI type: ${FFIType[numberType]} (${type})`)
  }

  return ffiTypeToKoffiTypeMap[numberType]
}

export class JSCallback implements BunJSCallback {
  #threadsafe: boolean
  #registeredCallback: koffi.IKoffiRegisteredCallback | null

  constructor(callback: (...args: any[]) => any, definition: FFIFunction) {
    const proto = koffi.proto(returnsToKoffiType(definition.returns), argsToKoffiTypes(definition.args))
    this.#registeredCallback = koffi.register(callback, proto)
    this.#threadsafe = definition.threadsafe ?? false
  }

  get ptr(): Pointer | null {
    if (!this.#registeredCallback) {
      return null
    }
    return Number(koffi.address(this.#registeredCallback)) as Pointer
  }

  get threadsafe(): boolean {
    return this.#threadsafe
  }

  close() {
    if (!this.#registeredCallback) {
      return
    }
    koffi.unregister(this.#registeredCallback)
    this.#registeredCallback = null
  }
}

function argsToKoffiTypes(args: readonly FFITypeOrString[] | undefined): koffi.TypeSpec[] {
  return args?.map(ffiTypeToKoffiType) ?? []
}

function returnsToKoffiType(returns: FFITypeOrString | undefined): koffi.TypeSpec {
  return ffiTypeToKoffiType(returns ?? FFIType.void)
}

function ffiFunctionToKoffiFunction<T extends (...args: unknown[]) => unknown>(
  lib: koffi.IKoffiLib,
  name: string,
  type: FFIFunction,
): T & koffi.KoffiFunction {
  const func = lib.func(name, returnsToKoffiType(type.returns), argsToKoffiTypes(type.args))
  return func as T & koffi.KoffiFunction
}

/**
 * Bun returns the pointer to the data backing a TypedArray, ArrayBuffer, etc,
 * directly aliasing the data.  koffi doesn't appear to expose such magicks, so
 * we have to settle for faking it.
 *
 * TODO: don't re-allocate every time.
 * TODO: don't leak.
 */
export const ptr: typeof bunPtr = (value) => {
  const uint8 = koffi.types.uint8
  const opaque = koffi.alloc(uint8, value.byteLength)
  const encodable = isArrayBufferView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : value
  koffi.encode(opaque, uint8, encodable, encodable.byteLength)
  const pointer = Number(koffi.address(opaque))
  return pointer as Pointer
}

export const toArrayBuffer: typeof bunToArrayBuffer = (pointer, offset, length) => {
  let ptrBigint = BigInt(pointer)
  if (offset) {
    ptrBigint += BigInt(offset)
  }
  return koffi.view(ptrBigint, length ? length : -1)
}

function guessSuffix() {
  switch (process.platform) {
    case "darwin":
      return "dylib"
    case "linux":
      return "so"
    case "win32":
      return "dll"
    default:
      return "so"
  }
}

export const suffix: string = guessSuffix()

export const dlopen: typeof bunDlopen = (name, symbols) => {
  let loadPath: string
  if (typeof name === "string") {
    loadPath = name
  } else if (name instanceof URL) {
    loadPath = name.pathname
  } else {
    throw new Error(`Unsupported FFI library name: ${name}`)
  }
  const lib = koffi.load(loadPath)
  const library: Record<string, koffi.KoffiFunction> = {}
  for (const [name, ffiFunction] of Object.entries(symbols)) {
    // Idea: could use defineProperty to lazily create the koffi.func
    library[name] = ffiFunctionToKoffiFunction(lib, name, ffiFunction)
  }
  return {
    symbols: library as unknown as ConvertFns<typeof symbols>,
    close: () => lib.unload(),
  }
}
