import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"

import { expect, test } from "bun:test"
import { createHostClipboard, type ClipboardSelection, type HostClipboardService } from "./clipboard.js"

const LIVE = process.platform === "linux" && process.env.OTUI_LIVE_X11_CLIPBOARD === "1"
const PROCESS_TIMEOUT_MS = 10_000
const MAX_ORACLE_OUTPUT_BYTES = 8 * 1024 * 1024
const encoder = new TextEncoder()

interface XclipResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: Buffer
  readonly stderr: Buffer
  readonly error?: Error
}

interface XclipOwner {
  readonly process: ChildProcessWithoutNullStreams
  readonly done: Promise<XclipResult>
  readonly ready: Promise<void>
}

const startOracle = (command: "xclip" | "xsel", args: readonly string[], input?: string): XclipOwner => {
  const child = spawn(command, [...args], { stdio: "pipe" })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let processError: Error | undefined
  const timer = setTimeout(() => {
    processError = new Error(`xclip exceeded its ${PROCESS_TIMEOUT_MS}ms timeout`)
    child.kill("SIGKILL")
  }, PROCESS_TIMEOUT_MS)

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength
    if (stdoutBytes > MAX_ORACLE_OUTPUT_BYTES) {
      processError = new Error(`xclip output exceeded ${MAX_ORACLE_OUTPUT_BYTES} bytes`)
      child.kill("SIGKILL")
      return
    }
    stdout.push(chunk)
  })
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength
    if (stderrBytes > MAX_ORACLE_OUTPUT_BYTES) {
      processError = new Error(`xclip diagnostics exceeded ${MAX_ORACLE_OUTPUT_BYTES} bytes`)
      child.kill("SIGKILL")
      return
    }
    stderr.push(chunk)
  })

  const done = new Promise<XclipResult>((resolve) => {
    child.once("error", (error) => {
      processError = error
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        error: processError,
      })
    })
  })

  const ready = new Promise<void>((resolve, reject) => {
    child.stdin.end(input, (error?: Error | null) => {
      if (error) reject(error)
      else resolve()
    })
  })
  return { process: child, done, ready }
}

const xclipRead = async (selection: ClipboardSelection): Promise<XclipResult> => {
  const oracle = startOracle("xclip", ["-selection", selection, "-out"])
  await oracle.ready
  return oracle.done
}

const startXclipOwner = async (selection: ClipboardSelection, text: string): Promise<XclipOwner> => {
  const owner = startOracle("xclip", ["-selection", selection, "-in", "-quiet"], text)
  await owner.ready
  if (owner.process.exitCode !== null || owner.process.signalCode !== null) {
    const result = await owner.done
    throw new Error(`xclip failed to own ${selection}: ${result.stderr.toString() || `exit ${result.code}`}`)
  }
  return owner
}

const startXselOwner = async (selection: ClipboardSelection, text: string): Promise<XclipOwner> => {
  const selectionFlag = selection === "clipboard" ? "--clipboard" : "--primary"
  const owner = startOracle("xsel", [selectionFlag, "--input", "--nodetach"], text)
  await owner.ready
  if (owner.process.exitCode !== null || owner.process.signalCode !== null) {
    const result = await owner.done
    throw new Error(`xsel failed to own ${selection}: ${result.stderr.toString() || `exit ${result.code}`}`)
  }
  return owner
}

const waitForOwner = async (owner: XclipOwner, selection: ClipboardSelection, expected: string): Promise<void> => {
  const expectedBytes = Buffer.from(expected)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (owner.process.exitCode !== null || owner.process.signalCode !== null) {
      const result = await owner.done
      throw new Error(`external owner exited before owning ${selection}: ${result.stderr.toString()}`)
    }
    const result = await xclipRead(selection)
    if (!result.error && result.signal === null && result.code === 0 && result.stdout.equals(expectedBytes)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`external owner did not acquire ${selection}`)
}

const stopOwner = async (owner: XclipOwner | undefined): Promise<void> => {
  if (!owner) return
  if (owner.process.exitCode === null && owner.process.signalCode === null) owner.process.kill("SIGTERM")
  await owner.done
}

const disposeHost = async (host: HostClipboardService | undefined): Promise<void> => {
  if (host) await host.dispose()
}

const assertXclipRead = async (selection: ClipboardSelection, expected: string): Promise<void> => {
  const result = await xclipRead(selection)
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.code, result.stderr.toString()).toBe(0)
  expect(result.stdout.equals(Buffer.from(expected))).toBe(true)
}

const assertHostRead = async (host: HostClipboardService, selection: ClipboardSelection, expected: string) => {
  const result = await host.read({ preferredTypes: ["text/plain"], selection })
  if (result.status !== "read") {
    const detail = result.status === "failed" ? `: ${result.error.message}` : ""
    throw new Error(`host ${selection} read returned ${result.status}${detail}`)
  }
  expect(result.representation.bytes).toEqual(encoder.encode(expected))
}

test.skipIf(!LIVE)(
  "uses a live X11 server and external clipboard tools as bidirectional oracles",
  async () => {
    if (!process.env.DISPLAY) throw new Error("OTUI live X11 clipboard test requires DISPLAY")
    if (process.env.WAYLAND_DISPLAY) {
      throw new Error("OTUI live X11 clipboard test requires WAYLAND_DISPLAY to be empty")
    }
    const version = spawnSync("xclip", ["-version"], { encoding: "utf8", timeout: PROCESS_TIMEOUT_MS })
    if (version.error || version.status !== 0) {
      const detail = version.error?.message ?? version.stderr.trim() ?? `exit ${version.status}`
      throw new Error(`OTUI live X11 clipboard test requires a working xclip: ${detail}`)
    }
    const xselVersion = spawnSync("xsel", ["--version"], { encoding: "utf8", timeout: PROCESS_TIMEOUT_MS })
    if (xselVersion.error || xselVersion.status !== 0) {
      const detail = xselVersion.error?.message ?? xselVersion.stderr.trim() ?? `exit ${xselVersion.status}`
      throw new Error(`OTUI live X11 clipboard test requires a working xsel: ${detail}`)
    }

    const exactText = "OpenTUI X11 clipboard: café, 世界, مرحبا, 🙂\nsecond line\tend"
    const largeText = "INCR payload 世界 🙂 0123456789\n".repeat(30_000)
    let host: HostClipboardService | undefined
    let owner: XclipOwner | undefined

    try {
      host = createHostClipboard({ timeoutMs: PROCESS_TIMEOUT_MS, maxReadBytes: 6 * 1024 * 1024 })

      for (const selection of ["clipboard", "primary"] as const) {
        expect(await host.writeText(exactText, { selection })).toEqual({ status: "written" })
        await assertXclipRead(selection, exactText)

        owner = await startXclipOwner(selection, exactText)
        await waitForOwner(owner, selection, exactText)
        await assertHostRead(host, selection, exactText)
        await stopOwner(owner)
        owner = undefined
      }

      expect(await host.writeText(largeText, { selection: "clipboard" })).toEqual({ status: "written" })
      await assertXclipRead("clipboard", largeText)

      await host.dispose()
      host = createHostClipboard({ timeoutMs: PROCESS_TIMEOUT_MS, maxReadBytes: 6 * 1024 * 1024 })
      owner = await startXselOwner("primary", largeText)
      await waitForOwner(owner, "primary", largeText)
      await assertHostRead(host, "primary", largeText)
      await stopOwner(owner)
      owner = undefined

      for (const selection of ["clipboard", "primary"] as const) {
        expect(await host.writeText(`clear-${selection}`, { selection })).toEqual({ status: "written" })
        expect(await host.clear({ selection })).toEqual({ status: "cleared" })
        const cleared = await xclipRead(selection)
        expect(cleared.error).toBeUndefined()
        expect(cleared.signal).toBeNull()
        expect(cleared.code).not.toBe(0)
        expect(cleared.stdout).toHaveLength(0)
      }

      expect(await host.writeText("owner disposed", { selection: "clipboard" })).toEqual({ status: "written" })
      await host.dispose()
      host = undefined

      host = createHostClipboard({ timeoutMs: PROCESS_TIMEOUT_MS })
      owner = await startXclipOwner("clipboard", "service recreated")
      await waitForOwner(owner, "clipboard", "service recreated")
      await assertHostRead(host, "clipboard", "service recreated")
      await stopOwner(owner)
      owner = undefined
    } finally {
      await stopOwner(owner)
      await disposeHost(host)
    }
  },
  60_000,
)
