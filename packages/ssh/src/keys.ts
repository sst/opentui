import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { type ParsedKey, utils } from "ssh2"
import { ConfigError } from "./errors.js"
import type { ServerConfig } from "./types.js"

/** SSH key helpers: fingerprinting, single-key parse normalization, and host-key resolution. */

const HOST_KEYGEN_ATTEMPTS = 20

/** OpenSSH-style SHA256 fingerprint of a raw public-key blob (`ssh-keygen -lf` form, e.g. `SHA256:nThbg6kX…`). */
export function sha256Fingerprint(publicKeyBlob: Buffer): string {
  const digest = createHash("sha256").update(publicKeyBlob).digest("base64")
  return `SHA256:${digest.replace(/=+$/, "")}`
}

/**
 * Parse a single SSH key from any form `utils.parseKey` accepts (PEM,
 * `authorized_keys` line, PPK), returning `null` on a parse error so callers
 * choose their own failure. parseKey returns an array for multi-key inputs;
 * this narrows to the first key.
 */
export function parseOneKey(input: string | Buffer): ParsedKey | null {
  const parsed = utils.parseKey(input)
  if (parsed instanceof Error) return null
  return Array.isArray(parsed) ? parsed[0]! : parsed
}

function generateParseableHostKey(): string {
  for (let i = 0; i < HOST_KEYGEN_ATTEMPTS; i++) {
    const pair = utils.generateKeyPairSync("ed25519")
    if (parseOneKey(pair.private)) return pair.private
  }
  throw new ConfigError("could not generate a parseable ed25519 host key")
}

/** Resolve host-key PEM(s) + fingerprint: explicit PEM, persisted path, or ephemeral. */
export function resolveHostKey(config: Pick<ServerConfig, "hostKey">): {
  hostKeyPems: (string | Buffer)[]
  fingerprint: string
  algorithm: string
  source: string
} {
  const hostKey = config.hostKey
  let hostKeyPems: (string | Buffer)[]
  let source: string

  if (hostKey && "pem" in hostKey) {
    hostKeyPems = Array.isArray(hostKey.pem) ? hostKey.pem : [hostKey.pem]
    source = "provided"
  } else if (hostKey && "path" in hostKey) {
    if (existsSync(hostKey.path)) {
      hostKeyPems = [readFileSync(hostKey.path)]
      source = `loaded ${hostKey.path}`
    } else {
      // First run: generate an ed25519 key, persist it owner-only, and use it.
      // POSIX-only hardening (dir 0700, key 0600), mirroring charmbracelet/keygen.
      // Windows has no POSIX mode bits, so there the key inherits the directory ACL.
      const pem = generateParseableHostKey()
      mkdirSync(dirname(hostKey.path), { recursive: true, mode: 0o700 })
      writeFileSync(hostKey.path, pem, { mode: 0o600 })
      hostKeyPems = [pem]
      source = `generated ${hostKey.path}`
    }
  } else {
    // No host key configured: ephemeral ed25519 (regenerated each start).
    hostKeyPems = [generateParseableHostKey()]
    source = "ephemeral"
  }

  const key = parseOneKey(hostKeyPems[0]!)
  if (!key) throw new ConfigError(`could not parse host key (${source})`)
  const blob = key.getPublicSSH()
  return { hostKeyPems, fingerprint: sha256Fingerprint(blob as Buffer), algorithm: key.type, source }
}
