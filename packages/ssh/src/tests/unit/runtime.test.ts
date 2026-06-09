import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { utils } from "ssh2"
import { formatBanner } from "../../banner.js"
import { ConfigError } from "../../errors.js"
import { resolveRuntime } from "../../runtime.js"
import { HOST_KEY } from "../support.js"

/** The one-line `authorized_keys` form of HOST_KEY's public half, for allowlist tests. */
const PUBLIC_KEY_LINE: string = (() => {
  const parsed = utils.parseKey(HOST_KEY)
  if (parsed instanceof Error) throw parsed
  const key = Array.isArray(parsed) ? parsed[0]! : parsed
  return `${key.type} ${key.getPublicSSH().toString("base64")}`
})()

/**
 * `resolveRuntime` turns a `ServerConfig` into decided values — host key(s), the
 * normalized authenticator, idle budget, and banner — checked directly rather
 * than inferred from a live handshake.
 */

test("resolves the open default: a none-only authenticator, no idle budget", () => {
  const rt = resolveRuntime({ hostKey: { pem: HOST_KEY } })

  expect(rt.authenticator.advertisedMethods()).toEqual(["none"]) // auth omitted ⇒ open ⇒ none
  expect(rt.noneOnly).toBe(true) // wide open — listen() warns outside localhost
  expect(rt.idleTimeoutMs).toBeUndefined()
  expect(rt.fingerprints[0]).toMatch(/^SHA256:/) // host key fingerprint, surfaced for ListenInfo
  expect(rt.hostKeys).toEqual([HOST_KEY]) // host-key PEMs passed through to the ssh2 Server

  const explicit = resolveRuntime({ auth: "open", hostKey: { pem: HOST_KEY } })
  expect(explicit.authenticator.advertisedMethods()).toEqual(["none"])
  expect(explicit.noneOnly).toBe(true)
})

test("an AuthMethods set normalizes through to the advertised methods (not none-only)", () => {
  const rt = resolveRuntime({
    auth: { publicKey: "any", password: () => true },
    hostKey: { pem: HOST_KEY },
  })

  const methods = rt.authenticator.advertisedMethods()
  expect(methods).toContain("publickey")
  expect(methods).toContain("password")
  expect(methods).not.toContain("none") // a credentialed server is never open
  expect(rt.noneOnly).toBe(false) // so listen() does not warn outside localhost
})

test("empty credentials (no methods) throw a ConfigError instead of locking everyone out", () => {
  expect(() => resolveRuntime({ auth: {}, hostKey: { pem: HOST_KEY } })).toThrow(ConfigError)
  expect(() => resolveRuntime({ auth: {}, hostKey: { pem: HOST_KEY } })).toThrow(/no authentication methods/i)
})

test("idleTimeout resolves to ms: a unit string is scaled, a number passes through", () => {
  const unit = resolveRuntime({ idleTimeout: "10m", hostKey: { pem: HOST_KEY } })
  expect(unit.idleTimeoutMs).toBe(600_000)

  const raw = resolveRuntime({ idleTimeout: 5_000, hostKey: { pem: HOST_KEY } })
  expect(raw.idleTimeoutMs).toBe(5_000) // a bare number is already ms
})

test("maxTimeout resolves to ms", () => {
  expect(resolveRuntime({ maxTimeout: "2s", hostKey: { pem: HOST_KEY } }).maxTimeoutMs).toBe(2_000)
  expect(resolveRuntime({ maxTimeout: 750, hostKey: { pem: HOST_KEY } }).maxTimeoutMs).toBe(750)
})

test("an unparseable idleTimeout throws a ConfigError at resolve time", () => {
  expect(() => resolveRuntime({ idleTimeout: "soon", hostKey: { pem: HOST_KEY } })).toThrow(ConfigError)
  expect(() => resolveRuntime({ idleTimeout: "soon", hostKey: { pem: HOST_KEY } })).toThrow(/invalid idleTimeout/i)
})

test("numeric timeouts must be finite positive values no longer than 24 hours", () => {
  for (const idleTimeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 86_400_001]) {
    expect(() => resolveRuntime({ idleTimeout, hostKey: { pem: HOST_KEY } })).toThrow(ConfigError)
  }
  expect(resolveRuntime({ idleTimeout: "24h", hostKey: { pem: HOST_KEY } }).idleTimeoutMs).toBe(86_400_000)
  expect(() => resolveRuntime({ maxTimeout: 0, hostKey: { pem: HOST_KEY } })).toThrow(ConfigError)
})

test("public-key policy must have an admitting rule", () => {
  expect(() => resolveRuntime({ auth: { publicKey: {} }, hostKey: { pem: HOST_KEY } })).toThrow(ConfigError)
  expect(() => resolveRuntime({ auth: { publicKey: { authorizedKeys: [] } }, hostKey: { pem: HOST_KEY } })).toThrow(
    ConfigError,
  )
  expect(() =>
    resolveRuntime({ auth: { publicKey: { authorizedKeys: ["not a key"] } }, hostKey: { pem: HOST_KEY } }),
  ).toThrow(ConfigError)
})

test("authorizedKeys file must contain only valid keys and at least one key", () => {
  const dir = mkdtempSync(join(tmpdir(), "opentui-ssh-authkeys-"))
  try {
    const invalid = join(dir, "invalid")
    writeFileSync(invalid, "not a key\n")
    expect(() =>
      resolveRuntime({ auth: { publicKey: { authorizedKeys: invalid } }, hostKey: { pem: HOST_KEY } }),
    ).toThrow(ConfigError)

    const missing = join(dir, "missing")
    expect(() =>
      resolveRuntime({ auth: { publicKey: { authorizedKeys: missing } }, hostKey: { pem: HOST_KEY } }),
    ).toThrow(ConfigError)

    const empty = join(dir, "empty")
    writeFileSync(empty, "# only comments\n\n")
    expect(() =>
      resolveRuntime({ auth: { publicKey: { authorizedKeys: empty } }, hostKey: { pem: HOST_KEY } }),
    ).toThrow(ConfigError)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the banner describes the bind: address, host key, and advertised methods", () => {
  const rt = resolveRuntime({ auth: { password: () => true }, hostKey: { pem: HOST_KEY } })
  const banner = formatBanner({ host: "127.0.0.1", port: 2222, fingerprints: rt.fingerprints }, rt.banner).join("\n")

  expect(banner).toContain("ssh://127.0.0.1:2222") // the reachable address
  expect(banner).toContain(rt.fingerprints[0]!) // the host key the client will pin
  expect(banner).toContain("provided") // host key source (a supplied pem)
  expect(banner).toContain("password") // the advertised method
})

test("the banner lists the authorized-key count only when an allowlist is configured", () => {
  const withKeys = resolveRuntime({
    auth: { publicKey: { authorizedKeys: [PUBLIC_KEY_LINE] } },
    hostKey: { pem: HOST_KEY },
  })
  expect(formatBanner({ host: "127.0.0.1", port: 2222, fingerprints: ["x"] }, withKeys.banner).join("\n")).toContain(
    "1 keys",
  )

  const open = resolveRuntime({ hostKey: { pem: HOST_KEY } })
  expect(formatBanner({ host: "127.0.0.1", port: 2222, fingerprints: ["x"] }, open.banner).join("\n")).not.toContain(
    "authorized",
  )
})

test("with no hostKey configured, an ephemeral key is generated fresh each resolve", () => {
  const a = resolveRuntime({})
  const b = resolveRuntime({})

  expect(a.fingerprints[0]).toMatch(/^SHA256:/)
  expect(a.fingerprints[0]).not.toBe(b.fingerprints[0]) // regenerated per start, not pinned
  expect(formatBanner({ host: "127.0.0.1", port: 2222, fingerprints: a.fingerprints }, a.banner).join("\n")).toContain(
    "ephemeral",
  )
})
