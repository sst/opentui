import { existsSync } from "node:fs"
import { extname, isAbsolute, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Worker as NodeWorker } from "node:worker_threads"

type MessageEventLike<T = unknown> = { data: T }
type ErrorEventLike = { message: string }

const ownExtension = extname(import.meta.url)
const knownProtocolRegex = /^(file|data|node):/

function resolveWorkerTarget(url: string | URL): string {
  if (url instanceof URL) {
    return url.href
  }

  // allowing any <words>:<anything> will confuse windows absolute path starting
  // with a drive letter with a valid url.
  if (knownProtocolRegex.test(url)) {
    return url
  }

  return pathToFileURL(url).href
}

function normalizeExtension(specifier: string): string
function normalizeExtension(specifier: URL): URL
function normalizeExtension(specifier: string | URL): string | URL {
  if (existsSync(specifier)) {
    return specifier
  }

  const stringSpecifier = String(specifier)
  const extension = extname(stringSpecifier)
  if (extension === ownExtension) {
    return specifier
  }

  const newSpecifier = stringSpecifier.slice(0, -extension.length) + ownExtension
  if (specifier instanceof URL) {
    return new URL(newSpecifier)
  }
  return newSpecifier
}

let trampoline: URL | undefined
let registerJs: string | URL | undefined

export class Worker extends NodeWorker {
  onmessage: ((event: MessageEventLike) => void) | null = null
  onerror: ((event: ErrorEventLike) => void) | null = null

  constructor(url: string | URL) {
    let execArgv = process.execArgv
    if (import.meta.url.endsWith(".ts")) {
      registerJs ??= normalizeExtension(new URL("./registerResolveJs.js", import.meta.url))
      const registerJsArg = `--import=${fileURLToPath(registerJs)}`
      if (!execArgv.includes(registerJsArg)) {
        execArgv = [...execArgv, registerJsArg]
      }
    }

    trampoline ??= normalizeExtension(new URL("./trampoline.worker.js", import.meta.url))
    super(trampoline, {
      workerData: {
        targetUrl: resolveWorkerTarget(url),
      },
      execArgv,
    })

    this.on("message", (data: unknown) => {
      this.onmessage?.({ data })
    })

    this.on("error", (error: Error) => {
      this.onerror?.(error)
    })
  }
}
