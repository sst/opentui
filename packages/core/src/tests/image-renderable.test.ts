import { createServer, type Server } from "node:http"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { ImageRenderable } from "../renderables/Image.js"
import { TextRenderable } from "../renderables/Text.js"
import { createTestRenderer, type TestRenderer, type TestRendererSetup } from "../testing/test-renderer.js"
import { setRendererCapabilities } from "../testing/terminal-capabilities.js"

const FIXTURES = new URL("./fixtures/images/", import.meta.url)

describe("ImageRenderable image loading", () => {
  let setup: TestRendererSetup
  let renderer: TestRenderer

  beforeEach(async () => {
    setup = await createTestRenderer({})
    renderer = setup.renderer
  })

  afterEach(() => {
    renderer.destroy()
  })

  test("loads encoded bytes, retains the image, and requests a render", async () => {
    const requestRender = mock(() => {})
    renderer.requestRender = requestRender
    const onLoad = mock(() => {})
    const renderable = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
      onLoad,
    })
    await renderable.loadPromise
    try {
      expect(renderable.loading).toBe(false)
      expect(renderable.loadError).toBeNull()
      expect(renderable.image?.info().format).toBe("png")
      expect(onLoad).toHaveBeenCalledTimes(1)
      expect(requestRender).toHaveBeenCalledTimes(1)
    } finally {
      renderable.destroy()
    }
  })

  test("defaults to aspect-preserving fit", async () => {
    const renderable = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
    })
    await renderable.loadPromise
    try {
      expect(renderable.fit).toBe("fit")
      expect(renderable.getFittedSize(60, 40, 2)).toEqual({ width: 60, height: 30 })
    } finally {
      renderable.destroy()
    }
  })

  test("calculates fit, cover, and fill using terminal cell aspect", async () => {
    const renderable = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
      fit: "cover",
    })
    await renderable.loadPromise
    try {
      expect(renderable.getFittedSize(60, 40, 2)).toEqual({ width: 80, height: 40 })
      renderable.fit = "fill"
      expect(renderable.getFittedSize(60, 40, 2)).toEqual({ width: 60, height: 40 })
    } finally {
      renderable.destroy()
    }
  })

  test("clears a buffered image from rendered output when its source is cleared", async () => {
    const renderable = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
      buffered: true,
      protocol: "blocks",
      position: "absolute",
      width: 2,
      height: 1,
    })
    renderer.root.add(renderable)
    await renderable.loadPromise
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("█")

    renderable.source = undefined
    await setup.renderOnce()

    expect(setup.captureCharFrame()).not.toContain("█")
  })

  test("clears the previous buffered image placement before rerendering", async () => {
    const renderable = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
      buffered: true,
      protocol: "blocks",
      fit: "fill",
      position: "absolute",
      width: 4,
      height: 4,
    })
    renderer.root.add(renderable)
    await renderable.loadPromise
    await setup.renderOnce()
    expect(setup.captureCharFrame().split("\n", 1)[0].slice(0, 4)).toBe("████")

    renderable.fit = "fit"
    await setup.renderOnce()

    const lines = setup.captureCharFrame().split("\n")
    expect(lines[0].slice(0, 4)).toBe("    ")
    expect(lines[1].slice(0, 4)).toBe("████")
    expect(lines[3].slice(0, 4)).toBe("    ")
  })

  test("preserves lower content beneath a zero-opacity image", async () => {
    const text = new TextRenderable(renderer, {
      content: "OK",
      position: "absolute",
      width: 2,
      height: 1,
    })
    const image = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
      protocol: "blocks",
      opacity: 0,
      position: "absolute",
      width: 2,
      height: 1,
    })
    renderer.root.add(text)
    renderer.root.add(image)
    await image.loadPromise
    await setup.renderOnce()

    expect(setup.captureCharFrame().split("\n", 1)[0].slice(0, 2)).toBe("OK")
  })

  test("exposes requested and effective image protocols", async () => {
    const renderable = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
      protocol: "blocks",
    })
    await renderable.loadPromise
    try {
      expect(renderable.protocol).toBe("blocks")
      expect(renderable.effectiveProtocol).toBe("blocks")
      renderable.protocol = "kitty"
      expect(renderable.effectiveProtocol).toBe("kitty")
      renderable.protocol = "auto"
      expect(renderable.effectiveProtocol).toBe("blocks")
    } finally {
      renderable.destroy()
    }
  })

  test("resolves auto from environment default then detected capabilities", async () => {
    const renderable = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
    })
    await renderable.loadPromise
    try {
      setRendererCapabilities(renderer, { image_protocol: "sixel" })
      expect(renderable.effectiveProtocol).toBe("blocks")
      setRendererCapabilities(renderer, { image_protocol: "auto", kitty_graphics: true })
      expect(renderable.effectiveProtocol).toBe("kitty")
      setRendererCapabilities(renderer, { image_protocol: "auto", sixel: true })
      expect(renderable.effectiveProtocol).toBe("blocks")
      ;(renderer as unknown as { _resolution: { width: number; height: number } | null })._resolution = {
        width: 800,
        height: 480,
      }
      setRendererCapabilities(renderer, { image_protocol: "sixel" })
      expect(renderable.effectiveProtocol).toBe("sixel")
      setRendererCapabilities(renderer, { image_protocol: "auto", sixel: true })
      expect(renderable.effectiveProtocol).toBe("sixel")
      setRendererCapabilities(renderer, { image_protocol: "auto", kitty_graphics: true, multiplexer: "tmux" })
      expect(renderable.effectiveProtocol).toBe("blocks")
    } finally {
      renderable.destroy()
    }
  })

  test("falls back from Sixel when the terminal reports zero pixel resolution", () => {
    const renderable = new ImageRenderable(renderer, { protocol: "sixel" })
    ;(renderer as unknown as { _resolution: { width: number; height: number } | null })._resolution = {
      width: 0,
      height: 0,
    }
    try {
      expect(renderable.effectiveProtocol).toBe("blocks")
    } finally {
      renderable.destroy()
    }
  })

  test("reports decode failures without installing an image", async () => {
    const onError = mock(() => {})
    const renderable = new ImageRenderable(renderer, {
      source: Uint8Array.of(1, 2, 3),
      onError,
    })
    await renderable.loadPromise
    try {
      expect(renderable.loading).toBe(false)
      expect(renderable.image).toBeNull()
      expect(renderable.loadError).toBeDefined()
      expect(onError).toHaveBeenCalledTimes(1)
    } finally {
      renderable.destroy()
    }
  })

  test("propagates callback exceptions through loadPromise after settling state", async () => {
    const loaded = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
      onLoad: () => {
        throw new Error("onLoad failed")
      },
    })
    await expect(loaded.loadPromise!).rejects.toThrow("onLoad failed")
    expect(loaded.loading).toBe(false)
    expect(loaded.image).not.toBeNull()
    loaded.destroy()

    const failed = new ImageRenderable(renderer, {
      source: Uint8Array.of(1, 2, 3),
      onError: () => {
        throw new Error("onError failed")
      },
    })
    await expect(failed.loadPromise!).rejects.toThrow("onError failed")
    expect(failed.loading).toBe(false)
    expect(failed.loadError).toBeDefined()
    failed.destroy()
  })

  test("loads local paths and file URLs through the same native decoder", async () => {
    const url = new URL("lossless.webp", FIXTURES)
    const renderable = new ImageRenderable(renderer, { source: fileURLToPath(url) })
    await renderable.loadPromise
    expect(renderable.image?.info().format).toBe("webp")
    renderable.source = url
    await renderable.loadPromise
    try {
      expect(renderable.image?.info().format).toBe("webp")
    } finally {
      renderable.destroy()
    }
  })

  test("replaces images atomically and disposes the previous image", async () => {
    const renderable = new ImageRenderable(renderer, { source: await readFile(new URL("rgba.png", FIXTURES)) })
    await renderable.loadPromise
    const previous = renderable.image
    renderable.source = await readFile(new URL("transparent.gif", FIXTURES))
    expect(renderable.image).toBe(previous)
    await renderable.loadPromise
    try {
      expect(renderable.image?.info().format).toBe("gif")
      expect(() => previous?.raw()).toThrow("disposed")
    } finally {
      renderable.destroy()
    }
  })

  test("keeps the previous image when a replacement fails", async () => {
    const onError = mock(() => {})
    const renderable = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
      onError,
    })
    await renderable.loadPromise
    const previous = renderable.image
    renderable.source = Uint8Array.of(1, 2, 3)
    await renderable.loadPromise
    try {
      expect(renderable.image).toBe(previous)
      expect(previous?.raw().data.byteLength).toBeGreaterThan(0)
      expect(onError).toHaveBeenCalledTimes(1)
    } finally {
      renderable.destroy()
    }
  })

  test("clearing the source aborts loading and disposes the retained image", async () => {
    const renderable = new ImageRenderable(renderer, { source: await readFile(new URL("rgba.png", FIXTURES)) })
    await renderable.loadPromise
    const previous = renderable.image
    renderable.source = undefined
    try {
      expect(renderable.image).toBeNull()
      expect(renderable.loading).toBe(false)
      expect(() => previous?.raw()).toThrow("disposed")
    } finally {
      renderable.destroy()
    }
  })

  test("a newer source wins when an older request completes later", async () => {
    const png = await readFile(new URL("rgba.png", FIXTURES))
    const gif = await readFile(new URL("transparent.gif", FIXTURES))
    let server: Server | undefined
    server = createServer((request, response) => {
      if (request.url === "/slow") {
        setTimeout(() => response.end(png), 50)
      } else {
        response.end(gif)
      }
    })
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("missing test server address")
    const base = `http://127.0.0.1:${address.port}`
    const onError = mock(() => {})
    const renderable = new ImageRenderable(renderer, { source: `${base}/slow`, onError })
    renderable.source = `${base}/fast`
    await renderable.loadPromise
    await new Promise((resolve) => setTimeout(resolve, 75))
    try {
      expect(renderable.image?.info().format).toBe("gif")
      expect(onError).not.toHaveBeenCalled()
    } finally {
      renderable.destroy()
      await new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve())))
    }
  })

  test("destroy aborts an in-flight load and prevents callbacks", async () => {
    const png = await readFile(new URL("rgba.png", FIXTURES))
    const server = createServer((_request, response) => setTimeout(() => response.end(png), 50))
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("missing test server address")
    const onLoad = mock(() => {})
    const onError = mock(() => {})
    const renderable = new ImageRenderable(renderer, {
      source: `http://127.0.0.1:${address.port}/slow`,
      onLoad,
      onError,
    })
    renderable.destroy()
    await renderable.loadPromise
    try {
      expect(renderable.image).toBeNull()
      expect(onLoad).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})
