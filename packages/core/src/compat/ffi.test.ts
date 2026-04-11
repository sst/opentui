import { describe, it, expect } from "bun:test"
import * as ffi from "./ffi.js"

describe("ffi", () => {
  it("can round-trip a Uint8Array", () => {
    const array = new TextEncoder().encode("Hello, world!")
    const pointer = ffi.ptr(array)
    const newArrayBuffer = ffi.toArrayBuffer(pointer, 0, array.byteLength)
    const newArray = new Uint8Array(newArrayBuffer)

    expect(newArray).toEqual(array)
    expect(new TextDecoder().decode(newArrayBuffer)).toBe("Hello, world!")
  })

  it("aliases Pointer memory", () => {
    const array = new TextEncoder().encode("Hello, world!")
    const pointer = ffi.ptr(array)
    const newArrayBuffer = ffi.toArrayBuffer(pointer, 0, array.byteLength)
    const newArray = new Uint8Array(newArrayBuffer)

    expect(array[0]).not.toBe(0)
    newArray[0] = 0
    expect(array[0]).toBe(0)
  })

  it("returns stable address", () => {
    const array = new TextEncoder().encode("Hello, world!")
    const pointer = ffi.ptr(array)
    const newArrayBuffer = ffi.toArrayBuffer(pointer, 0, array.byteLength)
    const newArray = new Uint8Array(newArrayBuffer)

    expect(pointer).toBe(ffi.ptr(newArray))
    expect(pointer).toBe(ffi.ptr(newArrayBuffer))
  })
})
