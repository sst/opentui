import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test"
import { ImageRenderable, NativeImage } from "@opentui/core"
import { testRender } from "../src/test-utils.js"

let originalConsoleError: (...args: any[]) => void

beforeAll(() => {
  originalConsoleError = console.error
  console.error = mock(() => {})
})

afterAll(() => {
  console.error = originalConsoleError
})

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==",
    "base64",
  ),
)

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

describe("React Renderer | image element", () => {
  it("creates an ImageRenderable and loads encoded bytes", async () => {
    let imageRef: ImageRenderable | null = null
    const loaded: string[] = []

    testSetup = await testRender(
      <image
        ref={(renderable: ImageRenderable | null) => {
          imageRef = renderable
        }}
        source={PNG_1X1}
        onLoad={(image) => loaded.push(image.info().format)}
        style={{ width: 4, height: 2 }}
      />,
      { width: 10, height: 6 },
    )
    await testSetup.renderOnce()

    expect(imageRef).toBeInstanceOf(ImageRenderable)
    await imageRef!.loadPromise
    expect(loaded).toEqual(["png"])
    expect(imageRef!.image?.width).toBe(1)
    expect(imageRef!.loadError).toBeNull()
  })

  it("decodes an initial byte source once", async () => {
    const decode = NativeImage.decode
    let decodeCalls = 0
    NativeImage.decode = (data) => {
      decodeCalls += 1
      return decode(data)
    }

    try {
      let imageRef: ImageRenderable | null = null
      testSetup = await testRender(
        <image
          ref={(renderable: ImageRenderable | null) => {
            imageRef = renderable
          }}
          source={PNG_1X1}
          style={{ width: 4, height: 2 }}
        />,
        { width: 10, height: 6 },
      )
      await testSetup.renderOnce()
      await imageRef!.loadPromise
      expect(decodeCalls).toBe(1)
    } finally {
      NativeImage.decode = decode
    }
  })
})
