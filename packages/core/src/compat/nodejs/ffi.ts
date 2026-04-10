import koffi from "koffi"
import { fileURLToPath } from "node:url"
import { isArrayBufferView } from "node:util/types"
import type {
  ConvertFns,
  DlopenFunction,
  FFIFunction,
  FFITypeOrString,
  JSCallback as IJSCallback,
  Pointer,
  PtrFunction,
  ToArrayBufferFunction,
} from "../ffi.js"
import { FFIType } from "../FFIType.js"

export { FFIType }

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

export class JSCallback implements IJSCallback {
  #threadsafe: boolean
  #registeredCallback: koffi.IKoffiRegisteredCallback | null

  constructor(callback: (...args: any[]) => any, definition: FFIFunction) {
    // Wrap callback to convert koffi External pointer args → numbers (Bun convention),
    // mirroring the conversion done for FFI function return values.
    const ptrArgIndices: number[] = []
    if (definition.args) {
      for (let i = 0; i < definition.args.length; i++) {
        if (isPointerType(definition.args[i])) ptrArgIndices.push(i)
      }
    }
    const wrappedCallback =
      ptrArgIndices.length > 0
        ? (...args: any[]) => {
            for (const i of ptrArgIndices) {
              const arg = args[i]
              if (typeof arg === "object" && arg !== null) {
                const addr = Number(koffi.address(arg))
                ptrExternals.set(addr, new WeakRef(arg))
                args[i] = addr
              }
            }
            return callback(...args)
          }
        : callback

    const proto = koffi.proto(returnsToKoffiType(definition.returns), argsToKoffiTypes(definition.args))
    this.#registeredCallback = koffi.register(wrappedCallback, koffi.pointer(proto))
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
  return num === FFIType.ptr
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

// Maps numeric pointer addresses (from FFI return values) back to their koffi External.
// toArrayBuffer needs the External to create a live koffi.view() (zero-copy alias of
// native memory) rather than a one-time memcpy snapshot.
const ptrExternals = new Map<number, WeakRef<object>>()

// koffi passes null for 0-length TypedArrays, but Bun passes a valid non-null
// address. Native code may treat null as "no data" even when length is also
// passed as 0. Use a static 1-byte sentinel so the pointer is always non-null.
const emptyPtrSentinel = new Uint8Array(1)

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
  if (isArrayBufferView(arg) && arg.byteLength === 0) {
    return emptyPtrSentinel
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
      const addr = Number(koffi.address(result))
      ptrExternals.set(addr, new WeakRef(result))
      return addr
    }
    if (returnsBigInt && typeof result === "number") {
      return BigInt(result)
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
export const ptr: PtrFunction = (value) => {
  const view = isArrayBufferView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value as ArrayBuffer)

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
      process.platform === "darwin" ? "libSystem.B.dylib" : process.platform === "win32" ? "msvcrt.dll" : "libc.so.6"
    const libc = koffi.load(libcName)
    const fn = libc.func("memcpy", "void*", ["void*", "void*", "size_t"])
    _memcpy = fn as unknown as (dest: Uint8Array, src: bigint, n: number) => void
  }
  return _memcpy
}

export const toArrayBuffer: ToArrayBufferFunction = (pointer, offset, length) => {
  if (pointer === null) {
    throw new TypeError("ptr must be a number")
  }

  if (length === undefined) {
    throw new Error(`nodejs ffi.toArrayBuffer requires a length argument`)
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

  // Check if we have the koffi External for this address — if so, use koffi.view
  // for a live zero-copy alias (matching Bun's toArrayBuffer behavior).
  if (typeof pointer === "number") {
    const ref = ptrExternals.get(pointer)
    if (ref) {
      const external = ref.deref()
      if (external) {
        if (offset) {
          const addr = koffi.address(external) + BigInt(offset)
          const dest = new Uint8Array(length)
          getMemcpy()(dest, addr, length)
          return dest.buffer
        }
        return koffi.view(external, length)
      }
    }
  }

  // Fallback: memcpy for addresses we don't have an External for
  let ptrBigint = typeof pointer === "bigint" ? pointer : BigInt(pointer)
  if (offset && ptrBigint !== null) {
    ptrBigint += BigInt(offset)
  }
  const dest = new Uint8Array(length)
  getMemcpy()(dest, ptrBigint, length)
  return dest.buffer
}

export const suffix: string = koffi.extension.slice(1)

export const dlopen: DlopenFunction = (name, symbols) => {
  let loadPath: string
  if (typeof name === "string") {
    loadPath = name
  } else if (name instanceof URL) {
    loadPath = fileURLToPath(name)
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

export const __url = import.meta.url
