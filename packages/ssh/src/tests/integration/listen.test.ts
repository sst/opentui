import { afterEach, expect, test } from "bun:test"
import { createServer } from "../../index.js"
import type { Server } from "../../types.js"
import { HOST_KEY } from "../support.js"

// listen() startup contract. A handler-less server is a compile error (only serve(handler) returns something startable; the builder has no listen()), so that footgun is proven in type/types.test.ts, not exercised here.

let server: Server | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

test("listen() resolves with host, port, and host-key fingerprints", async () => {
  server = createServer({ auth: "open", startupBanner: false, hostKey: { pem: HOST_KEY } }).serve(() => {})
  const info = await server.listen(0)
  expect(info.port).toBeGreaterThan(0)
  expect(info.host).toBeTruthy()
  expect(info.fingerprints).toHaveLength(1)
  expect(info.fingerprints[0]).toMatch(/^SHA256:/)
})

test("listen() rejects when the port is already in use", async () => {
  server = createServer({ auth: "open", startupBanner: false, hostKey: { pem: HOST_KEY } }).serve(() => {})
  const { port } = await server.listen(0)

  // A bind failure surfaces by rejecting listen(), not via onError.
  const reported: unknown[] = []
  const second = createServer({
    auth: "open",
    startupBanner: false,
    hostKey: { pem: HOST_KEY },
    onError: (error) => reported.push(error),
  }).serve(() => {})
  try {
    await expect(second.listen(port)).rejects.toThrow(/Failed to listen/)
    expect(reported).toEqual([])
  } finally {
    await second.close()
  }
})

test("concurrent listen rejects the duplicate without disturbing the listener", async () => {
  server = createServer({ auth: "open", startupBanner: false, hostKey: { pem: HOST_KEY } }).serve(() => {})
  const first = server.listen(0)
  const duplicate = server.listen(0).catch((error: unknown) => error)
  const info = await first

  await expect(duplicate).resolves.toMatchObject({ code: "ERR_SERVER_ALREADY_LISTEN" })
  expect(info.port).toBeGreaterThan(0)
})

test("close is idempotent and the same server can listen again", async () => {
  server = createServer({ auth: "open", startupBanner: false, hostKey: { pem: HOST_KEY } }).serve(() => {})
  const first = await server.listen(0)
  expect(first.port).toBeGreaterThan(0)

  await Promise.all([server.close(), server.close()])
  await server.close()

  const second = await server.listen(0)
  expect(second.port).toBeGreaterThan(0)
})
