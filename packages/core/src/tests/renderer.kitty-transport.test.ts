import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import { inflateSync } from "node:zlib"
import { CliRenderEvents, createCliRenderer, type CliRenderer, type KittyImageTransport } from "../renderer.js"
import { NativeImage } from "../image.js"
import { ImageRenderable } from "../renderables/Image.js"
import { createTestStdin, TestWriteStream } from "../testing/test-streams.js"

type Command = { fields: Record<string, string>; payload: Buffer }

class SyntheticTerminal extends TestWriteStream {
  readonly stdin = createTestStdin()
  readonly commands: Command[] = []
  probeReplies: "both" | "query-only" | "reject" = "both"
  rejectUploads = false
  private pending = ""
  private probePath = ""

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.pending += chunk.toString("latin1")
    for (;;) {
      const start = this.pending.indexOf("\x1b_G")
      if (start < 0) {
        this.pending = this.pending.endsWith("\x1b_") ? "\x1b_" : this.pending.endsWith("\x1b") ? "\x1b" : ""
        break
      }
      const end = this.pending.indexOf("\x1b\\", start)
      if (end < 0) {
        this.pending = this.pending.slice(start)
        break
      }
      const [header, data = ""] = this.pending.slice(start + 3, end).split(";")
      this.pending = this.pending.slice(end + 2)
      const fields = Object.fromEntries(header.split(",").map((field) => field.split("=")))
      const payload = Buffer.from(data, "base64")
      this.commands.push({ fields, payload })
      if (fields.a === "q") {
        if (fields.t === "f") this.probePath = payload.toString()
        this.reply(fields.i, fields.t === "f" && this.probeReplies === "reject" ? "ENOENT:not local" : "OK")
      } else if (fields.a === "t" && fields.t === "f" && payload.toString() === this.probePath) {
        if (this.probeReplies === "both") this.reply(fields.i)
      } else if (fields.a === "t" && fields.t === "f" && this.rejectUploads) {
        this.reply(fields.i, "EIO:synthetic upload failure")
      }
    }
    callback()
  }

  reply(id: string, message = "OK"): void {
    const bytes = Buffer.from(`\x1b_Gi=${id};${message}\x1b\\`)
    // Exercise the existing input parser's fragmented APC handling.
    this.stdin.emit("data", bytes.subarray(0, 5))
    this.stdin.emit("data", bytes.subarray(5))
  }

  uploads(): Command[] {
    return this.commands.filter(({ fields }) => fields.a === "t")
  }

  imageBytes(): Buffer {
    return Buffer.concat(this.commands.filter(({ fields }) => fields.a === "t" || "m" in fields).map((c) => c.payload))
  }
}

const renderers: CliRenderer[] = []
const originalTmpdir = process.env.TMPDIR
beforeEach(() => {
  // The Node suite grants filesystem access to this image fixture directory.
  if (process.env.OTUI_IMAGE_TEST_TMPDIR) process.env.TMPDIR = process.env.OTUI_IMAGE_TEST_TMPDIR
})
afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.destroy()
  if (originalTmpdir === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = originalTmpdir
})

async function setup(
  mode: KittyImageTransport = "raw",
  options: { remote?: boolean; probe?: SyntheticTerminal["probeReplies"] } = {},
) {
  const terminal = new SyntheticTerminal(10, 4)
  terminal.probeReplies = options.probe ?? "both"
  const renderer = await createCliRenderer({
    stdin: terminal.stdin,
    stdout: terminal as unknown as NodeJS.WriteStream,
    remote: options.remote ?? false,
    kittyImageTransport: mode,
    consoleMode: "disabled",
    useMouse: false,
    exitSignals: [],
  })
  renderers.push(renderer)
  await renderer.idle()
  terminal.commands.length = 0
  return { renderer, terminal }
}

async function draw(renderer: CliRenderer, pixels: Uint8Array, width = 64, png = false): Promise<ImageRenderable> {
  const source = NativeImage.fromRgba(pixels, width, pixels.length / width / 4)
  if (png) source.ensureEncodedPng()
  const renderable = new ImageRenderable(renderer, { source, protocol: "kitty", width: 2, height: 1 })
  source.dispose()
  renderer.root.add(renderable)
  await renderable.loadPromise
  renderer.requestRender()
  await renderer.idle()
  return renderable
}

test("Kitty transport defaults to raw and opt-in zlib roundtrips exact RGB and RGBA", async () => {
  for (const mode of ["raw", "zlib"] as const) {
    for (const alpha of [false, true]) {
      const { renderer, terminal } = await setup(mode)
      const pixels = new Uint8Array(64 * 64 * 4)
      const expected: number[] = []
      for (let i = 0; i < pixels.length; i += 4) {
        const pixel = [i % 256, 42, 19, alpha ? 127 : 255]
        pixels.set(pixel, i)
        expected.push(...pixel.slice(0, alpha ? 4 : 3))
      }
      await draw(renderer, pixels)
      const upload = terminal.uploads()[0]
      expect(upload.fields.f).toBe(alpha ? "32" : "24")
      if (mode === "zlib") expect(upload.fields.o).toBe("z")
      else expect(upload.fields.o).toBeUndefined()
      const bytes = terminal.imageBytes()
      expect(mode === "zlib" ? inflateSync(bytes) : bytes).toEqual(Buffer.from(expected))
      expect(renderer.kittyImageTransportStatus.effective).toBe(mode)
      renderer.destroy()
    }
  }
})

test("Kitty zlib uses raw on entropy expansion and leaves retained PNG unchanged", async () => {
  const { renderer, terminal } = await setup("zlib")
  const noise = new Uint8Array(64 * 64 * 4)
  let seed = 7919
  for (let i = 0; i < noise.length; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    noise[i] = seed & 255
  }
  const first = await draw(renderer, noise)
  expect(renderer.kittyImageTransportStatus.effective).toBe("raw")
  expect(renderer.kittyImageTransportStatus.fallback).toBe("compression")
  expect(terminal.imageBytes()).toEqual(Buffer.from(noise))
  first.destroy()
  terminal.commands.length = 0
  await draw(renderer, noise, 64, true)
  expect(renderer.kittyImageTransportStatus.effective).toBe("png")
  expect(terminal.uploads()[0].fields.f).toBe("100")
  expect(terminal.uploads()[0].fields.o).toBeUndefined()
  expect(terminal.imageBytes().subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
})

test("Kitty file integration keeps bytes alive across frames and consumes only matching ACKs", async () => {
  const { renderer, terminal } = await setup("file")
  expect(renderer.kittyImageTransportStatus.fileState).toBe("ready")
  expect(renderer.kittyImageTransportStatus.pendingFiles).toBe(0)
  await draw(renderer, new Uint8Array([1, 2, 3, 255]), 1)
  const upload = terminal.uploads()[0]
  const path = upload.payload.toString()
  expect(upload.fields.t).toBe("f")
  expect(readFileSync(path)).toEqual(Buffer.from([1, 2, 3]))
  expect(statSync(path).mode & 0o777).toBe(0o600)
  renderer.emit(CliRenderEvents.FRAME)
  terminal.stdin.emit("data", Buffer.from("\x1b[0n\x1b[1;1R"))
  terminal.reply("31337")
  expect(existsSync(path)).toBe(true)
  expect(renderer.kittyImageTransportStatus.pendingFiles).toBe(1)
  renderer.removeInputHandler(renderer["capabilityHandler"])
  terminal.reply(upload.fields.i)
  expect(existsSync(path)).toBe(false)
  expect(renderer.kittyImageTransportStatus.pendingFiles).toBe(0)
})

test("Kitty file preserves PNG and never overwrites a pending same-ID file", async () => {
  const { renderer, terminal } = await setup("file")
  const pixels = new Uint8Array([1, 2, 3, 255])
  const previous = await draw(renderer, pixels, 1, true)
  const first = terminal.uploads()[0]
  expect(first.fields.f).toBe("100")
  expect(readFileSync(first.payload.toString()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  // Preserve this upload until ACK even if later frames replace the same image ID.
  previous.destroy()
  terminal.commands.length = 0
  await draw(renderer, new Uint8Array([9, 8, 7, 6]), 1)
  expect(terminal.uploads()[0].fields.t).toBeUndefined()
  expect(renderer.kittyImageTransportStatus.fallback).toBe("busy")
  expect(renderer.kittyImageTransportStatus.pendingFiles).toBe(1)
  terminal.reply(first.fields.i)
  expect(existsSync(first.payload.toString())).toBe(false)
})

test("Kitty file errors trigger raw retransmission and remove the lease", async () => {
  const { renderer, terminal } = await setup("file")
  await draw(renderer, new Uint8Array([1, 2, 3, 4]), 1)
  const upload = terminal.uploads()[0]
  terminal.commands.length = 0
  terminal.reply(upload.fields.i, "ENOENT:disappeared")
  await renderer.idle()
  expect(existsSync(upload.payload.toString())).toBe(false)
  expect(renderer.kittyImageTransportStatus.fileState).toBe("unsupported")
  expect(terminal.uploads()[0].fields.t).toBeUndefined()
  expect(terminal.imageBytes()).toEqual(Buffer.from([1, 2, 3, 4]))
})

test("Kitty file errors during synchronous output publication also retry raw", async () => {
  const { renderer, terminal } = await setup("file")
  terminal.rejectUploads = true
  await draw(renderer, new Uint8Array([1, 2, 3, 4]), 1)
  expect(renderer.kittyImageTransportStatus.fileState).toBe("unsupported")
  expect(renderer.kittyImageTransportStatus.pendingFiles).toBe(0)
  const uploads = terminal.uploads()
  expect(uploads).toHaveLength(2)
  expect(uploads[0].fields.t).toBe("f")
  expect(uploads[1].payload).toEqual(Buffer.from([1, 2, 3, 4]))
  expect(existsSync(uploads[0].payload.toString())).toBe(false)
})

test("Kitty file falls back for remote, rejected medium, and query-only old WezTerm", async () => {
  for (const options of [{ remote: true }, { probe: "reject" as const }, { probe: "query-only" as const }]) {
    const { renderer, terminal } = await setup("file", options)
    expect(renderer.kittyImageTransportStatus.fileState).toBe(
      options.probe === "query-only" ? "probing" : "unsupported",
    )
    await draw(renderer, new Uint8Array([1, 2, 3, 4]), 1)
    expect(terminal.uploads()[0].fields.t).toBeUndefined()
    expect(renderer.kittyImageTransportStatus.effective).toBe("raw")
    renderer.destroy()
  }
})

test("Kitty file cancel, output error, suspend and destroy unlink pending uploads", async () => {
  for (const action of ["cancel", "error", "suspend", "destroy"] as const) {
    const { renderer, terminal } = await setup("file")
    await draw(renderer, new Uint8Array([1, 2, 3, 4]), 1)
    const path = terminal.uploads()[0].payload.toString()
    expect(existsSync(path)).toBe(true)
    if (action === "cancel") renderer.cancelKittyImageTransport()
    if (action === "error") terminal.emit("error", new Error("synthetic sink failure"))
    if (action === "suspend") renderer.suspend()
    if (action === "destroy") renderer.destroy()
    expect(existsSync(path)).toBe(false)
    if (action !== "destroy") expect(renderer.kittyImageTransportStatus.pendingFiles).toBe(0)
    renderer.destroy()
  }
})
