import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test"
import { TextRenderable } from "./Text.js"
import { TextNodeRenderable } from "./TextNode.js"
import { SyntaxStyle } from "../syntax-style.js"
import { StyledText } from "../lib/styled-text.js"
import { RGBA } from "../lib/RGBA.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>

describe("TextBufferRenderable syntax style lifecycle", () => {
  beforeEach(async () => {
    ;({ renderer: currentRenderer, renderOnce } = await createTestRenderer({
      width: 50,
      height: 10,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  it("does not allocate SyntaxStyle for TextNodeRenderable tree that only inherits default styles", async () => {
    const createSpy = spyOn(SyntaxStyle, "create")
    try {
      const text = new TextRenderable(currentRenderer, {
        id: "react-like-text",
        content: "", // Start empty, like React does
        fg: RGBA.fromValues(1, 1, 1, 1), // Explicit default
      })
      currentRenderer.root.add(text)

      // Add a child node with no explicit style, simulating <text>Hello</text>
      const child = new TextNodeRenderable({})
      child.add("Hello from React/Solid")
      text.add(child)

      await renderOnce()

      expect(text.plainText).toBe("Hello from React/Solid")
      expect(createSpy).not.toHaveBeenCalled()

      // Now add a styled child, it SHOULD allocate
      const styledChild = new TextNodeRenderable({ fg: RGBA.fromHex("#ff0000") })
      styledChild.add(" Styled")
      text.add(styledChild)

      await renderOnce()

      expect(createSpy).toHaveBeenCalledTimes(1)
    } finally {
      createSpy.mockRestore()
    }
  })

  it("does not allocate a native SyntaxStyle when constructing and rendering plain text", async () => {
    const createSpy = spyOn(SyntaxStyle, "create")
    try {
      const text = new TextRenderable(currentRenderer, {
        id: "plain-text",
        content: "No highlighting needed here",
      })
      currentRenderer.root.add(text)
      await renderOnce()

      expect(createSpy).not.toHaveBeenCalled()

      currentRenderer.root.remove(text)
      expect(() => text.destroy()).not.toThrow()
      expect(createSpy).not.toHaveBeenCalled()
    } finally {
      createSpy.mockRestore()
    }
  })

  it("lazily creates a single SyntaxStyle on explicit request and destroys it with the renderable", async () => {
    class Probe extends TextRenderable {
      public poke() {
        this.ensureSyntaxStyle()
      }
    }

    const createSpy = spyOn(SyntaxStyle, "create")
    try {
      const probe = new Probe(currentRenderer, {
        id: "probe-text",
        content: "Lazy style",
      })
      currentRenderer.root.add(probe)
      await renderOnce()

      expect(createSpy).not.toHaveBeenCalled()

      probe.poke()
      expect(createSpy).toHaveBeenCalledTimes(1)

      probe.poke() // should be idempotent
      expect(createSpy).toHaveBeenCalledTimes(1)

      currentRenderer.root.remove(probe)
      expect(() => probe.destroy()).not.toThrow()
    } finally {
      createSpy.mockRestore()
    }
  })

  it("throws if ensureSyntaxStyle is called after destruction", async () => {
    class Probe extends TextRenderable {
      public poke() {
        this.ensureSyntaxStyle()
      }
    }

    const probe = new Probe(currentRenderer, {
      id: "probe-text",
      content: "Lazy style",
    })
    probe.destroy()

    expect(() => probe.poke()).toThrow("Cannot allocate SyntaxStyle: renderable is already destroyed")
  })

  it("still applies chunk styles for styled content, allocating the SyntaxStyle lazily", async () => {
    const chunkFg = RGBA.fromHex("#ff0000")
    const createSpy = spyOn(SyntaxStyle, "create")
    try {
      const text = new TextRenderable(currentRenderer, {
        id: "styled-text",
        content: new StyledText([{ __isChunk: true as const, text: "styled", fg: chunkFg }]),
      })
      currentRenderer.root.add(text)
      await renderOnce()

      expect(createSpy).toHaveBeenCalledTimes(1)

      const { buffers, width } = currentRenderer.currentRenderBuffer
      for (let col = text.x; col < text.x + "styled".length; col++) {
        const index = text.y * width + col
        const fg = RGBA.fromArray(buffers.fg.slice(index * 4, index * 4 + 4))
        expect(fg.toInts()).toEqual(chunkFg.toInts())
      }
    } finally {
      createSpy.mockRestore()
    }
  })

  it("loadFile triggers updateTextInfo to update layout and render state", async () => {
    const text = new TextRenderable(currentRenderer, {
      id: "load-file-text",
      content: "initial",
    })
    currentRenderer.root.add(text)
    await renderOnce()

    const updateSpy = spyOn(text as any, "updateTextInfo")

    // Create a dummy file to load in a proper temp directory
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opentui-test-"))
    const dummyPath = path.join(tmpDir, "dummy_test_file.txt")
    fs.writeFileSync(dummyPath, "loaded content")

    try {
      text.loadFile(dummyPath)
      expect(updateSpy).toHaveBeenCalledTimes(1)
      expect(text.plainText).toBe("loaded content")
    } finally {
      updateSpy.mockRestore()
      if (fs.existsSync(dummyPath)) {
        fs.unlinkSync(dummyPath)
      }
      if (fs.existsSync(tmpDir)) {
        fs.rmdirSync(tmpDir)
      }
    }
  })
})
