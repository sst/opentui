import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  BUN_DLOPEN_NULL,
  FFIType,
  KOFFI_CALLBACK_THREADSAFE,
  KOFFI_NAPI_UNSUPPORTED,
  KOFFI_POINTER_OVERRIDE,
  LIBRARY_CLOSED,
  NODE_CALLBACK_THREADSAFE,
  NODE_NAPI_UNSUPPORTED,
  NODE_POINTER_OVERRIDE,
  NODE_PTR_VALUE,
  NODE_STRING_RETURN,
  NODE_USIZE_UNSUPPORTED,
  POINTER_NEGATIVE,
  POINTER_UNSAFE,
  createBunBackend,
  createKoffiBackend,
  createNodeBackend,
  ffiBool,
  toPointer,
  type FFICallbackInstance,
  type Pointer,
} from "./ffi.js"

function createMockBackend() {
  const events: string[] = []
  const symbolDefinitions: unknown[] = []
  const callbackDefinitions: unknown[] = []
  const toArrayBufferPointers: number[] = []
  const rawCallbacks: MockJSCallback[] = []
  let nextPtr = 1

  class MockJSCallback implements FFICallbackInstance {
    ptr: Pointer | null
    readonly threadsafe: boolean
    closeCount = 0

    constructor(_callback: (...args: any[]) => any, definition: { readonly threadsafe?: boolean }) {
      this.ptr = nextPtr++ as Pointer
      this.threadsafe = definition.threadsafe ?? false
      callbackDefinitions.push(definition)
      rawCallbacks.push(this)
    }

    close(): void {
      if (this.closeCount > 0) {
        return
      }

      this.closeCount++
      events.push(`callback.close:${this.ptr}`)
      this.ptr = null
    }
  }

  const backend = createBunBackend({
    JSCallback: MockJSCallback,
    dlopen(_path, symbols) {
      symbolDefinitions.push(symbols)

      return {
        symbols: Object.fromEntries(Object.keys(symbols).map((name) => [name, () => undefined])) as any,
        close() {
          events.push("library.close")
        },
      }
    },
    ptr() {
      return 1 as Pointer
    },
    suffix: ".mock",
    toArrayBuffer(pointer, _offset, length) {
      toArrayBufferPointers.push(pointer)
      return new ArrayBuffer(length)
    },
  })

  return { backend, callbackDefinitions, events, rawCallbacks, symbolDefinitions, toArrayBufferPointers }
}

interface MockNodeBackendOptions {
  closeError?: Error
}

function createMockNodeBackend(options: MockNodeBackendOptions = {}) {
  const events: string[] = []
  const paths: Array<string | null> = []
  const symbolDefinitions: unknown[] = []
  const callbackDefinitions: unknown[] = []
  const toArrayBufferCalls: Array<{ pointer: bigint; length: number; copy: boolean | undefined }> = []
  const rawPointers = new WeakMap<ArrayBuffer, bigint>()
  let nextCallbackPtr = 9000n
  let nextRawPointer = 1000n

  const backend = createNodeBackend({
    dlopen(
      path: string | null,
      symbols: Record<string, { readonly parameters: readonly string[]; readonly result: string }>,
    ) {
      paths.push(path)
      symbolDefinitions.push(symbols)

      return {
        lib: {
          close() {
            events.push("library.close")
            if (options.closeError) {
              throw options.closeError
            }
          },
          registerCallback(
            signature: { readonly parameters: readonly string[]; readonly result: string },
            _callback: (...args: any[]) => any,
          ) {
            const pointer = nextCallbackPtr++
            events.push(`callback.register:${pointer}`)
            callbackDefinitions.push(signature)
            return pointer
          },
          unregisterCallback(pointer: bigint) {
            events.push(`callback.unregister:${pointer}`)
          },
        },
        functions: Object.fromEntries(Object.keys(symbols).map((name) => [name, () => undefined])),
      }
    },
    getRawPointer(source: ArrayBuffer) {
      let pointer = rawPointers.get(source)
      if (pointer == null) {
        pointer = nextRawPointer
        nextRawPointer += 100n
        rawPointers.set(source, pointer)
      }

      return pointer
    },
    suffix: "mock",
    toArrayBuffer(pointer: bigint, length: number, copy?: boolean) {
      toArrayBufferCalls.push({ pointer, length, copy })
      return new ArrayBuffer(length)
    },
  })

  return {
    backend,
    callbackDefinitions,
    events,
    paths,
    symbolDefinitions,
    toArrayBufferCalls,
  }
}

function createMockKoffiBackend() {
  const events: string[] = []
  const paths: string[] = []
  const symbolDefinitions: unknown[] = []
  const symbolCalls: Array<{ name: string; args: unknown[] }> = []
  const callbackDefinitions: unknown[] = []
  const callbackPointers: object[] = []
  const viewCalls: Array<{ pointer: unknown; length: number }> = []
  const returnValues = new Map<string, unknown>()
  const objectPointers = new WeakMap<object, bigint>()
  let nextObjectPointer = 5000n

  function address(value: unknown): bigint {
    if (typeof value === "bigint") {
      return value
    }

    if (typeof value === "number") {
      return BigInt(value)
    }

    if ((typeof value !== "object" && typeof value !== "function") || value == null) {
      throw new TypeError("mock Koffi address expects a pointer-like value")
    }

    let pointer = objectPointers.get(value)
    if (pointer == null) {
      pointer = nextObjectPointer
      nextObjectPointer += 100n
      objectPointers.set(value, pointer)
    }

    return pointer
  }

  const backend = createKoffiBackend(
    {
      address,
      load(path: string) {
        paths.push(path)
        return {
          func(name: string, result: string, parameters: readonly unknown[]) {
            symbolDefinitions.push({ name, result, parameters })
            return (...args: unknown[]) => {
              symbolCalls.push({ name, args })
              return returnValues.get(name)
            }
          },
          unload() {
            events.push("library.unload")
          },
        }
      },
      pointer(type: unknown) {
        return { pointerTo: type }
      },
      proto(name: string, result: string, parameters: readonly unknown[]) {
        const definition = { name, result, parameters }
        callbackDefinitions.push(definition)
        return definition
      },
      register(callback: (...args: any[]) => any, type: unknown) {
        const pointer = { id: callbackPointers.length + 1 }
        callbackPointers.push(pointer)
        events.push(`callback.register:${pointer.id}`)
        callbackDefinitions.push({ callback, type })
        return pointer
      },
      unregister(pointer: { id?: number }) {
        events.push(`callback.unregister:${pointer.id}`)
      },
      view(pointer: unknown, length: number) {
        viewCalls.push({ pointer, length })
        return new ArrayBuffer(length)
      },
    },
    {
      ptr(value) {
        return Number(address(value)) as Pointer
      },
      toArrayBuffer(pointer, offset, length) {
        viewCalls.push({ pointer: BigInt(pointer) + BigInt(offset ?? 0), length })
        return new ArrayBuffer(length)
      },
    },
  )

  return {
    backend,
    callbackDefinitions,
    callbackPointers,
    events,
    paths,
    returnValues,
    symbolCalls,
    symbolDefinitions,
    viewCalls,
  }
}

describe("platform/ffi", () => {
  test("converts JavaScript booleans to numeric FFI booleans", () => {
    expect(ffiBool(false)).toBe(0)
    expect(ffiBool(true)).toBe(1)
  })

  test("closes the native library before auto-closing managed callbacks", () => {
    const { backend, events, rawCallbacks } = createMockBackend()
    const library = backend.dlopen("mock", {})

    const first = library.createCallback(() => undefined, { returns: "void" })
    const second = library.createCallback(() => undefined, { returns: "void" })

    expect(first.ptr).toBe(1 as Pointer)
    expect(second.ptr).toBe(2 as Pointer)

    library.close()

    expect(events).toEqual(["library.close", "callback.close:1", "callback.close:2"])
    expect(first.ptr).toBeNull()
    expect(second.ptr).toBeNull()
    expect(rawCallbacks.map((callback) => callback.closeCount)).toEqual([1, 1])

    library.close()
    first.close()

    expect(events).toEqual(["library.close", "callback.close:1", "callback.close:2"])
    expect(rawCallbacks.map((callback) => callback.closeCount)).toEqual([1, 1])
  })

  test("removes explicitly closed callbacks from library-owned cleanup", () => {
    const { backend, events, rawCallbacks } = createMockBackend()
    const library = backend.dlopen("mock", {})
    const callback = library.createCallback(() => undefined, { returns: "void" })

    callback.close()
    callback.close()
    library.close()

    expect(callback.ptr).toBeNull()
    expect(events).toEqual(["callback.close:1", "library.close"])
    expect(rawCallbacks[0]?.closeCount).toBe(1)
  })

  test("throws when creating a callback after library close", () => {
    const { backend } = createMockBackend()
    const library = backend.dlopen("mock", {})

    library.close()

    expect(() => library.createCallback(() => undefined, { returns: "void" })).toThrow(LIBRARY_CLOSED)
  })

  test("normalizes safe bigint pointers at the Bun backend boundary", () => {
    const { backend, callbackDefinitions, symbolDefinitions, toArrayBufferPointers } = createMockBackend()

    backend.dlopen("mock", { withPtr: { ptr: 12n as Pointer } })
    expect((symbolDefinitions[0] as any).withPtr.ptr).toBe(12)

    const library = backend.dlopen("mock", {})
    library.createCallback(() => undefined, { ptr: 13n as Pointer, returns: "void" })
    expect((callbackDefinitions[0] as any).ptr).toBe(13)

    backend.toArrayBuffer(14n as Pointer, 0, 1)
    expect(toArrayBufferPointers).toEqual([14])
  })

  test("rejects unsafe bigint pointer narrowing", () => {
    const { backend } = createMockBackend()
    const unsafePointer = (BigInt(Number.MAX_SAFE_INTEGER) + 1n) as Pointer
    const negativePointer = -1n as Pointer

    expect(toPointer(1n)).toBe(1 as Pointer)
    expect(() => toPointer(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(POINTER_UNSAFE)
    expect(() => toPointer(-1n)).toThrow(POINTER_NEGATIVE)
    expect(() => backend.toArrayBuffer(unsafePointer, 0, 1)).toThrow(POINTER_UNSAFE)
    expect(() => backend.dlopen("mock", { withPtr: { ptr: unsafePointer } })).toThrow(POINTER_UNSAFE)

    const library = backend.dlopen("mock", {})
    expect(() => library.createCallback(() => undefined, { ptr: negativePointer, returns: "void" })).toThrow(
      POINTER_NEGATIVE,
    )
  })

  test("converts file: URLs to filesystem paths at Node dlopen", () => {
    const { backend, paths } = createMockNodeBackend()
    const filePath = join(process.cwd(), "libopentui.mock")
    const fileUrl = pathToFileURL(filePath)

    backend.dlopen(fileUrl, {})
    backend.dlopen("/usr/lib/libfoo.so", {})

    expect(paths).toEqual([fileURLToPath(fileUrl), "/usr/lib/libfoo.so"])
  })

  test("normalizes Node integer, char, bool, and void FFIType aliases", () => {
    const { backend, symbolDefinitions } = createMockNodeBackend()

    backend.dlopen("mock", {
      primitives: {
        args: [
          FFIType.char,
          FFIType.int8_t,
          FFIType.i8,
          FFIType.uint8_t,
          FFIType.u8,
          FFIType.int16_t,
          FFIType.i16,
          FFIType.uint16_t,
          FFIType.u16,
          FFIType.int32_t,
          FFIType.int,
          FFIType.i32,
          FFIType.uint32_t,
          FFIType.u32,
          FFIType.int64_t,
          FFIType.i64,
          FFIType.uint64_t,
          FFIType.u64,
          FFIType.bool,
        ],
        returns: FFIType.void,
      },
    })

    expect(symbolDefinitions).toEqual([
      {
        primitives: {
          parameters: [
            "char",
            "i8",
            "i8",
            "u8",
            "u8",
            "i16",
            "i16",
            "u16",
            "u16",
            "i32",
            "i32",
            "i32",
            "u32",
            "u32",
            "i64",
            "i64",
            "u64",
            "u64",
            "bool",
          ],
          result: "void",
        },
      },
    ])
  })

  test("normalizes Node float FFIType aliases", () => {
    const { backend, symbolDefinitions } = createMockNodeBackend()

    backend.dlopen("mock", {
      floats: {
        args: [FFIType.float, FFIType.f32, FFIType.double, FFIType.f64],
        returns: FFIType.void,
      },
    })

    expect(symbolDefinitions).toEqual([
      {
        floats: {
          parameters: ["f32", "f32", "f64", "f64"],
          result: "void",
        },
      },
    ])
  })

  test("normalizes Node pointer-like FFIType aliases", () => {
    const { backend, symbolDefinitions } = createMockNodeBackend()
    const library = backend.dlopen("mock", {
      pointers: {
        args: [FFIType.ptr, FFIType.pointer, FFIType.function, FFIType.callback, FFIType.buffer, FFIType.cstring],
        returns: FFIType.void,
      },
    })

    expect(typeof library.symbols.pointers).toBe("function")
    expect(symbolDefinitions).toEqual([
      {
        pointers: {
          parameters: ["pointer", "pointer", "pointer", "pointer", "buffer", "string"],
          result: "void",
        },
      },
    ])
  })

  test("uses Node pointer and toArrayBuffer memory semantics", () => {
    const { backend, toArrayBufferCalls } = createMockNodeBackend()
    const buffer = new ArrayBuffer(16)
    const view = new Uint8Array(buffer, 4, 8)
    const otherBuffer = new ArrayBuffer(16)
    const unsafeNumericPointer = (Number.MAX_SAFE_INTEGER + 1) as Pointer
    const negativeBigIntPointer = -1n as Pointer

    expect(backend.ptr(buffer)).toBe(1000n as Pointer)
    expect(backend.ptr(view)).toBe(1004n as Pointer)
    expect(backend.ptr(buffer)).toBe(1000n as Pointer)
    expect(backend.ptr(otherBuffer)).toBe(1100n as Pointer)
    expect(() => backend.ptr({} as ArrayBuffer)).toThrow(NODE_PTR_VALUE)

    backend.toArrayBuffer(2000n as Pointer, 8, 32)
    backend.toArrayBuffer(3000n as Pointer, undefined, 16)
    expect(() => backend.toArrayBuffer(unsafeNumericPointer, 0, 1)).toThrow(POINTER_UNSAFE)
    expect(() => backend.toArrayBuffer(negativeBigIntPointer, 0, 1)).toThrow(POINTER_NEGATIVE)

    expect(toArrayBufferCalls).toEqual([
      { pointer: 2008n, length: 32, copy: false },
      { pointer: 3000n, length: 16, copy: false },
    ])
  })

  test("passes dlopen(null) to Node and rejects it in Bun", () => {
    const bun = createMockBackend()
    const node = createMockNodeBackend()

    node.backend.dlopen(null, {})
    expect(node.paths).toEqual([null])

    expect(() => bun.backend.dlopen(null, {})).toThrow(BUN_DLOPEN_NULL)
  })

  test("loads Koffi symbols and normalizes pointer boundaries", () => {
    const { backend, paths, returnValues, symbolCalls, symbolDefinitions, viewCalls } = createMockKoffiBackend()
    const returnedPointer = { native: true }
    returnValues.set("withPointers", returnedPointer)
    returnValues.set("withU64", 42)
    const filePath = join(process.cwd(), "libopentui.mock")
    const fileUrl = pathToFileURL(filePath)

    const library = backend.dlopen(fileUrl, {
      withPointers: { args: [FFIType.ptr, FFIType.usize, FFIType.bool], returns: FFIType.ptr },
      withU64: { returns: FFIType.u64 },
    })

    expect(library.symbols.withPointers(123 as Pointer, 4, 1)).toBe(5000 as Pointer)
    expect(library.symbols.withU64()).toBe(42n)
    backend.toArrayBuffer(200 as Pointer, 8, 16)

    expect(paths).toEqual([fileURLToPath(fileUrl)])
    expect(symbolDefinitions).toEqual([
      { name: "withPointers", result: "void *", parameters: ["void *", "size_t", "bool"] },
      { name: "withU64", result: "uint64_t", parameters: [] },
    ])
    expect(symbolCalls).toEqual([
      { name: "withPointers", args: [123n, 4, true] },
      { name: "withU64", args: [] },
    ])
    expect(viewCalls).toEqual([{ pointer: 208n, length: 16 }])
  })

  test("manages Koffi callbacks and normalizes callback pointer arguments", () => {
    const { backend, callbackDefinitions, callbackPointers, events } = createMockKoffiBackend()
    const library = backend.dlopen("mock", {})
    const callbackArgs: unknown[] = []
    const callback = library.createCallback((pointer: Pointer) => callbackArgs.push(pointer), {
      args: [FFIType.ptr],
      returns: FFIType.void,
    })
    const nativePointer = { native: true }

    ;(callbackDefinitions[1] as { callback: (...args: unknown[]) => void }).callback(nativePointer)

    expect(callback.ptr).toBe(callbackPointers[0] as Pointer)
    expect(callbackArgs).toEqual([5000 as Pointer])
    expect(callbackDefinitions[0]).toMatchObject({ result: "void", parameters: ["void *"] })
    expect((callbackDefinitions[0] as { name: string }).name).toMatch(/^OpenTUICallback\d+$/)

    callback.close()
    callback.close()
    library.close()

    expect(callback.ptr).toBeNull()
    expect(events).toEqual(["callback.register:1", "callback.unregister:1", "library.unload"])
  })

  test("rejects Koffi unsupported callback and symbol definitions", () => {
    const { backend } = createMockKoffiBackend()

    expect(() => backend.dlopen("mock", { withPtr: { ptr: 1n as Pointer, returns: FFIType.void } })).toThrow(
      KOFFI_POINTER_OVERRIDE,
    )
    expect(() => backend.dlopen("mock", { withNapi: { args: [FFIType.napi_env], returns: FFIType.void } })).toThrow(
      KOFFI_NAPI_UNSUPPORTED,
    )

    const library = backend.dlopen("mock", {})
    expect(() => library.createCallback(() => undefined, { returns: FFIType.void, threadsafe: true })).toThrow(
      KOFFI_CALLBACK_THREADSAFE,
    )
    expect(() => library.createCallback(() => undefined, { ptr: 1n as Pointer, returns: FFIType.void })).toThrow(
      KOFFI_POINTER_OVERRIDE,
    )
  })

  test("manages Node callbacks through the loaded library", () => {
    const { backend, callbackDefinitions, events } = createMockNodeBackend()
    const library = backend.dlopen("mock", {})
    const callback = library.createCallback(() => undefined, { args: [FFIType.i32], returns: FFIType.i32 })

    expect(callback.ptr).toBe(9000n as Pointer)
    expect(callback.threadsafe).toBe(false)
    expect(callbackDefinitions).toEqual([{ parameters: ["i32"], result: "i32" }])

    callback.close()
    callback.close()
    library.close()

    expect(callback.ptr).toBeNull()
    expect(events).toEqual(["callback.register:9000", "callback.unregister:9000", "library.close"])
  })

  test("marks Node callbacks closed after library close without unregistering an already closed library", () => {
    const { backend, events } = createMockNodeBackend()
    const library = backend.dlopen("mock", {})
    const callback = library.createCallback(() => undefined, { returns: FFIType.void })

    library.close()
    library.close()
    callback.close()

    expect(callback.ptr).toBeNull()
    expect(() => library.createCallback(() => undefined, { returns: FFIType.void })).toThrow(LIBRARY_CLOSED)
    expect(events).toEqual(["callback.register:9000", "library.close"])
  })

  test("does not unregister Node callbacks after a throwing library close starts", () => {
    const closeError = new Error("close failed")
    const { backend, events } = createMockNodeBackend({ closeError })
    const library = backend.dlopen("mock", {})
    const callback = library.createCallback(() => undefined, { returns: FFIType.void })

    expect(() => library.close()).toThrow(closeError)

    expect(callback.ptr).toBeNull()
    expect(events).toEqual(["callback.register:9000", "library.close"])
  })

  test("rejects Node-only unsupported callback and symbol definitions", () => {
    const { backend } = createMockNodeBackend()

    expect(() => backend.dlopen("mock", { withPtr: { ptr: 1n as Pointer, returns: FFIType.void } })).toThrow(
      NODE_POINTER_OVERRIDE,
    )

    expect(() => backend.dlopen("mock", { withUsize: { args: [FFIType.usize], returns: FFIType.void } })).toThrow(
      NODE_USIZE_UNSUPPORTED,
    )
    expect(() => backend.dlopen("mock", { withNapi: { args: [FFIType.napi_env], returns: FFIType.void } })).toThrow(
      NODE_NAPI_UNSUPPORTED,
    )
    expect(() => backend.dlopen("mock", { returnsNapi: { returns: FFIType.napi_value } })).toThrow(
      NODE_NAPI_UNSUPPORTED,
    )
    expect(() => backend.dlopen("mock", { returnsString: { returns: FFIType.cstring } })).toThrow(NODE_STRING_RETURN)
    expect(() => backend.dlopen("mock", { invalid: { args: ["bad" as FFIType], returns: FFIType.void } })).toThrow(
      "Unsupported FFIType for node:ffi: bad",
    )

    const library = backend.dlopen("mock", {})
    expect(() => library.createCallback(() => undefined, { returns: FFIType.void, threadsafe: true })).toThrow(
      NODE_CALLBACK_THREADSAFE,
    )
    expect(() => library.createCallback(() => undefined, { ptr: 1n as Pointer, returns: FFIType.void })).toThrow(
      NODE_POINTER_OVERRIDE,
    )
  })
})
