import { Readable } from "stream"
import { CliRenderer, type CliRendererConfig } from "../renderer"
import { resolveRenderLib } from "../zig"
import { createMockKeys } from "./mock-keys"
import { createMockMouse } from "./mock-mouse"
import type { CapturedFrame } from "../types"

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

export async function createTestRenderer(options: TestRendererOptions): Promise<{
  renderer: TestRenderer
  mockInput: MockInput
  mockMouse: MockMouse
  renderOnce: () => Promise<void>
  captureCharFrame: () => string
  captureSpans: () => CapturedFrame
  resize: (width: number, height: number) => void
}> {
  process.env.OTUI_USE_CONSOLE = "false"

  // Convert legacy kittyKeyboard boolean to new format
  const useKittyKeyboard = options.kittyKeyboard ? { events: true } : options.useKittyKeyboard

  const renderer = await setupTestRenderer({
    ...options,
    useKittyKeyboard,
    useAlternateScreen: false,
    useConsole: false,
  })

  renderer.disableStdoutInterception()

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
  const stdout = config.stdout || process.stdout

  const width = config.width || stdout.columns || 80
  const height = config.height || stdout.rows || 24
  const renderHeight =
    config.experimental_splitHeight && config.experimental_splitHeight > 0 ? config.experimental_splitHeight : height

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
