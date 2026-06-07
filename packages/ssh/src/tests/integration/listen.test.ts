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

test("listen() resolves with host, port, and a host-key fingerprint", async () => {
  server = createServer({ auth: "open", startupBanner: false, hostKey: { pem: HOST_KEY } }).serve(() => {})
  const info = await server.listen(0)
  expect(info.port).toBeGreaterThan(0)
  expect(info.host).toBeTruthy()
  expect(info.fingerprint).toMatch(/^SHA256:/)
})

test("listen() rejects when the port is already in use", async () => {
  server = createServer({ auth: "open", startupBanner: false, hostKey: { pem: HOST_KEY } }).serve(() => {})
  const { port } = await server.listen(0)

  // A bind failure surfaces by rejecting listen(), not via onError.
  const second = createServer({ auth: "open", startupBanner: false, hostKey: { pem: HOST_KEY } }).serve(() => {})
  try {
    await expect(second.listen(port)).rejects.toThrow(/Failed to listen/)
  } finally {
    await second.close()
  }
})
