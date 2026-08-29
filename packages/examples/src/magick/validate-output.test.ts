import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { deflateSync } from "node:zlib"
import { NativeImage, type CliRenderer } from "@opentui/core"
import { validateOutput } from "./validate-output.js"

function rendererDump(frame: string, fileState = "ready") {
  return {
    kittyImageTransportStatus: { fileState, pendingFiles: 0 },
    dumpOutputBuffer(id: number) {
      mkdirSync("buffer_dump")
      writeFileSync(
        `buffer_dump/output_buffer_${id}.txt`,
        `Last Rendered ANSI Output:\n================\n${frame}\n================\nBuffer size: ${Buffer.byteLength(frame)} bytes\n`,
      )
    },
  } as unknown as CliRenderer
}

for (const channels of [3, 4]) {
  for (const compressed of [false, true]) {
    test(`native dump validation checks ${channels}-channel ${compressed ? "zlib" : "raw"} pixels`, async () => {
      const rgba = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, channels === 3 ? 255 : 128)
      const image = NativeImage.fromRgba(rgba, 2, 1)
      const pixels = channels === 3 ? Uint8Array.of(1, 2, 3, 4, 5, 6) : rgba
      const encoded = Buffer.from(compressed ? deflateSync(pixels) : pixels).toString("base64")
      const frame = `\x1b_Ga=d,d=I,i=42,q=2\x1b\\\x1b_Ga=t,f=${channels * 8},s=2,v=1,i=42,${compressed ? "o=z," : ""}m=0,q=2;${encoded}\x1b\\`
      const cwd = process.cwd()
      try {
        const result = await validateOutput(rendererDump(frame), image, async (request) => {
          expect(request).toContain("a=d,d=I,i=42,q=2")
          expect(request).toContain("m=0,q=0")
          return "\x1b_Gi=42,p=1;OK\x1b\\\x1b[0n"
        })
        expect(result.acknowledged).toBe(true)
        expect(result.wirePixelsCompared).toBe(true)
        expect(result.encoding).toBe(compressed ? "zlib" : "raw")
      } finally {
        image.dispose()
      }
      expect(process.cwd()).toBe(cwd)
    })
  }
}

test("an unrelated image acknowledgement does not validate the upload", async () => {
  const image = NativeImage.fromRgba(Uint8Array.of(1, 2, 3, 255), 1, 1)
  try {
    const result = await validateOutput(
      rendererDump("\x1b_Ga=t,f=24,s=1,v=1,i=42,m=0,q=2;AQID\x1b\\"),
      image,
      async () => "\x1b_Gi=31337;OK\x1b\\",
    )
    expect(result.acknowledged).toBe(false)
  } finally {
    image.dispose()
  }
})

test("file cancellation is not a successful upload", async () => {
  const image = NativeImage.fromRgba(Uint8Array.of(1, 2, 3, 255), 1, 1)
  const frame = "\x1b_Ga=t,t=f,f=24,s=1,v=1,i=42,q=0;L25vdC1yZWFk\x1b\\"
  try {
    for (const state of ["timeout", "cancelled"]) {
      await expect(validateOutput(rendererDump(frame, state), image, async () => "")).rejects.toThrow()
    }
    const result = await validateOutput(rendererDump(frame), image, async () => {
      throw new Error("File must not be replayed")
    })
    expect(result).toMatchObject({ encoding: "file", acknowledged: true, wirePixelsCompared: false })
  } finally {
    image.dispose()
  }
})

test("bad pixels fail before replay and restore the working directory", async () => {
  const image = NativeImage.fromRgba(Uint8Array.of(1, 2, 3, 255), 1, 1)
  const cwd = process.cwd()
  try {
    await expect(
      validateOutput(rendererDump("\x1b_Ga=t,f=24,s=1,v=1,i=42,m=0,q=2;////\x1b\\"), image, async () => {
        throw new Error("Unexpected replay")
      }),
    ).rejects.toThrow()
    expect(process.cwd()).toBe(cwd)
  } finally {
    image.dispose()
  }
})
