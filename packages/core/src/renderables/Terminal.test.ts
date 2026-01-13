import { test, expect, beforeEach, afterEach } from "bun:test"
import { StatelessTerminalRenderable } from "./Terminal"
import { createTestRenderer, type TestRenderer } from "../testing"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 80, height: 24 })
  currentRenderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
})

afterEach(async () => {
  if (currentRenderer) {
    currentRenderer.destroy()
  }
})

test("StatelessTerminalRenderable - basic construction", async () => {
  const terminal = new StatelessTerminalRenderable(currentRenderer, {
    id: "test-stateless-terminal",
    ansi: "Hello, World!",
    cols: 80,
    rows: 24,
  })

  expect(terminal.cols).toBe(80)
  expect(terminal.rows).toBe(24)

  currentRenderer.root.add(terminal)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toContain("Hello, World!")
})

test("StatelessTerminalRenderable - ANSI colored text", async () => {
  const terminal = new StatelessTerminalRenderable(currentRenderer, {
    id: "test-stateless-terminal",
    ansi: "\x1b[31mRed\x1b[0m \x1b[32mGreen\x1b[0m",
    cols: 80,
    rows: 24,
  })

  currentRenderer.root.add(terminal)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toContain("Red")
  expect(frame).toContain("Green")
})

// Large input tests

function generateLargeAnsi(lineCount: number, lineLength: number = 80): string {
  const colors = [31, 32, 33, 34, 35, 36, 37]
  let result = ""
  for (let i = 0; i < lineCount; i++) {
    const color = colors[i % colors.length]
    const text = `Line ${i}: ${"x".repeat(lineLength - 10)}`
    result += `\x1b[${color}m${text}\x1b[0m\n`
  }
  return result
}

function generateComplexAnsi(size: number): string {
  let result = ""
  const styles = [
    "\x1b[1m", // bold
    "\x1b[2m", // dim
    "\x1b[3m", // italic
    "\x1b[4m", // underline
    "\x1b[7m", // inverse
    "\x1b[9m", // strikethrough
    "\x1b[31m", // red
    "\x1b[32m", // green
    "\x1b[33m", // yellow
    "\x1b[34m", // blue
    "\x1b[38;5;208m", // 256 color
    "\x1b[38;2;255;105;180m", // RGB color
  ]

  let currentSize = 0
  let lineNum = 0
  while (currentSize < size) {
    const style = styles[lineNum % styles.length]
    const line = `${style}Line ${lineNum}: Some text content here\x1b[0m\n`
    result += line
    currentSize += line.length
    lineNum++
  }
  return result
}

test("StatelessTerminalRenderable - large input 1000 lines", async () => {
  const largeAnsi = generateLargeAnsi(1000)

  const terminal = new StatelessTerminalRenderable(currentRenderer, {
    id: "test-stateless-large",
    ansi: largeAnsi,
    cols: 120,
    rows: 50,
  })

  currentRenderer.root.add(terminal)
  await renderOnce()

  const frame = captureFrame()
  expect(frame.length).toBeGreaterThan(0)
})

test("StatelessTerminalRenderable - large input 200KB", async () => {
  const largeAnsi = generateComplexAnsi(200 * 1024)

  const terminal = new StatelessTerminalRenderable(currentRenderer, {
    id: "test-stateless-200kb",
    ansi: largeAnsi,
    cols: 120,
    rows: 50,
  })

  currentRenderer.root.add(terminal)
  await renderOnce()

  const frame = captureFrame()
  expect(frame.length).toBeGreaterThan(0)
})

test("StatelessTerminalRenderable - rapid ansi updates with microtasks", async () => {
  const terminal = new StatelessTerminalRenderable(currentRenderer, {
    id: "test-stateless-async",
    ansi: "Initial",
    cols: 80,
    rows: 24,
  })

  currentRenderer.root.add(terminal)

  // Rapidly update ansi with microtask breaks
  for (let i = 0; i < 100; i++) {
    terminal.ansi = generateLargeAnsi(50)
    await renderOnce()
    await Promise.resolve() // Force microtask break
  }

  expect(true).toBe(true)
})

test("StatelessTerminalRenderable - stress test rapid creation", async () => {
  const terminals: StatelessTerminalRenderable[] = []

  for (let i = 0; i < 30; i++) {
    const terminal = new StatelessTerminalRenderable(currentRenderer, {
      id: `test-stateless-stress-${i}`,
      ansi: generateLargeAnsi(100),
      cols: 80,
      rows: 24,
    })
    terminals.push(terminal)
    currentRenderer.root.add(terminal)
  }

  await renderOnce()

  // Access all terminals
  for (const terminal of terminals) {
    await Promise.resolve()
  }

  // Destroy all
  for (let i = 0; i < terminals.length; i++) {
    currentRenderer.root.remove(`test-stateless-stress-${i}`)
  }

  await Promise.resolve()
  expect(true).toBe(true)
})

test("StatelessTerminalRenderable - update cols and rows", async () => {
  const terminal = new StatelessTerminalRenderable(currentRenderer, {
    id: "test-stateless-resize",
    ansi: "Hello",
    cols: 80,
    rows: 24,
  })

  currentRenderer.root.add(terminal)
  await renderOnce()

  terminal.cols = 120
  terminal.rows = 40
  await renderOnce()

  expect(terminal.cols).toBe(120)
  expect(terminal.rows).toBe(40)
})

test("StatelessTerminalRenderable - trimEnd option", async () => {
  const terminal = new StatelessTerminalRenderable(currentRenderer, {
    id: "test-stateless-trim",
    ansi: "Hello\n\n\n",
    cols: 80,
    rows: 24,
    trimEnd: true,
  })

  currentRenderer.root.add(terminal)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toContain("Hello")
})

test("StatelessTerminalRenderable - special escape sequences", async () => {
  // Various special sequences
  const ansi =
    `\x1b[2J\x1b[H` + // Clear screen and home
    `\x1b[5;10HPosition 5,10` + // Move to row 5, col 10
    `\x1b[31mRed text\x1b[0m` +
    `\x1b[1;4mBold underline\x1b[0m`

  const terminal = new StatelessTerminalRenderable(currentRenderer, {
    id: "test-stateless-sequences",
    ansi,
    cols: 80,
    rows: 24,
  })

  currentRenderer.root.add(terminal)
  await renderOnce()

  const frame = captureFrame()
  expect(frame).toContain("Position")
})

test("StatelessTerminalRenderable - getScrollPositionForLine", async () => {
  const largeAnsi = generateLargeAnsi(100)

  const terminal = new StatelessTerminalRenderable(currentRenderer, {
    id: "test-stateless-scroll",
    ansi: largeAnsi,
    cols: 80,
    rows: 24,
  })

  currentRenderer.root.add(terminal)
  await renderOnce()

  const scrollPos = terminal.getScrollPositionForLine(50)
  expect(typeof scrollPos).toBe("number")
})
