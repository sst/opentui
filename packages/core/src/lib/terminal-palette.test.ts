import { test, expect } from "bun:test"
import { TerminalPalette } from "./terminal-palette"
import { EventEmitter } from "events"
import { Buffer } from "node:buffer"

class MockStream extends EventEmitter {
  isTTY = true
  isRaw = false
  isPaused() {
    return false
  }
  write(_data: string) {
    return true
  }
}

test("TerminalPalette detectOSCSupport returns true on response", async () => {
  const stdin = new MockStream() as any
  const stdout = new MockStream() as any

  const palette = new TerminalPalette(stdin, stdout)

  const detectPromise = palette.detectOSCSupport(500)

  // Emit immediately - will be picked up in first 10ms check cycle
  stdin.emit("data", Buffer.from("\x1b]4;0;#ff0000\x07"))

  const result = await detectPromise

  expect(result).toBe(true)
})

test("TerminalPalette detectOSCSupport returns false on timeout", async () => {
  const stdin = new MockStream() as any
  const stdout = new MockStream() as any

  const palette = new TerminalPalette(stdin, stdout)

  const result = await palette.detectOSCSupport(100)

  expect(result).toBe(false)
})

test("TerminalPalette parses OSC 4 hex format correctly", async () => {
  const stdin = new MockStream() as any
  const stdout = new MockStream() as any

  const palette = new TerminalPalette(stdin, stdout)

  const detectPromise = palette.detect(2000)

  // Emit OSC detection response immediately
  stdin.emit("data", Buffer.from("\x1b]4;0;#000000\x07"))
  
  // Then emit palette responses after OSC detection completes (~350ms)
  setTimeout(() => {
    for (let i = 0; i < 256; i++) {
      const color = i === 0 ? "#ff00aa" : i === 1 ? "#00ff00" : i === 2 ? "#0000ff" : "#000000"
      stdin.emit("data", Buffer.from(`\x1b]4;${i};${color}\x07`))
    }
  }, 400)

  const result = await detectPromise

  expect(result[0]).toBe("#ff00aa")
  expect(result[1]).toBe("#00ff00")
  expect(result[2]).toBe("#0000ff")
})

test("TerminalPalette parses OSC 4 rgb format with 4 hex digits", async () => {
  const stdin = new MockStream() as any
  const stdout = new MockStream() as any

  const palette = new TerminalPalette(stdin, stdout)

  const detectPromise = palette.detect(2000)

  stdin.emit("data", Buffer.from("\x1b]4;0;#000000\x07"))
  
  setTimeout(() => {
    stdin.emit("data", Buffer.from("\x1b]4;0;rgb:ffff/0000/aaaa\x07"))
    for (let i = 1; i < 256; i++) {
      stdin.emit("data", Buffer.from(`\x1b]4;${i};#000000\x07`))
    }
  }, 400)

  const result = await detectPromise

  expect(result[0]).toMatch(/^#[0-9a-f]{6}$/)
  expect(result[0]).toBe("#ff00aa")
})

test("TerminalPalette parses OSC 4 rgb format with 2 hex digits", async () => {
  const stdin = new MockStream() as any
  const stdout = new MockStream() as any

  const palette = new TerminalPalette(stdin, stdout)

  const detectPromise = palette.detect(2000)

  stdin.emit("data", Buffer.from("\x1b]4;0;#000000\x07"))
  
  setTimeout(() => {
    stdin.emit("data", Buffer.from("\x1b]4;0;rgb:ff/00/aa\x07"))
    for (let i = 1; i < 256; i++) {
      stdin.emit("data", Buffer.from(`\x1b]4;${i};#000000\x07`))
    }
  }, 400)

  const result = await detectPromise

  expect(result[0]).toMatch(/^#[0-9a-f]{6}$/)
  expect(result[0]).toBe("#ff00aa")
})

test("TerminalPalette handles multiple color responses in single buffer", async () => {
  const stdin = new MockStream() as any
  const stdout = new MockStream() as any

  const palette = new TerminalPalette(stdin, stdout)

  const detectPromise = palette.detect(2000)

  stdin.emit("data", Buffer.from("\x1b]4;0;#000000\x07"))
  
  setTimeout(() => {
    stdin.emit(
      "data",
      Buffer.from(
        "\x1b]4;0;rgb:0000/0000/0000\x07" +
          "\x1b]4;1;rgb:aa00/0000/0000\x07" +
          "\x1b]4;2;rgb:0000/aa00/0000\x07" +
          "\x1b]4;3;rgb:aa00/aa00/0000\x07",
      ),
    )
    
    for (let i = 4; i < 256; i++) {
      stdin.emit("data", Buffer.from(`\x1b]4;${i};#000000\x07`))
    }
  }, 400)

  const result = await detectPromise

  expect(result[0]).toBe("#000000")
  expect(result[1]).toBe("#a90000")
  expect(result[2]).toBe("#00a900")
  expect(result[3]).toBe("#a9a900")
})

test("TerminalPalette handles BEL terminator", async () => {
  const stdin = new MockStream() as any
  const stdout = new MockStream() as any

  const palette = new TerminalPalette(stdin, stdout)

  const detectPromise = palette.detect(2000)

  stdin.emit("data", Buffer.from("\x1b]4;0;#000000\x07"))
  
  setTimeout(() => {
    stdin.emit("data", Buffer.from("\x1b]4;0;#ff0000\x07"))
    for (let i = 1; i < 256; i++) {
      stdin.emit("data", Buffer.from(`\x1b]4;${i};#000000\x07`))
    }
  }, 400)

  const result = await detectPromise

  expect(result[0]).toBe("#ff0000")
})

test("TerminalPalette handles ST terminator", async () => {
  const stdin = new MockStream() as any
  const stdout = new MockStream() as any

  const palette = new TerminalPalette(stdin, stdout)

  const detectPromise = palette.detect(2000)

  stdin.emit("data", Buffer.from("\x1b]4;0;#000000\x07"))
  
  setTimeout(() => {
    stdin.emit("data", Buffer.from("\x1b]4;0;#00ff00\x1b\\"))
    for (let i = 1; i < 256; i++) {
      stdin.emit("data", Buffer.from(`\x1b]4;${i};#000000\x07`))
    }
  }, 400)

  const result = await detectPromise

  expect(result[0]).toBe("#00ff00")
})

test("TerminalPalette scales color components correctly", async () => {
  const stdin = new MockStream() as any
  const stdout = new MockStream() as any

  const palette = new TerminalPalette(stdin, stdout)

  const detectPromise = palette.detect(2000)

  stdin.emit("data", Buffer.from("\x1b]4;0;#000000\x07"))
  
  setTimeout(() => {
    stdin.emit("data", Buffer.from("\x1b]4;0;rgb:ffff/0000/0000\x07"))
    for (let i = 1; i < 256; i++) {
      stdin.emit("data", Buffer.from(`\x1b]4;${i};#000000\x07`))
    }
  }, 400)

  const result = await detectPromise

  expect(result[0]).toBe("#ff0000")
})

test("TerminalPalette returns null for colors that don't respond", async () => {
  const stdin = new MockStream() as any
  const stdout = new MockStream() as any

  const palette = new TerminalPalette(stdin, stdout)

  const detectPromise = palette.detect(1000)

  stdin.emit("data", Buffer.from("\x1b]4;0;#000000\x07"))
  
  setTimeout(() => {
    // Only respond to first color
    stdin.emit("data", Buffer.from("\x1b]4;0;#ff0000\x07"))
  }, 400)

  const result = await detectPromise

  expect(result[0]).toBe("#ff0000")
  expect(result.some((color: string | null) => color === null)).toBe(true)
})
