import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type MockMouse, type TestRenderer } from "../testing.js"
import { TextRenderable } from "../renderables/Text.js"
import { TextareaRenderable } from "../renderables/Textarea.js"
import { CliRenderEvents } from "../renderer.js"

describe("word and line selection", () => {
  let renderer: TestRenderer
  let mockMouse: MockMouse
  let renderOnce: () => Promise<void>

  beforeEach(async () => {
    ;({ renderer, mockMouse, renderOnce } = await createTestRenderer({ width: 60, height: 20 }))
  })

  afterEach(() => {
    renderer.destroy()
  })

  test("MouseEvent.clickCount tracks repeated clicks at the same position", async () => {
    const text = new TextRenderable(renderer, {
      id: "click-count-text",
      position: "absolute",
      left: 1,
      top: 1,
      width: 20,
      height: 1,
      content: "alpha beta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    const counts: number[] = []
    text.onMouseDown = (event) => {
      counts.push(event.clickCount)
    }

    await mockMouse.click(text.x + 1, text.y)
    await mockMouse.click(text.x + 1, text.y)
    await Bun.sleep(450)
    await mockMouse.click(text.x + 1, text.y)
    await mockMouse.click(text.x + 2, text.y)

    expect(counts).toEqual([1, 2, 1, 1])
  })

  test("MouseEvent.clickCount reaches 3 on a triple click", async () => {
    const text = new TextRenderable(renderer, {
      id: "triple-click-text",
      position: "absolute",
      left: 1,
      top: 1,
      width: 20,
      height: 1,
      content: "alpha beta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    const counts: number[] = []
    text.onMouseDown = (event) => {
      counts.push(event.clickCount)
    }

    await mockMouse.click(text.x + 1, text.y)
    await mockMouse.click(text.x + 1, text.y)
    await mockMouse.click(text.x + 1, text.y)

    expect(counts).toEqual([1, 2, 3])
  })

  test("MouseEvent.clickCount resets when the pointer position changes", async () => {
    const text = new TextRenderable(renderer, {
      id: "position-reset-click-count-text",
      position: "absolute",
      left: 1,
      top: 1,
      width: 20,
      height: 1,
      content: "alpha beta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    const counts: number[] = []
    text.onMouseDown = (event) => {
      counts.push(event.clickCount)
    }

    await mockMouse.click(text.x + 1, text.y)
    await mockMouse.click(text.x + 1, text.y)
    await mockMouse.click(text.x + 2, text.y)

    expect(counts).toEqual([1, 2, 1])
  })

  test("MouseEvent.clickCount is 0 on mouse up after a drag", async () => {
    const text = new TextRenderable(renderer, {
      id: "drag-mouseup-click-count-text",
      position: "absolute",
      left: 1,
      top: 1,
      width: 20,
      height: 2,
      content: "alpha beta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    let upClickCount: number | null = null
    text.onMouseUp = (event) => {
      upClickCount = event.clickCount
    }

    await mockMouse.drag(text.x + 1, text.y, text.x + 4, text.y)

    expect(upClickCount).toBe(0)
  })

  test("MouseEvent.clickCount does not treat drags as prior clicks", async () => {
    const text = new TextRenderable(renderer, {
      id: "drag-reset-click-count-text",
      position: "absolute",
      left: 1,
      top: 1,
      width: 20,
      height: 2,
      content: "alpha beta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    const counts: number[] = []
    text.onMouseDown = (event) => {
      counts.push(event.clickCount)
    }

    await mockMouse.drag(text.x + 1, text.y, text.x + 4, text.y)
    await mockMouse.click(text.x + 4, text.y)

    expect(counts).toEqual([1, 1])
  })

  test("MouseEvent.clickCount is reported consistently on mouse up", async () => {
    const text = new TextRenderable(renderer, {
      id: "mouseup-click-count-text",
      position: "absolute",
      left: 1,
      top: 1,
      width: 20,
      height: 1,
      content: "alpha beta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    const upCounts: number[] = []
    text.onMouseUp = (event) => {
      upCounts.push(event.clickCount)
    }

    await mockMouse.click(text.x + 1, text.y)
    await mockMouse.click(text.x + 1, text.y)

    expect(upCounts).toEqual([1, 2])
  })

  test("MouseEvent.clickCount resets when the mouse button changes", async () => {
    const text = new TextRenderable(renderer, {
      id: "button-reset-click-count-text",
      position: "absolute",
      left: 1,
      top: 1,
      width: 20,
      height: 1,
      content: "alpha beta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    const counts: number[] = []
    text.onMouseDown = (event) => {
      counts.push(event.clickCount)
    }

    await mockMouse.click(text.x + 1, text.y)
    await mockMouse.click(text.x + 1, text.y)
    await mockMouse.click(text.x + 1, text.y, 2)

    expect(counts).toEqual([1, 2, 1])
  })

  test("renderer.selectWord selects the word under the cursor in text renderables", async () => {
    const text = new TextRenderable(renderer, {
      id: "select-word-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "alpha beta gamma",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 7, text.y)

    expect(text.getSelectedText()).toBe("beta")
    expect(renderer.getSelection()?.getSelectedText()).toBe("beta")
  })

  test("renderer.selectLine selects the full visual line under the cursor", async () => {
    const text = new TextRenderable(renderer, {
      id: "select-line-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 20,
      height: 3,
      content: "first\nsecond\nthird",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectLine(text.x + 2, text.y + 1)

    expect(text.getSelectedText()).toBe("second")
    expect(renderer.getSelection()?.getSelectedText()).toBe("second")
  })

  test("renderer.selectLine can target empty logical lines", async () => {
    const text = new TextRenderable(renderer, {
      id: "empty-line-select-line-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 20,
      height: 3,
      content: "first\n\nthird",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectLine(text.x, text.y + 1)

    expect(text.getSelectedText()).toBe("")
  })

  test("renderer.selectLine uses visual lines for wrapped text", async () => {
    const text = new TextRenderable(renderer, {
      id: "wrapped-select-line-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 6,
      height: 3,
      content: "alpha beta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectLine(text.x + 1, text.y)

    expect(text.getSelectedText()).toBe("alpha ")
  })

  test("renderer.updateSelectionWordSnap extends a word selection by whole words", async () => {
    const text = new TextRenderable(renderer, {
      id: "word-snap-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "alpha beta gamma",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 1, text.y)
    renderer.updateSelectionWordSnap(text.x + 8, text.y)

    expect(text.getSelectedText()).toBe("alpha beta")
    expect(renderer.getSelection()?.getSelectedText()).toBe("alpha beta")
  })

  test("renderer.selectWord works on wrapped continuation lines", async () => {
    const text = new TextRenderable(renderer, {
      id: "wrapped-select-word-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 6,
      height: 3,
      content: "alpha beta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 1, text.y + 1)

    expect(text.getSelectedText()).toBe("beta")
  })

  test("renderer.updateSelectionWordSnap can extend backward by whole words", async () => {
    const text = new TextRenderable(renderer, {
      id: "word-snap-reverse-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "alpha beta gamma",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 7, text.y)
    renderer.updateSelectionWordSnap(text.x + 1, text.y)

    expect(text.getSelectedText()).toBe("alpha beta")
  })

  test("renderer.selectWord treats the continuation cell of a wide CJK grapheme as part of the same word", async () => {
    const text = new TextRenderable(renderer, {
      id: "cjk-continuation-cell-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "abc日 def",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 5, text.y)

    expect(text.getSelectedText()).toBe("日")
  })

  test("renderer.selectWord respects CJK and ASCII word boundaries", async () => {
    const text = new TextRenderable(renderer, {
      id: "cjk-word-boundary-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "abc日 def",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 4, text.y)
    expect(text.getSelectedText()).toBe("日")

    renderer.selectWord(text.x + 1, text.y)
    expect(text.getSelectedText()).toBe("abc")
  })

  test("renderer.updateSelectionWordSnap can extend across logical line breaks", async () => {
    const text = new TextRenderable(renderer, {
      id: "logical-line-word-snap-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 20,
      height: 3,
      content: "alpha\nbeta gamma",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 1, text.y + 1)
    renderer.updateSelectionWordSnap(text.x + 1, text.y)

    expect(text.getSelectedText()).toBe("alpha\nbeta")
  })

  test("renderer.updateSelectionWordSnap can extend across wrapped visual lines", async () => {
    const text = new TextRenderable(renderer, {
      id: "wrapped-word-snap-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 6,
      height: 3,
      content: "alpha beta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 1, text.y)
    renderer.updateSelectionWordSnap(text.x + 1, text.y + 1)

    expect(text.getSelectedText()).toBe("alpha beta")
  })

  test("renderer.selectWord splits tab-separated tokens at whitespace boundaries", async () => {
    const text = new TextRenderable(renderer, {
      id: "tab-separated-word-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "foo\tbar baz",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 6, text.y)

    expect(text.getSelectedText()).toBe("bar")
  })

  test("renderer.selectWord splits hyphenated tokens at punctuation boundaries", async () => {
    const text = new TextRenderable(renderer, {
      id: "hyphenated-word-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "foo-bar baz",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 1, text.y)
    expect(text.getSelectedText()).toBe("foo")

    renderer.selectWord(text.x + 5, text.y)
    expect(text.getSelectedText()).toBe("bar")
  })

  test("renderer.selectWord groups decomposed accented latin text as one word", async () => {
    const text = new TextRenderable(renderer, {
      id: "decomposed-accented-word-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "cafe\u0301 noir",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 3, text.y)

    expect(text.getSelectedText()).toBe("cafe\u0301")
  })

  test("renderer.selectWord groups accented latin text as one word", async () => {
    const text = new TextRenderable(renderer, {
      id: "accented-word-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "café noir",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 3, text.y)

    expect(text.getSelectedText()).toBe("café")
  })

  test("renderer.selectWord treats the continuation cell of a wide emoji grapheme as part of the same cluster", async () => {
    const text = new TextRenderable(renderer, {
      id: "emoji-continuation-cell-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "hi 👨‍👩‍👧‍👦 there",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 5, text.y)

    expect(text.getSelectedText()).toBe("👨‍👩‍👧‍👦")
  })

  test("renderer.selectWord keeps emoji grapheme clusters intact", async () => {
    const text = new TextRenderable(renderer, {
      id: "emoji-word-text",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "hi 👨‍👩‍👧‍👦 there",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    renderer.selectWord(text.x + 4, text.y)

    expect(text.getSelectedText()).toBe("👨‍👩‍👧‍👦")
  })

  test("renderer.selectWord treats the continuation cell of a wide CJK grapheme as part of the same word in textareas", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "cjk-continuation-cell-textarea",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 3,
      initialValue: "abc日 def",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectWord(textarea.x + 5, textarea.y)

    expect(textarea.getSelectedText()).toBe("日")
  })

  test("renderer.selectWord splits tab-separated tokens at whitespace boundaries in textareas", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "tab-separated-word-textarea",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 3,
      initialValue: "foo\tbar baz",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectWord(textarea.x + 6, textarea.y)

    expect(textarea.getSelectedText()).toBe("bar")
  })

  test("renderer.selectLine can target empty logical lines in textareas", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "empty-line-select-line-textarea",
      position: "absolute",
      left: 2,
      top: 2,
      width: 20,
      height: 4,
      initialValue: "first\n\nthird",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectLine(textarea.x, textarea.y + 1)

    expect(textarea.getSelectedText()).toBe("")
  })

  test("renderer.selectLine works for textarea renderables", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "select-line-textarea",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 4,
      initialValue: "first\nsecond\nthird",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectLine(textarea.x + 1, textarea.y + 1)

    expect(textarea.getSelectedText()).toBe("second")
  })

  test("renderer.selectLine works for wrapped textarea visual lines", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "wrapped-select-line-textarea",
      position: "absolute",
      left: 2,
      top: 2,
      width: 6,
      height: 4,
      initialValue: "alpha beta",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectLine(textarea.x + 1, textarea.y + 1)

    expect(textarea.getSelectedText()).toBe("beta")
  })

  test("renderer.selectWord works on wrapped textarea continuation lines", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "wrapped-select-word-textarea",
      position: "absolute",
      left: 2,
      top: 2,
      width: 6,
      height: 4,
      initialValue: "alpha beta",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectWord(textarea.x + 1, textarea.y + 1)

    expect(textarea.getSelectedText()).toBe("beta")
  })

  test("renderer.updateSelectionWordSnap works across logical line breaks in textareas", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "logical-line-word-snap-textarea",
      position: "absolute",
      left: 2,
      top: 2,
      width: 20,
      height: 4,
      initialValue: "alpha\nbeta gamma",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectWord(textarea.x + 1, textarea.y + 1)
    renderer.updateSelectionWordSnap(textarea.x + 1, textarea.y)

    expect(textarea.getSelectedText()).toBe("alpha\nbeta")
  })

  test("renderer.updateSelectionWordSnap works backward across wrapped textarea visual lines", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "wrapped-word-snap-textarea-backward",
      position: "absolute",
      left: 2,
      top: 2,
      width: 6,
      height: 4,
      initialValue: "alpha beta",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectWord(textarea.x + 1, textarea.y + 1)
    renderer.updateSelectionWordSnap(textarea.x + 1, textarea.y)

    expect(textarea.getSelectedText()).toBe("alpha beta")
  })

  test("renderer.updateSelectionWordSnap works across wrapped textarea visual lines", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "wrapped-word-snap-textarea",
      position: "absolute",
      left: 2,
      top: 2,
      width: 6,
      height: 4,
      initialValue: "alpha beta",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectWord(textarea.x + 1, textarea.y)
    renderer.updateSelectionWordSnap(textarea.x + 1, textarea.y + 1)

    expect(textarea.getSelectedText()).toBe("alpha beta")
  })

  test("renderer.selectWord groups decomposed accented latin text in textareas", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "decomposed-accented-word-textarea",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 3,
      initialValue: "cafe\u0301 noir",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectWord(textarea.x + 3, textarea.y)

    expect(textarea.getSelectedText()).toBe("cafe\u0301")
  })

  test("renderer.selectWord treats the continuation cell of a wide emoji grapheme as part of the same cluster in textareas", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "emoji-continuation-cell-textarea",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 3,
      initialValue: "hi 👨‍👩‍👧‍👦 there",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectWord(textarea.x + 5, textarea.y)

    expect(textarea.getSelectedText()).toBe("👨‍👩‍👧‍👦")
  })

  test("renderer.selectWord works for textarea renderables", async () => {
    const textarea = new TextareaRenderable(renderer, {
      id: "select-word-textarea",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 3,
      initialValue: "hello brave new world",
      selectable: true,
    })
    renderer.root.add(textarea)
    await renderOnce()

    renderer.selectWord(textarea.x + 7, textarea.y)

    expect(textarea.getSelectedText()).toBe("brave")
    expect(renderer.getSelection()?.getSelectedText()).toBe("brave")
  })

  test("double-click via mouse events selects the word under the cursor", async () => {
    const text = new TextRenderable(renderer, {
      id: "dbl-click-integration",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "alpha beta gamma",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    await mockMouse.doubleClick(text.x + 7, text.y)

    expect(text.getSelectedText()).toBe("beta")
    expect(renderer.getSelection()?.getSelectedText()).toBe("beta")
  })

  test("triple-click via mouse events selects the full visual line", async () => {
    const text = new TextRenderable(renderer, {
      id: "triple-click-integration",
      position: "absolute",
      left: 2,
      top: 2,
      width: 20,
      height: 3,
      content: "first\nsecond\nthird",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    await mockMouse.click(text.x + 2, text.y + 1)
    await mockMouse.click(text.x + 2, text.y + 1)
    await mockMouse.click(text.x + 2, text.y + 1)

    expect(text.getSelectedText()).toBe("second")
    expect(renderer.getSelection()?.getSelectedText()).toBe("second")
  })

  test("double-click-drag extends selection by whole words", async () => {
    const text = new TextRenderable(renderer, {
      id: "dbl-click-drag-integration",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "alpha beta gamma delta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    // Double-click on "beta" (second down starts word selection)
    await mockMouse.click(text.x + 7, text.y)
    await mockMouse.pressDown(text.x + 7, text.y)
    // Drag to "gamma"
    await mockMouse.moveTo(text.x + 14, text.y)
    await mockMouse.release(text.x + 14, text.y)

    expect(text.getSelectedText()).toBe("beta gamma")
  })

  test("double-click-drag does not emit intermediate selection-finished events during drag", async () => {
    const text = new TextRenderable(renderer, {
      id: "dbl-click-drag-selection-event",
      position: "absolute",
      left: 2,
      top: 2,
      width: 30,
      height: 1,
      content: "alpha beta gamma delta",
      selectable: true,
    })
    renderer.root.add(text)
    await renderOnce()

    let selectionEventCount = 0
    renderer.on(CliRenderEvents.SELECTION, () => {
      selectionEventCount += 1
    })

    await mockMouse.click(text.x + 7, text.y)
    expect(selectionEventCount).toBe(1)

    await mockMouse.pressDown(text.x + 7, text.y)
    expect(selectionEventCount).toBe(2)

    await mockMouse.moveTo(text.x + 14, text.y)
    await mockMouse.moveTo(text.x + 20, text.y)
    expect(selectionEventCount).toBe(2)

    await mockMouse.release(text.x + 20, text.y)
    expect(selectionEventCount).toBe(3)
  })
})
