import { Readable, Writable } from "stream"
import { CliRenderer, type CliRendererConfig } from "../renderer.js"
import { resolveRenderLib } from "../zig.js"
import { createMockKeys } from "./mock-keys.js"
import { createMockMouse } from "./mock-mouse.js"
import type { CapturedFrame } from "../types.js"

export interface TestRendererOptions extends CliRendererConfig {
  width?: number
  height?: number
  kittyKeyboard?: boolean
  otherModifiersMode?: boolean
}
export interface TestRenderer extends CliRenderer {}
export type MockInput = ReturnType<typeof createMockKeys>
export type MockMouse = ReturnType<typeof createMockMouse>

const decoder = new TextDecoder()

class TestWriteStream extends Writable {
  public readonly isTTY = true
  public readonly columns: number
  public readonly rows: number

  constructor(columns: number, rows: number) {
    super()
    this.columns = columns
    this.rows = rows
  }

  _write(_chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback()
  }

  getColorDepth(): number {
    return 24
  }
}

export async function createTestRenderer(options: TestRendererOptions): Promise<{
  renderer: TestRenderer
  mockInput: MockInput
  mockMouse: MockMouse
  renderOnce: () => Promise<void>
  captureCharFrame: () => string
  captureSpans: () => CapturedFrame
  resize: (width: number, height: number) => void
}> {
  // Convert legacy kittyKeyboard boolean to new format
  const useKittyKeyboard = options.kittyKeyboard ? { events: true } : options.useKittyKeyboard

  const renderer = await setupTestRenderer({
    ...options,
    useKittyKeyboard,
    screenMode: options.screenMode ?? "main-screen",
    footerHeight: options.footerHeight ?? 12,
    consoleMode: options.consoleMode ?? "disabled",
    externalOutputMode: options.externalOutputMode ?? "passthrough",
  })

  const mockInput = createMockKeys(renderer, {
    kittyKeyboard: options.kittyKeyboard,
    otherModifiersMode: options.otherModifiersMode,
  })
  const mockMouse = createMockMouse(renderer)

  const renderOnce = async () => {
    //@ts-expect-error - this is a test renderer
    await renderer.loop()
  }

  return {
    renderer,
    mockInput,
    mockMouse,
    renderOnce,
    captureCharFrame: () => {
      const currentBuffer = renderer.currentRenderBuffer
      const frameBytes = currentBuffer.getRealCharBytes(true)
      return decoder.decode(frameBytes)
    },
    captureSpans: () => {
      const currentBuffer = renderer.currentRenderBuffer
      const lines = currentBuffer.getSpanLines()
      const cursorState = renderer.getCursorState()
      return {
        cols: currentBuffer.width,
        rows: currentBuffer.height,
        cursor: [cursorState.x, cursorState.y] as [number, number],
        lines,
      }
    },
    resize: (width: number, height: number) => {
      //@ts-expect-error - this is a test renderer
      renderer.processResize(width, height)
    },
  }
}

async function setupTestRenderer(config: TestRendererOptions) {
  const stdin = config.stdin || (new Readable({ read() {} }) as NodeJS.ReadStream)
  const width = config.width || config.stdout?.columns || process.stdout.columns || 80
  const height = config.height || config.stdout?.rows || process.stdout.rows || 24
  const stdout = config.stdout || (new TestWriteStream(width, height) as unknown as NodeJS.WriteStream)
  const renderHeight = config.screenMode === "split-footer" ? (config.footerHeight ?? 12) : height

  const ziglib = resolveRenderLib()
  const rendererPtr = ziglib.createRenderer(width, renderHeight, {
    testing: true,
    remote: config.remote ?? false,
  })
  if (!rendererPtr) {
    throw new Error("Failed to create test renderer")
  }
  if (config.useThread === undefined) {
    config.useThread = true
  }

  if (process.platform === "linux") {
    config.useThread = false
  }
  ziglib.setUseThread(rendererPtr, config.useThread)

  const renderer = new CliRenderer(ziglib, rendererPtr, stdin, stdout, width, height, config)

  process.off("SIGWINCH", renderer["sigwinchHandler"])

  // Do not setup the terminal for testing as we will not actually output anything to the terminal
  // await renderer.setupTerminal()

  return renderer
}
