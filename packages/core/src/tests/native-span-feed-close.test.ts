import { test, expect } from "bun:test"
import { NativeSpanFeed } from "../NativeSpanFeed"
import { resolveRenderLib } from "../zig"

const lib = resolveRenderLib()

function nextTick(): Promise<void> {
  // Use a timer turn instead of process.nextTick so Promise/microtask work
  // from async handlers and close deferral can settle before assertions.
  return new Promise((resolve) => setTimeout(resolve, 0))
}

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

test("close should not destroy immediately while async handler is still pending", async () => {
  const stream = NativeSpanFeed.create({ chunkSize: 64, initialChunks: 1 })
  const ptr = stream.streamPtr

  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  let handlerStarted = false
  let handlerSettled = false

  stream.onData(async (_data) => {
    handlerStarted = true
    await gate
    handlerSettled = true
  })

  const payload = new Uint8Array(64).fill(0xaa)
  lib.streamWrite(ptr, payload)
  lib.streamCommit(ptr)
  stream.drainAll()

  expect(handlerStarted).toBe(true)

  stream.close()

  const destroyedImmediately = (stream as any).destroyed === true

  release()
  await nextTick()

  expect(handlerSettled).toBe(true)

  try {
    expect(destroyedImmediately).toBe(false)
  } finally {
    if (!(stream as any).destroyed) {
      lib.destroyNativeSpanFeed(ptr)
    }
  }
})

test("close should not destroy when native close reports Busy", () => {
  const stream = NativeSpanFeed.create({ chunkSize: 64, initialChunks: 1, autoCommitOnFull: false })
  const ptr = stream.streamPtr

  const reserve = lib.streamReserve(ptr, 1)
  expect(reserve.status).toBe(0)

  try {
    stream.close()
  } catch {
    // If close starts throwing on Busy, that's acceptable for this assertion.
  }

  const destroyedAfterBusyClose = (stream as any).destroyed === true

  try {
    expect(destroyedAfterBusyClose).toBe(false)
  } finally {
    if (!(stream as any).destroyed) {
      lib.streamCommitReserved(ptr, 0)
      lib.streamClose(ptr)
      lib.destroyNativeSpanFeed(ptr)
    }
  }
})
