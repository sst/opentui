import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { ImageRenderable, NativeImage } from "@opentui/core"
import { act, useState } from "react"
import { testRender } from "../src/test-utils.js"

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==",
    "base64",
  ),
)

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined
let consoleError: ReturnType<typeof spyOn>

beforeEach(() => {
  consoleError = spyOn(console, "error")
})

afterEach(() => {
  try {
    act(() => testSetup?.renderer.destroy())
    expect(consoleError).not.toHaveBeenCalled()
  } finally {
    testSetup = undefined
    consoleError.mockRestore()
  }
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
        onLoad={(info) => loaded.push(info.format)}
        style={{ width: 4, height: 2 }}
      />,
      { width: 10, height: 6 },
    )
    await testSetup.renderOnce()

    expect(imageRef).toBeInstanceOf(ImageRenderable)
    await imageRef!.loadPromise
    expect(loaded).toEqual(["png"])
    expect(imageRef!.imageInfo?.width).toBe(1)
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

  it("clears the image when the source prop is removed", async () => {
    let imageRef: ImageRenderable | null = null
    let setVisible!: (visible: boolean) => void

    function App() {
      const [visible, setImageVisible] = useState(true)
      setVisible = setImageVisible
      return (
        <image
          ref={(renderable: ImageRenderable | null) => {
            imageRef = renderable
          }}
          {...(visible ? { source: PNG_1X1 } : {})}
          protocol="blocks"
          style={{ width: 2, height: 1 }}
        />
      )
    }

    testSetup = await testRender(<App />, { width: 4, height: 2 })
    await imageRef!.loadPromise
    await testSetup.renderOnce()
    expect(testSetup.captureCharFrame()).toContain("█")

    act(() => setVisible(false))
    if (imageRef!.loadPromise) await imageRef!.loadPromise
    await testSetup.renderOnce()

    expect(imageRef!.source).toBeUndefined()
    expect(imageRef!.imageInfo).toBeNull()
    expect(imageRef!.loadError).toBeNull()
    expect(testSetup.captureCharFrame()).not.toContain("█")
  })
})
