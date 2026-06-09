import { expect, spyOn, test } from "bun:test"
import { logging } from "../../logging.js"
import type { MiddlewareSession } from "../../types.js"

test("default logging escapes client-controlled control characters", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {})
  const middleware = logging()
  const session = {
    identity: { method: "none", username: "alice\0\r\nFORGED\x1b[2J\x7f\x85" },
    remoteAddress: { address: "127.0.0.1", port: 22 },
    term: "xterm\x1b]0;owned\x07",
    cols: 80,
    rows: 24,
  } as MiddlewareSession
  try {
    await middleware(session, (() => Promise.resolve({})) as never)
    const lines = log.mock.calls.map(([line]) => String(line))
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line).not.toMatch(/[\r\n\x1b\x07]/)
    }
    expect(lines[0]).toContain("alice\\u0000\\u000d\\u000aFORGED\\u001b[2J\\u007f\\u0085")
    expect(lines[0]).toContain("xterm\\u001b]0;owned\\u0007")
  } finally {
    log.mockRestore()
  }
})

test("a throwing logging sink cannot prevent the session from running", async () => {
  let nextCalls = 0
  const middleware = logging({
    log() {
      throw new Error("sink failed")
    },
  })

  await middleware(
    {
      identity: { method: "none", username: "alice" },
      remoteAddress: { address: "127.0.0.1", port: 22 },
      term: "xterm",
      cols: 80,
      rows: 24,
    } as MiddlewareSession,
    (() => {
      nextCalls++
      return Promise.resolve({})
    }) as never,
  )

  expect(nextCalls).toBe(1)
})

test("a rejected asynchronous logging sink is contained", async () => {
  let nextCalls = 0
  const middleware = logging({
    async log() {
      throw new Error("async sink failed")
    },
  })

  await middleware(
    {
      identity: { method: "none", username: "alice" },
      remoteAddress: { address: "127.0.0.1", port: 22 },
      term: "xterm",
      cols: 80,
      rows: 24,
    } as MiddlewareSession,
    (() => {
      nextCalls++
      return Promise.resolve({})
    }) as never,
  )
  await Promise.resolve()

  expect(nextCalls).toBe(1)
})
