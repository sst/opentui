import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { ManualClock } from "../testing/manual-clock"
import type { RawMouseEvent } from "./parse.mouse"
import { StdinParser, type StdinEvent, type StdinParserOptions } from "./stdin-parser"

type EventSnapshot =
  | {
      type: "key"
      raw: string
      name: string
      ctrl: boolean
      meta: boolean
      shift: boolean
      eventType: string
    }
  | {
      type: "mouse"
      raw: string
      encoding: "sgr" | "x10"
      event: RawMouseEvent
    }
  | {
      type: "paste"
      text: string
    }
  | {
      type: "response"
      protocol: string
      sequence: string
    }

function createParser(options: StdinParserOptions = {}): StdinParser {
  return new StdinParser({ armTimeouts: false, clock: new ManualClock(), ...options })
}

function createTimedParser(options: StdinParserOptions = {}): { parser: StdinParser; clock: ManualClock } {
  const clock = new ManualClock()
  return {
    parser: createParser({ ...options, armTimeouts: true, clock }),
    clock,
  }
}

function advanceParserTimeout(clock: ManualClock): void {
  clock.advance(10)
}

function collectAvailable(parser: StdinParser): StdinEvent[] {
  const events: StdinEvent[] = []
  parser.drain((event) => {
    events.push(event)
  })
  return events
}

function snapshotEvent(event: StdinEvent): EventSnapshot {
  switch (event.type) {
    case "key":
      return {
        type: "key",
        raw: event.raw,
        name: event.key.name,
        ctrl: event.key.ctrl,
        meta: event.key.meta,
        shift: event.key.shift,
        eventType: event.key.eventType,
      }
    case "mouse":
      return {
        type: "mouse",
        raw: event.raw,
        encoding: event.encoding,
        event: {
          ...event.event,
          ...(event.event.scroll ? { scroll: event.event.scroll } : {}),
        },
      }
    case "paste":
      return {
        type: "paste",
        text: event.text,
      }
    case "response":
      return {
        type: "response",
        protocol: event.protocol,
        sequence: event.sequence,
      }
  }
}

function collectSnapshots(parser: StdinParser): EventSnapshot[] {
  return collectAvailable(parser).map(snapshotEvent)
}

describe("StdinParser", () => {
  test("push accepts zero-length buffers", () => {
    const parser = createParser()

    try {
      parser.push(new Uint8Array(0))
      expect(collectAvailable(parser)).toEqual([])
    } finally {
      parser.destroy()
    }
  })

  test("emits ASCII text as key events", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("a"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "key",
          raw: "a",
          name: "a",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("emits standalone [ immediately and does not join a later <", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("["))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "key",
          raw: "[",
          name: "[",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])

      parser.push(Buffer.from("<"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "key",
          raw: "<",
          name: "<",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("emits split UTF-8 text as one key event", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from([0xf0, 0x9f]))
      expect(collectAvailable(parser)).toEqual([])

      parser.push(Buffer.from([0x91, 0x8d]))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "key",
          raw: "👍",
          name: "",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("times out lone ESC to one Escape key event", () => {
    const { parser, clock } = createTimedParser()

    try {
      parser.push(Buffer.from("\x1b"))
      expect(collectAvailable(parser)).toEqual([])

      clock.advance(9)
      expect(collectAvailable(parser)).toEqual([])

      clock.advance(1)
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "key",
          raw: "\x1b",
          name: "escape",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("preserves legacy single high-byte compatibility on timeout", () => {
    const { parser, clock } = createTimedParser()

    try {
      parser.push(Uint8Array.from([0xe9]))
      expect(collectAvailable(parser)).toEqual([])

      advanceParserTimeout(clock)
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "key",
          raw: "\x1bi",
          name: "i",
          ctrl: false,
          meta: true,
          shift: false,
          eventType: "press",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("releases invalid UTF-8 lead when next byte is not continuation", () => {
    const parser = createParser()

    try {
      parser.push(Uint8Array.from([0xe9]))
      expect(collectAvailable(parser)).toEqual([])

      parser.push(Buffer.from("x"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "key",
          raw: "\x1bi",
          name: "i",
          ctrl: false,
          meta: true,
          shift: false,
          eventType: "press",
        },
        {
          type: "key",
          raw: "x",
          name: "x",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("emits mouse then key from one push", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("\x1b[<64;10;5Mx"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "mouse",
          raw: "\x1b[<64;10;5M",
          encoding: "sgr",
          event: {
            type: "scroll",
            button: 0,
            x: 9,
            y: 4,
            modifiers: { shift: false, alt: false, ctrl: false },
            scroll: { direction: "up", delta: 1 },
          },
        },
        {
          type: "key",
          raw: "x",
          name: "x",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("emits key then mouse from one push", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("x\x1b[<64;10;5M"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "key",
          raw: "x",
          name: "x",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
        {
          type: "mouse",
          raw: "\x1b[<64;10;5M",
          encoding: "sgr",
          event: {
            type: "scroll",
            button: 0,
            x: 9,
            y: 4,
            modifiers: { shift: false, alt: false, ctrl: false },
            scroll: { direction: "up", delta: 1 },
          },
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("handles split SGR mouse across pushes", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("\x1b[<64;10;"))
      expect(collectAvailable(parser)).toEqual([])

      parser.push(Buffer.from("5M"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "mouse",
          raw: "\x1b[<64;10;5M",
          encoding: "sgr",
          event: {
            type: "scroll",
            button: 0,
            x: 9,
            y: 4,
            modifiers: { shift: false, alt: false, ctrl: false },
            scroll: { direction: "up", delta: 1 },
          },
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("emits OSC, DCS, and APC as response events", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("\x1b]4;0;#ffffff\x07\x1bP>|kitty(0.40.1)\x1b\\\x1b_Gi=1;OK\x1b\\"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "response",
          protocol: "osc",
          sequence: "\x1b]4;0;#ffffff\x07",
        },
        {
          type: "response",
          protocol: "dcs",
          sequence: "\x1bP>|kitty(0.40.1)\x1b\\",
        },
        {
          type: "response",
          protocol: "apc",
          sequence: "\x1b_Gi=1;OK\x1b\\",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("keeps focus sequences mixed with text as response and key events", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("a\x1b[Ib\x1b[Oc"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "key",
          raw: "a",
          name: "a",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
        {
          type: "response",
          protocol: "csi",
          sequence: "\x1b[I",
        },
        {
          type: "key",
          raw: "b",
          name: "b",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
        {
          type: "response",
          protocol: "csi",
          sequence: "\x1b[O",
        },
        {
          type: "key",
          raw: "c",
          name: "c",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("emits one paste event for split bracketed paste", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("\x1b[200~hello "))
      expect(collectAvailable(parser)).toEqual([])

      parser.push(Buffer.from("world\x1b[201~x"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "paste",
          text: "hello world",
        },
        {
          type: "key",
          raw: "x",
          name: "x",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("handles split bracketed paste end across all boundaries", () => {
    const pasteEnd = "\x1b[201~"

    for (let split = 1; split < pasteEnd.length; split += 1) {
      const parser = createParser()
      try {
        parser.push(Buffer.from("\x1b[200~hello"))
        parser.push(Buffer.from(pasteEnd.slice(0, split)))
        expect(collectAvailable(parser)).toEqual([])

        parser.push(Buffer.from(pasteEnd.slice(split)))
        expect(collectSnapshots(parser)).toEqual([
          {
            type: "paste",
            text: "hello",
          },
        ])
      } finally {
        parser.destroy()
      }
    }
  })

  test("ignores near-match bracketed paste endings", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("\x1b[200~abc\x1b[20"))
      expect(collectAvailable(parser)).toEqual([])

      parser.push(Buffer.from("2~def"))
      expect(collectAvailable(parser)).toEqual([])

      parser.push(Buffer.from("\x1b[201~"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "paste",
          text: "abc\x1b[202~def",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("handles doubled escape before paste end marker", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("\x1b[200~abc\x1b"))
      expect(collectAvailable(parser)).toEqual([])

      parser.push(Buffer.from("\x1b[201~"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "paste",
          text: "abc\x1b",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("emits one paste event for large paste without growing pending capacity", () => {
    const parser = createParser({ maxPendingBytes: 32 })
    const payload = "x".repeat(100_000)

    try {
      parser.push(Buffer.from(`\x1b[200~${payload}\x1b[201~z`))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "paste",
          text: payload,
        },
        {
          type: "key",
          raw: "z",
          name: "z",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])
      expect(parser.bufferCapacity).toBeLessThanOrEqual(512)
    } finally {
      parser.destroy()
    }
  })

  test("emits empty paste event", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("\x1b[200~\x1b[201~"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "paste",
          text: "",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("classifies SGR continuation after timed-out ESC as unknown response", () => {
    const { parser, clock } = createTimedParser()

    try {
      parser.push(Buffer.from("\x1b"))
      advanceParserTimeout(clock)
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "key",
          raw: "\x1b",
          name: "escape",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])

      parser.push(Buffer.from("[<35;20;5m"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "response",
          protocol: "unknown",
          sequence: "[<35;20;5m",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("timeout flushes partial SGR continuation as one unknown response", () => {
    const { parser, clock } = createTimedParser()

    try {
      parser.push(Buffer.from("[<35;20"))
      expect(collectAvailable(parser)).toEqual([])

      advanceParserTimeout(clock)
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "response",
          protocol: "unknown",
          sequence: "[<35;20",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("resets the timeout when an incomplete sequence receives more bytes", () => {
    const { parser, clock } = createTimedParser()

    try {
      parser.push(Buffer.from("\x1b[<35;20;"))
      clock.advance(9)
      parser.push(Buffer.from("5"))

      expect(collectAvailable(parser)).toEqual([])

      clock.advance(9)
      expect(collectAvailable(parser)).toEqual([])

      parser.push(Buffer.from("m"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "mouse",
          raw: "\x1b[<35;20;5m",
          encoding: "sgr",
          event: {
            type: "move",
            button: 0,
            x: 19,
            y: 4,
            modifiers: { shift: false, alt: false, ctrl: false },
          },
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("aborts partial CSI on embedded ESC and restarts at the new escape", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("\x1b[<35;\x1b[<35;20;5m"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "response",
          protocol: "unknown",
          sequence: "\x1b[<35;",
        },
        {
          type: "mouse",
          raw: "\x1b[<35;20;5m",
          encoding: "sgr",
          event: {
            type: "move",
            button: 0,
            x: 19,
            y: 4,
            modifiers: { shift: false, alt: false, ctrl: false },
          },
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("keeps chunk shape invariant across mixed key, mouse, response, and paste traffic", () => {
    const stream = Buffer.concat([
      Buffer.from("x\x1b[<64;10;5M\x1b[I\x1b]4;0;#ffffff\x07\x1b[200~p\x1b[201~"),
      Buffer.from("👍"),
    ])
    const parserA = createParser()
    const parserB = createParser()

    try {
      parserA.push(stream)
      const singleChunk = collectSnapshots(parserA)

      for (const chunk of [
        Buffer.from("x\x1b[<64"),
        Buffer.from(";10;5M\x1b"),
        Buffer.from("[I\x1b]4;0;"),
        Buffer.from("#ffffff\x07\x1b[200~"),
        Buffer.from("p\x1b[201~"),
        Buffer.from("👍"),
      ]) {
        parserB.push(chunk)
      }

      expect(collectSnapshots(parserB)).toEqual(singleChunk)
    } finally {
      parserA.destroy()
      parserB.destroy()
    }
  })

  test("reset clears buffered state and releases retained capacity", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("\x1b["))
      expect(collectAvailable(parser)).toEqual([])

      parser.push(Buffer.alloc(4096, "x"))
      expect(parser.bufferCapacity).toBeGreaterThanOrEqual(256)

      parser.reset()
      expect(collectAvailable(parser)).toEqual([])
      expect(parser.bufferCapacity).toBeLessThanOrEqual(256)

      parser.push(Buffer.from("x"))
      expect(collectSnapshots(parser)).toEqual([
        {
          type: "key",
          raw: "x",
          name: "x",
          ctrl: false,
          meta: false,
          shift: false,
          eventType: "press",
        },
      ])
    } finally {
      parser.destroy()
    }
  })

  test("allows destroy during drain callback", () => {
    const parser = createParser()

    try {
      parser.push(Buffer.from("abc"))

      let eventCount = 0
      expect(() => {
        parser.drain(() => {
          eventCount += 1
          if (eventCount === 1) {
            parser.destroy()
          }
        })
      }).not.toThrow()
      expect(eventCount).toBe(1)
    } finally {
      parser.destroy()
    }
  })
})
