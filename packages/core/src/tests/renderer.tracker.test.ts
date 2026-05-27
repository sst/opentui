import { test, expect, beforeEach, afterEach } from "bun:test"
import { Readable, Writable } from "stream"
import { createCliRenderer } from "../renderer.js"

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
let destroyFns: Array<() => void> = []

beforeEach(() => {
  pauseCalled = false
  originalStdinPaused = process.stdin.isPaused()
  originalPause = process.stdin.pause.bind(process.stdin)
  process.stdin.pause = (() => {
    pauseCalled = true
    return originalPause()
  }) as typeof process.stdin.pause
})

afterEach(() => {
  for (const destroy of destroyFns.splice(0)) {
    destroy()
  }

  process.stdin.pause = originalPause
  if (!originalStdinPaused) {
    process.stdin.resume()
  }
})

test("second renderer sharing process.stdin is rejected", async () => {
  const first = await createCliRenderer({
    stdin: process.stdin,
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })
  destroyFns.push(() => first.destroy())

  await expect(
    createCliRenderer({
      stdin: process.stdin,
      stdout: nonProcessStdout(),
      bufferedOutput: "memory",
    }),
  ).rejects.toThrow("stdin is already used by another CliRenderer")
})

test("second renderer sharing stdout is rejected", async () => {
  const stdout = nonProcessStdout()
  const first = await createCliRenderer({
    stdin: customStdin(),
    stdout,
    bufferedOutput: "memory",
  })
  destroyFns.push(() => first.destroy())

  await expect(
    createCliRenderer({
      stdin: customStdin(),
      stdout,
      bufferedOutput: "memory",
    }),
  ).rejects.toThrow("stdout is already used by another CliRenderer")
})

test("destroy releases streams for reuse", async () => {
  const stdin = customStdin()
  const stdout = nonProcessStdout()
  const first = await createCliRenderer({
    stdin,
    stdout,
    bufferedOutput: "memory",
  })

  first.destroy()

  const second = await createCliRenderer({
    stdin,
    stdout,
    bufferedOutput: "memory",
  })
  destroyFns.push(() => second.destroy())

  expect(second.stdin).toBe(stdin)
})

test("failed input setup releases streams for reuse", async () => {
  const stdin = customStdin()
  const stdout = nonProcessStdout()
  let failRawMode = true

  stdin.setRawMode = (enabled) => {
    if (enabled && failRawMode) {
      throw new Error("raw mode failed")
    }
    return stdin
  }

  await expect(
    createCliRenderer({
      stdin,
      stdout,
      bufferedOutput: "memory",
    }),
  ).rejects.toThrow("raw mode failed")

  failRawMode = false

  const renderer = await createCliRenderer({
    stdin,
    stdout,
    bufferedOutput: "memory",
  })
  destroyFns.push(() => renderer.destroy())

  expect(renderer.stdin).toBe(stdin)
})

test("renderers using separate stream objects can coexist", async () => {
  const first = await createCliRenderer({
    stdin: customStdin(),
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })
  destroyFns.push(() => first.destroy())

  const second = await createCliRenderer({
    stdin: customStdin(),
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })
  destroyFns.push(() => second.destroy())

  expect(second.isDestroyed).toBe(false)
})

test("renderer using process.stdin pauses it on destroy", async () => {
  const renderer = await createCliRenderer({
    stdin: process.stdin,
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })

  pauseCalled = false
  renderer.destroy()

  expect(pauseCalled).toBe(true)
})

test("renderer with custom stdin does not pause process.stdin on destroy", async () => {
  const renderer = await createCliRenderer({
    stdin: customStdin(),
    stdout: nonProcessStdout(),
    bufferedOutput: "memory",
  })

  pauseCalled = false
  renderer.destroy()

  expect(pauseCalled).toBe(false)
})
