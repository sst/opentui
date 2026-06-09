import { readFileSync } from "node:fs"
import type { AuthContext } from "ssh2"
import { ConfigError } from "./errors.js"
import { parseOneKey, sha256Fingerprint } from "./keys.js"
import type { AuthConfig, CredentialMethods, Identity, KeyboardPrompt, PublicKey } from "./types.js"

/**
 * Internal normalized policy the `Authenticator` decides over. `"open"` is
 * normalized to `{ none: true }`; an `AuthMethods` set passes through.
 */
export interface NormalizedAuthConfig extends CredentialMethods {
  /** Set by normalization when `auth` is `"open"`; never written by a user. */
  none?: boolean
}

/** The SSH auth methods this package understands. Subset of ssh2's `AuthenticationType`. */
export type AuthMethod = "none" | "password" | "publickey" | "keyboard-interactive"

/**
 * A single auth attempt, narrowed to the fields a decision needs. This keeps the
 * auth core testable without a live ssh2 handshake.
 */
export type AuthAttempt =
  | { method: "none"; username: string }
  | { method: "password"; username: string; password: string }
  | {
      method: "keyboard-interactive"
      username: string
      prompt: KeyboardPrompt
    }
  | {
      method: "publickey"
      username: string
      key: PublicKey
      /** Present only on the signed (second) pass; absent on the probe. */
      signature?: Buffer
      /** The signed data; present alongside `signature`. */
      blob?: Buffer
      hashAlgo?: string
    }

type PublicKeyAttempt = Extract<AuthAttempt, { method: "publickey" }>

/**
 * The verdict for one attempt. `acceptProbe` is the publickey query reply
 * (PK_OK): the key is acceptable, so the client should sign — no identity yet.
 * Only a verified attempt yields an `accept` with an `identity`.
 */
export type AuthOutcome =
  | { type: "accept"; identity: Identity }
  | { type: "acceptProbe" }
  | { type: "reject"; methods: AuthMethod[] }

/**
 * Adapt ssh2's live `AuthContext` into a plain `AuthAttempt`. Read-only w.r.t.
 * ssh2 (never calls `ctx.accept()`/`reject()`), so the wiring is unit-testable
 * without a real handshake. Returns `null` for an unmodeled method so `handle()`
 * can reject it.
 */
export function attemptFromAuthContext(ctx: AuthContext): AuthAttempt | null {
  switch (ctx.method) {
    case "none":
      return { method: "none", username: ctx.username }
    case "password":
      return { method: "password", username: ctx.username, password: ctx.password }
    case "keyboard-interactive":
      return {
        method: "keyboard-interactive",
        username: ctx.username,
        // Bridge ssh2's callback-based ctx.prompt() onto our promise-based prompt().
        prompt: (questions) =>
          new Promise<string[]>((resolve) => {
            ctx.prompt(questions, (answers) => resolve(answers ?? []))
          }),
      }
    case "publickey":
      // The verifier checks `signature` over `blob` using `key`/`hashAlgo`; carry
      // them through unchanged. They are absent on the probe (first) pass and
      // present on the signed (second) pass.
      return {
        method: "publickey",
        username: ctx.username,
        key: { algorithm: ctx.key.algo, blob: ctx.key.data },
        signature: ctx.signature,
        blob: ctx.blob,
        hashAlgo: ctx.hashAlgo,
      }
    default:
      return null
  }
}

export interface Authenticator {
  /**
   * Decide a live ssh2 auth context end to end: adapt, decide, and fail closed on
   * any unexpected throw. The connection handler just applies the verdict.
   */
  handle(ctx: AuthContext): Promise<AuthOutcome>
  /**
   * Decide a single already-adapted attempt. Value-in, value-out — the unit seam
   * for the security-critical paths (above all signature verification).
   */
  authenticate(attempt: AuthAttempt): Promise<AuthOutcome>
  /** The configured methods, told to clients on reject and in the banner. */
  advertisedMethods(): AuthMethod[]
}

/**
 * Reconstruct a `ParsedKey` from an attempt's `key` so we can verify its
 * signature ourselves: ssh2 surfaces only `{ algo, data }` with no `.verify()`.
 * `parseOneKey` accepts the OpenSSH one-line form rebuilt here.
 */
function parseAttemptKey(key: PublicKey) {
  return parseOneKey(`${key.algorithm} ${key.blob.toString("base64")}`)
}

/**
 * Build the auth decision core from normalized config and a pre-parsed allowlist.
 *
 * User predicates and signature verification run against client-supplied input.
 * Any throw is reported through `onError` and treated as a reject.
 */
export function createAuthenticator(
  auth: NormalizedAuthConfig,
  authorizedKeys?: Set<string>,
  onError: (err: unknown) => void = () => {},
): Authenticator {
  // User predicates must opt in with `true`; throws are reported and rejected.
  const guard = async (fn: () => boolean | Promise<boolean>): Promise<boolean> => {
    try {
      return (await fn()) === true
    } catch (err) {
      onError(err)
      return false
    }
  }

  const advertisedMethods = (): AuthMethod[] => {
    const methods: AuthMethod[] = []
    if (auth.publicKey || authorizedKeys) methods.push("publickey")
    if (auth.password) methods.push("password")
    if (auth.keyboardInteractive) methods.push("keyboard-interactive")
    if (auth.none) methods.push("none")
    return methods
  }

  const reject = (): AuthOutcome => ({ type: "reject", methods: advertisedMethods() })

  const allowFn = typeof auth.publicKey === "object" ? auth.publicKey.allow : undefined
  const inAllowlist = (attempt: PublicKeyAttempt) => authorizedKeys?.has(attempt.key.blob.toString("base64")) ?? false

  // Static admission is shared by the probe and signed pass; the dynamic predicate
  // only runs after signature verification.
  const staticAdmits = (attempt: PublicKeyAttempt): boolean => auth.publicKey === "any" || inAllowlist(attempt)

  /**
   * Probe pass: decide whether the client should sign this key. Do not run
   * `allow` yet; it should only inspect a verified key.
   */
  const probeAdmits = (attempt: PublicKeyAttempt): boolean => {
    if (staticAdmits(attempt)) return true
    return typeof allowFn === "function"
  }

  /**
   * Signed pass: the key is proven, so the dynamic `allow` predicate can safely
   * make the final admission decision.
   */
  const verifiedAdmits = async (attempt: PublicKeyAttempt, fingerprint: string): Promise<boolean> => {
    if (staticAdmits(attempt)) return true
    return typeof allowFn === "function"
      ? await guard(() => allowFn({ username: attempt.username, fingerprint, publicKey: attempt.key }))
      : false
  }

  const authenticate = async (attempt: AuthAttempt): Promise<AuthOutcome> => {
    switch (attempt.method) {
      case "none":
        return auth.none ? { type: "accept", identity: { method: "none", username: attempt.username } } : reject()

      case "password": {
        const fn = auth.password
        if (!fn) return reject()
        const ok = await guard(() => fn({ username: attempt.username, password: attempt.password }))
        return ok ? { type: "accept", identity: { method: "password", username: attempt.username } } : reject()
      }

      case "keyboard-interactive": {
        const fn = auth.keyboardInteractive
        if (!fn) return reject()
        const ok = await guard(() => fn({ username: attempt.username, prompt: attempt.prompt }))
        return ok
          ? { type: "accept", identity: { method: "keyboard-interactive", username: attempt.username } }
          : reject()
      }

      case "publickey": {
        if (!auth.publicKey && !authorizedKeys) return reject()

        // First pass: tell the client whether this key is worth signing.
        if (!attempt.signature) {
          return probeAdmits(attempt) ? { type: "acceptProbe" } : reject()
        }

        // Signed pass only: fingerprint feeds the `allow` predicate and identity.
        const fingerprint = sha256Fingerprint(attempt.key.blob)

        // ssh2 provides the signature but does not verify it for us. Do not mint
        // an identity until the signature verifies over the signed blob.
        if (!attempt.blob) return reject()
        const parsed = parseAttemptKey(attempt.key)
        let verified = false
        try {
          verified = parsed?.verify(attempt.blob, attempt.signature, attempt.hashAlgo) === true
        } catch (err) {
          onError(err)
        }
        if (!verified) return reject()
        // Key proven; now apply the admission policy.
        if (!(await verifiedAdmits(attempt, fingerprint))) return reject()
        return {
          type: "accept",
          identity: { method: "publickey", username: attempt.username, fingerprint, publicKey: attempt.key },
        }
      }

      default: {
        // Exhaustiveness seam: adding an AuthAttempt method without a case is a
        // compile error. Still fails closed (reject) for an untyped caller that
        // slips a method past the type.
        const _exhaustive: never = attempt
        void _exhaustive
        return reject()
      }
    }
  }

  const handle = async (ctx: AuthContext): Promise<AuthOutcome> => {
    // An unmodeled method becomes a reject (with the advertised set), never an
    // attempt the core might accept.
    const attempt = attemptFromAuthContext(ctx)
    if (!attempt) return reject()
    try {
      return await authenticate(attempt)
    } catch (err) {
      // User predicates already fail closed via guard(); this catches an
      // unexpected throw so it can never escape into ssh2.
      onError(err)
      return reject()
    }
  }

  return { advertisedMethods, authenticate, handle }
}

/**
 * Read a set of base64'd public-SSH blobs from an authorized_keys file or array.
 * We parse each line (skipping blanks/comments) rather than hash it because
 * Node's `crypto.createPublicKey` doesn't accept the one-line `ssh-ed25519 AAAA…`
 * form; `parseOneKey` does, yielding a comparable blob.
 */
function loadAuthorizedKeys(source: string | string[]): Set<string> {
  let lines: string[]
  if (typeof source === "string") {
    try {
      lines = readFileSync(source, "utf8").split("\n")
    } catch {
      throw new ConfigError(`could not read authorizedKeys file: ${source}`)
    }
  } else {
    lines = source
  }
  const set = new Set<string>()
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const key = parseOneKey(line)
    if (!key) throw new ConfigError(`invalid authorizedKeys entry: ${line.slice(0, 40)}`)
    set.add(key.getPublicSSH().toString("base64"))
  }
  if (set.size === 0) throw new ConfigError("authorizedKeys did not contain any public keys")
  return set
}

/** The auth facts `resolveAuth` decides off the public `AuthConfig`. */
export interface ResolvedAuth {
  /** The security core, normalized off `auth` (+ any static allowlist). */
  authenticator: Authenticator
  /** True when `none` is the only advertised method — a wide-open server (listen() warns outside localhost). */
  noneOnly: boolean
  /** Parsed static allowlist, surfaced for the startup banner; undefined when none. */
  authorizedKeys: Set<string> | undefined
}

/**
 * Resolve the public `AuthConfig` into the running auth: normalize "open" to the
 * internal none-only config, parse the static allowlist once at startup, build the
 * decision core, and reject an empty credential set at startup.
 *
 * `onError` is the fail-closed sink threaded into the core (a throwing user
 * predicate is denied + reported, never leaked) and into `handle()`.
 */
export function resolveAuth(auth: AuthConfig | undefined, onError: (err: unknown) => void): ResolvedAuth {
  // "open" (or omitted) is the no-auth default, normalized to { none: true }; a
  // AuthMethods set passes through. The public `AuthConfig` sum forbids mixing the two.
  const isOpen = auth === undefined || auth === "open"
  if (!isOpen) {
    if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw new ConfigError("invalid auth configuration")
    if ("none" in auth) throw new ConfigError('auth.none is invalid — use auth: "open" for no authentication')
    if (auth.password !== undefined && typeof auth.password !== "function") {
      throw new ConfigError("auth.password must be a function")
    }
    if (auth.keyboardInteractive !== undefined && typeof auth.keyboardInteractive !== "function") {
      throw new ConfigError("auth.keyboardInteractive must be a function")
    }
    if (
      auth.publicKey !== undefined &&
      auth.publicKey !== "any" &&
      (!auth.publicKey || typeof auth.publicKey !== "object" || Array.isArray(auth.publicKey))
    ) {
      throw new ConfigError('auth.publicKey must be "any" or a policy object')
    }
    if (typeof auth.publicKey === "object") {
      if (auth.publicKey.allow !== undefined && typeof auth.publicKey.allow !== "function") {
        throw new ConfigError("auth.publicKey.allow must be a function")
      }
      const authorizedKeys = auth.publicKey.authorizedKeys
      if (
        authorizedKeys !== undefined &&
        typeof authorizedKeys !== "string" &&
        !(Array.isArray(authorizedKeys) && authorizedKeys.every((key) => typeof key === "string"))
      ) {
        throw new ConfigError("auth.publicKey.authorizedKeys must be a path or array of public keys")
      }
    }
  }
  const authConfig: NormalizedAuthConfig = isOpen ? { none: true } : auth

  // The static allowlist nests under publicKey; parse it once here, not per
  // connection. (The dynamic `allow` predicate stays in authConfig for the core to call.)
  const publicKeyPolicy = typeof authConfig.publicKey === "object" ? authConfig.publicKey : undefined
  if (publicKeyPolicy && !publicKeyPolicy.authorizedKeys && typeof publicKeyPolicy.allow !== "function") {
    throw new ConfigError('auth.publicKey must set "any", authorizedKeys, or allow')
  }
  const authorizedKeys = publicKeyPolicy?.authorizedKeys
    ? loadAuthorizedKeys(publicKeyPolicy.authorizedKeys)
    : undefined

  const authenticator = createAuthenticator(authConfig, authorizedKeys, onError)

  // Empty credentials configure no methods, so no client could authenticate.
  const methods = authenticator.advertisedMethods()
  if (!isOpen && methods.length === 0) {
    throw new ConfigError(
      "auth: {} configures no authentication methods — no client could connect. " +
        'Set publicKey / password / keyboardInteractive, or use auth: "open" for no authentication.',
    )
  }

  // No-auth servers are wide open; listen() warns when one listens outside localhost.
  const noneOnly = methods.length === 1 && methods[0] === "none"

  return { authenticator, noneOnly, authorizedKeys }
}
