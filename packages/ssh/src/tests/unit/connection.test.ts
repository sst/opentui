import { EventEmitter } from "node:events"
import { expect, test } from "bun:test"
import type { AuthContext, ClientInfo, Connection } from "ssh2"
import { createConnectionHandler } from "../../connection.js"
import { createSafeInvoke } from "../../safe.js"
import { deferred } from "../support.js"

test("an authentication decision is ignored after the connection closes", async () => {
  const started = deferred<void>()
  const decision = deferred<void>()
  let accepts = 0
  let rejects = 0
  const client = Object.assign(new EventEmitter(), {
    end() {},
    _sock: { destroy() {} },
  }) as unknown as Connection
  const handler = createConnectionHandler({
    authenticator: {
      advertisedMethods: () => ["none"],
      authenticate: async () => ({ type: "reject", methods: ["none"] }),
      async handle() {
        started.resolve()
        await decision.promise
        return { type: "accept", identity: { method: "none", username: "late" } }
      },
    },
    middlewares: [],
    handler: () => {},
    safe: createSafeInvoke(() => {}),
    idleTimeoutMs: undefined,
    maxTimeoutMs: undefined,
    sessionLimits: { perConnection: 1, global: 100 },
  })
  handler.onConnection(client, { ip: "127.0.0.1", port: 1234 } as ClientInfo)
  handler.setAccepting(true)
  client.emit("authentication", {
    method: "none",
    username: "late",
    accept: () => accepts++,
    reject: () => rejects++,
  } as unknown as AuthContext)
  await started.promise
  client.emit("close")
  decision.resolve()
  await Promise.resolve()
  await Promise.resolve()

  expect(accepts).toBe(0)
  expect(rejects).toBe(0)
})

test("closeAll waits for a logically closed bridge to finish draining", async () => {
  let rawCallback: (() => void) | undefined
  const channel = Object.assign(new EventEmitter(), {
    write(_data: Buffer | string, callback?: () => void) {
      rawCallback = callback
      return false
    },
    pause() {},
    resume() {},
    exit() {},
    close() {},
  })
  const sshSession = new EventEmitter()
  let clientEndCalls = 0
  const client = Object.assign(new EventEmitter(), {
    end() {
      clientEndCalls++
    },
    _sock: { destroy() {} },
  }) as unknown as Connection
  const handler = createConnectionHandler({
    authenticator: {
      advertisedMethods: () => ["none"],
      authenticate: async () => ({ type: "reject", methods: ["none"] }),
      handle: async () => ({ type: "accept", identity: { method: "none", username: "x" } }),
    },
    middlewares: [
      (session) => {
        session.write("pending")
      },
    ],
    handler: () => {},
    safe: createSafeInvoke(() => {}),
    idleTimeoutMs: undefined,
    maxTimeoutMs: undefined,
    sessionLimits: { perConnection: 1, global: 100 },
  })
  handler.onConnection(client, { ip: "127.0.0.1", port: 1234 } as ClientInfo)
  handler.setAccepting(true)
  client.emit("ready")
  client.emit("session", () => sshSession)
  sshSession.emit("shell", () => channel)
  await Promise.resolve()
  await Promise.resolve()

  let closed = false
  const closing = handler.closeAll().then(() => {
    closed = true
  })
  await Promise.resolve()
  expect(closed).toBe(false)
  expect(clientEndCalls).toBe(0)

  rawCallback?.()
  await closing
  expect(clientEndCalls).toBe(1)
})

test("closeAll force-closes a client that never drains", async () => {
  const channel = Object.assign(new EventEmitter(), {
    write() {
      return false
    },
    pause() {},
    resume() {},
    exit() {},
    close() {},
  })
  const sshSession = new EventEmitter()
  let socketDestroyCalls = 0
  const client = Object.assign(new EventEmitter(), {
    end() {},
    _sock: {
      destroy() {
        socketDestroyCalls++
      },
    },
  }) as unknown as Connection
  const handler = createConnectionHandler({
    authenticator: {
      advertisedMethods: () => ["none"],
      authenticate: async () => ({ type: "reject", methods: ["none"] }),
      handle: async () => ({ type: "accept", identity: { method: "none", username: "x" } }),
    },
    middlewares: [
      (session) => {
        session.write("never drains")
      },
    ],
    handler: () => {},
    safe: createSafeInvoke(() => {}),
    idleTimeoutMs: undefined,
    maxTimeoutMs: undefined,
    sessionLimits: { perConnection: 1, global: 100 },
  })
  handler.onConnection(client, { ip: "127.0.0.1", port: 1234 } as ClientInfo)
  handler.setAccepting(true)
  client.emit("ready")
  client.emit("session", () => sshSession)
  sshSession.emit("shell", () => channel)
  await Promise.resolve()
  await Promise.resolve()

  await handler.closeAll()
  expect(socketDestroyCalls).toBe(1)
})

test("closeAll rejects shells requested after shutdown begins", async () => {
  let rawCallback: (() => void) | undefined
  const channel = Object.assign(new EventEmitter(), {
    write(_data: Buffer | string, callback?: () => void) {
      rawCallback = callback
      return false
    },
    pause() {},
    resume() {},
    exit() {},
    close() {},
  })
  const client = Object.assign(new EventEmitter(), {
    end() {},
    _sock: { destroy() {} },
  }) as unknown as Connection
  const handler = createConnectionHandler({
    authenticator: {
      advertisedMethods: () => ["none"],
      authenticate: async () => ({ type: "reject", methods: ["none"] }),
      handle: async () => ({ type: "accept", identity: { method: "none", username: "x" } }),
    },
    middlewares: [
      (session) => {
        session.write("pending")
      },
    ],
    handler: () => {},
    safe: createSafeInvoke(() => {}),
    idleTimeoutMs: undefined,
    maxTimeoutMs: undefined,
    sessionLimits: { perConnection: 2, global: 2 },
  })
  handler.onConnection(client, { ip: "127.0.0.1", port: 1234 } as ClientInfo)
  handler.setAccepting(true)
  client.emit("ready")

  const firstSession = new EventEmitter()
  client.emit("session", () => firstSession)
  firstSession.emit(
    "shell",
    () => channel,
    () => {},
  )
  await Promise.resolve()
  await Promise.resolve()

  const closing = handler.closeAll()
  await Promise.resolve()
  let accepted = 0
  let rejected = 0
  const lateSession = new EventEmitter()
  client.emit("session", () => lateSession)
  lateSession.emit(
    "shell",
    () => {
      accepted++
      return channel
    },
    () => rejected++,
  )

  expect(accepted).toBe(0)
  expect(rejected).toBe(1)
  rawCallback?.()
  await closing
})

test("a bridge setup failure releases reserved capacity", () => {
  const errors: unknown[] = []
  const client = Object.assign(new EventEmitter(), {
    end() {},
    _sock: { destroy() {} },
  }) as unknown as Connection
  const handler = createConnectionHandler({
    authenticator: {
      advertisedMethods: () => ["none"],
      authenticate: async () => ({ type: "reject", methods: ["none"] }),
      handle: async () => ({ type: "accept", identity: { method: "none", username: "x" } }),
    },
    middlewares: [],
    handler: () => {},
    safe: createSafeInvoke((error) => errors.push(error)),
    idleTimeoutMs: undefined,
    maxTimeoutMs: undefined,
    sessionLimits: { perConnection: 1, global: 1 },
  })
  handler.onConnection(client, { ip: "127.0.0.1", port: 1234 } as ClientInfo)
  handler.setAccepting(true)
  client.emit("ready")

  let accepts = 0
  let rejects = 0
  for (let i = 0; i < 2; i++) {
    const sshSession = new EventEmitter()
    client.emit("session", () => sshSession)
    sshSession.emit(
      "shell",
      () => {
        accepts++
        return {}
      },
      () => rejects++,
    )
  }

  expect(accepts).toBe(2)
  expect(rejects).toBe(0)
  expect(errors).toHaveLength(2)
})
