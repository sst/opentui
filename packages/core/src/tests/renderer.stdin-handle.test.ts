import { test, expect, afterEach } from "bun:test"
import { Readable } from "stream"
import { createCliRenderer, type CliRenderer } from "../renderer.js"
import { createTestStdout } from "../testing/test-streams.js"

// #1405: createCliRenderer touches process.stdin, which lazily instantiates the
// TTY read stream and registers its handle on the event loop. destroy() removed
// the listener, cleared raw mode and paused — but pause() stops the read without
// releasing the registration, so the loop kept holding it. On the legacy Windows
// console host that wedges conhost shortly after destroy() and takes the window
// with it. These cover the release and, just as importantly, every case where
// releasing would be wrong.

class FakeStdin extends Readable {
  public unrefCalls = 0
  public rawMode: boolean | null = null
  constructor() {
    super({ read() {} })
  }
  unref(): void {
    this.unrefCalls += 1
  }
  setRawMode(mode: boolean): this {
    this.rawMode = mode
    return this
  }
}

/** A stdin with no `unref` at all — what a redirected, file-backed stdin looks like. */
class UnrefLessStdin extends Readable {
  constructor() {
    super({ read() {} })
  }
  setRawMode(mode: boolean): this {
    return this
  }
}

const destroyFns: Array<() => void> = []
let restoreStdin: (() => void) | null = null

afterEach(() => {
  while (destroyFns.length) destroyFns.pop()!()
  restoreStdin?.()
  restoreStdin = null
})

/** Install `stream` as process.stdin so the renderer's default path picks it up. */
function useAsProcessStdin(stream: Readable): void {
  const original = Object.getOwnPropertyDescriptor(process, "stdin")!
  Object.defineProperty(process, "stdin", { value: stream, configurable: true })
  restoreStdin = () => Object.defineProperty(process, "stdin", original)
}

async function makeRenderer(config: Record<string, unknown> = {}): Promise<CliRenderer> {
  const renderer = await createCliRenderer({ stdout: createTestStdout(), ...config })
  destroyFns.push(() => {
    if (!renderer.isDestroyed) renderer.destroy()
  })
  return renderer
}

test("destroy releases the stdin handle the renderer itself registered", async () => {
  const stdin = new FakeStdin()
  useAsProcessStdin(stdin)

  const renderer = await makeRenderer()
  expect(stdin.unrefCalls).toBe(0)

  renderer.destroy()
  expect(stdin.unrefCalls).toBe(1)
})

test("destroy leaves a caller-supplied stdin alone", async () => {
  const processStdin = new FakeStdin()
  useAsProcessStdin(processStdin)
  const supplied = new FakeStdin()

  const renderer = await makeRenderer({ stdin: supplied })
  renderer.destroy()

  expect(supplied.unrefCalls).toBe(0)
  expect(processStdin.unrefCalls).toBe(0)
})

test("destroy leaves a stdin the host app was already consuming", async () => {
  const stdin = new FakeStdin()
  stdin.on("data", () => {}) // the app is reading stdin before the renderer exists
  useAsProcessStdin(stdin)

  const renderer = await makeRenderer()
  renderer.destroy()

  expect(stdin.unrefCalls).toBe(0)
})

test("destroy leaves stdin alone when a listener attached during the session survives", async () => {
  const stdin = new FakeStdin()
  useAsProcessStdin(stdin)

  const renderer = await makeRenderer()
  const appListener = () => {}
  stdin.on("data", appListener) // host app starts reading while the renderer runs

  renderer.destroy()
  expect(stdin.unrefCalls).toBe(0)
})

test("destroy does not throw when stdin has no unref", async () => {
  const stdin = new UnrefLessStdin()
  useAsProcessStdin(stdin)

  const renderer = await makeRenderer()
  expect(() => renderer.destroy()).not.toThrow()
})

test("suspend does not release the handle, because resume follows it", async () => {
  const stdin = new FakeStdin()
  useAsProcessStdin(stdin)

  const renderer = await makeRenderer()
  renderer.suspend()
  expect(stdin.unrefCalls).toBe(0)

  renderer.resume()
  renderer.destroy()
  expect(stdin.unrefCalls).toBe(1)
})
