import { test, expect } from "bun:test"
import { JSCallback } from "bun:ffi"
import { resolveRenderLib } from "./zig"

const lib = resolveRenderLib()

const callbacks: JSCallback[] = []
const enum EventId {
  Closed = 5,
}

test("streamClose emits Closed once", () => {
  const events: number[] = []
  const cb = new JSCallback(
    (_streamPtr, eventId) => {
      events.push(Number(eventId))
    },
    {
      args: ["ptr", "u32", "ptr", "u64"],
      returns: "void",
    },
  )
  callbacks.push(cb)
  lib.initNativeSpanFeedCallback(cb.ptr)

  const streamPtr = lib.createNativeSpanFeed(null)
  expect(streamPtr).not.toBe(0)
  expect(streamPtr).not.toBeNull()
  expect(lib.attachNativeSpanFeed(streamPtr!)).toBe(0)

  expect(lib.streamClose(streamPtr!)).toBe(0)
  expect(lib.streamClose(streamPtr!)).toBe(0)
  lib.destroyNativeSpanFeed(streamPtr!)

  const closedEvents = events.filter((id) => id === EventId.Closed).length
  expect(closedEvents).toBe(1)
})

test("destroyNativeSpanFeed emits Closed when needed", () => {
  const events: number[] = []
  const cb = new JSCallback(
    (_streamPtr, eventId) => {
      events.push(Number(eventId))
    },
    {
      args: ["ptr", "u32", "ptr", "u64"],
      returns: "void",
    },
  )
  callbacks.push(cb)
  lib.initNativeSpanFeedCallback(cb.ptr)

  const streamPtr = lib.createNativeSpanFeed(null)
  expect(streamPtr).not.toBe(0)
  expect(streamPtr).not.toBeNull()
  expect(lib.attachNativeSpanFeed(streamPtr!)).toBe(0)
  lib.destroyNativeSpanFeed(streamPtr!)

  const closedEvents = events.filter((id) => id === EventId.Closed).length
  expect(closedEvents).toBe(1)
})
