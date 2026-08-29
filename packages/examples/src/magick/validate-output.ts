import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inflateSync } from "node:zlib"
import type { CliRenderer, NativeImage } from "@opentui/core"

export async function validateOutput(
  renderer: CliRenderer,
  expected: NativeImage,
  exchange: (command: string) => Promise<string>,
) {
  const directory = await mkdtemp(join(tmpdir(), "magick-wire-"))
  const cwd = process.cwd()
  try {
    // The public native dumper uses fixed relative paths. Isolate its diagnostic files.
    try {
      process.chdir(directory)
      renderer.dumpOutputBuffer(process.pid)
    } finally {
      process.chdir(cwd)
    }
    const dump = await readFile(join(directory, "buffer_dump", `output_buffer_${process.pid}.txt`))
    const marker = Buffer.from("Last Rendered ANSI Output:\n================\n")
    const start = dump.indexOf(marker) + marker.length
    const size = Number(dump.toString().match(/\nBuffer size: (\d+) bytes\n/)?.[1])
    assert(start >= marker.length && Number.isSafeInteger(size) && size > 0 && start + size <= dump.length)
    const frame = dump.subarray(start, start + size).toString("utf8")
    const packets = [...frame.matchAll(/\x1b_G([^;\x1b]*);([^\x1b]*)\x1b\\/g)].map((match) => ({
      fields: Object.fromEntries(match[1].split(",").map((field) => field.split("="))),
      payload: match[2],
    }))
    const first = packets.findIndex((packet) => packet.fields.a === "t")
    assert(first >= 0, "No image transmission in native output")
    const header = packets[first].fields
    assert.equal(Number(header.s), expected.width)
    assert.equal(Number(header.v), expected.height)
    const expectedPixels = expected.raw().data
    const sha256 = createHash("sha256").update(expectedPixels).digest("hex")
    if (header.t === "f") {
      const status = renderer.kittyImageTransportStatus
      assert.equal(status.fileState, "ready")
      assert.equal(status.pendingFiles, 0, "File validation requires a consumed upload, not cancellation")
      return { sourceSha256: sha256, encoding: "file", acknowledged: true, wirePixelsCompared: false }
    }
    const fragments: string[] = []
    let complete = false
    for (const packet of packets.slice(first)) {
      if (complete) break
      fragments.push(packet.payload)
      complete = packet.fields.m === "0"
    }
    assert(complete, "Native image transmission is incomplete")
    const encoded = Buffer.from(fragments.join(""), "base64")
    const decoded =
      header.o === "z" ? inflateSync(encoded, { maxOutputLength: expected.width * expected.height * 4 }) : encoded
    const channels = Number(header.f) === 24 ? 3 : 4
    assert(["24", "32"].includes(header.f), "This check accepts raw RGB/RGBA, not PNG")
    assert.equal(decoded.length, expected.width * expected.height * channels)
    for (let pixel = 0; pixel < expected.width * expected.height; pixel++) {
      for (let channel = 0; channel < channels; channel++) {
        assert.equal(decoded[pixel * channels + channel], expectedPixels[pixel * 4 + channel])
      }
    }
    // Replay only after timing. The renderer remains the sole terminal output owner.
    const request = frame.replace(/\x1b_G[^\x1b]*\x1b\\/g, (packet) =>
      packet.startsWith("\x1b_Ga=d,") ? packet : packet.replace("q=2", "q=0"),
    )
    const response = await exchange(request)
    assert(/^\d+$/.test(header.i))
    const acknowledged = new RegExp(`\\x1b_Gi=${header.i}(?:,[^;]*)?;OK\\x1b\\\\`).test(response)
    return {
      sourceSha256: sha256,
      encoding: header.o === "z" ? "zlib" : "raw",
      acknowledged,
      wirePixelsCompared: true,
      response,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
