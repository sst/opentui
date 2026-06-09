import type { Identity, Middleware, RemoteAddress } from "./types.js"

/**
 * A connection-lifecycle event. Pure observability — the logging middleware
 * never reports errors (those flow to `onError`, the one error sink); it only
 * marks a session starting and ending.
 */
export interface LogEvent<Id extends Identity = Identity> {
  /** "connect" at session start, "disconnect" at teardown. */
  type: "connect" | "disconnect"
  /** Who connected, narrowed to the server's configured auth. */
  identity: Id
  remoteAddress: RemoteAddress
  term: string
  cols: number
  rows: number
  /** How long the session lasted, in ms — present only on "disconnect". */
  durationMs?: number
}

export interface LoggingOptions<Id extends Identity = Identity> {
  /** Sink for events. Defaults to a one-line `console.log` formatter. */
  log?: (event: LogEvent<Id>) => void
}

const formatAddress = (address: RemoteAddress): string =>
  address.port != null ? `${address.address}:${address.port}` : address.address

const formatDuration = (ms: number): string => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

/** The default one-line rendering, e.g. `connect alice@1.2.3.4:54321  publickey SHA256:…  xterm-256color 80×24`. */
function formatLogEvent(event: LogEvent): string {
  const who = `${event.identity.username}@${formatAddress(event.remoteAddress)}`
  if (event.type === "connect") {
    const method =
      event.identity.method === "publickey" ? `publickey ${event.identity.fingerprint}` : event.identity.method
    return `connect    ${who}  ${method}  ${event.term} ${event.cols}×${event.rows}`
  }
  return `disconnect ${who}  ${formatDuration(event.durationMs ?? 0)}`
}

/**
 * Lifecycle logging as a `.use(...)` middleware: a "connect" event on entry, a
 * "disconnect" (with duration) on teardown. It is a setup/teardown onion — the
 * `finally` runs even when a downstream gate denies or the handler throws, so
 * every session is logged — but it only ever returns the handoff, never swallows
 * the throw. Errors stay the job of `onError`; this is observability alone.
 *
 * ```ts
 * createServer({ auth: { publicKey: "any" } })
 *   .use(logging())                       // default: one line per event to console.log
 *   .serve((s) => mountApp(s.renderer))
 * ```
 */
export function logging<Id extends Identity = Identity>(options: LoggingOptions<Id> = {}): Middleware<Id> {
  const sink = options.log ?? ((event: LogEvent<Id>) => console.log(formatLogEvent(event)))
  return async (session, next) => {
    const start = Date.now()
    sink({
      type: "connect",
      identity: session.identity,
      remoteAddress: session.remoteAddress,
      term: session.term,
      cols: session.cols,
      rows: session.rows,
    })
    try {
      return await next()
    } finally {
      sink({
        type: "disconnect",
        identity: session.identity,
        remoteAddress: session.remoteAddress,
        term: session.term,
        cols: session.cols,
        rows: session.rows,
        durationMs: Date.now() - start,
      })
    }
  }
}
