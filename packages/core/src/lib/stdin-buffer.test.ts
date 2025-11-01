import { describe, expect, it, beforeEach } from "bun:test"
import { StdinBuffer } from "./stdin-buffer"

describe("StdinBuffer", () => {
  let buffer: StdinBuffer

  beforeEach(() => {
    buffer = new StdinBuffer(10)
  })

  describe("Regular Characters", () => {
    it("should pass through regular characters immediately", () => {
      const result = buffer.push("a")
      expect(result).toEqual(["a"])
    })

    it("should pass through multiple regular characters", () => {
      const result = buffer.push("abc")
      expect(result).toEqual(["a", "b", "c"])
    })

    it("should handle unicode characters", () => {
      const result = buffer.push("hello 世界")
      expect(result).toEqual(["h", "e", "l", "l", "o", " ", "世", "界"])
    })
  })

  describe("Complete Escape Sequences", () => {
    it("should pass through complete mouse SGR sequences", () => {
      const mouseSeq = "\x1b[<35;20;5m"
      const result = buffer.push(mouseSeq)
      expect(result).toEqual([mouseSeq])
    })

    it("should pass through complete arrow key sequences", () => {
      const upArrow = "\x1b[A"
      const result = buffer.push(upArrow)
      expect(result).toEqual([upArrow])
    })

    it("should pass through complete function key sequences", () => {
      const f1 = "\x1b[11~"
      const result = buffer.push(f1)
      expect(result).toEqual([f1])
    })

    it("should pass through meta key sequences", () => {
      const metaA = "\x1ba"
      const result = buffer.push(metaA)
      expect(result).toEqual([metaA])
    })

    it("should pass through SS3 sequences", () => {
      const ss3 = "\x1bOA"
      const result = buffer.push(ss3)
      expect(result).toEqual([ss3])
    })
  })

  describe("Partial Escape Sequences", () => {
    it("should buffer incomplete mouse SGR sequence", () => {
      const result1 = buffer.push("\x1b")
      expect(result1).toEqual([])
      expect(buffer.getBuffer()).toBe("\x1b")

      const result2 = buffer.push("[<35")
      expect(result2).toEqual([])
      expect(buffer.getBuffer()).toBe("\x1b[<35")

      const result3 = buffer.push(";20;5m")
      expect(result3).toEqual(["\x1b[<35;20;5m"])
      expect(buffer.getBuffer()).toBe("")
    })

    it("should buffer incomplete CSI sequence", () => {
      const result1 = buffer.push("\x1b[")
      expect(result1).toEqual([])

      const result2 = buffer.push("1;")
      expect(result2).toEqual([])

      const result3 = buffer.push("5H")
      expect(result3).toEqual(["\x1b[1;5H"])
    })

    it("should buffer split across many chunks", () => {
      buffer.push("\x1b")
      buffer.push("[")
      buffer.push("<")
      buffer.push("3")
      buffer.push("5")
      buffer.push(";")
      buffer.push("2")
      buffer.push("0")
      buffer.push(";")
      buffer.push("5")
      const result = buffer.push("m")

      expect(result).toEqual(["\x1b[<35;20;5m"])
    })
  })

  describe("Mixed Content", () => {
    it("should handle characters followed by escape sequence", () => {
      const result = buffer.push("abc\x1b[A")
      expect(result).toEqual(["a", "b", "c", "\x1b[A"])
    })

    it("should handle escape sequence followed by characters", () => {
      const result = buffer.push("\x1b[Aabc")
      expect(result).toEqual(["\x1b[A", "a", "b", "c"])
    })

    it("should handle multiple complete sequences", () => {
      const result = buffer.push("\x1b[A\x1b[B\x1b[C")
      expect(result).toEqual(["\x1b[A", "\x1b[B", "\x1b[C"])
    })

    it("should handle partial sequence with preceding characters", () => {
      const result1 = buffer.push("abc\x1b[<35")
      expect(result1).toEqual(["a", "b", "c"])
      expect(buffer.getBuffer()).toBe("\x1b[<35")

      const result2 = buffer.push(";20;5m")
      expect(result2).toEqual(["\x1b[<35;20;5m"])
    })
  })

  describe("Mouse Events", () => {
    it("should handle mouse press event", () => {
      const result = buffer.push("\x1b[<0;10;5M")
      expect(result).toEqual(["\x1b[<0;10;5M"])
    })

    it("should handle mouse release event", () => {
      const result = buffer.push("\x1b[<0;10;5m")
      expect(result).toEqual(["\x1b[<0;10;5m"])
    })

    it("should handle mouse move event", () => {
      const result = buffer.push("\x1b[<35;20;5m")
      expect(result).toEqual(["\x1b[<35;20;5m"])
    })

    it("should handle split mouse events", () => {
      buffer.push("\x1b[<3")
      buffer.push("5;1")
      buffer.push("5;")
      const result = buffer.push("10m")
      expect(result).toEqual(["\x1b[<35;15;10m"])
    })

    it("should handle multiple mouse events", () => {
      const result = buffer.push("\x1b[<35;1;1m\x1b[<35;2;2m\x1b[<35;3;3m")
      expect(result).toEqual(["\x1b[<35;1;1m", "\x1b[<35;2;2m", "\x1b[<35;3;3m"])
    })

    it("should handle old-style mouse sequence (ESC[M + 3 bytes)", () => {
      const result = buffer.push("\x1b[M abc")
      expect(result).toEqual(["\x1b[M ab", "c"])
    })

    it("should buffer incomplete old-style mouse sequence", () => {
      buffer.push("\x1b[M")
      expect(buffer.getBuffer()).toBe("\x1b[M")

      buffer.push(" a")
      expect(buffer.getBuffer()).toBe("\x1b[M a")

      const result = buffer.push("b")
      expect(result).toEqual(["\x1b[M ab"])
    })
  })

  describe("Edge Cases", () => {
    it("should handle empty input", () => {
      const result = buffer.push("")
      expect(result).toEqual([])
    })

    it("should handle lone escape character", () => {
      const result1 = buffer.push("\x1b")
      expect(result1).toEqual([])

      // After timeout or explicit flush, should emit
      const flushed = buffer.flush()
      expect(flushed).toEqual(["\x1b"])
    })

    it("should handle buffer input", () => {
      const result = buffer.push(Buffer.from("\x1b[A"))
      expect(result).toEqual(["\x1b[A"])
    })

    it("should handle very long sequences", () => {
      const longSeq = "\x1b[" + "1;".repeat(50) + "H"
      const result = buffer.push(longSeq)
      expect(result).toEqual([longSeq])
    })
  })

  describe("Flush", () => {
    it("should flush incomplete sequences", () => {
      buffer.push("\x1b[<35")
      const flushed = buffer.flush()
      expect(flushed).toEqual(["\x1b[<35"])
      expect(buffer.getBuffer()).toBe("")
    })

    it("should return empty array if nothing to flush", () => {
      const flushed = buffer.flush()
      expect(flushed).toEqual([])
    })
  })

  describe("Clear", () => {
    it("should clear buffered content", () => {
      buffer.push("\x1b[<35")
      expect(buffer.getBuffer()).toBe("\x1b[<35")

      buffer.clear()
      expect(buffer.getBuffer()).toBe("")
    })
  })

  describe("Real-world Scenarios", () => {
    it("should handle rapid typing with mouse movements", () => {
      const sequences: string[] = []

      // Type 'h'
      sequences.push(...buffer.push("h"))

      // Mouse move arrives in chunks
      sequences.push(...buffer.push("\x1b"))
      sequences.push(...buffer.push("[<35;"))
      sequences.push(...buffer.push("10;5m"))

      // Type 'e'
      sequences.push(...buffer.push("e"))

      // Type 'l'
      sequences.push(...buffer.push("l"))

      expect(sequences).toEqual(["h", "\x1b[<35;10;5m", "e", "l"])
    })

    it("should handle paste with embedded escape sequences", () => {
      const pasteStart = "\x1b[200~"
      const pasteEnd = "\x1b[201~"
      const content = "hello world"

      const result = buffer.push(pasteStart + content + pasteEnd)

      expect(result).toContain(pasteStart)
      expect(result).toContain(pasteEnd)
    })
  })
})
