import { CliRenderer, type CliRendererConfig } from "../renderer"
import { resolveRenderLib } from "../zig"
import { createMockKeys } from "./mock-keys"

export async function createTestRenderer(
  options: CliRendererConfig,
): Promise<{ renderer: CliRenderer; mockInput: ReturnType<typeof createMockKeys> }> {
  const renderer = await setupTestRenderer({
    ...options,
    useAlternateScreen: false,
    useConsole: false,
  })

  //@ts-expect-error - this is a test renderer
  renderer.renderNative = function () {}

  const mockInput = createMockKeys(renderer)
  return { renderer, mockInput }
}

async function setupTestRenderer(config: CliRendererConfig) {
  const stdin = config.stdin || process.stdin
  const stdout = config.stdout || process.stdout

  const width = stdout.columns || 80
  const height = stdout.rows || 24
  const renderHeight =
    config.experimental_splitHeight && config.experimental_splitHeight > 0 ? config.experimental_splitHeight : height

  const ziglib = resolveRenderLib()
  const rendererPtr = ziglib.createRenderer(width, renderHeight)
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
