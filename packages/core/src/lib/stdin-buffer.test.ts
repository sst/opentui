import { describe, expect, it, beforeEach } from "bun:test"
import { StdinBuffer } from "./stdin-buffer"
import { Readable } from "stream"

describe("StdinBuffer", () => {
  let buffer: StdinBuffer
  let mockStdin: Readable
  let emittedSequences: string[]

  beforeEach(() => {
    // Create a mock stdin stream
    mockStdin = new Readable({
      read() {},
    }) as any
    buffer = new StdinBuffer(mockStdin as any, { timeout: 10 })

    // Collect emitted sequences
    emittedSequences = []
    buffer.on("data", (sequence) => {
      emittedSequences.push(sequence)
    })
  })

  // Helper to push data to mock stdin
  function pushToStdin(data: string | Buffer): void {
    mockStdin.push(data)
  }

  // Helper to wait for async operations
  async function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  describe("Regular Characters", () => {
    it("should pass through regular characters immediately", () => {
      pushToStdin("a")
      expect(emittedSequences).toEqual(["a"])
    })

    it("should pass through multiple regular characters", () => {
      pushToStdin("abc")
      expect(emittedSequences).toEqual(["a", "b", "c"])
    })

    it("should handle unicode characters", () => {
      pushToStdin("hello 世界")
      expect(emittedSequences).toEqual(["h", "e", "l", "l", "o", " ", "世", "界"])
    })
  })

  describe("Complete Escape Sequences", () => {
    it("should pass through complete mouse SGR sequences", () => {
      const mouseSeq = "\x1b[<35;20;5m"
      pushToStdin(mouseSeq)
      expect(emittedSequences).toEqual([mouseSeq])
    })

    it("should pass through complete arrow key sequences", () => {
      const upArrow = "\x1b[A"
      pushToStdin(upArrow)
      expect(emittedSequences).toEqual([upArrow])
    })

    it("should pass through complete function key sequences", () => {
      const f1 = "\x1b[11~"
      pushToStdin(f1)
      expect(emittedSequences).toEqual([f1])
    })

    it("should pass through meta key sequences", () => {
      const metaA = "\x1ba"
      pushToStdin(metaA)
      expect(emittedSequences).toEqual([metaA])
    })

    it("should pass through SS3 sequences", () => {
      const ss3 = "\x1bOA"
      pushToStdin(ss3)
      expect(emittedSequences).toEqual([ss3])
    })
  })

  describe("Partial Escape Sequences", () => {
    it("should buffer incomplete mouse SGR sequence", async () => {
      pushToStdin("\x1b")
      expect(emittedSequences).toEqual([])
      expect(buffer.getBuffer()).toBe("\x1b")

      pushToStdin("[<35")
      expect(emittedSequences).toEqual([])
      expect(buffer.getBuffer()).toBe("\x1b[<35")

      pushToStdin(";20;5m")
      expect(emittedSequences).toEqual(["\x1b[<35;20;5m"])
      expect(buffer.getBuffer()).toBe("")
    })

    it("should buffer incomplete CSI sequence", () => {
      pushToStdin("\x1b[")
      expect(emittedSequences).toEqual([])

      pushToStdin("1;")
      expect(emittedSequences).toEqual([])

      pushToStdin("5H")
      expect(emittedSequences).toEqual(["\x1b[1;5H"])
    })

    it("should buffer split across many chunks", () => {
      pushToStdin("\x1b")
      pushToStdin("[")
      pushToStdin("<")
      pushToStdin("3")
      pushToStdin("5")
      pushToStdin(";")
      pushToStdin("2")
      pushToStdin("0")
      pushToStdin(";")
      pushToStdin("5")
      pushToStdin("m")

      expect(emittedSequences).toEqual(["\x1b[<35;20;5m"])
    })

    it("should flush incomplete sequence after timeout", async () => {
      pushToStdin("\x1b[<35")
      expect(emittedSequences).toEqual([])

      // Wait for timeout
      await wait(15)

      expect(emittedSequences).toEqual(["\x1b[<35"])
    })
  })

  describe("Mixed Content", () => {
    it("should handle characters followed by escape sequence", () => {
      pushToStdin("abc\x1b[A")
      expect(emittedSequences).toEqual(["a", "b", "c", "\x1b[A"])
    })

    it("should handle escape sequence followed by characters", () => {
      pushToStdin("\x1b[Aabc")
      expect(emittedSequences).toEqual(["\x1b[A", "a", "b", "c"])
    })

    it("should handle multiple complete sequences", () => {
      pushToStdin("\x1b[A\x1b[B\x1b[C")
      expect(emittedSequences).toEqual(["\x1b[A", "\x1b[B", "\x1b[C"])
    })

    it("should handle partial sequence with preceding characters", () => {
      pushToStdin("abc\x1b[<35")
      expect(emittedSequences).toEqual(["a", "b", "c"])
      expect(buffer.getBuffer()).toBe("\x1b[<35")

      pushToStdin(";20;5m")
      expect(emittedSequences).toEqual(["a", "b", "c", "\x1b[<35;20;5m"])
    })
  })

  describe("Mouse Events", () => {
    it("should handle mouse press event", () => {
      pushToStdin("\x1b[<0;10;5M")
      expect(emittedSequences).toEqual(["\x1b[<0;10;5M"])
    })

    it("should handle mouse release event", () => {
      pushToStdin("\x1b[<0;10;5m")
      expect(emittedSequences).toEqual(["\x1b[<0;10;5m"])
    })

    it("should handle mouse move event", () => {
      pushToStdin("\x1b[<35;20;5m")
      expect(emittedSequences).toEqual(["\x1b[<35;20;5m"])
    })

    it("should handle split mouse events", () => {
      pushToStdin("\x1b[<3")
      pushToStdin("5;1")
      pushToStdin("5;")
      pushToStdin("10m")
      expect(emittedSequences).toEqual(["\x1b[<35;15;10m"])
    })

    it("should handle multiple mouse events", () => {
      pushToStdin("\x1b[<35;1;1m\x1b[<35;2;2m\x1b[<35;3;3m")
      expect(emittedSequences).toEqual(["\x1b[<35;1;1m", "\x1b[<35;2;2m", "\x1b[<35;3;3m"])
    })

    it("should handle old-style mouse sequence (ESC[M + 3 bytes)", () => {
      pushToStdin("\x1b[M abc")
      expect(emittedSequences).toEqual(["\x1b[M ab", "c"])
    })

    it("should buffer incomplete old-style mouse sequence", () => {
      pushToStdin("\x1b[M")
      expect(buffer.getBuffer()).toBe("\x1b[M")

      pushToStdin(" a")
      expect(buffer.getBuffer()).toBe("\x1b[M a")

      pushToStdin("b")
      expect(emittedSequences).toEqual(["\x1b[M ab"])
    })
  })

  describe("Edge Cases", () => {
    it("should handle empty input", () => {
      pushToStdin("")
      // Empty string doesn't trigger a data event from stdin
      expect(emittedSequences).toEqual([])
    })

    it("should handle lone escape character with timeout", async () => {
      pushToStdin("\x1b")
      expect(emittedSequences).toEqual([])

      // After timeout, should emit
      await wait(15)
      expect(emittedSequences).toEqual(["\x1b"])
    })

    it("should handle lone escape character with explicit flush", () => {
      pushToStdin("\x1b")
      expect(emittedSequences).toEqual([])

      const flushed = buffer.flush()
      expect(flushed).toEqual(["\x1b"])
    })

    it("should handle buffer input", () => {
      pushToStdin(Buffer.from("\x1b[A"))
      expect(emittedSequences).toEqual(["\x1b[A"])
    })

    it("should handle very long sequences", () => {
      const longSeq = "\x1b[" + "1;".repeat(50) + "H"
      pushToStdin(longSeq)
      expect(emittedSequences).toEqual([longSeq])
    })
  })

  describe("Flush", () => {
    it("should flush incomplete sequences", () => {
      pushToStdin("\x1b[<35")
      const flushed = buffer.flush()
      expect(flushed).toEqual(["\x1b[<35"])
      expect(buffer.getBuffer()).toBe("")
    })

    it("should return empty array if nothing to flush", () => {
      const flushed = buffer.flush()
      expect(flushed).toEqual([])
    })

    it("should emit flushed data via timeout", async () => {
      pushToStdin("\x1b[<35")
      expect(emittedSequences).toEqual([])

      // Wait for timeout to flush
      await wait(15)

      expect(emittedSequences).toEqual(["\x1b[<35"])
    })
  })

  describe("Clear", () => {
    it("should clear buffered content without emitting", () => {
      pushToStdin("\x1b[<35")
      expect(buffer.getBuffer()).toBe("\x1b[<35")

      buffer.clear()
      expect(buffer.getBuffer()).toBe("")
      expect(emittedSequences).toEqual([])
    })
  })

  describe("Real-world Scenarios", () => {
    it("should handle rapid typing with mouse movements", () => {
      // Type 'h'
      pushToStdin("h")

      // Mouse move arrives in chunks
      pushToStdin("\x1b")
      pushToStdin("[<35;")
      pushToStdin("10;5m")

      // Type 'e'
      pushToStdin("e")

      // Type 'l'
      pushToStdin("l")

      expect(emittedSequences).toEqual(["h", "\x1b[<35;10;5m", "e", "l"])
    })

    it("should handle paste with embedded escape sequences", () => {
      const pasteStart = "\x1b[200~"
      const pasteEnd = "\x1b[201~"
      const content = "hello world"

      pushToStdin(pasteStart + content + pasteEnd)

      expect(emittedSequences).toContain(pasteStart)
      expect(emittedSequences).toContain(pasteEnd)
    })
  })

  describe("Destroy", () => {
    it("should remove stdin listener on destroy", () => {
      buffer.destroy()

      // Should not emit after destroy
      pushToStdin("a")
      expect(emittedSequences).toEqual([])
    })

    it("should clear pending timeouts on destroy", async () => {
      pushToStdin("\x1b[<35")
      buffer.destroy()

      // Wait longer than timeout
      await wait(15)

      // Should not have emitted anything
      expect(emittedSequences).toEqual([])
    })
  })
})
