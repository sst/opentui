const g = globalThis as Record<string, unknown>

function ensureLocalStorage(): void {
  if (typeof g.localStorage !== "undefined") return

  const store: Record<string, string> = {}
  g.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k])
    },
    get length() {
      return Object.keys(store).length
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  }
}

function ensureDevtoolsGlobals(): void {
  ensureLocalStorage()

  // Vue DevTools assumes a browser-like environment based on `navigator`.
  // In terminal environments (Bun/Node) we provide minimal DOM-ish globals to prevent crashes.
  if (typeof g.document === "undefined") {
    g.document = {
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: () => ({
        style: {},
        appendChild: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        parentNode: { removeChild: () => {} },
      }),
      createRange: () => ({
        selectNode: () => {},
        getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
      }),
      getElementById: () => null,
      body: { appendChild: () => {}, removeChild: () => {} },
      documentElement: { appendChild: () => {} },
    }
  }

  if (typeof g.window === "undefined") {
    g.window = g
  }

  if (typeof g.self === "undefined") {
    g.self = g
  }

  if (typeof g.navigator === "undefined") {
    g.navigator = { userAgent: "node" }
  }

  const windowRecord = g.window as Record<string, unknown>
  windowRecord.addEventListener =
    (windowRecord.addEventListener as unknown as (...args: unknown[]) => void) || (() => {})
  windowRecord.removeEventListener =
    (windowRecord.removeEventListener as unknown as (...args: unknown[]) => void) || (() => {})
}

export async function initDevtoolsGlobalHook(): Promise<void> {
  ensureDevtoolsGlobals()
  const { initDevTools, toggleHighPerfMode } = await import("@vue/devtools-kit")
  initDevTools()

  const highPerfEnv = process.env["OPENTUI_DEVTOOLS_HIGH_PERF"] ?? "false"
  const isHighPerfEnabled = highPerfEnv === "true"
  if (!isHighPerfEnabled) {
    toggleHighPerfMode(false)
  }
}

export interface DevToolsConnectOptions {
  connect?: boolean
  waitForConnect?: boolean
  timeoutMs?: number
}

export async function connectToDevTools(
  host = "http://localhost",
  port = 8098,
  options: DevToolsConnectOptions = {},
): Promise<() => void> {
  await initDevtoolsGlobalHook()

  if (options.connect === false) return () => {}

  const { createRpcServer, setElectronServerContext } = await import("@vue/devtools-kit")
  const { functions } = await import("@vue/devtools-core")
  const { io } = await import("socket.io-client")

  const url = `${host}:${port}`
  const socket = io(url)
  let didSetupRpc = false

  const onConnect = () => {
    if (!didSetupRpc) {
      didSetupRpc = true
      setElectronServerContext(socket)
      createRpcServer(functions, { preset: "electron" })
    }
    socket.emit("vue-devtools:init")
  }

  socket.on("connect", onConnect)

  socket.on("vue-devtools:disconnect-user-app", () => {
    socket.disconnect()
  })

  const waitForConnect = options.waitForConnect ?? true
  if (waitForConnect && !socket.connected) {
    const timeoutMs = options.timeoutMs ?? 2000
    await new Promise<void>((resolve) => {
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        socket.off("connect", handleConnect)
        socket.off("connect_error", handleError)
        socket.off("error", handleError)
        clearTimeout(timer)
        resolve()
      }

      const handleConnect = () => {
        settle()
      }

      const handleError = () => {
        settle()
      }

      socket.on("connect", handleConnect)
      socket.on("connect_error", handleError)
      socket.on("error", handleError)
      const timer = setTimeout(settle, timeoutMs)
    })
  }

  return () => {
    socket.emit("vue-devtools:disconnect")
    socket.disconnect()
  }
}
