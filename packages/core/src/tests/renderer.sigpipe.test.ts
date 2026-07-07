import { expect, test } from "bun:test"
import { type ChildProcess, spawn } from "node:child_process"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const testFilePath = fileURLToPath(import.meta.url)
const testDir = dirname(testFilePath)
const fixturePath = join(testDir, `renderer-sigpipe.fixture${extname(testFilePath)}`)
const packageRoot = testFilePath.includes(`${sep}.node-test${sep}`)
  ? resolve(testDir, "..", "..", "..")
  : resolve(testDir, "..", "..")
const workspaceRoot = resolve(packageRoot, "..", "..")

function getFixtureRuntimeArgs(): string[] {
  if (process.versions.bun) return []

  return [
    "--permission",
    `--allow-fs-read=${workspaceRoot}`,
    "--allow-child-process",
    "--allow-worker",
    "--allow-ffi",
    "--experimental-ffi",
  ]
}

function waitForReady(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let stderr = ""
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Renderer child did not become ready within ${timeoutMs}ms: ${stderr}`))
    }, timeoutMs)

    const onData = (chunk: Buffer): void => {
      stderr += chunk.toString()
      if (!stderr.includes("renderer-ready\n")) return
      cleanup()
      resolvePromise()
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup()
      reject(new Error(`Renderer child exited before readiness: code=${code}, signal=${signal}, stderr=${stderr}`))
    }
    const cleanup = (): void => {
      clearTimeout(timeout)
      child.stderr?.off("data", onData)
      child.off("exit", onExit)
    }

    child.stderr?.on("data", onData)
    child.once("exit", onExit)
  })
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)

  return new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      cleanup()
      resolvePromise(false)
    }, timeoutMs)
    const onExit = (): void => {
      cleanup()
      resolvePromise(true)
    }
    const cleanup = (): void => {
      clearTimeout(timeout)
      child.off("exit", onExit)
    }

    child.once("exit", onExit)
  })
}

const sigpipeTest = process.platform === "win32" ? test.skip : test

sigpipeTest(
  "default renderer exits after SIGPIPE",
  async () => {
    const child = spawn(process.execPath, [...getFixtureRuntimeArgs(), fixturePath], {
      cwd: packageRoot,
      env: process.env,
      stdio: ["pipe", "ignore", "pipe"],
    })

    try {
      await waitForReady(child, 5_000)
      expect(child.kill("SIGPIPE")).toBe(true)
      expect(await waitForExit(child, 2_000)).toBe(true)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL")
        await waitForExit(child, 2_000)
      }
    }
  },
  10_000,
)
