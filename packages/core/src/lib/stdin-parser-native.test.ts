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

test("NativeStdinParser emits complete bracketed paste as one token", () => {
  const lib = resolveRenderLib()
  const parser = lib.createStdinParser({ timeoutMs: 10, maxBufferBytes: 200_000, reserved0: 0 })
  const nativeParser = new NativeStdinParser(lib, parser, { armTimeouts: false })

  try {
    const chunk = Buffer.from(`\x1b[200~${"x".repeat(70_000)}\x1b[201~`)
    const payloadLens: number[] = []

    expect(nativeParser.push(chunk)).toBe(true)
    nativeParser.drain((token, payload) => {
      expect(token.kind).toBe("paste")
      payloadLens.push(payload.length)
    })

    expect(payloadLens).toEqual([70_000])
  } finally {
    nativeParser.destroy()
  }
})

test("NativeStdinParser emits empty bracketed paste token", () => {
  const lib = resolveRenderLib()
  const parser = lib.createStdinParser({ timeoutMs: 10, maxBufferBytes: 1024, reserved0: 0 })
  const nativeParser = new NativeStdinParser(lib, parser, { armTimeouts: false })

  try {
    const payloads: string[] = []
    expect(nativeParser.push(Buffer.from("\x1b[200~\x1b[201~"))).toBe(true)

    nativeParser.drain((token, payload) => {
      expect(token.kind).toBe("paste")
      payloads.push(new TextDecoder().decode(payload))
    })

    expect(payloads).toEqual([""])
  } finally {
    nativeParser.destroy()
  }
})

test("NativeStdinParser timeout flush emits pending escape", () => {
  const lib = resolveRenderLib()
  const parser = lib.createStdinParser({ timeoutMs: 10, maxBufferBytes: 1024, reserved0: 0 })
  const nativeParser = new NativeStdinParser(lib, parser, { armTimeouts: false })

  try {
    const kinds: string[] = []
    expect(nativeParser.push(Buffer.from("\x1b"))).toBe(true)

    nativeParser.drain((token) => {
      kinds.push(token.kind)
    })
    expect(kinds).toEqual([])

    nativeParser.flushTimeout(Date.now() + 100)
    nativeParser.drain((token) => {
      kinds.push(token.kind)
    })

    expect(kinds).toEqual(["esc"])
  } finally {
    nativeParser.destroy()
  }
})

test("NativeStdinParser payload snapshots are stable across drains", () => {
  const lib = resolveRenderLib()
  const parser = lib.createStdinParser({ timeoutMs: 10, maxBufferBytes: 1024, reserved0: 0 })
  const nativeParser = new NativeStdinParser(lib, parser, { armTimeouts: false })

  try {
    const payloads: Uint8Array[] = []
    expect(nativeParser.push(Buffer.from("ab"))).toBe(true)

    nativeParser.drain((_token, payload) => {
      payloads.push(payload)
    })

    expect(payloads.length).toBe(2)
    expect(new TextDecoder().decode(payloads[0])).toBe("a")
    expect(new TextDecoder().decode(payloads[1])).toBe("b")
  } finally {
    nativeParser.destroy()
  }
})

test("NativeStdinParser allows destroy during token callback", () => {
  const lib = resolveRenderLib()
  const parser = lib.createStdinParser({ timeoutMs: 10, maxBufferBytes: 1024, reserved0: 0 })
  const nativeParser = new NativeStdinParser(lib, parser, { armTimeouts: false })

  try {
    expect(nativeParser.push(Buffer.from("abc"))).toBe(true)

    let tokenCount = 0
    expect(() => {
      nativeParser.drain(() => {
        tokenCount += 1
        if (tokenCount === 1) {
          nativeParser.destroy()
        }
      })
    }).not.toThrow()

    expect(tokenCount).toBe(1)
  } finally {
    nativeParser.destroy()
  }
})
