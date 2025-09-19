import { CliRenderer, type CliRendererConfig } from "../renderer"
import { resolveRenderLib } from "../zig"
import { createMockKeys } from "./mock-keys"
import { createMockMouse } from "./mock-mouse"

export interface TestRendererOptions extends CliRendererConfig {
  width?: number
  height?: number
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
}> {
  const renderer = await setupTestRenderer({
    ...options,
    useAlternateScreen: false,
    useConsole: false,
  })

  renderer.disableStdoutInterception()

  const mockInput = createMockKeys(renderer)
  const mockMouse = createMockMouse(renderer)
  return {
    renderer,
    mockInput,
    mockMouse,
    renderOnce: async () => {
      //@ts-expect-error - this is a test renderer
      await renderer.loop()
    },
    captureCharFrame: () => {
      const currentBuffer = renderer.currentRenderBuffer
      const frameBytes = currentBuffer.getRealCharBytes(true)
      return decoder.decode(frameBytes)
    },
  }
}

async function setupTestRenderer(config: TestRendererOptions) {
  const stdin = config.stdin || process.stdin
  const stdout = config.stdout || process.stdout

  const width = config.width || stdout.columns || 80
  const height = config.height || stdout.rows || 24
  const renderHeight =
    config.experimental_splitHeight && config.experimental_splitHeight > 0 ? config.experimental_splitHeight : height

  const ziglib = resolveRenderLib()
  const rendererPtr = ziglib.createRenderer(width, renderHeight, { testing: true })
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

  // Do not setup the terminal for testing as we will not actualy output anything to the terminal
  // await renderer.setupTerminal()

  return renderer
}
