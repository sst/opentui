import { afterEach, describe, expect, it } from "bun:test"

import type { Highlight } from "../types.js"
import { TextareaRenderable } from "../renderables/Textarea.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { createExtmarksController, type Extmark, type ExtmarksController } from "./extmarks.js"

interface Harness {
  renderer: TestRenderer
  textarea: TextareaRenderable
  extmarks: ExtmarksController
}

const harnesses: Harness[] = []

async function mount(initialValue: string, beforeExtmarks?: (textarea: TextareaRenderable) => void): Promise<Harness> {
  const { renderer, renderOnce } = await createTestRenderer({ width: 80, height: 24 })
  const textarea = new TextareaRenderable(renderer, {
    left: 0,
    top: 0,
    width: 40,
    height: 10,
    initialValue,
  })

  renderer.root.add(textarea)
  await renderOnce()

  beforeExtmarks?.(textarea)
  const harness = { renderer, textarea, extmarks: textarea.extmarks }
  harnesses.push(harness)
  return harness
}

function range(extmarks: ExtmarksController, id: number): [number, number] | null {
  const mark = extmarks.get(id)
  return mark ? [mark.start, mark.end] : null
}

function marksFor(extmarks: ExtmarksController, typeId: number): number[] {
  return extmarks.getAllForTypeId(typeId).map((mark) => mark.id)
}

function lineHighlights(textarea: TextareaRenderable): Highlight[][] {
  return Array.from({ length: textarea.editBuffer.getLineCount() }, (_, line) => textarea.getLineHighlights(line))
}

afterEach(() => {
  for (const { renderer, extmarks } of harnesses.splice(0).reverse()) {
    extmarks.destroy()
    renderer.destroy()
  }
})

describe("ExtmarksController observable migration contract", () => {
  // Tests named "documents" record differential evidence for known defects, not an endorsement that they stay unfixed.
  it("uses public numeric IDs and keeps the type registry while marks are deleted or cleared", async () => {
    const { extmarks } = await mount("abcdef")
    const tokenType = extmarks.registerType("token")
    const noteType = extmarks.registerType("note")
    const data = { token: "ab" }
    const metadata = { source: "parser" }

    const firstId = extmarks.create({
      start: 0,
      end: 2,
      virtual: true,
      styleId: 7,
      priority: 11,
      data,
      metadata,
      typeId: tokenType,
    })
    const secondId = extmarks.create({ start: 2, end: 4, typeId: tokenType })

    expect({ firstId, secondId, tokenType, noteType }).toEqual({ firstId: 1, secondId: 2, tokenType: 1, noteType: 2 })
    expect(extmarks.get(firstId)).toEqual({
      id: 1,
      start: 0,
      end: 2,
      virtual: true,
      styleId: 7,
      priority: 11,
      data,
      typeId: 1,
    } satisfies Extmark)
    expect(extmarks.getMetadataFor(firstId)).toBe(metadata)
    expect(marksFor(extmarks, tokenType)).toEqual([1, 2])

    expect(extmarks.delete(firstId)).toBe(true)
    expect(extmarks.delete(firstId)).toBe(false)
    expect(extmarks.get(firstId)).toBeNull()
    expect(extmarks.getMetadataFor(firstId)).toBeUndefined()
    expect(marksFor(extmarks, tokenType)).toEqual([2])

    extmarks.clear()
    expect(extmarks.getAll()).toEqual([])
    expect(marksFor(extmarks, tokenType)).toEqual([])
    expect(extmarks.getTypeId("token")).toBe(tokenType)
    expect(extmarks.getTypeName(noteType)).toBe("note")
    expect(extmarks.create({ start: 0, end: 1, typeId: noteType })).toBe(3)
  })

  it("uses half-open containment and never contains a zero-width mark", async () => {
    const { extmarks } = await mount("abcdef")
    const ranged = extmarks.create({ start: 2, end: 4 })
    const empty = extmarks.create({ start: 4, end: 4 })

    expect([1, 2, 3, 4].map((offset) => extmarks.getAtOffset(offset).map((mark) => mark.id))).toEqual([
      [],
      [ranged],
      [ranged],
      [],
    ])
    expect(extmarks.get(empty)).toMatchObject({ start: 4, end: 4 })
    expect([0, 1, 2, 3, 4, 5, 6].some((offset) => extmarks.getAtOffset(offset).some((mark) => mark.id === empty))).toBe(
      false,
    )
  })

  it("applies implicit start-right and end-left insertion gravity", async () => {
    const { textarea, extmarks } = await mount("abcdef")
    const ids = {
      atStart: extmarks.create({ start: 2, end: 5 }),
      atEnd: extmarks.create({ start: 0, end: 2 }),
      inside: extmarks.create({ start: 1, end: 4 }),
      before: extmarks.create({ start: 3, end: 5 }),
      after: extmarks.create({ start: 0, end: 1 }),
      zeroWidth: extmarks.create({ start: 2, end: 2 }),
    }

    textarea.cursorOffset = 2
    textarea.insertText("X")

    expect(Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, range(extmarks, id)]))).toEqual({
      atStart: [3, 6],
      atEnd: [0, 2],
      inside: [1, 5],
      before: [4, 6],
      after: [0, 1],
      zeroWidth: [3, 3],
    })
  })

  it("clips overlap, removes covered marks, shifts suffixes, and preserves deletion-edge zero-width marks", async () => {
    const { textarea, extmarks } = await mount("abcdefghij")
    const ids = {
      before: extmarks.create({ start: 0, end: 2 }),
      suffix: extmarks.create({ start: 8, end: 10 }),
      covered: extmarks.create({ start: 3, end: 5 }),
      spanning: extmarks.create({ start: 1, end: 9 }),
      leftOverlap: extmarks.create({ start: 1, end: 4 }),
      rightOverlap: extmarks.create({ start: 6, end: 9 }),
      zeroAtStart: extmarks.create({ start: 3, end: 3 }),
      zeroInside: extmarks.create({ start: 4, end: 4 }),
      zeroAtEnd: extmarks.create({ start: 7, end: 7 }),
    }

    textarea.deleteRange(0, 3, 0, 7)

    expect(textarea.plainText).toBe("abchij")
    expect(Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, range(extmarks, id)]))).toEqual({
      before: [0, 2],
      suffix: [4, 6],
      covered: null,
      spanning: [1, 5],
      leftOverlap: [1, 3],
      rightOverlap: [3, 5],
      zeroAtStart: [3, 3],
      zeroInside: null,
      zeroAtEnd: [3, 3],
    })
  })

  it("clears marks but not registered types for whole-buffer replacement APIs", async () => {
    const cases = [
      { name: "setText", expectedText: "XY", apply: (textarea: TextareaRenderable) => textarea.setText("XY") },
      { name: "replaceText", expectedText: "XY", apply: (textarea: TextareaRenderable) => textarea.replaceText("XY") },
      { name: "clear", expectedText: "", apply: (textarea: TextareaRenderable) => textarea.clear() },
    ]

    for (const testCase of cases) {
      const { textarea, extmarks } = await mount("abcdef")
      const typeId = extmarks.registerType(testCase.name)
      const id = extmarks.create({ start: 1, end: 5, typeId, metadata: testCase.name })
      const atStart = extmarks.create({ start: 0, end: 0, typeId })
      const atEnd = extmarks.create({ start: 6, end: 6, typeId })

      testCase.apply(textarea)

      expect({ name: testCase.name, text: textarea.plainText, mark: extmarks.get(id) }).toEqual({
        name: testCase.name,
        text: testCase.expectedText,
        mark: null,
      })
      expect([atStart, atEnd].map((markId) => extmarks.get(markId))).toEqual([null, null])
      expect(extmarks.getMetadataFor(id)).toBeUndefined()
      expect(marksFor(extmarks, typeId)).toEqual([])
      expect(extmarks.getTypeId(testCase.name)).toBe(typeId)
      expect(extmarks.create({ start: 0, end: 0, typeId })).toBe(4)
    }
  })

  it("tracks newline, delete-line, and half-open selection deletion coordinates exactly", async () => {
    {
      const { textarea, extmarks } = await mount("abcdef")
      const id = extmarks.create({ start: 2, end: 5 })
      textarea.cursorOffset = 2
      textarea.newLine()
      expect({ text: textarea.plainText, range: range(extmarks, id) }).toEqual({ text: "ab\ncdef", range: [3, 6] })
    }

    {
      const { textarea, extmarks } = await mount("aa\nbb\ncc")
      const id = extmarks.create({ start: 6, end: 8 })
      textarea.cursorOffset = 3
      textarea.deleteLine()
      expect({ text: textarea.plainText, range: range(extmarks, id) }).toEqual({ text: "aa\ncc", range: [3, 5] })
    }

    {
      const { textarea, extmarks } = await mount("abcdefgh")
      const id = extmarks.create({ start: 1, end: 7 })
      textarea.setSelection(3, 5)
      expect(textarea.deleteSelection()).toBe(true)
      expect({ text: textarea.plainText, range: range(extmarks, id) }).toEqual({ text: "abcfgh", range: [1, 5] })
    }
  })

  it("restores IDs, typeId, data, metadata, and type queries for ordinary undo and redo", async () => {
    const { textarea, extmarks } = await mount("abcdef")
    const typeId = extmarks.registerType("token")
    const data = { value: 1 }
    const metadata = { owner: "parser" }
    const id = extmarks.create({ start: 2, end: 4, typeId, data, metadata })

    textarea.cursorOffset = 0
    textarea.insertText("X")
    expect(range(extmarks, id)).toEqual([3, 5])

    textarea.undo()
    expect(extmarks.get(id)).toMatchObject({ id, start: 2, end: 4, typeId, data })
    expect(extmarks.get(id)?.data).toBe(data)
    expect(extmarks.getMetadataFor(id)).toBe(metadata)
    expect(marksFor(extmarks, typeId)).toEqual([id])

    textarea.redo()
    expect(extmarks.get(id)).toMatchObject({ id, start: 3, end: 5, typeId, data })
    expect(extmarks.getMetadataFor(id)).toBe(metadata)
    expect(marksFor(extmarks, typeId)).toEqual([id])
    expect(extmarks.create({ start: 0, end: 0, typeId })).toBe(2)
  })

  it("restores metadata and type indexing when undo restores a deleted mark", async () => {
    const { textarea, extmarks } = await mount("abcdef")
    const typeId = extmarks.registerType("atomic")
    const data = { value: "cd" }
    const metadata = { owner: "parser" }
    const id = extmarks.create({ start: 2, end: 4, virtual: true, typeId, data, metadata })

    textarea.cursorOffset = 4
    textarea.deleteCharBackward()
    expect({ text: textarea.plainText, mark: extmarks.get(id), typed: marksFor(extmarks, typeId) }).toEqual({
      text: "abef",
      mark: null,
      typed: [],
    })

    textarea.undo()
    expect(textarea.plainText).toBe("abcdef")
    expect(extmarks.get(id)).toEqual({
      id,
      start: 2,
      end: 4,
      virtual: true,
      styleId: undefined,
      priority: undefined,
      data,
      typeId,
    })
    expect(extmarks.getMetadataFor(id)).toBe(metadata)
    expect(marksFor(extmarks, typeId)).toEqual([id])

    textarea.redo()
    expect({ text: textarea.plainText, mark: extmarks.get(id), typed: marksFor(extmarks, typeId) }).toEqual({
      text: "abef",
      mark: null,
      typed: [],
    })
  })

  it("restores replaceText sidecars but never restores marks after a non-undoable clear", async () => {
    for (const testCase of [
      {
        name: "replaceText",
        text: "XY",
        undoText: "abcdef",
        restoresMark: true,
        apply: (textarea: TextareaRenderable) => textarea.replaceText("XY"),
      },
      {
        name: "clear",
        text: "",
        undoText: "",
        restoresMark: false,
        apply: (textarea: TextareaRenderable) => textarea.clear(),
      },
    ]) {
      const { textarea, extmarks } = await mount("abcdef")
      const typeId = extmarks.registerType(testCase.name)
      const data = { operation: testCase.name }
      const id = extmarks.create({ start: 1, end: 5, typeId, data, metadata: data })

      testCase.apply(textarea)
      expect({ text: textarea.plainText, mark: extmarks.get(id) }).toEqual({ text: testCase.text, mark: null })

      textarea.undo()
      expect(textarea.plainText).toBe(testCase.undoText)
      if (testCase.restoresMark) {
        expect(extmarks.get(id)).toMatchObject({ id, start: 1, end: 5, typeId, data })
        expect(extmarks.getMetadataFor(id)).toBe(data)
        expect(marksFor(extmarks, typeId)).toEqual([id])
      } else {
        expect(extmarks.get(id)).toBeNull()
        expect(extmarks.getMetadataFor(id)).toBeUndefined()
        expect(marksFor(extmarks, typeId)).toEqual([])
      }

      textarea.redo()
      expect({ text: textarea.plainText, mark: extmarks.get(id) }).toEqual({ text: testCase.text, mark: null })
    }

    const { textarea, extmarks } = await mount("abcdef")
    const id = extmarks.create({ start: 1, end: 5 })
    textarea.setText("XY")
    textarea.undo()
    expect({ text: textarea.plainText, mark: extmarks.get(id) }).toEqual({ text: "XY", mark: null })
  })

  it("does not resurrect explicitly removed marks or their styles through text undo", async () => {
    for (const operation of ["delete", "clear"] as const) {
      const { textarea, extmarks } = await mount("abcdef")
      const id = extmarks.create({ start: 2, end: 4, styleId: 7, metadata: operation })

      textarea.cursorOffset = 0
      textarea.insertText("X")
      if (operation === "delete") extmarks.delete(id)
      else extmarks.clear()

      textarea.undo()
      expect({
        operation,
        text: textarea.plainText,
        mark: extmarks.get(id),
        highlights: lineHighlights(textarea),
      }).toEqual({
        operation,
        text: "abcdef",
        mark: null,
        highlights: [[]],
      })
    }
  })

  it("treats virtual marks atomically for horizontal and vertical cursor movement", async () => {
    {
      const { textarea, extmarks } = await mount("abcdefgh")
      extmarks.create({ start: 3, end: 6, virtual: true })

      textarea.cursorOffset = 2
      textarea.moveCursorRight()
      expect(textarea.cursorOffset).toBe(6)
      textarea.moveCursorLeft()
      expect(textarea.cursorOffset).toBe(2)

      textarea.cursorOffset = 4
      expect(textarea.cursorOffset).toBe(6)
      textarea.editBuffer.setCursorByOffset(2)
      textarea.editBuffer.setCursorByOffset(4)
      expect(textarea.cursorOffset).toBe(6)
      textarea.cursorOffset = 7
      textarea.editBuffer.setCursorByOffset(4)
      expect(textarea.cursorOffset).toBe(2)
    }

    for (const testCase of [
      { start: 2, direction: "down", expected: 7 },
      { start: 4, direction: "down", expected: 12 },
      { start: 16, direction: "up", expected: 7 },
      { start: 18, direction: "up", expected: 12 },
    ] as const) {
      const { textarea, extmarks } = await mount("012345\nabcdef\nUVWXYZ")
      extmarks.create({ start: 8, end: 12, virtual: true })
      textarea.cursorOffset = testCase.start
      if (testCase.direction === "down") textarea.moveCursorDown()
      else textarea.moveCursorUp()
      expect({ start: testCase.start, direction: testCase.direction, end: textarea.cursorOffset }).toEqual({
        start: testCase.start,
        direction: testCase.direction,
        end: testCase.expected,
      })
    }
  })

  it("uses whole-mark deletion only at the atomic boundaries", async () => {
    const cases = [
      { name: "backspace at end", cursor: 9, action: "backspace", text: "abcdef", mark: null },
      { name: "delete at start", cursor: 3, action: "delete", text: "abcdef", mark: null },
      { name: "backspace at start", cursor: 3, action: "backspace", text: "ab[LINK]def", mark: [2, 8] },
      { name: "delete at end", cursor: 9, action: "delete", text: "abc[LINK]ef", mark: [3, 9] },
    ] satisfies Array<{
      name: string
      cursor: number
      action: "backspace" | "delete"
      text: string
      mark: [number, number] | null
    }>

    for (const testCase of cases) {
      const { textarea, extmarks } = await mount("abc[LINK]def")
      textarea.cursorOffset = testCase.cursor
      const id = extmarks.create({ start: 3, end: 9, virtual: true })
      if (testCase.action === "backspace") textarea.deleteCharBackward()
      else textarea.deleteChar()
      expect({ name: testCase.name, text: textarea.plainText, mark: range(extmarks, id) }).toEqual({
        name: testCase.name,
        text: testCase.text,
        mark: testCase.mark,
      })
    }
  })

  it("allows selections to enter and partially delete virtual marks", async () => {
    const { textarea, extmarks } = await mount("abc[LINK]def")
    const id = extmarks.create({ start: 3, end: 9, virtual: true })

    textarea.cursorOffset = 2
    textarea.setSelection(2, 4)
    textarea.moveCursorRight()
    expect({ cursor: textarea.cursorOffset, selection: textarea.getSelection() }).toEqual({
      cursor: 4,
      selection: null,
    })

    textarea.setSelection(4, 7)
    textarea.deleteSelection()
    expect({ text: textarea.plainText, mark: range(extmarks, id) }).toEqual({ text: "abc[K]def", mark: [3, 6] })
  })

  it("preserves exact highlight style, priority, cells, and removes stale extmark ranges", async () => {
    const { textarea, extmarks } = await mount("abcdef")
    textarea.addHighlight(0, { start: 0, end: 1, styleId: 12, priority: 1, hlRef: 77 })
    const outer = extmarks.create({ start: 1, end: 5, styleId: 10, priority: 2 })
    const inner = extmarks.create({ start: 3, end: 4, styleId: 11, priority: 9 })

    expect(textarea.getLineHighlights(0)).toEqual([
      { start: 0, end: 1, styleId: 12, priority: 1, hlRef: 77 },
      { start: 1, end: 5, styleId: 10, priority: 2, hlRef: outer },
      { start: 3, end: 4, styleId: 11, priority: 9, hlRef: inner },
    ])

    textarea.cursorOffset = 0
    textarea.insertText("X")
    expect(textarea.getLineHighlights(0)).toEqual([
      { start: 0, end: 1, styleId: 12, priority: 1, hlRef: 77 },
      { start: 2, end: 6, styleId: 10, priority: 2, hlRef: outer },
      { start: 4, end: 5, styleId: 11, priority: 9, hlRef: inner },
    ])

    extmarks.delete(outer)
    expect(textarea.getLineHighlights(0)).toEqual([
      { start: 0, end: 1, styleId: 12, priority: 1, hlRef: 77 },
      { start: 4, end: 5, styleId: 11, priority: 9, hlRef: inner },
    ])
    extmarks.clear()
    expect(textarea.getLineHighlights(0)).toEqual([{ start: 0, end: 1, styleId: 12, priority: 1, hlRef: 77 }])
  })

  it("never replaces editor methods", async () => {
    let moveCursorRight: TextareaRenderable["editBuffer"]["moveCursorRight"]
    let setCursorByOffset: TextareaRenderable["editorView"]["setCursorByOffset"]
    let undo: TextareaRenderable["editBuffer"]["undo"]
    const { textarea, extmarks } = await mount("abcdef", (value) => {
      moveCursorRight = () => {}
      setCursorByOffset = () => {}
      undo = () => null
      value.editBuffer.moveCursorRight = moveCursorRight
      value.editorView.setCursorByOffset = setCursorByOffset
      value.editBuffer.undo = undo
    })

    expect(textarea.editBuffer.moveCursorRight).toBe(moveCursorRight!)
    expect(textarea.editorView.setCursorByOffset).toBe(setCursorByOffset!)
    expect(textarea.editBuffer.undo).toBe(undo!)
    extmarks.destroy()
    expect(textarea.editBuffer.moveCursorRight).toBe(moveCursorRight!)
    expect(textarea.editorView.setCursorByOffset).toBe(setCursorByOffset!)
    expect(textarea.editBuffer.undo).toBe(undo!)
  })

  it("keeps one native policy reference per controller", async () => {
    const { textarea, extmarks } = await mount("abcdefgh")
    expect(textarea.extmarks).toBe(extmarks)
    const second = createExtmarksController(textarea.editBuffer, textarea.editorView)
    second.create({ start: 3, end: 6, virtual: true })

    extmarks.destroy()
    textarea.cursorOffset = 2
    textarea.moveCursorRight()
    expect(textarea.cursorOffset).toBe(6)

    second.destroy()
    textarea.cursorOffset = 2
    textarea.moveCursorRight()
    expect(textarea.cursorOffset).toBe(3)
  })

  it("uses display-cell offsets for tabs, wide and composed graphemes, and normalized line endings", async () => {
    const cases: Array<{
      name: string
      input: string
      text: string
      offsets: number[]
      positions: Array<{ row: number; col: number }>
      range: [number, number]
      highlights: Highlight[][]
    }> = [
      {
        name: "tab",
        input: "A\tB",
        text: "A\tB",
        offsets: [0, 1, 3, 4],
        positions: [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 3 },
          { row: 0, col: 4 },
        ],
        range: [1, 3],
        highlights: [[{ start: 1, end: 3, styleId: 5, priority: 8, hlRef: 1 }]],
      },
      {
        name: "wide CJK",
        input: "A界B",
        text: "A界B",
        offsets: [0, 1, 3, 4],
        positions: [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 3 },
          { row: 0, col: 4 },
        ],
        range: [1, 3],
        highlights: [[{ start: 1, end: 3, styleId: 5, priority: 8, hlRef: 1 }]],
      },
      {
        name: "emoji ZWJ",
        input: "A👩‍💻B",
        text: "A👩‍💻B",
        offsets: [0, 1, 3, 4],
        positions: [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 3 },
          { row: 0, col: 4 },
        ],
        range: [1, 3],
        highlights: [[{ start: 1, end: 3, styleId: 5, priority: 8, hlRef: 1 }]],
      },
      {
        name: "combining sequence",
        input: "Ae\u0301B",
        text: "Ae\u0301B",
        offsets: [0, 1, 2, 3],
        positions: [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 0, col: 3 },
        ],
        range: [1, 2],
        highlights: [[{ start: 1, end: 2, styleId: 5, priority: 8, hlRef: 1 }]],
      },
      ...["\r", "\n", "\r\n"].map((lineEnding) => ({
        name: JSON.stringify(lineEnding),
        input: `A${lineEnding}B`,
        text: "A\nB",
        offsets: [0, 1, 2, 3],
        positions: [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 1, col: 0 },
          { row: 1, col: 1 },
        ],
        range: [0, 3] as [number, number],
        highlights: [
          [{ start: 0, end: 1, styleId: 5, priority: 8, hlRef: 1 }],
          [{ start: 0, end: 1, styleId: 5, priority: 8, hlRef: 1 }],
        ],
      })),
      {
        name: "mixed multiline",
        input: "A界\n👩‍💻e\u0301\nZ",
        text: "A界\n👩‍💻e\u0301\nZ",
        offsets: [0, 1, 3, 4, 6, 7, 8, 9],
        positions: [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 3 },
          { row: 1, col: 0 },
          { row: 1, col: 2 },
          { row: 1, col: 3 },
          { row: 2, col: 0 },
          { row: 2, col: 1 },
        ],
        range: [1, 8],
        highlights: [
          [{ start: 1, end: 3, styleId: 5, priority: 8, hlRef: 1 }],
          [{ start: 0, end: 3, styleId: 5, priority: 8, hlRef: 1 }],
          [],
        ],
      },
    ]

    for (const testCase of cases) {
      const { textarea, extmarks } = await mount(testCase.input)
      textarea.focus()
      textarea.cursorOffset = 0
      const offsets = [textarea.cursorOffset]
      while (textarea.moveCursorRight() && offsets.at(-1) !== textarea.cursorOffset) offsets.push(textarea.cursorOffset)

      const id = extmarks.create({ start: testCase.range[0], end: testCase.range[1], styleId: 5, priority: 8 })

      expect({
        name: testCase.name,
        text: textarea.plainText,
        offsets,
        positions: offsets.map((offset) => textarea.editBuffer.offsetToPosition(offset)),
        mark: range(extmarks, id),
        highlights: lineHighlights(textarea),
      }).toEqual({
        name: testCase.name,
        text: testCase.text,
        offsets: testCase.offsets,
        positions: testCase.positions,
        mark: testCase.range,
        highlights: testCase.highlights,
      })
    }
  })
})
