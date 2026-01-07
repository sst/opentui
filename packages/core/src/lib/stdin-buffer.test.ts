import { describe, expect, it, beforeEach } from "bun:test"
import { StdinBuffer } from "./stdin-buffer"

describe("StdinBuffer", () => {
  let buffer: StdinBuffer
  let emittedSequences: string[]

  beforeEach(() => {
    buffer = new StdinBuffer({ timeout: 10 })

    // Collect emitted sequences
    emittedSequences = []
    buffer.on("data", (sequence) => {
      emittedSequences.push(sequence)
    })
  })

  function processInput(data: string | Buffer): void {
    buffer.process(data)
  }

  function flushBuffer(): void {
    for (const seq of buffer.flush()) {
      emittedSequences.push(seq)
    }
  }

  async function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  describe("Regular Characters", () => {
    it("should pass through regular characters immediately", () => {
      processInput("a")
      expect(emittedSequences).toEqual(["a"])
    })

    it("should pass through multiple regular characters", () => {
      processInput("abc")
      expect(emittedSequences).toEqual(["a", "b", "c"])
    })

    it("should handle unicode characters", () => {
      processInput("hello 世界")
      expect(emittedSequences).toEqual(["h", "e", "l", "l", "o", " ", "世", "界"])
    })
  })

  describe("Complete Escape Sequences", () => {
    it("should pass through complete mouse SGR sequences", () => {
      const mouseSeq = "\x1b[<35;20;5m"
      processInput(mouseSeq)
      expect(emittedSequences).toEqual([mouseSeq])
    })

    it("should pass through complete arrow key sequences", () => {
      const upArrow = "\x1b[A"
      processInput(upArrow)
      expect(emittedSequences).toEqual([upArrow])
    })

    it("should pass through complete function key sequences", () => {
      const f1 = "\x1b[11~"
      processInput(f1)
      expect(emittedSequences).toEqual([f1])
    })

    it("should pass through meta key sequences", () => {
      const metaA = "\x1ba"
      processInput(metaA)
      expect(emittedSequences).toEqual([metaA])
    })

    it("should pass through SS3 sequences", () => {
      const ss3 = "\x1bOA"
      processInput(ss3)
      expect(emittedSequences).toEqual([ss3])
    })
  })

  describe("Partial Escape Sequences", () => {
    it("should buffer incomplete mouse SGR sequence", async () => {
      processInput("\x1b")
      expect(emittedSequences).toEqual([])
      expect(buffer.getBuffer()).toBe("\x1b")

      processInput("[<35")
      expect(emittedSequences).toEqual([])
      expect(buffer.getBuffer()).toBe("\x1b[<35")

      processInput(";20;5m")
      expect(emittedSequences).toEqual(["\x1b[<35;20;5m"])
      expect(buffer.getBuffer()).toBe("")
    })

    it("should buffer incomplete CSI sequence", () => {
      processInput("\x1b[")
      expect(emittedSequences).toEqual([])

      processInput("1;")
      expect(emittedSequences).toEqual([])

      processInput("5H")
      expect(emittedSequences).toEqual(["\x1b[1;5H"])
    })

    it("should buffer split across many chunks", () => {
      processInput("\x1b")
      processInput("[")
      processInput("<")
      processInput("3")
      processInput("5")
      processInput(";")
      processInput("2")
      processInput("0")
      processInput(";")
      processInput("5")
      processInput("m")

      expect(emittedSequences).toEqual(["\x1b[<35;20;5m"])
    })

    it("should flush incomplete sequence after timeout", async () => {
      processInput("\x1b[<35")
      expect(emittedSequences).toEqual([])

      // Wait for timeout
      await wait(15)

      expect(emittedSequences).toEqual(["\x1b[<35"])
    })
  })

  describe("Mixed Content", () => {
    it("should handle characters followed by escape sequence", () => {
      processInput("abc\x1b[A")
      expect(emittedSequences).toEqual(["a", "b", "c", "\x1b[A"])
    })

    it("should handle escape sequence followed by characters", () => {
      processInput("\x1b[Aabc")
      expect(emittedSequences).toEqual(["\x1b[A", "a", "b", "c"])
    })

    it("should handle multiple complete sequences", () => {
      processInput("\x1b[A\x1b[B\x1b[C")
      expect(emittedSequences).toEqual(["\x1b[A", "\x1b[B", "\x1b[C"])
    })

    it("should handle partial sequence with preceding characters", () => {
      processInput("abc\x1b[<35")
      expect(emittedSequences).toEqual(["a", "b", "c"])
      expect(buffer.getBuffer()).toBe("\x1b[<35")

      processInput(";20;5m")
      expect(emittedSequences).toEqual(["a", "b", "c", "\x1b[<35;20;5m"])
    })
  })

  describe("Mouse Events", () => {
    it("should handle mouse press event", () => {
      processInput("\x1b[<0;10;5M")
      expect(emittedSequences).toEqual(["\x1b[<0;10;5M"])
    })

    it("should handle mouse release event", () => {
      processInput("\x1b[<0;10;5m")
      expect(emittedSequences).toEqual(["\x1b[<0;10;5m"])
    })

    it("should handle mouse move event", () => {
      processInput("\x1b[<35;20;5m")
      expect(emittedSequences).toEqual(["\x1b[<35;20;5m"])
    })

    it("should handle split mouse events", () => {
      processInput("\x1b[<3")
      processInput("5;1")
      processInput("5;")
      processInput("10m")
      expect(emittedSequences).toEqual(["\x1b[<35;15;10m"])
    })

    it("should handle multiple mouse events", () => {
      processInput("\x1b[<35;1;1m\x1b[<35;2;2m\x1b[<35;3;3m")
      expect(emittedSequences).toEqual(["\x1b[<35;1;1m", "\x1b[<35;2;2m", "\x1b[<35;3;3m"])
    })

    it("should handle old-style mouse sequence (ESC[M + 3 bytes)", () => {
      processInput("\x1b[M abc")
      expect(emittedSequences).toEqual(["\x1b[M ab", "c"])
    })

    it("should buffer incomplete old-style mouse sequence", () => {
      processInput("\x1b[M")
      expect(buffer.getBuffer()).toBe("\x1b[M")

      processInput(" a")
      expect(buffer.getBuffer()).toBe("\x1b[M a")

      processInput("b")
      expect(emittedSequences).toEqual(["\x1b[M ab"])
    })
  })

  describe("Edge Cases", () => {
    it("should handle empty input", () => {
      processInput("")
      // Empty string emits an empty data event
      expect(emittedSequences).toEqual([""])
    })

    it("should handle lone escape character with timeout", async () => {
      processInput("\x1b")
      expect(emittedSequences).toEqual([])

      // After timeout, should emit
      await wait(15)
      expect(emittedSequences).toEqual(["\x1b"])
    })

    it("should handle lone escape character with explicit flush", () => {
      processInput("\x1b")
      expect(emittedSequences).toEqual([])

      const flushed = buffer.flush()
      expect(flushed).toEqual(["\x1b"])
    })

    it("should handle buffer input", () => {
      processInput(Buffer.from("\x1b[A"))
      expect(emittedSequences).toEqual(["\x1b[A"])
    })

    it("should handle very long sequences", () => {
      const longSeq = "\x1b[" + "1;".repeat(50) + "H"
      processInput(longSeq)
      expect(emittedSequences).toEqual([longSeq])
    })
  })

  describe("Flush", () => {
    it("should flush incomplete sequences", () => {
      processInput("\x1b[<35")
      const flushed = buffer.flush()
      expect(flushed).toEqual(["\x1b[<35"])
      expect(buffer.getBuffer()).toBe("")
    })

    it("should return empty array if nothing to flush", () => {
      const flushed = buffer.flush()
      expect(flushed).toEqual([])
    })

    it("should emit flushed data via timeout", async () => {
      processInput("\x1b[<35")
      expect(emittedSequences).toEqual([])

      // Wait for timeout to flush
      await wait(15)

      expect(emittedSequences).toEqual(["\x1b[<35"])
    })
  })

  describe("Clear", () => {
    it("should clear buffered content without emitting", () => {
      processInput("\x1b[<35")
      expect(buffer.getBuffer()).toBe("\x1b[<35")

      buffer.clear()
      expect(buffer.getBuffer()).toBe("")
      expect(emittedSequences).toEqual([])
    })
  })

  describe("Real-world Scenarios", () => {
    it("should handle rapid typing with mouse movements", () => {
      // Type 'h'
      processInput("h")

      // Mouse move arrives in chunks
      processInput("\x1b")
      processInput("[<35;")
      processInput("10;5m")

      // Type 'e'
      processInput("e")

      // Type 'l'
      processInput("l")

      expect(emittedSequences).toEqual(["h", "\x1b[<35;10;5m", "e", "l"])
    })
  })

  describe("Bracketed Paste", () => {
    let emittedPaste: string[] = []

    beforeEach(() => {
      buffer = new StdinBuffer({ timeout: 10 })

      // Collect emitted sequences
      emittedSequences = []
      buffer.on("data", (sequence) => {
        emittedSequences.push(sequence)
      })

      // Collect paste events
      emittedPaste = []
      buffer.on("paste", (data) => {
        emittedPaste.push(data)
      })
    })

    it("should emit paste event for complete bracketed paste", () => {
      const pasteStart = "\x1b[200~"
      const pasteEnd = "\x1b[201~"
      const content = "hello world"

      processInput(pasteStart + content + pasteEnd)

      expect(emittedPaste).toEqual(["hello world"])
      expect(emittedSequences).toEqual([]) // No data events during paste
    })

    it("should handle paste arriving in chunks", () => {
      processInput("\x1b[200~")
      expect(emittedPaste).toEqual([])

      processInput("hello ")
      expect(emittedPaste).toEqual([])

      processInput("world\x1b[201~")
      expect(emittedPaste).toEqual(["hello world"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle paste with input before and after", () => {
      processInput("a")
      processInput("\x1b[200~pasted\x1b[201~")
      processInput("b")

      expect(emittedSequences).toEqual(["a", "b"])
      expect(emittedPaste).toEqual(["pasted"])
    })

    it("should handle paste split across multiple chunks", () => {
      processInput("\x1b[200~")
      processInput("chunk1")
      processInput("chunk2")
      processInput("chunk3\x1b[201~")

      expect(emittedPaste).toEqual(["chunk1chunk2chunk3"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle multiple pastes", () => {
      processInput("\x1b[200~first\x1b[201~")
      processInput("a")
      processInput("\x1b[200~second\x1b[201~")

      expect(emittedPaste).toEqual(["first", "second"])
      expect(emittedSequences).toEqual(["a"])
    })

    it("should handle empty paste", () => {
      processInput("\x1b[200~\x1b[201~")

      expect(emittedPaste).toEqual([""])
      expect(emittedSequences).toEqual([])
    })

    it("should continue normal processing after paste", () => {
      processInput("\x1b[200~pasted content\x1b[201~")
      processInput("abc")
      processInput("\x1b[A")

      expect(emittedPaste).toEqual(["pasted content"])
      expect(emittedSequences).toEqual(["a", "b", "c", "\x1b[A"])
    })

    it("should handle data before paste start in same chunk", () => {
      processInput("abc\x1b[200~pasted\x1b[201~")

      expect(emittedSequences).toEqual(["a", "b", "c"])
      expect(emittedPaste).toEqual(["pasted"])
    })

    it("should handle data after paste end in same chunk", () => {
      processInput("\x1b[200~pasted\x1b[201~xyz")

      expect(emittedPaste).toEqual(["pasted"])
      expect(emittedSequences).toEqual(["x", "y", "z"])
    })

    it("should handle data before and after paste in same chunk", () => {
      processInput("abc\x1b[200~pasted\x1b[201~xyz")

      expect(emittedSequences).toEqual(["a", "b", "c", "x", "y", "z"])
      expect(emittedPaste).toEqual(["pasted"])
    })

    it("should handle escape sequences before paste", () => {
      processInput("\x1b[A\x1b[200~pasted\x1b[201~")

      expect(emittedSequences).toEqual(["\x1b[A"])
      expect(emittedPaste).toEqual(["pasted"])
    })

    it("should handle escape sequences after paste", () => {
      processInput("\x1b[200~pasted\x1b[201~\x1b[B")

      expect(emittedPaste).toEqual(["pasted"])
      expect(emittedSequences).toEqual(["\x1b[B"])
    })

    it("should handle escape sequences before and after paste", () => {
      processInput("\x1b[A\x1b[200~pasted\x1b[201~\x1b[B")

      expect(emittedSequences).toEqual(["\x1b[A", "\x1b[B"])
      expect(emittedPaste).toEqual(["pasted"])
    })

    it("should handle mixed content before paste in same chunk", () => {
      processInput("a\x1b[Ab\x1b[200~pasted\x1b[201~")

      expect(emittedSequences).toEqual(["a", "\x1b[A", "b"])
      expect(emittedPaste).toEqual(["pasted"])
    })

    it("should handle mixed content after paste in same chunk", () => {
      processInput("\x1b[200~pasted\x1b[201~x\x1b[By")

      expect(emittedPaste).toEqual(["pasted"])
      expect(emittedSequences).toEqual(["x", "\x1b[B", "y"])
    })

    it("should handle complex mixed content with paste", () => {
      processInput("start\x1b[A\x1b[200~pasted content\x1b[201~\x1b[Bend")

      expect(emittedSequences).toEqual(["s", "t", "a", "r", "t", "\x1b[A", "\x1b[B", "e", "n", "d"])
      expect(emittedPaste).toEqual(["pasted content"])
    })

    it("should handle paste start split from content", () => {
      processInput("\x1b[200")
      expect(emittedPaste).toEqual([])
      expect(emittedSequences).toEqual([])

      processInput("~content\x1b[201~")
      expect(emittedPaste).toEqual(["content"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle paste end split from content", () => {
      processInput("\x1b[200~content\x1b[201")
      expect(emittedPaste).toEqual([])

      processInput("~")
      expect(emittedPaste).toEqual(["content"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle paste markers split across chunks", () => {
      processInput("\x1b")
      processInput("[")
      processInput("200")
      processInput("~")
      expect(emittedPaste).toEqual([])

      processInput("content")
      expect(emittedPaste).toEqual([])

      processInput("\x1b")
      processInput("[")
      processInput("201")
      processInput("~")
      expect(emittedPaste).toEqual(["content"])
    })

    it("should handle paste with newlines", () => {
      processInput("\x1b[200~line1\nline2\nline3\x1b[201~")

      expect(emittedPaste).toEqual(["line1\nline2\nline3"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle paste with tabs", () => {
      processInput("\x1b[200~col1\tcol2\tcol3\x1b[201~")

      expect(emittedPaste).toEqual(["col1\tcol2\tcol3"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle paste with special characters", () => {
      processInput("\x1b[200~!@#$%^&*()_+-=[]{}|;:',.<>?/\x1b[201~")

      expect(emittedPaste).toEqual(["!@#$%^&*()_+-=[]{}|;:',.<>?/"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle paste with unicode", () => {
      processInput("\x1b[200~Hello 世界 🎉\x1b[201~")

      expect(emittedPaste).toEqual(["Hello 世界 🎉"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle very long paste content", () => {
      const longContent = "a".repeat(10000)
      processInput("\x1b[200~" + longContent + "\x1b[201~")

      expect(emittedPaste).toEqual([longContent])
      expect(emittedSequences).toEqual([])
    })

    it("should handle paste interrupted by clear", () => {
      processInput("\x1b[200~partial content")
      expect(emittedPaste).toEqual([])

      buffer.clear()
      expect(emittedPaste).toEqual([])

      processInput("a")
      expect(emittedSequences).toEqual(["a"])
      expect(emittedPaste).toEqual([])
    })

    it("should handle paste interrupted by destroy", () => {
      processInput("\x1b[200~partial content")
      expect(emittedPaste).toEqual([])

      buffer.destroy()
      expect(emittedPaste).toEqual([])
    })

    it("should handle consecutive pastes without data between", () => {
      processInput("\x1b[200~first\x1b[201~\x1b[200~second\x1b[201~")

      expect(emittedPaste).toEqual(["first", "second"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle paste with only paste markers and data in separate chunks", () => {
      processInput("\x1b[200~\x1b[201~")
      processInput("a")

      expect(emittedPaste).toEqual([""])
      expect(emittedSequences).toEqual(["a"])
    })

    it("should handle data arriving between paste start chunks", () => {
      processInput("\x1b")
      processInput("[")
      processInput("200~content\x1b[201~")

      expect(emittedPaste).toEqual(["content"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle incomplete escape before paste start", () => {
      processInput("\x1b[<35")
      expect(emittedSequences).toEqual([])

      processInput(";20;5m\x1b[200~paste\x1b[201~")
      expect(emittedSequences).toEqual(["\x1b[<35;20;5m"])
      expect(emittedPaste).toEqual(["paste"])
    })

    it("should handle paste followed by incomplete escape", () => {
      processInput("\x1b[200~paste\x1b[201~\x1b[<35")
      expect(emittedPaste).toEqual(["paste"])
      expect(emittedSequences).toEqual([])
      expect(buffer.getBuffer()).toBe("\x1b[<35")

      processInput(";20;5m")
      expect(emittedSequences).toEqual(["\x1b[<35;20;5m"])
    })

    it("should handle escape sequence interrupted by paste start", () => {
      processInput("\x1b[1;")
      expect(emittedSequences).toEqual([])
      expect(buffer.getBuffer()).toBe("\x1b[1;")

      processInput("5H\x1b[200~paste\x1b[201~")
      expect(emittedSequences).toEqual(["\x1b[1;5H"])
      expect(emittedPaste).toEqual(["paste"])
    })

    it("should handle paste start marker appearing in regular data stream", () => {
      // If somehow a paste start appears without being complete
      processInput("\x1b[20")
      expect(emittedSequences).toEqual([])

      // Complete as a different sequence
      processInput("0R") // CPR response
      expect(emittedSequences).toEqual(["\x1b[200R"])
      expect(emittedPaste).toEqual([])
    })

    it("should handle multiple escape sequences after paste", () => {
      processInput("\x1b[200~pasted\x1b[201~\x1b[A\x1b[B\x1b[C")

      expect(emittedPaste).toEqual(["pasted"])
      expect(emittedSequences).toEqual(["\x1b[A", "\x1b[B", "\x1b[C"])
    })

    it("should handle Buffer input for paste", () => {
      processInput(Buffer.from("\x1b[200~pasted\x1b[201~"))

      expect(emittedPaste).toEqual(["pasted"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle paste with carriage returns", () => {
      processInput("\x1b[200~line1\r\nline2\r\nline3\x1b[201~")

      expect(emittedPaste).toEqual(["line1\r\nline2\r\nline3"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle paste start marker in pasted content as literal data", () => {
      processInput("\x1b[200~content with \x1b[200~ inside\x1b[201~")

      expect(emittedPaste).toEqual(["content with \x1b[200~ inside"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle nested paste: inner end marker closes outer paste", () => {
      processInput("\x1b[200~outer \x1b[200~inner\x1b[201~ rest\x1b[201~")

      // First \x1b[201~ ends the paste, remaining is processed as data
      expect(emittedPaste).toEqual(["outer \x1b[200~inner"])
      expect(emittedSequences).toContain(" ")
      expect(emittedSequences).toContain("r")
      expect(emittedSequences).toContain("e")
      expect(emittedSequences).toContain("s")
      expect(emittedSequences).toContain("t")
      expect(emittedSequences).toContain("\x1b[201~")
    })

    it("should handle paste end marker without paste start as normal escape", () => {
      processInput("\x1b[201~")

      expect(emittedPaste).toEqual([])
      expect(emittedSequences).toEqual(["\x1b[201~"])
    })

    it("should handle paste end marker in regular content as escape sequence", () => {
      processInput("hello\x1b[201~world")

      expect(emittedPaste).toEqual([])
      expect(emittedSequences).toEqual(["h", "e", "l", "l", "o", "\x1b[201~", "w", "o", "r", "l", "d"])
    })

    it("should handle multiple paste start markers before end", () => {
      processInput("\x1b[200~first \x1b[200~ second \x1b[200~ third\x1b[201~")

      // All inner paste starts are treated as content
      expect(emittedPaste).toEqual(["first \x1b[200~ second \x1b[200~ third"])
      expect(emittedSequences).toEqual([])
    })

    it("should handle paste with literal backslash-x-1-b sequence", () => {
      processInput("\x1b[200~The text \\x1b[200~ is literal\x1b[201~")

      expect(emittedPaste).toEqual(["The text \\x1b[200~ is literal"])
      expect(emittedSequences).toEqual([])
    })
  })

  describe("Grapheme Cluster Handling", () => {
    it("should keep basic emoji as single sequence", () => {
      processInput("🌟")
      expect(emittedSequences).toEqual(["🌟"])
    })

    it("should keep multiple basic emoji as separate sequences", () => {
      processInput("🌟👍🎉")
      expect(emittedSequences).toEqual(["🌟", "👍", "🎉"])
    })

    it("should keep ZWJ family emoji as single sequence", () => {
      processInput("👨‍👩‍👧‍👦")
      expect(emittedSequences).toEqual(["👨‍👩‍👧‍👦"])
    })

    it("should keep flag emoji as single sequence", () => {
      processInput("🇺🇸")
      expect(emittedSequences).toEqual(["🇺🇸"])
    })

    it("should keep skin tone emoji as single sequence", () => {
      processInput("👋🏻")
      expect(emittedSequences).toEqual(["👋🏻"])
    })

    it("should keep emoji with VS16 as single sequence", () => {
      processInput("❤️")
      expect(emittedSequences).toEqual(["❤️"])
    })

    it("should handle mixed ASCII and emoji", () => {
      processInput("Hi👋there")
      expect(emittedSequences).toEqual(["H", "i", "👋", "t", "h", "e", "r", "e"])
    })

    it("should handle mixed CJK and emoji", () => {
      processInput("世界🌍")
      expect(emittedSequences).toEqual(["世", "界", "🌍"])
    })

    it("should handle complex ZWJ sequences", () => {
      processInput("👩‍🚀")
      expect(emittedSequences).toEqual(["👩‍🚀"])
    })

    it("should handle rainbow flag", () => {
      processInput("🏳️‍🌈")
      expect(emittedSequences).toEqual(["🏳️‍🌈"])
    })

    it("should handle emoji between escape sequences", () => {
      processInput("\x1b[A🌟\x1b[B")
      expect(emittedSequences).toEqual(["\x1b[A", "🌟", "\x1b[B"])
    })

    it("should handle ASCII with variation selector (keycap)", () => {
      processInput("#️⃣")
      expect(emittedSequences).toEqual(["#️⃣"])
    })
  })

  describe("Kitty Keyboard Protocol Sequences", () => {
    const kitty = (codepoint: number) => `\x1b[${codepoint}u`

    it("should preserve Kitty sequences as-is for downstream parsing", () => {
      processInput(kitty(97))
      expect(emittedSequences).toEqual([kitty(97)])
    })

    it("should preserve Kitty emoji sequences as-is", () => {
      processInput(kitty(0x1f600))
      expect(emittedSequences).toEqual([kitty(0x1f600)])
    })

    it("should handle mixed Kitty and regular escape sequences", () => {
      processInput(kitty(0x1f600))
      processInput("\x1b[A")
      expect(emittedSequences).toEqual([kitty(0x1f600), "\x1b[A"])
    })

    it("should handle multiple Kitty sequences", () => {
      processInput(kitty(0x1f468))
      processInput(kitty(0x200d))
      processInput(kitty(0x1f469))
      expect(emittedSequences).toEqual([kitty(0x1f468), kitty(0x200d), kitty(0x1f469)])
    })
  })

  describe("Destroy", () => {
    it("should clear buffer on destroy", () => {
      processInput("\x1b[<35")
      expect(buffer.getBuffer()).toBe("\x1b[<35")

      buffer.destroy()
      expect(buffer.getBuffer()).toBe("")
    })

    it("should clear pending timeouts on destroy", async () => {
      processInput("\x1b[<35")
      buffer.destroy()

      // Wait longer than timeout
      await wait(15)

      // Should not have emitted anything
      expect(emittedSequences).toEqual([])
    })
  })

  describe("Terminal Capability Responses", () => {
    it("should handle complete DECRPM response", () => {
      processInput("\x1b[?1016;2$y")
      expect(emittedSequences).toEqual(["\x1b[?1016;2$y"])
    })

    it("should handle split DECRPM response", () => {
      processInput("\x1b[?10")
      processInput("16;2$y")
      expect(emittedSequences).toEqual(["\x1b[?1016;2$y"])
    })

    it("should handle CPR (Cursor Position Report) for width detection", () => {
      processInput("\x1b[1;2R")
      expect(emittedSequences).toEqual(["\x1b[1;2R"])
    })

    it("should handle CPR for scaled text detection", () => {
      processInput("\x1b[1;3R")
      expect(emittedSequences).toEqual(["\x1b[1;3R"])
    })

    it("should handle complete XTVersion response", () => {
      processInput("\x1bP>|kitty(0.40.1)\x1b\\")
      expect(emittedSequences).toEqual(["\x1bP>|kitty(0.40.1)\x1b\\"])
    })

    it("should handle split XTVersion response", () => {
      processInput("\x1bP>|kit")
      expect(emittedSequences).toEqual([])
      expect(buffer.getBuffer()).toBe("\x1bP>|kit")

      processInput("ty(0.40")
      expect(emittedSequences).toEqual([])
      expect(buffer.getBuffer()).toBe("\x1bP>|kitty(0.40")

      processInput(".1)\x1b\\")
      expect(emittedSequences).toEqual(["\x1bP>|kitty(0.40.1)\x1b\\"])
      expect(buffer.getBuffer()).toBe("")
    })

    it("should handle Ghostty XTVersion response split", () => {
      processInput("\x1bP>|gho")
      processInput("stty 1.1.3")
      processInput("\x1b\\")
      expect(emittedSequences).toEqual(["\x1bP>|ghostty 1.1.3\x1b\\"])
    })

    it("should handle tmux XTVersion response", () => {
      processInput("\x1bP>|tmux 3.5a\x1b\\")
      expect(emittedSequences).toEqual(["\x1bP>|tmux 3.5a\x1b\\"])
    })

    it("should handle complete Kitty graphics response", () => {
      processInput("\x1b_Gi=1;OK\x1b\\")
      expect(emittedSequences).toEqual(["\x1b_Gi=1;OK\x1b\\"])
    })

    it("should handle split Kitty graphics response", () => {
      processInput("\x1b_Gi=1;")
      expect(emittedSequences).toEqual([])
      expect(buffer.getBuffer()).toBe("\x1b_Gi=1;")

      processInput("EINVAL:Zero width")
      expect(emittedSequences).toEqual([])

      processInput("/height not allowed\x1b\\")
      expect(emittedSequences).toEqual(["\x1b_Gi=1;EINVAL:Zero width/height not allowed\x1b\\"])
    })

    it("should handle DA1 (Device Attributes) response", () => {
      processInput("\x1b[?62;c")
      expect(emittedSequences).toEqual(["\x1b[?62;c"])
    })

    it("should handle DA1 with multiple attributes", () => {
      processInput("\x1b[?62;22c")
      expect(emittedSequences).toEqual(["\x1b[?62;22c"])
    })

    it("should handle DA1 with sixel capability", () => {
      processInput("\x1b[?1;2;4c")
      expect(emittedSequences).toEqual(["\x1b[?1;2;4c"])
    })

    it("should handle pixel resolution response", () => {
      processInput("\x1b[4;720;1280t")
      expect(emittedSequences).toEqual(["\x1b[4;720;1280t"])
    })

    it("should handle split pixel resolution response", () => {
      processInput("\x1b[4;72")
      processInput("0;1280t")
      expect(emittedSequences).toEqual(["\x1b[4;720;1280t"])
    })

    it("should handle multiple DECRPM responses in sequence", () => {
      processInput("\x1b[?1016;2$y\x1b[?2027;0$y\x1b[?2031;2$y")
      expect(emittedSequences).toEqual(["\x1b[?1016;2$y", "\x1b[?2027;0$y", "\x1b[?2031;2$y"])
    })

    it("should handle kitty full capability response arriving in chunks", () => {
      // Simulate kitty's full response arriving in multiple chunks
      processInput("\x1b[?1016;2$y\x1b[?20")
      expect(emittedSequences).toEqual(["\x1b[?1016;2$y"])
      expect(buffer.getBuffer()).toBe("\x1b[?20")

      processInput("27;0$y\x1b[?2031;2$y\x1bP>|kit")
      expect(emittedSequences).toEqual(["\x1b[?1016;2$y", "\x1b[?2027;0$y", "\x1b[?2031;2$y"])
      expect(buffer.getBuffer()).toBe("\x1bP>|kit")

      processInput("ty(0.40.1)\x1b\\")
      expect(emittedSequences).toEqual([
        "\x1b[?1016;2$y",
        "\x1b[?2027;0$y",
        "\x1b[?2031;2$y",
        "\x1bP>|kitty(0.40.1)\x1b\\",
      ])
    })

    it("should handle capability response mixed with user input", () => {
      processInput("\x1b[?1016;2$yh")
      expect(emittedSequences).toEqual(["\x1b[?1016;2$y", "h"])
    })

    it("should handle user keypress during capability response", () => {
      processInput("\x1bP>|kit")
      expect(buffer.getBuffer()).toBe("\x1bP>|kit")

      processInput("ty(0.40.1)\x1b\\a")
      expect(emittedSequences).toEqual(["\x1bP>|kitty(0.40.1)\x1b\\", "a"])
    })

    it("should handle extremely split XTVersion", () => {
      // Each character arrives separately
      processInput("\x1b")
      processInput("P")
      processInput(">")
      processInput("|")
      processInput("k")
      processInput("i")
      processInput("t")
      processInput("t")
      processInput("y")
      processInput("(")
      processInput("0")
      processInput(".")
      processInput("4")
      processInput("0")
      processInput(".")
      processInput("1")
      processInput(")")
      processInput("\x1b")
      processInput("\\")

      expect(emittedSequences).toEqual(["\x1bP>|kitty(0.40.1)\x1b\\"])
    })
  })
})
