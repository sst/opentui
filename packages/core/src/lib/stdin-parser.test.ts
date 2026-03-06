import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import {
  StdinParser,
  StdinParserNextStatus,
  StdinTokenKind,
  type StdinParserOptions,
  type StdinTokenKind as Kind,
} from "./stdin-parser"

type TokenSnapshot = {
  kind: Kind
  payload: Uint8Array
}

type ExpectedToken = {
  kind: Kind
  payload: string | number[] | Uint8Array
}

function createParser(options: StdinParserOptions = {}): StdinParser {
  return new StdinParser({ ...options, armTimeouts: false })
}

function toBytes(value: string | number[] | Uint8Array): Uint8Array {
  if (typeof value === "string") {
    return Buffer.from(value)
  }

  if (value instanceof Uint8Array) {
    return value
  }

  return Uint8Array.from(value)
}

function collectAvailable(parser: StdinParser): { status: string; tokens: TokenSnapshot[] } {
  const tokens: TokenSnapshot[] = []

  while (true) {
    const next = parser.next()
    if (next.status !== StdinParserNextStatus.token) {
      return { status: next.status, tokens }
    }

    tokens.push({
      kind: next.token.kind,
      payload: next.payload.slice(),
    })
  }
}

function expectTokens(actual: TokenSnapshot[], expected: ExpectedToken[]): void {
  expect(actual.map((token) => token.kind)).toEqual(expected.map((token) => token.kind))
  expect(actual.map((token) => Array.from(token.payload))).toEqual(
    expected.map((token) => Array.from(toBytes(token.payload))),
  )
}

describe("StdinParser", () => {
  test("push accepts zero-length buffers", () => {
    const parser = createParser()

    try {
      expect(parser.push(new Uint8Array(0))).toBe(true)
    } finally {
      parser.destroy()
    }
  })

  test("next reports pending for incomplete escape", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b"))).toBe(true)
      expect(parser.next()).toEqual({ status: StdinParserNextStatus.pending })
    } finally {
      parser.destroy()
    }
  })

  test("emits mouse then key from one push", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b[<64;10;5Mx"))).toBe(true)

      const { status, tokens } = collectAvailable(parser)
      expect(status).toBe(StdinParserNextStatus.none)
      expectTokens(tokens, [
        { kind: StdinTokenKind.mouse_sgr, payload: "\x1b[<64;10;5M" },
        { kind: StdinTokenKind.text, payload: "x" },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("emits key then mouse from one push", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("x\x1b[<64;10;5M"))).toBe(true)

      const { status, tokens } = collectAvailable(parser)
      expect(status).toBe(StdinParserNextStatus.none)
      expectTokens(tokens, [
        { kind: StdinTokenKind.text, payload: "x" },
        { kind: StdinTokenKind.mouse_sgr, payload: "\x1b[<64;10;5M" },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("handles split SGR mouse across pushes", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b[<64;10;"))).toBe(true)

      const first = collectAvailable(parser)
      expect(first.status).toBe(StdinParserNextStatus.pending)
      expectTokens(first.tokens, [])

      expect(parser.push(Buffer.from("5M"))).toBe(true)

      const second = collectAvailable(parser)
      expect(second.status).toBe(StdinParserNextStatus.none)
      expectTokens(second.tokens, [{ kind: StdinTokenKind.mouse_sgr, payload: "\x1b[<64;10;5M" }])
    } finally {
      parser.destroy()
    }
  })

  test("handles split OSC response across pushes", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b]4;0;#fff"))).toBe(true)

      const first = collectAvailable(parser)
      expect(first.status).toBe(StdinParserNextStatus.pending)
      expectTokens(first.tokens, [])

      expect(parser.push(Buffer.from("fff\x07"))).toBe(true)

      const second = collectAvailable(parser)
      expect(second.status).toBe(StdinParserNextStatus.none)
      expectTokens(second.tokens, [{ kind: StdinTokenKind.osc, payload: "\x1b]4;0;#ffffff\x07" }])
    } finally {
      parser.destroy()
    }
  })

  test("handles split bracketed paste across pushes", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b[200~hello "))).toBe(true)

      const first = collectAvailable(parser)
      expect(first.status).toBe(StdinParserNextStatus.pending)
      expectTokens(first.tokens, [])

      expect(parser.push(Buffer.from("world\x1b[201~"))).toBe(true)

      const second = collectAvailable(parser)
      expect(second.status).toBe(StdinParserNextStatus.none)
      expectTokens(second.tokens, [{ kind: StdinTokenKind.paste, payload: "hello world" }])
    } finally {
      parser.destroy()
    }
  })

  test("handles split bracketed paste end across all boundaries", () => {
    const pasteEnd = "\x1b[201~"

    for (let split = 1; split < pasteEnd.length; split += 1) {
      const parser = createParser()

      try {
        expect(parser.push(Buffer.from("\x1b[200~hello"))).toBe(true)
        expect(parser.push(Buffer.from(pasteEnd.slice(0, split)))).toBe(true)

        const first = collectAvailable(parser)
        expect(first.status).toBe(StdinParserNextStatus.pending)
        expectTokens(first.tokens, [])

        expect(parser.push(Buffer.from(pasteEnd.slice(split)))).toBe(true)

        const second = collectAvailable(parser)
        expect(second.status).toBe(StdinParserNextStatus.none)
        expectTokens(second.tokens, [{ kind: StdinTokenKind.paste, payload: "hello" }])
      } finally {
        parser.destroy()
      }
    }
  })

  test("ignores near-match bracketed paste endings", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b[200~abc\x1b[20"))).toBe(true)

      const first = collectAvailable(parser)
      expect(first.status).toBe(StdinParserNextStatus.pending)
      expectTokens(first.tokens, [])

      expect(parser.push(Buffer.from("2~def"))).toBe(true)

      const second = collectAvailable(parser)
      expect(second.status).toBe(StdinParserNextStatus.pending)
      expectTokens(second.tokens, [])

      expect(parser.push(Buffer.from("\x1b[201~"))).toBe(true)

      const third = collectAvailable(parser)
      expect(third.status).toBe(StdinParserNextStatus.none)
      expectTokens(third.tokens, [{ kind: StdinTokenKind.paste, payload: "abc\x1b[202~def" }])
    } finally {
      parser.destroy()
    }
  })

  test("handles doubled escape before paste end marker", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b[200~abc\x1b"))).toBe(true)

      const first = collectAvailable(parser)
      expect(first.status).toBe(StdinParserNextStatus.pending)
      expectTokens(first.tokens, [])

      expect(parser.push(Buffer.from("\x1b[201~"))).toBe(true)

      const second = collectAvailable(parser)
      expect(second.status).toBe(StdinParserNextStatus.none)
      expectTokens(second.tokens, [{ kind: StdinTokenKind.paste, payload: "abc\x1b" }])
    } finally {
      parser.destroy()
    }
  })

  test("preserves trailing bytes after bracketed paste", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b[200~hello\x1b[201~x"))).toBe(true)

      const { status, tokens } = collectAvailable(parser)
      expect(status).toBe(StdinParserNextStatus.none)
      expectTokens(tokens, [
        { kind: StdinTokenKind.paste, payload: "hello" },
        { kind: StdinTokenKind.text, payload: "x" },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("discards oversized paste payload until end marker", () => {
    const parser = createParser({ maxBufferBytes: 32 })

    try {
      expect(parser.push(Buffer.from("\x1b[200~"))).toBe(true)

      const started = collectAvailable(parser)
      expect(started.status).toBe(StdinParserNextStatus.pending)
      expectTokens(started.tokens, [])

      expect(parser.push(Buffer.from("abcdefghijklmnopqrstuvwxyz0123456789"))).toBe(true)

      const first = collectAvailable(parser)
      expect(first.status).toBe(StdinParserNextStatus.none)
      expectTokens(first.tokens, [])

      expect(parser.push(Buffer.from("ignored"))).toBe(true)

      const second = collectAvailable(parser)
      expect(second.status).toBe(StdinParserNextStatus.none)
      expectTokens(second.tokens, [])

      expect(parser.push(Buffer.from("\x1b[20"))).toBe(true)
      expect(parser.push(Buffer.from("1~z"))).toBe(true)

      const third = collectAvailable(parser)
      expect(third.status).toBe(StdinParserNextStatus.none)
      expectTokens(third.tokens, [{ kind: StdinTokenKind.text, payload: "z" }])
    } finally {
      parser.destroy()
    }
  })

  test("returns false when buffer limit is reached outside paste mode", () => {
    const parser = createParser({ maxBufferBytes: 8 })

    try {
      expect(parser.push(Buffer.from("123456789"))).toBe(false)
    } finally {
      parser.destroy()
    }
  })

  test("emits empty paste token", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b[200~\x1b[201~"))).toBe(true)

      const { status, tokens } = collectAvailable(parser)
      expect(status).toBe(StdinParserNextStatus.none)
      expectTokens(tokens, [{ kind: StdinTokenKind.paste, payload: "" }])
    } finally {
      parser.destroy()
    }
  })

  test("emits one token for complete bracketed paste payload", () => {
    const parser = createParser()
    const stream = Buffer.concat([Buffer.from("\x1b[200~"), Buffer.alloc(10_000, "x"), Buffer.from("\x1b[201~")])

    try {
      expect(parser.push(stream)).toBe(true)

      const { status, tokens } = collectAvailable(parser)
      expect(status).toBe(StdinParserNextStatus.none)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]?.kind).toBe(StdinTokenKind.paste)
      expect(tokens[0]?.payload.length).toBe(10_000)
    } finally {
      parser.destroy()
    }
  })

  test("keeps focus sequences mixed with text", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("a\x1b[Ib\x1b[Oc"))).toBe(true)

      const { status, tokens } = collectAvailable(parser)
      expect(status).toBe(StdinParserNextStatus.none)
      expectTokens(tokens, [
        { kind: StdinTokenKind.text, payload: "a" },
        { kind: StdinTokenKind.csi, payload: "\x1b[I" },
        { kind: StdinTokenKind.text, payload: "b" },
        { kind: StdinTokenKind.csi, payload: "\x1b[O" },
        { kind: StdinTokenKind.text, payload: "c" },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("is chunk-shape invariant", () => {
    const stream = Buffer.concat([
      Buffer.from("x\x1b[<64;10;5M\x1b[I\x1b]4;0;#ffffff\x07\x1b[200~p\x1b[201~"),
      Buffer.from("\u{1F44D}"),
    ])
    const parserA = createParser()
    const parserB = createParser()

    try {
      expect(parserA.push(stream)).toBe(true)
      const singleChunk = collectAvailable(parserA)
      expect(singleChunk.status).toBe(StdinParserNextStatus.none)

      const chunks = [
        Buffer.from("x\x1b[<64"),
        Buffer.from(";10;5M\x1b"),
        Buffer.from("[I\x1b]4;0;"),
        Buffer.from("#ffffff\x07\x1b[200~"),
        Buffer.from("p\x1b[201~"),
        Buffer.from("\u{1F44D}"),
      ]

      for (const chunk of chunks) {
        expect(parserB.push(chunk)).toBe(true)
      }

      const splitChunks = collectAvailable(parserB)
      expect(splitChunks.status).toBe(StdinParserNextStatus.none)
      expectTokens(
        splitChunks.tokens,
        singleChunk.tokens.map((token) => ({ kind: token.kind, payload: token.payload })),
      )
    } finally {
      parserA.destroy()
      parserB.destroy()
    }
  })

  test("timeout flushes lone high-byte lead as unknown", () => {
    const parser = createParser()

    try {
      expect(parser.push(Uint8Array.from([0xe9]))).toBe(true)

      const first = collectAvailable(parser)
      expect(first.status).toBe(StdinParserNextStatus.pending)
      expectTokens(first.tokens, [])

      parser.flushTimeout(Number.MAX_SAFE_INTEGER)

      const second = collectAvailable(parser)
      expect(second.status).toBe(StdinParserNextStatus.none)
      expectTokens(second.tokens, [{ kind: StdinTokenKind.unknown, payload: [0xe9] }])
    } finally {
      parser.destroy()
    }
  })

  test("classifies SGR continuation after timed-out ESC as unknown", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b"))).toBe(true)

      const first = collectAvailable(parser)
      expect(first.status).toBe(StdinParserNextStatus.pending)
      expectTokens(first.tokens, [])

      parser.flushTimeout(Number.MAX_SAFE_INTEGER)

      const second = collectAvailable(parser)
      expect(second.status).toBe(StdinParserNextStatus.none)
      expectTokens(second.tokens, [{ kind: StdinTokenKind.esc, payload: "\x1b" }])

      expect(parser.push(Buffer.from("[<35;20;5m"))).toBe(true)

      const third = collectAvailable(parser)
      expect(third.status).toBe(StdinParserNextStatus.none)
      expectTokens(third.tokens, [{ kind: StdinTokenKind.unknown, payload: "[<35;20;5m" }])
    } finally {
      parser.destroy()
    }
  })

  test("timeout flushes partial SGR continuation after timed-out ESC", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b"))).toBe(true)

      const escPending = collectAvailable(parser)
      expect(escPending.status).toBe(StdinParserNextStatus.pending)
      expectTokens(escPending.tokens, [])

      parser.flushTimeout(Number.MAX_SAFE_INTEGER)

      const escFlushed = collectAvailable(parser)
      expect(escFlushed.status).toBe(StdinParserNextStatus.none)
      expectTokens(escFlushed.tokens, [{ kind: StdinTokenKind.esc, payload: "\x1b" }])

      expect(parser.push(Buffer.from("[<35;20"))).toBe(true)

      const first = collectAvailable(parser)
      expect(first.status).toBe(StdinParserNextStatus.pending)
      expectTokens(first.tokens, [])

      parser.flushTimeout(Number.MAX_SAFE_INTEGER)

      const second = collectAvailable(parser)
      expect(second.status).toBe(StdinParserNextStatus.none)
      expectTokens(second.tokens, [{ kind: StdinTokenKind.unknown, payload: "[<35;20" }])
    } finally {
      parser.destroy()
    }
  })

  test("reset releases retained buffer capacity", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.alloc(4096, "x"))).toBe(true)
      expect(parser.bufferCapacity).toBeGreaterThanOrEqual(4096)

      parser.reset()

      expect(parser.bufferCapacity).toBeLessThanOrEqual(256)
    } finally {
      parser.destroy()
    }
  })

  test("aborts CSI on embedded ESC", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b[<35;\x1b[<35;20;5m"))).toBe(true)

      const { status, tokens } = collectAvailable(parser)
      expect(status).toBe(StdinParserNextStatus.none)
      expectTokens(tokens, [
        { kind: StdinTokenKind.unknown, payload: "\x1b[<35;" },
        { kind: StdinTokenKind.mouse_sgr, payload: "\x1b[<35;20;5m" },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("aborts CSI on embedded ESC with separate pushes", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("\x1b[<35;"))).toBe(true)

      const first = collectAvailable(parser)
      expect(first.status).toBe(StdinParserNextStatus.pending)
      expectTokens(first.tokens, [])

      expect(parser.push(Buffer.from("\x1b[<35;20;5m"))).toBe(true)

      const second = collectAvailable(parser)
      expect(second.status).toBe(StdinParserNextStatus.none)
      expectTokens(second.tokens, [
        { kind: StdinTokenKind.unknown, payload: "\x1b[<35;" },
        { kind: StdinTokenKind.mouse_sgr, payload: "\x1b[<35;20;5m" },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("releases invalid utf8 lead when next byte is not continuation", () => {
    const parser = createParser()

    try {
      expect(parser.push(Uint8Array.from([0xe9]))).toBe(true)

      const first = collectAvailable(parser)
      expect(first.status).toBe(StdinParserNextStatus.pending)
      expectTokens(first.tokens, [])

      expect(parser.push(Buffer.from("x"))).toBe(true)

      const second = collectAvailable(parser)
      expect(second.status).toBe(StdinParserNextStatus.none)
      expectTokens(second.tokens, [
        { kind: StdinTokenKind.unknown, payload: [0xe9] },
        { kind: StdinTokenKind.text, payload: "x" },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("payload snapshots are stable across drains", () => {
    const parser = createParser()

    try {
      const payloads: Uint8Array[] = []

      expect(parser.push(Buffer.from("ab"))).toBe(true)
      parser.drain((_token, payload) => {
        payloads.push(payload)
      })

      expect(payloads).toHaveLength(2)
      expect(Buffer.from(payloads[0] ?? [])).toEqual(Buffer.from("a"))
      expect(Buffer.from(payloads[1] ?? [])).toEqual(Buffer.from("b"))
    } finally {
      parser.destroy()
    }
  })

  test("allows destroy during token callback", () => {
    const parser = createParser()

    try {
      expect(parser.push(Buffer.from("abc"))).toBe(true)

      let tokenCount = 0
      expect(() => {
        parser.drain(() => {
          tokenCount += 1
          if (tokenCount === 1) {
            parser.destroy()
          }
        })
      }).not.toThrow()

      expect(tokenCount).toBe(1)
    } finally {
      parser.destroy()
    }
  })
})
