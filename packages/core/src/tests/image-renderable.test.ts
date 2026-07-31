import { createServer, type Server } from "node:http"
import { readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { ImageRenderable, resolveImageRenderProtocol } from "../renderables/Image.js"
import { TextRenderable } from "../renderables/Text.js"
import { createTestRenderer, type TestRenderer, type TestRendererSetup } from "../testing/test-renderer.js"
import { createTerminalCapabilities } from "../testing/terminal-capabilities.js"

const FIXTURES = new URL("./fixtures/images/", import.meta.url)

async function within<T>(promise: Promise<T>, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 2_000)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  server.closeAllConnections()
  await closed
}

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

  test("loads encoded bytes and retains the image", async () => {
    const loaded: string[] = []
    const renderable = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
      onLoad: (image) => loaded.push(image.info().format),
    })
    await renderable.loadPromise
    const image = renderable.image!
    try {
      expect(renderable.loading).toBe(false)
      expect(renderable.loadError).toBeNull()
      expect(image.info().format).toBe("png")
      expect(loaded).toEqual(["png"])
    } finally {
      renderable.destroy()
    }
    expect(() => image.info()).toThrow("disposed")
  })

  test("dumps image cells with their fallback glyphs", async () => {
    const timestamp = Date.now()
    const dumpDirectory = resolve("buffer_dump")
    const currentDump = resolve(dumpDirectory, `current_buffer_${timestamp}.txt`)
    const nextDump = resolve(dumpDirectory, `next_buffer_${timestamp}.txt`)
    const outputDump = resolve(dumpDirectory, `output_buffer_${timestamp}.txt`)
    const renderable = new ImageRenderable(renderer, {
      source: await readFile(new URL("rgba.png", FIXTURES)),
      protocol: "kitty",
      width: 1,
      height: 1,
    })
    await renderable.loadPromise

    try {
      expect(renderer.currentRenderBuffer.drawImage(renderable.image!, 0, 0, 1, 1, 0, 0, 0, 0, 2, 2, "kitty")).toBe(
        true,
      )
      const fallback = setup.captureCharFrame().match(/[^\s]/)?.[0]
      expect(fallback).toBeDefined()

      renderer.dumpBuffers(timestamp)

      expect(await readFile(currentDump, "utf8")).toContain(fallback!)
    } finally {
      await Promise.all([currentDump, nextDump, outputDump].map((path) => rm(path, { force: true })))
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

  test("renders the centered source crop for cover", async () => {
    const renderable = new ImageRenderable(renderer, {
      source: await readFile(new URL("orientation.jpg", FIXTURES)),
      fit: "cover",
      protocol: "blocks",
      position: "absolute",
      width: 2,
      height: 2,
    })
    renderer.root.add(renderable)
    await renderable.loadPromise
    await setup.renderOnce()

    const imageSpans = setup.captureSpans().lines[0].spans.filter((span) => span.text === "▀")
    expect(imageSpans).toHaveLength(2)
    const reds = imageSpans.map((span) => span.fg.toInts()[0])
    expect(reds[0]).toBeGreaterThan(64)
    expect(reds[1]).toBeLessThan(192)
    expect(reds[0]).toBeLessThan(reds[1])
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

  test("resolves automatic and configured image protocols", () => {
    expect(resolveImageRenderProtocol("sixel", null, false)).toBe("blocks")
    expect(resolveImageRenderProtocol("auto", createTerminalCapabilities({ image_protocol: "sixel" }), false)).toBe(
      "blocks",
    )
    expect(resolveImageRenderProtocol("auto", createTerminalCapabilities({ kitty_graphics: true }), false)).toBe(
      "kitty",
    )
    expect(resolveImageRenderProtocol("auto", createTerminalCapabilities({ sixel: true }), true)).toBe("sixel")
    expect(
      resolveImageRenderProtocol(
        "auto",
        createTerminalCapabilities({ kitty_graphics: true, multiplexer: "tmux" }),
        true,
      ),
    ).toBe("blocks")
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
    try {
      await expect(loaded.loadPromise!).rejects.toThrow("onLoad failed")
      expect(loaded.loading).toBe(false)
      expect(loaded.image).not.toBeNull()
    } finally {
      loaded.destroy()
    }

    const failed = new ImageRenderable(renderer, {
      source: Uint8Array.of(1, 2, 3),
      onError: () => {
        throw new Error("onError failed")
      },
    })
    try {
      await expect(failed.loadPromise!).rejects.toThrow("onError failed")
      expect(failed.loading).toBe(false)
      expect(failed.loadError).toBeDefined()
    } finally {
      failed.destroy()
    }
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
    const png = await readFile(new URL("rgba.png", FIXTURES))
    const requestStarted = Promise.withResolvers<void>()
    const requestAborted = Promise.withResolvers<void>()
    const socketClosed = Promise.withResolvers<void>()
    let requestWasAborted = false
    let socketWasClosed = false
    const server = createServer((request) => {
      request.once("aborted", () => {
        requestWasAborted = true
        requestAborted.resolve()
      })
      request.socket.once("close", () => {
        socketWasClosed = true
        socketClosed.resolve()
      })
      requestStarted.resolve()
    })
    let renderable: ImageRenderable | undefined
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("missing test server address")
      renderable = new ImageRenderable(renderer, { source: png })
      await renderable.loadPromise
      const previous = renderable.image

      renderable.source = `http://127.0.0.1:${address.port}/pending`
      const pendingLoad = renderable.loadPromise
      if (!pendingLoad) throw new Error("missing pending image load")
      await within(requestStarted.promise, "server did not receive the pending image request")
      renderable.source = undefined
      await within(
        Promise.all([pendingLoad, requestAborted.promise, socketClosed.promise]),
        "image request was not aborted",
      )

      expect(renderable.image).toBeNull()
      expect(renderable.loading).toBe(false)
      expect(() => previous?.raw()).toThrow("disposed")
      expect(requestWasAborted).toBe(true)
      expect(socketWasClosed).toBe(true)
    } finally {
      renderable?.destroy()
      await closeServer(server)
    }
  })

  test("a newer source aborts the older request and replaces its image", async () => {
    const gif = await readFile(new URL("transparent.gif", FIXTURES))
    const requestStarted = Promise.withResolvers<void>()
    const requestAborted = Promise.withResolvers<void>()
    const socketClosed = Promise.withResolvers<void>()
    let requestWasAborted = false
    let socketWasClosed = false
    const server = createServer((request, response) => {
      if (request.url === "/slow") {
        request.once("aborted", () => {
          requestWasAborted = true
          requestAborted.resolve()
        })
        request.socket.once("close", () => {
          socketWasClosed = true
          socketClosed.resolve()
        })
        requestStarted.resolve()
      } else {
        response.setHeader("Connection", "close")
        response.end(gif)
      }
    })
    const onError = mock(() => {})
    let renderable: ImageRenderable | undefined
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("missing test server address")
      const base = `http://127.0.0.1:${address.port}`
      renderable = new ImageRenderable(renderer, { source: `${base}/slow`, onError })
      const olderLoad = renderable.loadPromise
      if (!olderLoad) throw new Error("missing older image load")
      await within(requestStarted.promise, "server did not receive the older image request")

      renderable.source = `${base}/fast`
      const newerLoad = renderable.loadPromise
      if (!newerLoad) throw new Error("missing newer image load")
      await within(
        Promise.all([olderLoad, newerLoad, requestAborted.promise, socketClosed.promise]),
        "older image request was not aborted",
      )

      expect(renderable.image?.info().format).toBe("gif")
      expect(onError).not.toHaveBeenCalled()
      expect(requestWasAborted).toBe(true)
      expect(socketWasClosed).toBe(true)
    } finally {
      renderable?.destroy()
      await closeServer(server)
    }
  })

  test("destroy aborts an in-flight load and prevents callbacks", async () => {
    const requestStarted = Promise.withResolvers<void>()
    const requestAborted = Promise.withResolvers<void>()
    const socketClosed = Promise.withResolvers<void>()
    let requestWasAborted = false
    let socketWasClosed = false
    const server = createServer((request) => {
      request.once("aborted", () => {
        requestWasAborted = true
        requestAborted.resolve()
      })
      request.socket.once("close", () => {
        socketWasClosed = true
        socketClosed.resolve()
      })
      requestStarted.resolve()
    })
    const onLoad = mock(() => {})
    const onError = mock(() => {})
    let renderable: ImageRenderable | undefined
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("missing test server address")
      renderable = new ImageRenderable(renderer, {
        source: `http://127.0.0.1:${address.port}/pending`,
        onLoad,
        onError,
      })
      const pendingLoad = renderable.loadPromise
      if (!pendingLoad) throw new Error("missing pending image load")
      await within(requestStarted.promise, "server did not receive the pending image request")

      renderable.destroy()
      await within(
        Promise.all([pendingLoad, requestAborted.promise, socketClosed.promise]),
        "image request was not aborted",
      )

      expect(renderable.image).toBeNull()
      expect(onLoad).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(requestWasAborted).toBe(true)
      expect(socketWasClosed).toBe(true)
    } finally {
      renderable?.destroy()
      await closeServer(server)
    }
  })
})
