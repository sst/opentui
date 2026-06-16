import { afterEach, expect, test } from "bun:test"
import { StyledText, link } from "../lib/styled-text.js"
import { TextRenderable } from "../renderables/Text.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"

let renderer: TestRenderer | null = null

afterEach(() => {
  renderer?.destroy()
  renderer = null
})

async function captureLink(
  config: Parameters<typeof createTestRenderer>[0] = {},
): Promise<{ url: string } | undefined> {
  const setup = await createTestRenderer(config)
  renderer = setup.renderer

  const text = new TextRenderable(renderer, { content: "" })
  const textBuffer = (text as any).textBuffer
  const originalSetStyledText = textBuffer.lib.textBufferSetStyledText.bind(textBuffer.lib)
  let capturedLink: { url: string } | undefined

  textBuffer.lib.textBufferSetStyledText = (_bufferPtr: unknown, chunks: Array<{ link?: { url: string } }>) => {
    capturedLink = chunks[0]?.link
  }

  try {
    text.content = new StyledText([link("file:///tmp/script.sh")("script.sh")])
  } finally {
    textBuffer.lib.textBufferSetStyledText = originalSetStyledText
  }

  return capturedLink
}

test("renderer default link scheme allowlist strips file hyperlinks before native packing", async () => {
  expect(await captureLink()).toBeUndefined()
})

test("renderer allowedLinkSchemes opt-in preserves file hyperlinks before native packing", async () => {
  expect(
    await captureLink({
      allowedLinkSchemes: ["http://", "https://", "mailto:", "file://"],
    }),
  ).toEqual({ url: "file:///tmp/script.sh" })
})
