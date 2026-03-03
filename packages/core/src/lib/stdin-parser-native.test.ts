import { expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { resolveRenderLib } from "../zig"
import { NativeStdinParser } from "./stdin-parser-native"

test("stdinParserPush accepts zero-length buffers", () => {
  const lib = resolveRenderLib()
  const parser = lib.createStdinParser({ timeoutMs: 10, maxBufferBytes: 1024, reserved0: 0 })

  try {
    expect(lib.stdinParserPush(parser, new Uint8Array(0))).toBe(0)
  } finally {
    lib.destroyStdinParser(parser)
  }
})

test("NativeStdinParser returns false when parser buffer limit is reached", () => {
  const lib = resolveRenderLib()
  const parser = lib.createStdinParser({ timeoutMs: 10, maxBufferBytes: 32, reserved0: 0 })
  const nativeParser = new NativeStdinParser(lib, parser, { armTimeouts: false })

  try {
    const accepted = nativeParser.push(Buffer.from("x".repeat(64)))
    expect(accepted).toBe(false)
  } finally {
    nativeParser.destroy()
  }
})

test("NativeStdinParser grows scratch buffers for large paste payloads", () => {
  const lib = resolveRenderLib()
  const parser = lib.createStdinParser({ timeoutMs: 10, maxBufferBytes: 200_000, reserved0: 0 })
  const nativeParser = new NativeStdinParser(lib, parser, {
    armTimeouts: false,
    payloadBufferBytes: 1024,
    tokenCapacity: 8,
  })

  try {
    const chunk = Buffer.from(`\x1b[200~${"x".repeat(70_000)}\x1b[201~`)
    const tokens: Array<{ kind: string; payloadLen: number }> = []

    expect(nativeParser.push(chunk)).toBe(true)
    nativeParser.drain((token, payload) => {
      tokens.push({ kind: token.kind, payloadLen: payload.length })
    })

    expect(tokens).toEqual([{ kind: "paste", payloadLen: 70_000 }])
  } finally {
    nativeParser.destroy()
  }
})

test("NativeStdinParser throws when overflow cannot grow anymore", () => {
  const lib = resolveRenderLib()
  const parser = lib.createStdinParser({ timeoutMs: 10, maxBufferBytes: 200_000, reserved0: 0 })
  const nativeParser = new NativeStdinParser(lib, parser, {
    armTimeouts: false,
    payloadBufferBytes: 1024,
    tokenCapacity: 8,
    maxPayloadBufferBytes: 1024,
    maxTokenCapacity: 8,
  })

  try {
    const chunk = Buffer.from(`\x1b[200~${"x".repeat(70_000)}\x1b[201~`)
    expect(nativeParser.push(chunk)).toBe(true)
    expect(() => {
      nativeParser.drain(() => {})
    }).toThrow(/max scratch buffers reached/)
  } finally {
    nativeParser.destroy()
  }
})
