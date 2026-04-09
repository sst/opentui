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

const BunPtrType = koffi.pointer("BunPtr", koffi.opaque())
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
    this.#registeredCallback = koffi.register(callback, koffi.pointer(proto))
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

function isPointerType(type: FFITypeOrString | undefined): boolean {
  if (type === undefined) return false
  const num = typeof type === "number" ? type : FFITypeStringToType[type as keyof typeof FFITypeStringToType]
  return num === FFIType.ptr || num === FFIType.pointer
}

function isBigIntType(type: FFITypeOrString | undefined): boolean {
  if (type === undefined) return false
  const num = typeof type === "number" ? type : FFITypeStringToType[type as keyof typeof FFITypeStringToType]
  return num === FFIType.i64 || num === FFIType.u64 || num === FFIType.i64_fast || num === FFIType.u64_fast
}

// Maps addresses returned by ptr() back to the original Uint8Array.
// When the address appears as an FFI function argument, the wrapper passes the
// Uint8Array directly to koffi — both Bun and koffi pass a TypedArray's underlying
// memory address verbatim, so the native side can read/write JS-owned memory
// (important for output parameters).
const ptrBackingArrays = new Map<number, WeakRef<Uint8Array>>()

function resolvePointerArg(arg: unknown): unknown {
  if (typeof arg === "number") {
    const ref = ptrBackingArrays.get(arg)
    if (ref) {
      const arr = ref.deref()
      if (arr) return arr
    }
    // Real native address (e.g. from JSCallback.ptr or read from output buffer) —
    // koffi accepts BigInt for pointer params.
    return BigInt(arg)
  }
  return arg
}

function ffiFunctionToKoffiFunction<T extends (...args: unknown[]) => unknown>(
  lib: koffi.IKoffiLib,
  name: string,
  type: FFIFunction,
): T & koffi.KoffiFunction {
  const func = lib.func(name, returnsToKoffiType(type.returns), argsToKoffiTypes(type.args))

  const ptrArgIndices: number[] = []
  if (type.args) {
    for (let i = 0; i < type.args.length; i++) {
      if (isPointerType(type.args[i])) ptrArgIndices.push(i)
    }
  }
  const returnsPtr = isPointerType(type.returns)
  // koffi may return small u64/i64 values as number instead of bigint;
  // Bun always returns bigint for these types.
  const returnsBigInt = isBigIntType(type.returns)

  if (ptrArgIndices.length === 0 && !returnsPtr && !returnsBigInt) {
    return func as T & koffi.KoffiFunction
  }

  const wrapper = (...args: unknown[]) => {
    for (const i of ptrArgIndices) {
      args[i] = resolvePointerArg(args[i])
    }
    const result = func(...args)
    if (returnsPtr && typeof result === "object" && result !== null) {
      return Number(koffi.address(result)) as unknown
    }
    if (returnsBigInt && typeof result === "number") {
      return BigInt(result) as unknown
    }
    return result
  }
  Object.defineProperty(wrapper, "name", { value: name })
  return wrapper as T & koffi.KoffiFunction
}

const KoffiNativeAlloc = Symbol("KoffiNativeAlloc")
const NativeAllocRegistry = new FinalizationRegistry((val) => koffi.free(val))

function nativeAlloc(value: object, bytes: number) {
  if (KoffiNativeAlloc in value) {
    return value[KoffiNativeAlloc]
  }
  const alloc = koffi.alloc(koffi.types.uint8, bytes)
  Object.defineProperty(value, KoffiNativeAlloc, {
    value: alloc,
    writable: false,
    configurable: true,
    enumerable: false,
  })
  NativeAllocRegistry.register(value, alloc)
  return alloc
}

/**
 * Returns the address of a koffi-allocated copy of `value` — a real native
 * address that can be embedded in packed structs for the native side to
 * dereference.
 *
 * The original Uint8Array is also stored so that when this address is later
 * passed as an FFI function argument, the wrapper can pass the original
 * TypedArray to koffi instead (enabling write-back for output parameters).
 */
export const ptr: typeof bunPtr = (value) => {
  const view = isArrayBufferView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value)

  // Allocate koffi memory and copy current data — gives a real native address
  // that can be safely embedded in struct binary data.
  const opaque = nativeAlloc(value, value.byteLength)
  koffi.encode(opaque, koffi.types.uint8, view, view.byteLength)
  const address = Number(koffi.address(opaque))

  // Also store the original view so resolvePointerArg can pass it through
  // to koffi for direct memory access (output parameter write-back).
  ptrBackingArrays.set(address, new WeakRef(view))

  return address as Pointer
}

// Lazy-loaded memcpy for copying from raw addresses
let _memcpy: ((dest: Uint8Array, src: bigint, n: number) => void) | undefined
function getMemcpy() {
  if (!_memcpy) {
    const libcName =
      process.platform === "darwin"
        ? "libSystem.B.dylib"
        : process.platform === "win32"
          ? "msvcrt.dll"
          : "libc.so.6"
    const libc = koffi.load(libcName)
    const fn = libc.func("memcpy", "void*", ["void*", "void*", "size_t"])
    _memcpy = fn as unknown as (dest: Uint8Array, src: bigint, n: number) => void
  }
  return _memcpy
}

export const toArrayBuffer: typeof bunToArrayBuffer = (pointer, offset, length) => {
  if (length === undefined) {
    throw new Error(`bun:ffi.toArrayBuffer requires a length argument`)
  }

  // If pointer is a koffi External, we can use koffi.view directly
  if (typeof pointer === "object" && pointer !== null) {
    if (offset) {
      // Need to offset the pointer — convert to address and use memcpy path
      const addr = koffi.address(pointer) + BigInt(offset)
      const dest = new Uint8Array(length)
      getMemcpy()(dest, addr, length)
      return dest.buffer
    }
    return koffi.view(pointer, length)
  }

  // For numeric addresses (Bun convention), use memcpy to copy into a new buffer
  let ptrBigint = typeof pointer === "bigint" ? pointer : BigInt(pointer)
  if (offset) {
    ptrBigint += BigInt(offset)
  }
  const dest = new Uint8Array(length)
  getMemcpy()(dest, ptrBigint, length)
  return dest.buffer
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
