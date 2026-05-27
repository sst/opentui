import { test, expect, beforeEach, afterEach } from "bun:test"
import { Readable, Writable } from "stream"
import { createCliRenderer, CliRenderer } from "../renderer.js"

// These tests verify that rendererTracker only pauses process.stdin when the
// last renderer that was ACTIVELY USING process.stdin is destroyed. A renderer
// using a custom stdin should not influence process.stdin at all.

class NoopWritable extends Writable {
  public readonly isTTY = true
  public readonly columns = 80
  public readonly rows = 24
  override _write(_c: any, _e: BufferEncoding, cb: (err?: Error | null) => void): void {
    cb()
  }
  getColorDepth(): number {
    return 24
  }
}

function customStdin(): NodeJS.ReadStream {
  return new Readable({ read() {} }) as NodeJS.ReadStream
}

function nonProcessStdout(): NodeJS.WriteStream {
  return new NoopWritable() as unknown as NodeJS.WriteStream
}

let originalStdinPaused: boolean
let pauseCalled = false
let originalPause: typeof process.stdin.pause

beforeEach(() => {
  // Spy on process.stdin.pause so we can assert whether it was called.
  pauseCalled = false
  originalStdinPaused = process.stdin.isPaused()
  originalPause = process.stdin.pause.bind(process.stdin)
  process.stdin.pause = (() => {
    pauseCalled = true
    return originalPause()
  }) as typeof process.stdin.pause
})

afterEach(() => {
  process.stdin.pause = originalPause
  // Restore original paused state
  if (!originalStdinPaused) {
    process.stdin.resume()
  }
})

test("two renderers sharing process.stdin: only the second destroy pauses", async () => {
  const a = await createCliRenderer({
    stdin: process.stdin,
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })
  const b = await createCliRenderer({
    stdin: process.stdin,
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })

  pauseCalled = false
  a.destroy()
  // First destroy: another process.stdin user remains, so no pause yet.
  expect(pauseCalled).toBe(false)

  pauseCalled = false
  b.destroy()
  // Second destroy: last process.stdin user gone, so pause should be called.
  expect(pauseCalled).toBe(true)
})

test("renderer with custom stdin does not touch process.stdin on destroy", async () => {
  const r = await createCliRenderer({
    stdin: customStdin(),
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })

  pauseCalled = false
  r.destroy()
  // No renderer was using process.stdin, so pause should not be called.
  expect(pauseCalled).toBe(false)
})

test("mixed: destroying custom-stdin renderer before process.stdin renderer does not pause prematurely", async () => {
  const processOne = await createCliRenderer({
    stdin: process.stdin,
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })
  const customOne = await createCliRenderer({
    stdin: customStdin(),
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })

  pauseCalled = false
  customOne.destroy()
  // Custom-stdin renderer destroyed; process.stdin still in use.
  expect(pauseCalled).toBe(false)

  pauseCalled = false
  processOne.destroy()
  // Now the last process.stdin user is gone; pause expected.
  expect(pauseCalled).toBe(true)
})

test("two custom-stdin renderers: neither touches process.stdin", async () => {
  const a = await createCliRenderer({
    stdin: customStdin(),
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })
  const b = await createCliRenderer({
    stdin: customStdin(),
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })

  pauseCalled = false
  a.destroy()
  expect(pauseCalled).toBe(false)
  b.destroy()
  expect(pauseCalled).toBe(false)
})

test("mixed: destroying process-stdin renderer first, custom second still behaves correctly", async () => {
  const processOne = await createCliRenderer({
    stdin: process.stdin,
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })
  const customOne = await createCliRenderer({
    stdin: customStdin(),
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })

  pauseCalled = false
  processOne.destroy()
  // Removing the only process.stdin user should pause, regardless of order.
  expect(pauseCalled).toBe(true)

  pauseCalled = false
  customOne.destroy()
  // Removing a custom-stdin renderer should never touch process.stdin.
  expect(pauseCalled).toBe(false)
})
