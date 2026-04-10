import * as cp from "node:child_process"

export interface SpawnSyncOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stderr?: "ignore" | "pipe"
  stdin?: "ignore" | "pipe"
  stdout?: "ignore" | "pipe"
  timeout?: number
  maxBuffer?: number
}

export interface SpawnSyncResult {
  stdout: Uint8Array
  stderr: Uint8Array
  exitCode: number
  success: boolean
  pid: number
  signalCode?: NodeJS.Signals | number
}

export function spawnSync(cmd: string[], options: SpawnSyncOptions = {}): SpawnSyncResult {
  const [file, ...rawArgs] = cmd
  const shouldAddNodeTypeFlags = !process.versions.bun && (file === process.execPath || file === "node")
  const args = shouldAddNodeTypeFlags ? ["--experimental-transform-types", ...rawArgs] : rawArgs

  const result = cp.spawnSync(file, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [
      options.stdin === "pipe" ? "pipe" : "ignore",
      options.stdout === "pipe" ? "pipe" : "ignore",
      options.stderr === "pipe" ? "pipe" : "ignore",
    ],
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  })

  return {
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
    exitCode: result.status ?? 1,
    success: result.status === 0,
    pid: result.pid ?? 0,
    signalCode: result.signal ?? undefined,
  }
}
