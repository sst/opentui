import { test, expect, describe } from "bun:test"
import { Readable } from "node:stream"
import { createCliRenderer } from "../renderer"
import tty from "tty"

const MOUSE_ENABLE_SEQUENCES = [
  "\x1b[?1000h",
  "\x1b[?1002h",
  "\x1b[?1003h",
  "\x1b[?1006h",
]

function createMockStreams() {
  const mockStdin = new Readable({ read() {} }) as tty.ReadStream
  mockStdin.isTTY = true
  mockStdin.setRawMode = () => mockStdin
  mockStdin.resume = () => mockStdin
  mockStdin.pause = () => mockStdin
  mockStdin.setEncoding = () => mockStdin

  const writes: string[] = []
  const mockStdout = {
    isTTY: true,
    columns: 80,
    rows: 24,
    write: (data: string | Buffer) => {
      writes.push(data.toString())
      return true
    },
  } as any

  return { mockStdin, mockStdout, writes }
}

describe("useMouse configuration", () => {
  test("useMouse: true sets renderer.useMouse to true", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const renderer = await createCliRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
      useMouse: true,
      exitOnCtrlC: false,
      useAlternateScreen: false,
    })

    expect(renderer.useMouse).toBe(true)
    renderer.destroy()
  })

  test("useMouse: false disables mouse tracking", async () => {
    const { mockStdin, mockStdout, writes } = createMockStreams()

    const renderer = await createCliRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
      useMouse: false,
      exitOnCtrlC: false,
      useAlternateScreen: false,
    })

    expect(renderer.useMouse).toBe(false)

    const allOutput = writes.join("")
    for (const seq of MOUSE_ENABLE_SEQUENCES) {
      expect(allOutput.includes(seq)).toBe(false)
    }

    renderer.destroy()
  })

  test("toggling useMouse property updates renderer state", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const renderer = await createCliRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
      useMouse: false,
      exitOnCtrlC: false,
      useAlternateScreen: false,
    })

    expect(renderer.useMouse).toBe(false)

    renderer.useMouse = true
    expect(renderer.useMouse).toBe(true)

    renderer.useMouse = false
    expect(renderer.useMouse).toBe(false)

    renderer.destroy()
  })
})
