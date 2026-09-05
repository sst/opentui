import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { EditBuffer } from "../edit-buffer.js"
import { EditorView } from "../editor-view.js"
import { Renderable, RenderableEvents } from "../Renderable.js"
import { BoxRenderable } from "../renderables/Box.js"
import { EditBufferRenderableEvents } from "../renderables/EditBufferRenderable.js"
import { InputRenderable } from "../renderables/Input.js"
import { LineNumberRenderable } from "../renderables/LineNumberRenderable.js"
import { TextareaRenderable } from "../renderables/Textarea.js"
import { TextRenderable } from "../renderables/Text.js"
import type { StyledText } from "../lib/styled-text.js"
import { SyntaxStyle } from "../syntax-style.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { TextBuffer } from "../text-buffer.js"
import { TextBufferView } from "../text-buffer-view.js"
import { resolveRenderLib, type NativeRenderableHandle } from "../zig.js"

// Native-backed measurement wires renderables to native state (measure targets,
// Yoga measure funcs, handles). These tests lock the lifecycle behavior:
// destroying renderables must detach cleanly while the rest of the tree keeps
// measuring, including under create/layout/destroy churn.

let renderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer, renderOnce } = await createTestRenderer({ width: 80, height: 30 }))
})

afterEach(() => {
  renderer.destroy()
})

function maybeCollectGarbage(): void {
  const bun = (globalThis as { Bun?: { gc?: (force?: boolean) => void } }).Bun
  bun?.gc?.(false)
}

function expectSize(
  renderable: TextRenderable | TextareaRenderable,
  expected: { width: number; height: number },
): void {
  expect(renderable.width).toBeCloseTo(expected.width, 5)
  expect(renderable.height).toBeCloseTo(expected.height, 5)
}

function trackNativeRenderable() {
  const lib = resolveRenderLib()
  const createNativeRenderable = lib.createNativeRenderable.bind(lib)
  let handle: NativeRenderableHandle | undefined
  const create = spyOn(lib, "createNativeRenderable").mockImplementation(() => {
    handle = createNativeRenderable()
    return handle
  })

  return {
    expectDestroyed(): void {
      expect(handle).toBeDefined()
      expect(() => lib.nativeRenderableGetYogaNode(handle!)).toThrow("Failed to get native renderable Yoga node")
    },
    restore(): void {
      create.mockRestore()
      if (handle) lib.destroyNativeRenderable(handle)
    },
  }
}

describe("native-backed measurement lifecycle", () => {
  test("does not acquire native ownership when base construction fails", () => {
    const lib = resolveRenderLib()
    const nativeCreate = spyOn(lib, "createNativeRenderable")
    const options = {
      get id(): string {
        throw new Error("injected base construction failure")
      },
    }

    try {
      expect(() => new TextRenderable(renderer, options)).toThrow("injected base construction failure")
      expect(nativeCreate).not.toHaveBeenCalled()
    } finally {
      nativeCreate.mockRestore()
    }
  })

  test("releases native ownership when text construction fails", () => {
    const native = trackNativeRenderable()
    let textBuffer: TextBuffer | undefined
    let textBufferView: TextBufferView | undefined
    let abortedRenderable: Renderable | undefined
    const createTextBuffer = TextBuffer.create.bind(TextBuffer)
    const textBufferCreate = spyOn(TextBuffer, "create").mockImplementation((widthMethod) => {
      textBuffer = createTextBuffer(widthMethod)
      return textBuffer
    })
    const createTextBufferView = TextBufferView.create.bind(TextBufferView)
    const textBufferViewCreate = spyOn(TextBufferView, "create").mockImplementation((buffer) => {
      textBufferView = createTextBufferView(buffer)
      return textBufferView
    })
    const syntaxStyleCreate = spyOn(SyntaxStyle, "create").mockImplementation(() => {
      throw new Error("injected text construction failure")
    })
    const context = renderer as TestRenderer & { claimFirstLineOffset?: (renderable?: Renderable) => number }
    const claimFirstLineOffset = context.claimFirstLineOffset
    context.claimFirstLineOffset = (renderable) => {
      abortedRenderable = renderable
      return 1
    }

    try {
      expect(() => new TextRenderable(renderer, { content: "unreachable" })).toThrow(
        "injected text construction failure",
      )
      expect(abortedRenderable?.isDestroyed).toBe(true)
      expect(() => textBuffer?.setText("unreachable")).toThrow("TextBuffer is destroyed")
      expect(() => textBufferView?.setWrapMode("word")).toThrow("TextBufferView is destroyed")
      native.expectDestroyed()
    } finally {
      context.claimFirstLineOffset = claimFirstLineOffset
      syntaxStyleCreate.mockRestore()
      textBufferViewCreate.mockRestore()
      textBufferCreate.mockRestore()
      textBufferView?.destroy()
      textBuffer?.destroy()
      native.restore()
    }
  })

  test("releases text resources when derived option processing fails", () => {
    const native = trackNativeRenderable()
    let abortedRenderable: Renderable | undefined
    const textBufferDestroy = spyOn(TextBuffer.prototype, "destroy")
    const textBufferViewDestroy = spyOn(TextBufferView.prototype, "destroy")
    const syntaxStyleDestroy = spyOn(SyntaxStyle.prototype, "destroy")
    const context = renderer as TestRenderer & { claimFirstLineOffset?: (renderable?: Renderable) => number }
    const claimFirstLineOffset = context.claimFirstLineOffset
    context.claimFirstLineOffset = (renderable) => {
      abortedRenderable = renderable
      return 1
    }
    const options = {
      get content(): string {
        throw new Error("injected derived text construction failure")
      },
    }

    try {
      expect(() => new TextRenderable(renderer, options)).toThrow("injected derived text construction failure")
      expect(abortedRenderable?.isDestroyed).toBe(true)
      expect(textBufferDestroy).toHaveBeenCalledTimes(1)
      expect(textBufferViewDestroy).toHaveBeenCalledTimes(1)
      expect(syntaxStyleDestroy).toHaveBeenCalledTimes(1)
      native.expectDestroyed()
    } finally {
      context.claimFirstLineOffset = claimFirstLineOffset
      syntaxStyleDestroy.mockRestore()
      textBufferViewDestroy.mockRestore()
      textBufferDestroy.mockRestore()
      native.restore()
    }
  })

  test("releases native ownership when editor construction fails", () => {
    const lib = resolveRenderLib()
    const native = trackNativeRenderable()
    let editBuffer: EditBuffer | undefined
    let editorView: EditorView | undefined
    const createEditBuffer = EditBuffer.create.bind(EditBuffer)
    const editBufferCreate = spyOn(EditBuffer, "create").mockImplementation((widthMethod) => {
      editBuffer = createEditBuffer(widthMethod)
      return editBuffer
    })
    const createEditorView = EditorView.create.bind(EditorView)
    const editorViewCreate = spyOn(EditorView, "create").mockImplementation((buffer, width, height) => {
      editorView = createEditorView(buffer, width, height)
      return editorView
    })
    const setMeasureTarget = spyOn(lib, "nativeRenderableSetMeasureTarget").mockImplementation(() => false)

    try {
      expect(() => new TextareaRenderable(renderer, { initialValue: "unreachable" })).toThrow(
        "Failed to attach editor native measure target",
      )
      expect(() => editBuffer?.setText("unreachable")).toThrow("EditBuffer is destroyed")
      expect(() => editorView?.setWrapMode("word")).toThrow("EditorView is destroyed")
      native.expectDestroyed()
    } finally {
      setMeasureTarget.mockRestore()
      editorViewCreate.mockRestore()
      editBufferCreate.mockRestore()
      editorView?.destroy()
      editBuffer?.destroy()
      native.restore()
    }
  })

  test("releases editor resources when derived option processing fails", () => {
    const native = trackNativeRenderable()
    const editBufferDestroy = spyOn(EditBuffer.prototype, "destroy")
    const editorViewDestroy = spyOn(EditorView.prototype, "destroy")
    const placeholder = {
      get chunks(): StyledText["chunks"] {
        throw new Error("injected derived editor construction failure")
      },
    } as StyledText

    try {
      expect(() => new TextareaRenderable(renderer, { placeholder })).toThrow(
        "injected derived editor construction failure",
      )
      expect(editBufferDestroy).toHaveBeenCalledTimes(1)
      expect(editorViewDestroy).toHaveBeenCalledTimes(1)
      native.expectDestroyed()
    } finally {
      editorViewDestroy.mockRestore()
      editBufferDestroy.mockRestore()
      native.restore()
    }
  })

  test("releases editor resources when input subclass initialization fails", () => {
    class ThrowingInputRenderable extends InputRenderable {
      override get plainText(): string {
        throw new Error("injected input construction failure")
      }
    }

    const native = trackNativeRenderable()
    const editBufferDestroy = spyOn(EditBuffer.prototype, "destroy")
    const editorViewDestroy = spyOn(EditorView.prototype, "destroy")

    try {
      expect(() => new ThrowingInputRenderable(renderer, {})).toThrow("injected input construction failure")
      expect(editBufferDestroy).toHaveBeenCalledTimes(1)
      expect(editorViewDestroy).toHaveBeenCalledTimes(1)
      native.expectDestroyed()
    } finally {
      editorViewDestroy.mockRestore()
      editBufferDestroy.mockRestore()
      native.restore()
    }
  })

  test("releases line-number resources when target setup fails", () => {
    const target = new TextRenderable(renderer, { content: "owned" })
    const registrySize = Renderable.renderablesByNumber.size
    Object.defineProperty(target, "virtualLineCount", {
      configurable: true,
      get() {
        throw new Error("injected line info failure")
      },
    })

    expect(() => new LineNumberRenderable(renderer, { target })).toThrow("injected line info failure")
    expect(Renderable.renderablesByNumber.size).toBe(registrySize)
    expect(target.listenerCount("line-info-change")).toBe(0)

    target.destroy()
  })

  test("releases native ownership when a destroy listener throws", () => {
    const native = trackNativeRenderable()
    const parent = new BoxRenderable(renderer, { width: 40 })
    const text = new TextRenderable(renderer, { content: "owned" })
    const layoutNode = text.getLayoutNode()
    const throwOnDestroy = () => {
      throw new Error("injected destroy failure")
    }
    parent.add(text)
    renderer.root.add(parent)
    text.on(RenderableEvents.DESTROYED, throwOnDestroy)

    try {
      expect(() => text.destroy()).toThrow("injected destroy failure")
      expect(parent.getLayoutNode().getChildCount()).toBe(0)
      expect(layoutNode.isFreed()).toBe(true)
      native.expectDestroyed()
    } finally {
      text.off(RenderableEvents.DESTROYED, throwOnDestroy)
      if (text.parent) text.parent.remove(text)
      layoutNode.free()
      native.restore()
    }
  })

  test("continues text teardown when a native resource destroy throws", () => {
    const native = trackNativeRenderable()
    const parent = new BoxRenderable(renderer, { width: 40 })
    const text = new TextRenderable(renderer, { content: "owned" })
    const layoutNode = text.getLayoutNode()
    const internals = text as unknown as { textBuffer: TextBuffer; textBufferView: TextBufferView }
    const textBufferViewDestroy = spyOn(internals.textBufferView, "destroy").mockImplementation(() => {
      throw new Error("injected text view destroy failure")
    })
    parent.add(text)
    renderer.root.add(parent)

    try {
      expect(() => text.destroy()).toThrow("injected text view destroy failure")
      expect(text.isDestroyed).toBe(true)
      expect(parent.getChildrenCount()).toBe(0)
      expect(layoutNode.isFreed()).toBe(true)
      expect(() => internals.textBuffer.setText("unreachable")).toThrow("TextBuffer is destroyed")
      native.expectDestroyed()
    } finally {
      textBufferViewDestroy.mockRestore()
      internals.textBufferView.destroy()
      native.restore()
    }
  })

  test("continues editor teardown when a subclass listener throws", () => {
    const native = trackNativeRenderable()
    const parent = new BoxRenderable(renderer, { width: 40 })
    const textarea = new TextareaRenderable(renderer, { initialValue: "owned" })
    const layoutNode = textarea.getLayoutNode()
    const internals = textarea as unknown as { editBuffer: EditBuffer; editorView: EditorView }
    textarea.traits = { status: "active" }
    textarea.on(EditBufferRenderableEvents.TRAITS_CHANGED, () => {
      throw new Error("injected traits listener failure")
    })
    parent.add(textarea)
    renderer.root.add(parent)

    try {
      expect(() => textarea.destroy()).toThrow("injected traits listener failure")
      expect(textarea.isDestroyed).toBe(true)
      expect(parent.getChildrenCount()).toBe(0)
      expect(layoutNode.isFreed()).toBe(true)
      expect(() => internals.editBuffer.setText("unreachable")).toThrow("EditBuffer is destroyed")
      expect(() => internals.editorView.setWrapMode("word")).toThrow("EditorView is destroyed")
      native.expectDestroyed()
    } finally {
      native.restore()
    }
  })

  test("destroying a line-number target detaches it and releases native ownership", () => {
    const native = trackNativeRenderable()
    const target = new TextRenderable(renderer, { content: "owned" })
    const lineNumbers = new LineNumberRenderable(renderer, { target })
    const children = lineNumbers.getChildren()
    const gutter = children.find((child) => child !== target)!

    try {
      expect(lineNumbers.getLayoutNode().getChildCount()).toBe(2)
      expect(target.listenerCount("line-info-change")).toBe(1)

      target.destroy()

      expect(target.parent).toBeNull()
      expect(target.listenerCount("line-info-change")).toBe(0)
      expect(lineNumbers.getChildrenCount()).toBe(0)
      expect(lineNumbers.getLayoutNode().getChildCount()).toBe(0)
      expect(gutter.isDestroyed).toBe(true)
      native.expectDestroyed()
    } finally {
      lineNumbers.destroy()
      for (const child of children) child.destroyRecursively()
      native.restore()
    }
  })

  test("reentrant line-number target cleanup destroys its internal gutter", () => {
    const target = new TextRenderable(renderer, { content: "owned" })
    const lineNumbers = new LineNumberRenderable(renderer, { target })
    const gutter = lineNumbers.getChildren().find((child) => child !== target)!
    target.on(RenderableEvents.DESTROYED, () => lineNumbers.clearTarget())

    target.destroy()

    expect(target.parent).toBeNull()
    expect(gutter.parent).toBeNull()
    expect(gutter.isDestroyed).toBe(true)
    expect(gutter.getLayoutNode().isFreed()).toBe(true)
    expect(lineNumbers.getChildrenCount()).toBe(0)
  })

  test("detaches a live native-backed child when live-count cleanup throws", () => {
    const native = trackNativeRenderable()
    const parent = new BoxRenderable(renderer, { width: 40 })
    const text = new TextRenderable(renderer, { content: "owned", live: true })
    const layoutNode = text.getLayoutNode()
    renderer.root.add(parent)
    parent.add(text)
    const originalDropLive = renderer.dropLive.bind(renderer)
    const dropLive = spyOn(renderer, "dropLive").mockImplementation(() => {
      originalDropLive()
      throw new Error("injected live-count cleanup failure")
    })

    try {
      expect(() => text.destroy()).toThrow("injected live-count cleanup failure")
      expect(text.isDestroyed).toBe(true)
      expect(parent.getChildrenCount()).toBe(0)
      expect(parent.getLayoutNode().getChildCount()).toBe(0)
      expect(layoutNode.isFreed()).toBe(true)
      native.expectDestroyed()
    } finally {
      dropLive.mockRestore()
      if (text.parent) text.parent.remove(text)
      layoutNode.free()
      native.restore()
    }
  })

  test("direct line-number teardown detaches its internal children", () => {
    const target = new TextRenderable(renderer, { content: "owned" })
    const lineNumbers = new LineNumberRenderable(renderer, { target })
    const children = lineNumbers.getChildren()
    const gutter = children.find((child) => child !== target)!

    try {
      expect(children).toHaveLength(2)
      expect(target.listenerCount("line-info-change")).toBe(1)
      lineNumbers.destroy()
      expect(lineNumbers.getChildrenCount()).toBe(0)
      expect(target.listenerCount("line-info-change")).toBe(0)
      for (const child of children) {
        expect(child.parent).toBeNull()
      }
      expect(gutter.isDestroyed).toBe(true)
      expect(gutter.getLayoutNode().isFreed()).toBe(true)
      expect(target.isDestroyed).toBe(false)
    } finally {
      for (const child of children) {
        child.destroyRecursively()
      }
    }
  })

  test("does not remount children onto a destroyed line-number parent", () => {
    const original = new TextRenderable(renderer, { content: "old" })
    const replacement = new TextRenderable(renderer, { content: "new" })
    const lineNumbers = new LineNumberRenderable(renderer, { target: original })
    const gutter = lineNumbers.getChildren().find((child) => child !== original)!
    gutter.on(RenderableEvents.DESTROYED, () => {
      lineNumbers.add(replacement)
    })

    lineNumbers.destroy()

    expect(lineNumbers.isDestroyed).toBe(true)
    expect(lineNumbers.getChildrenCount()).toBe(0)
    expect(lineNumbers.getLayoutNode().getChildCount()).toBe(0)
    expect(replacement.parent).toBeNull()
    expect(replacement.listenerCount("line-info-change")).toBe(0)
    expect(gutter.isDestroyed).toBe(true)
    original.destroy()
    replacement.destroy()
  })

  test("releases native ownership when parent detach throws", () => {
    const native = trackNativeRenderable()
    class ThrowingParent extends BoxRenderable {
      private failOnce = true
      public override remove(child: Renderable): void {
        if (this.failOnce) {
          this.failOnce = false
          throw new Error("injected detach failure")
        }
        super.remove(child)
      }
    }

    const parent = new ThrowingParent(renderer, { width: 40 })
    const text = new TextRenderable(renderer, { content: "owned", live: true })
    const layoutNode = text.getLayoutNode()
    parent.add(text)

    try {
      expect(() => text.destroy()).toThrow("injected detach failure")
      expect(text.isDestroyed).toBe(true)
      expect(text.parent).toBeNull()
      expect(parent.getChildrenCount()).toBe(0)
      expect(parent.getLayoutNode().getChildCount()).toBe(0)
      expect(parent.liveCount).toBe(0)
      expect(layoutNode.isFreed()).toBe(true)
      native.expectDestroyed()
    } finally {
      native.restore()
      parent.destroy()
    }
  })

  test("destroying an exposed line-number gutter detaches it before freeing Yoga", () => {
    const target = new TextRenderable(renderer, { content: "owned" })
    const lineNumbers = new LineNumberRenderable(renderer, { target })
    const gutter = lineNumbers.getChildren().find((child) => child !== target)!

    try {
      gutter.destroy()

      expect(gutter.parent).toBeNull()
      expect(target.parent).toBeNull()
      expect(target.listenerCount("line-info-change")).toBe(0)
      expect(lineNumbers.getChildrenCount()).toBe(0)
      expect(lineNumbers.getLayoutNode().getChildCount()).toBe(0)
      expect(() => lineNumbers.destroy()).not.toThrow()
    } finally {
      gutter.destroyRecursively()
      target.destroyRecursively()
      lineNumbers.destroyRecursively()
    }
  })

  test("recursive teardown continues after a child destroy listener throws", () => {
    const parent = new BoxRenderable(renderer, { width: 40 })
    const first = new TextRenderable(renderer, { content: "first" })
    const second = new TextRenderable(renderer, { content: "second" })
    const firstLayoutNode = first.getLayoutNode()
    const secondLayoutNode = second.getLayoutNode()
    first.on(RenderableEvents.DESTROYED, () => {
      throw new Error("injected child destroy failure")
    })
    parent.add(first)
    parent.add(second)
    renderer.root.add(parent)

    expect(() => parent.destroyRecursively()).toThrow("injected child destroy failure")
    expect(first.isDestroyed).toBe(true)
    expect(second.isDestroyed).toBe(true)
    expect(parent.isDestroyed).toBe(true)
    expect(firstLayoutNode.isFreed()).toBe(true)
    expect(secondLayoutNode.isFreed()).toBe(true)
  })

  test("destroying a text renderable keeps sibling measurement working", async () => {
    const parent = new BoxRenderable(renderer, { width: 40, flexDirection: "column", alignItems: "flex-start" })
    const first = new TextRenderable(renderer, { content: "AAAAA", wrapMode: "none", alignSelf: "flex-start" })
    const second = new TextRenderable(renderer, { content: "BBBBBBBBBB", wrapMode: "none", alignSelf: "flex-start" })
    parent.add(first)
    parent.add(second)
    renderer.root.add(parent)
    await renderOnce()

    expectSize(first, { width: 5, height: 1 })
    expectSize(second, { width: 10, height: 1 })

    first.destroy()
    await renderOnce()
    expectSize(second, { width: 10, height: 1 })

    second.content = "CCC"
    await renderOnce()
    expectSize(second, { width: 3, height: 1 })
  })

  test("destroying a textarea keeps sibling measurement working", async () => {
    const parent = new BoxRenderable(renderer, { width: 40, flexDirection: "column", alignItems: "flex-start" })
    const first = new TextareaRenderable(renderer, { initialValue: "AAAAA", wrapMode: "none", alignSelf: "flex-start" })
    const second = new TextareaRenderable(renderer, {
      initialValue: "BBBBBBBBBB",
      wrapMode: "none",
      alignSelf: "flex-start",
    })
    parent.add(first)
    parent.add(second)
    renderer.root.add(parent)
    await renderOnce()

    expectSize(first, { width: 5, height: 1 })
    expectSize(second, { width: 10, height: 1 })

    first.destroy()
    await renderOnce()
    expectSize(second, { width: 10, height: 1 })

    second.setText("CCC")
    await renderOnce()
    expectSize(second, { width: 3, height: 1 })
  })

  test("survives create/layout/destroy churn of native-backed renderables", async () => {
    for (let round = 0; round < 20; round++) {
      const container = new BoxRenderable(renderer, { flexDirection: "column", alignItems: "flex-start" })
      renderer.root.add(container)

      const texts: TextRenderable[] = []
      const textareas: TextareaRenderable[] = []
      for (let index = 0; index < 16; index++) {
        const width = 1 + ((round + index) % 20)
        const text = new TextRenderable(renderer, {
          content: "X".repeat(width),
          wrapMode: "none",
          alignSelf: "flex-start",
        })
        texts.push(text)
        container.add(text)
      }
      for (let index = 0; index < 6; index++) {
        const width = 1 + ((round + index) % 15)
        const textarea = new TextareaRenderable(renderer, {
          initialValue: "Y".repeat(width),
          wrapMode: "none",
          alignSelf: "flex-start",
        })
        textareas.push(textarea)
        container.add(textarea)
      }

      await renderOnce()

      for (const [index, text] of texts.entries()) {
        expectSize(text, { width: 1 + ((round + index) % 20), height: 1 })
      }
      for (const [index, textarea] of textareas.entries()) {
        expectSize(textarea, { width: 1 + ((round + index) % 15), height: 1 })
      }

      // Alternate destroy orders: children-first and recursive subtree destroy.
      if (round % 2 === 0) {
        for (const text of texts) text.destroy()
        for (const textarea of textareas) textarea.destroy()
        container.destroy()
      } else {
        container.destroyRecursively()
      }

      if (round % 5 === 0) maybeCollectGarbage()
      await renderOnce()
    }
  })
})
