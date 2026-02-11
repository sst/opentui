import { test, expect } from "bun:test"
import { NativeSpanFeed } from "../NativeSpanFeed"
import { resolveRenderLib } from "../zig"

const lib = resolveRenderLib()

function writeAndCommit(stream: NativeSpanFeed, data: Uint8Array): void {
  lib.streamWrite(stream.streamPtr, data)
  lib.streamCommit(stream.streamPtr)
}

test("async handler keeps chunk pinned until Promise resolves", async () => {
  // Single chunk forces reuse; async handlers must keep data pinned.
  const stream = NativeSpanFeed.create({ chunkSize: 64, initialChunks: 1 })

  let resolveHandler!: () => void
  const handlerDone = new Promise<void>((r) => {
    resolveHandler = r
  })

  let capturedData: Uint8Array | null = null
  let dataValidAtResolve = false

  stream.onData(async (data) => {
    capturedData = data
    const originalBytes = new Uint8Array(data)
    await handlerDone
    dataValidAtResolve = capturedData.every((b, i) => b === originalBytes[i])
  })
  const original = new Uint8Array(64)
  for (let i = 0; i < 64; i++) original[i] = i
  writeAndCommit(stream, original)
  const overwrite = new Uint8Array(64).fill(0xff)
  writeAndCommit(stream, overwrite)
  stream.drainAll()
  resolveHandler()
  await new Promise((r) => setTimeout(r, 10))

  expect(capturedData).not.toBeNull()
  expect(dataValidAtResolve).toBe(true)

  stream.close()
})

test("mixed sync and async handlers on same stream", async () => {
  const stream = NativeSpanFeed.create({ chunkSize: 256, initialChunks: 1 })

  const syncReceived: string[] = []
  let asyncReceived: string[] = []
  let resolveAsync!: () => void
  const asyncDone = new Promise<void>((r) => {
    resolveAsync = r
  })

  stream.onData((data) => {
    syncReceived.push(new TextDecoder().decode(data))
  })
  stream.onData(async (data) => {
    const text = new TextDecoder().decode(data)
    await asyncDone
    asyncReceived.push(text)
  })

  const msg = new TextEncoder().encode("hello")
  writeAndCommit(stream, msg)
  stream.drainAll()

  expect(syncReceived).toEqual(["hello"])
  expect(asyncReceived).toEqual([])
  resolveAsync()
  await new Promise((r) => setTimeout(r, 10))

  expect(asyncReceived).toEqual(["hello"])

  stream.close()
})

test("async handler rejection still decrements refcount", async () => {
  const stream = NativeSpanFeed.create({ chunkSize: 64, initialChunks: 1 })

  stream.onData(async () => {
    throw new Error("async failure")
  })

  const data = new Uint8Array(64).fill(0xaa)
  writeAndCommit(stream, data)
  stream.drainAll()

  await new Promise((r) => setTimeout(r, 10))
  const received: Uint8Array[] = []
  stream.onData((d) => {
    received.push(new Uint8Array(d))
  })

  const data2 = new Uint8Array(64).fill(0xbb)
  writeAndCommit(stream, data2)
  stream.drainAll()

  expect(received.length).toBe(1)
  expect(received[0][0]).toBe(0xbb)

  stream.close()
})

test("sync-only handlers decrement refcount immediately (no regression)", () => {
  const stream = NativeSpanFeed.create({ chunkSize: 64, initialChunks: 1 })

  const received: string[] = []
  stream.onData((data) => {
    received.push(new TextDecoder().decode(data))
  })

  const msg1 = new TextEncoder().encode("A".repeat(64))
  writeAndCommit(stream, msg1)
  stream.drainAll()
  const msg2 = new TextEncoder().encode("B".repeat(64))
  writeAndCommit(stream, msg2)
  stream.drainAll()

  expect(received.length).toBe(2)
  expect(received[1]).toBe("B".repeat(64))

  stream.close()
})

test("multiple async handlers all settle before refcount decrement", async () => {
  const stream = NativeSpanFeed.create({ chunkSize: 64, initialChunks: 1 })

  let resolve1!: () => void
  let resolve2!: () => void
  const done1 = new Promise<void>((r) => {
    resolve1 = r
  })
  const done2 = new Promise<void>((r) => {
    resolve2 = r
  })

  const order: string[] = []

  stream.onData(async (_data) => {
    await done1
    order.push("handler1")
  })

  stream.onData(async (_data) => {
    await done2
    order.push("handler2")
  })

  const data = new Uint8Array(64).fill(0xcc)
  writeAndCommit(stream, data)
  stream.drainAll()

  resolve1()
  await new Promise((r) => setTimeout(r, 10))
  resolve2()
  await new Promise((r) => setTimeout(r, 10))

  expect(order).toEqual(["handler1", "handler2"])

  const received: number[] = []
  stream.onData((d) => {
    received.push(d[0])
  })

  const data2 = new Uint8Array(64).fill(0xdd)
  writeAndCommit(stream, data2)
  stream.drainAll()

  expect(received).toContain(0xdd)

  stream.close()
})
