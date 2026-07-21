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
          onLoad={(image) => loaded.push(image.info().format)}
          style={{ width: 4, height: 2 }}
        />
      ),
      { width: 10, height: 6 },
    )
    await testSetup.renderOnce()

    expect(imageRef).toBeInstanceOf(ImageRenderable)
    await imageRef!.loadPromise
    expect(loaded).toEqual(["png"])
    expect(imageRef!.image?.width).toBe(1)
    expect(imageRef!.loadError).toBeNull()
  })

  it("reloads when the source prop changes reactively", async () => {
    let imageRef: ImageRenderable | undefined
    const [source, setSource] = createSignal<Uint8Array | undefined>(undefined)

    testSetup = await testRender(() => <image ref={imageRef} source={source()} style={{ width: 4, height: 2 }} />, {
      width: 10,
      height: 6,
    })
    await testSetup.renderOnce()
    expect(imageRef!.image).toBeNull()

    setSource(PNG_1X1)
    await testSetup.renderOnce()
    await imageRef!.loadPromise
    expect(imageRef!.image?.info().format).toBe("png")
  })
})
