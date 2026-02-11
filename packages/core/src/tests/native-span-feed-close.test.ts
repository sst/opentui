import { test, expect } from "bun:test"
import { resolveRenderLib } from "../zig"

const lib = resolveRenderLib()

const enum EventId {
  Closed = 5,
}

test("streamClose emits Closed once", () => {
  const events: number[] = []

  const streamPtr = lib.createNativeSpanFeed(null)
  expect(streamPtr).not.toBe(0)
  expect(streamPtr).not.toBeNull()
  lib.registerNativeSpanFeedStream(streamPtr!, (eventId) => {
    events.push(Number(eventId))
  })
  expect(lib.attachNativeSpanFeed(streamPtr!)).toBe(0)

  expect(lib.streamClose(streamPtr!)).toBe(0)
  expect(lib.streamClose(streamPtr!)).toBe(0)
  lib.unregisterNativeSpanFeedStream(streamPtr!)
  lib.destroyNativeSpanFeed(streamPtr!)

  const closedEvents = events.filter((id) => id === EventId.Closed).length
  expect(closedEvents).toBe(1)
})

test("destroyNativeSpanFeed emits Closed when needed", () => {
  const events: number[] = []

  const streamPtr = lib.createNativeSpanFeed(null)
  expect(streamPtr).not.toBe(0)
  expect(streamPtr).not.toBeNull()
  lib.registerNativeSpanFeedStream(streamPtr!, (eventId) => {
    events.push(Number(eventId))
  })
  expect(lib.attachNativeSpanFeed(streamPtr!)).toBe(0)
  lib.destroyNativeSpanFeed(streamPtr!)

  const closedEvents = events.filter((id) => id === EventId.Closed).length
  expect(closedEvents).toBe(1)
})
