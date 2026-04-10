import { parentPort as maybeParentPort, workerData } from "node:worker_threads"

function setup() {
  if (!maybeParentPort) {
    throw new Error("Expected parentPort in worker thread")
  }
  const parentPort = maybeParentPort
  globalThis.postMessage = (message) => parentPort.postMessage(message)

  let onmessage: ((event: MessageEvent) => void) | null = null
  Object.defineProperty(globalThis, "onmessage", {
    configurable: true,
    enumerable: true,
    set(handler) {
      if (onmessage) {
        parentPort.removeListener("message", onmessage)
        onmessage = null
      }

      if (handler) {
        onmessage = (data) => handler({ data })
        parentPort.on("message", onmessage)
      }
    },
  })
}

setup()
await import(workerData.targetUrl)
