import assert from "node:assert/strict"
import process from "node:process"

const nativePackageName = `@opentui/core-${process.platform}-${process.arch}`
const isNodeTest = process.env.NODE_TEST_CONTEXT !== undefined
const isMainModule = import.meta.main

let corePromise
let testingPromise
let runtimePluginPromise

const loadCore = async () => {
  corePromise ??= import("@opentui/core")
  return corePromise
}

const loadTesting = async () => {
  testingPromise ??= import("@opentui/core/testing")
  return testingPromise
}

const loadRuntimePlugin = async () => {
  runtimePluginPromise ??= import("@opentui/core/runtime-plugin")
  return runtimePluginPromise
}

export async function createAsciiFontSelectionRoot(renderer) {
  const { ASCIIFontRenderable, BoxRenderable, RGBA, TextRenderable } = await loadCore()

  renderer.setBackgroundColor("#0d1117")

  const root = new BoxRenderable(renderer, {
    id: "ascii-font-dist-demo-root",
    position: "absolute",
    left: 1,
    top: 1,
    width: 76,
    height: 20,
    backgroundColor: "#161b22",
    borderColor: "#50565d",
    title: "ASCII Font Dist Demo",
    titleAlignment: "center",
    border: true,
  })
  renderer.root.add(root)

  const subtitle = new TextRenderable(renderer, {
    id: "ascii-font-dist-demo-subtitle",
    content: "Packed Node.js consumer smoke test",
    left: 2,
    top: 1,
    fg: "#f0f6fc",
  })
  root.add(subtitle)

  const instructions = new TextRenderable(renderer, {
    id: "ascii-font-dist-demo-instructions",
    content: "Drag to select a font. Press C to clear. Press Ctrl+C to exit.",
    left: 2,
    top: 2,
    fg: "#94a3b8",
  })
  root.add(instructions)

  const tinyFont = new ASCIIFontRenderable(renderer, {
    id: "ascii-font-dist-demo-tiny",
    position: "absolute",
    left: 2,
    top: 4,
    text: "NODE",
    font: "tiny",
    color: RGBA.fromInts(255, 215, 0, 255),
    backgroundColor: RGBA.fromInts(0, 0, 32, 255),
    selectionBg: "#4a5568",
    selectionFg: "#ffffff",
  })
  root.add(tinyFont)

  const blockFont = new ASCIIFontRenderable(renderer, {
    id: "ascii-font-dist-demo-block",
    position: "absolute",
    left: 2,
    top: 8,
    text: "DIST",
    font: "block",
    color: [RGBA.fromInts(255, 120, 120, 255), RGBA.fromInts(120, 220, 255, 255)],
    backgroundColor: RGBA.fromInts(0, 0, 32, 255),
    selectionBg: "#4a5568",
    selectionFg: "#ffffff",
  })
  root.add(blockFont)

  const preview = new TextRenderable(renderer, {
    id: "ascii-font-dist-demo-preview",
    content: "Expected selection target: NODE",
    left: 2,
    top: 15,
    fg: "#7dd3fc",
  })
  root.add(preview)

  const statusText = new TextRenderable(renderer, {
    id: "ascii-font-dist-demo-status",
    content: "Selection: none",
    left: 2,
    top: 17,
    fg: "#e6edf3",
  })
  root.add(statusText)

  let statusMessage = "Selection: none"
  const setStatusMessage = (message) => {
    statusMessage = message
    statusText.content = message
  }

  renderer.on("selection", (selection) => {
    const selectedText = selection?.getSelectedText() ?? ""
    setStatusMessage(selectedText ? `Selection: ${selectedText}` : "Selection: empty")
  })

  renderer.keyInput.on("keypress", (event) => {
    const key = event.sequence.toLowerCase()
    if (key === "c") {
      renderer.clearSelection()
      setStatusMessage("Selection cleared")
    }
  })

  return {
    root,
    fonts: [tinyFont, blockFont],
    getStatusMessage: () => statusMessage,
    destroy: () => {
      renderer.clearSelection()
      root.destroyRecursively()
    },
  }
}

if (isNodeTest) {
  const { default: test } = await import("node:test")

  test("imports core public entrypoints", async () => {
    const [core, testing, runtimePlugin] = await Promise.all([loadCore(), loadTesting(), loadRuntimePlugin()])

    assert.equal(typeof core.createCliRenderer, "function")
    assert.equal(typeof core.ASCIIFontRenderable, "function")
    assert.equal(typeof testing.createTestRenderer, "function")
    assert.equal(typeof runtimePlugin.createRuntimePlugin, "function")
  })

  test("loads the platform-native package", async () => {
    try {
      const nativePackage = await import(nativePackageName)
      assert.equal(typeof nativePackage.default, "string")
    } catch (error) {
      assert.fail(
        `Expected ${nativePackageName} to be installed for the dist test. ` +
          `dist-test should install it automatically. Original error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })

  test("renders the ASCII font selection demo and supports selection", async () => {
    const [{ createTestRenderer }] = await Promise.all([loadTesting()])
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 80,
      height: 24,
    })

    const demo = await createAsciiFontSelectionRoot(renderer)

    try {
      await renderOnce()

      const firstFrame = captureCharFrame()
      assert.match(firstFrame, /ASCII Font Dist Demo/)
      assert.match(firstFrame, /Drag to select a font/)
      assert.match(firstFrame, /Expected selection target: NODE/)

      const [tinyFont] = demo.fonts
      renderer.startSelection(tinyFont, tinyFont.x, tinyFont.y)
      renderer.updateSelection(tinyFont, tinyFont.x + tinyFont.width, tinyFont.y, { finishDragging: true })
      renderer.emit("selection", renderer.getSelection())

      await renderOnce()

      assert.equal(renderer.getSelection()?.getSelectedText(), "NODE")
      assert.equal(tinyFont.hasSelection(), true)
      assert.equal(demo.getStatusMessage(), "Selection: NODE")
      assert.match(captureCharFrame(), /Selection: NODE/)
    } finally {
      demo.destroy()
      renderer.destroy()
    }
  })
}

if (isMainModule && !isNodeTest) {
  const { createCliRenderer } = await loadCore()
  const renderer = await createCliRenderer({
    targetFps: 30,
    enableMouseMovement: true,
    exitOnCtrlC: true,
  })

  await createAsciiFontSelectionRoot(renderer)
}
