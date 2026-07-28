import { afterEach, describe, expect, it } from "bun:test"
import { ImageRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { testRender } from "../index.js"

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

describe("image component", () => {
  it("creates an ImageRenderable and loads encoded bytes", async () => {
    let imageRef: ImageRenderable | undefined
    const loaded: string[] = []

    testSetup = await testRender(
      () => (
        <image
          ref={imageRef}
          source={PNG_1X1}
          onLoad={(info) => loaded.push(info.format)}
          style={{ width: 4, height: 2 }}
        />
      ),
      { width: 10, height: 6 },
    )
    await testSetup.renderOnce()

    expect(imageRef).toBeInstanceOf(ImageRenderable)
    await imageRef!.loadPromise
    expect(loaded).toEqual(["png"])
    expect(imageRef!.imageInfo?.width).toBe(1)
    expect(imageRef!.loadError).toBeNull()
  })

  it("replaces and clears the image when the source prop changes reactively", async () => {
    let imageRef: ImageRenderable | undefined
    const [source, setSource] = createSignal<Uint8Array | undefined>(PNG_1X1)

    testSetup = await testRender(
      () => <image ref={imageRef} source={source()} protocol="blocks" width={2} height={1} />,
      {
        width: 4,
        height: 2,
      },
    )
    await imageRef!.loadPromise
    await testSetup.renderOnce()
    expect(imageRef!.imageInfo?.format).toBe("png")
    expect(testSetup.captureCharFrame()).toContain("█")

    setSource(PNG_1X1.slice())
    await imageRef!.loadPromise
    await testSetup.renderOnce()
    expect(imageRef!.imageInfo?.format).toBe("png")
    expect(testSetup.captureCharFrame()).toContain("█")

    setSource(undefined)
    await testSetup.renderOnce()
    expect(imageRef!.imageInfo).toBeNull()
    expect(testSetup.captureCharFrame()).not.toContain("█")
  })
})
