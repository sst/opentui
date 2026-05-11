const WORKER_UNAVAILABLE = "OpenTUI tree-sitter workers are not available for this runtime yet."

class UnsupportedWorker {
  constructor() {
    throw new Error(WORKER_UNAVAILABLE)
  }
}

export const Worker = globalThis.Worker ?? (UnsupportedWorker as unknown as typeof globalThis.Worker)
