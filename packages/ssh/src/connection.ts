import type { ClientInfo, Connection } from "ssh2"
import type { Authenticator } from "./auth.js"
import { createSessionBridge, DEFAULT_PTY, type PtyInfo, type SessionBridge } from "./bridge.js"
import { type RuntimeMiddleware, runSession } from "./run-session.js"
import { ignoreErrors, type SafeInvoke } from "./safe.js"
import type { Identity, RemoteAddress, SessionHandler } from "./types.js"

/** What the connection handler needs from the resolved runtime and sealed chain. */
export interface ConnectionDependencies {
  authenticator: Authenticator
  middlewares: RuntimeMiddleware[]
  handler: SessionHandler
  safe: SafeInvoke
  idleTimeoutMs: number | undefined
  maxTimeoutMs: number | undefined
}

const normalizeAddress = (address: string | undefined): string => {
  if (!address) return "unknown"
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address
}

const toRemoteAddress = (address: string | undefined, port: number | undefined): RemoteAddress => ({
  address: normalizeAddress(address),
  ...(typeof port === "number" ? { port } : {}),
})

/**
 * The per-connection ssh2 authentication → session → shell lifecycle.
 * `onConnection` is the ssh2 `Server` connection listener; `closeAll` drains
 * tracked bridges then sockets for `Server.close()`. Bridge/client tracking
 * lives here because this is what spawns the sessions.
 */
export function createConnectionHandler(dependencies: ConnectionDependencies): {
  onConnection: (client: Connection, info: ClientInfo) => void
  closeAll: () => void
} {
  const { authenticator, middlewares, handler, safe, idleTimeoutMs, maxTimeoutMs } = dependencies
  const clients = new Set<Connection>()
  const bridges = new Set<SessionBridge>()

  const onConnection = (client: Connection, info: ClientInfo) => {
    clients.add(client)

    // Updated once authentication accepts a real identity.
    let identity: Identity = { method: "none", username: "unknown" }
    // Remote address from ssh2's public, typed `info`. (The local address isn't on
    // `ClientInfo` and ssh2 exposes no public accessor, so we don't surface it.)
    const remoteAddress = toRemoteAddress(info.ip, info.port)

    client.on("authentication", async (ctx) => {
      const outcome = await authenticator.handle(ctx)
      if (outcome.type === "reject") return ctx.reject(outcome.methods)
      if (outcome.type === "accept") identity = outcome.identity
      return ctx.accept()
    })

    client.on("ready", () => {
      client.on("session", (acceptSession) => {
        const sshSession = acceptSession()
        let pty: PtyInfo = DEFAULT_PTY
        let activeBridge: SessionBridge | undefined

        sshSession.on("pty", (accept, _reject, info) => {
          // `term` typed via ssh2-augment.d.ts (@types/ssh2 omits it at this version).
          pty = {
            term: info.term ?? "",
            cols: info.cols,
            rows: info.rows,
            hasPty: true,
          }
          accept?.()
        })

        // SIGWINCH is process.stdout-only; forward ssh2 window-change manually.
        sshSession.on("window-change", (accept, _reject, info) => {
          accept?.()
          activeBridge?.resize(info.cols, info.rows)
        })

        sshSession.on("shell", (accept) => {
          const channel = accept()
          // Keep each shell's teardown tied to its own bridge; `activeBridge` may
          // be replaced if the client opens another shell on the same SSH session.
          const shellBridge = createSessionBridge(channel, {
            pty,
            identity,
            idleTimeoutMs,
            maxTimeoutMs,
            safe,
            remoteAddress,
          })
          activeBridge = shellBridge
          bridges.add(shellBridge)
          shellBridge.session.onClose(() => bridges.delete(shellBridge))
          runSession(middlewares, handler, shellBridge, safe)
        })
      })
    })

    client.on("close", () => clients.delete(client))
    client.on("error", (err: Error) => safe.report(err))
  }

  const closeAll = () => {
    for (const bridge of bridges) {
      ignoreErrors(() => bridge.destroy())
    }
    bridges.clear()
    for (const client of clients) {
      ignoreErrors(() => client.end())
      // Force the socket shut: client.end() is a graceful half-close that hangs
      // net.Server.close() if the peer is already gone.
      ignoreErrors(() => {
        ;(client as unknown as { _sock?: { destroy?: () => void } })._sock?.destroy?.()
      })
    }
    clients.clear()
  }

  return { onConnection, closeAll }
}
