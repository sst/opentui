import type { TreeSitterEdit, TreeSitterPoint, Utf8EditChange } from "./types.js"

const encoder = new TextEncoder()

function utf8Length(content: string): number {
  return encoder.encode(content).length
}

export class Utf8ContentIndex {
  private utf16LineStarts: number[] = []
  private utf8LineStarts: number[] = []
  private content: string
  private totalByteLength = 0

  constructor(content: string) {
    this.content = content
    this.rebuild(content)
  }

  get byteLength(): number {
    return this.totalByteLength
  }

  utf16IndexAtPoint(point: TreeSitterPoint): number {
    const lineStart = this.utf16LineStarts[point.row]
    const byteLineStart = this.utf8LineStarts[point.row]
    if (lineStart === undefined || byteLineStart === undefined || point.column < 0) {
      throw new RangeError(`Invalid UTF-8 point ${point.row}:${point.column}`)
    }

    const lineEnd = this.utf16LineStarts[point.row + 1] ?? this.content.length
    let utf16Index = lineStart
    let byteColumn = 0
    while (utf16Index < lineEnd && byteColumn < point.column) {
      const codePoint = this.content.codePointAt(utf16Index)!
      byteColumn += utf8Length(String.fromCodePoint(codePoint))
      utf16Index += codePoint > 0xffff ? 2 : 1
    }
    if (byteColumn !== point.column) {
      throw new RangeError(`UTF-8 column ${point.column} splits a code point on row ${point.row}`)
    }
    return utf16Index
  }

  byteIndexAtPoint(point: TreeSitterPoint): number {
    const lineStart = this.utf8LineStarts[point.row]
    if (lineStart === undefined || point.column < 0) {
      throw new RangeError(`Invalid UTF-8 point ${point.row}:${point.column}`)
    }
    this.utf16IndexAtPoint(point)
    return lineStart + point.column
  }

  byteIndexAtUtf16Index(index: number): number {
    if (index < 0 || index > this.content.length) {
      throw new RangeError(`Invalid UTF-16 index ${index}`)
    }
    let low = 0
    let high = this.utf16LineStarts.length
    while (low + 1 < high) {
      const middle = (low + high) >>> 1
      if (this.utf16LineStarts[middle]! <= index) low = middle
      else high = middle
    }
    return this.utf8LineStarts[low]! + utf8Length(this.content.slice(this.utf16LineStarts[low], index))
  }

  updateSingleEdit(newContent: string, edit: TreeSitterEdit): void {
    const oldContent = this.content
    const oldUtf16LineStarts = this.utf16LineStarts
    const oldUtf8LineStarts = this.utf8LineStarts
    const utf16Delta = edit.newEndIndex - edit.oldEndIndex
    const byteDelta =
      utf8Length(newContent.slice(edit.startIndex, edit.newEndIndex)) -
      utf8Length(oldContent.slice(edit.startIndex, edit.oldEndIndex))
    const prefixCount = edit.startPosition.row + 1
    const nextUtf16LineStarts = oldUtf16LineStarts.slice(0, prefixCount)
    const nextUtf8LineStarts = oldUtf8LineStarts.slice(0, prefixCount)
    const scanStart = oldUtf16LineStarts[edit.startPosition.row]!
    let byteIndex = oldUtf8LineStarts[edit.startPosition.row]!

    for (let index = scanStart; index < edit.newEndIndex; ) {
      const codePoint = newContent.codePointAt(index)!
      const character = String.fromCodePoint(codePoint)
      const utf16Length = codePoint > 0xffff ? 2 : 1
      byteIndex += utf8Length(character)
      index += utf16Length
      if (character === "\n") {
        nextUtf16LineStarts.push(index)
        nextUtf8LineStarts.push(byteIndex)
      }
    }

    for (let row = edit.oldEndPosition.row + 1; row < oldUtf16LineStarts.length; row++) {
      const shiftedUtf16 = oldUtf16LineStarts[row]! + utf16Delta
      if (shiftedUtf16 > (nextUtf16LineStarts.at(-1) ?? -1)) {
        nextUtf16LineStarts.push(shiftedUtf16)
        nextUtf8LineStarts.push(oldUtf8LineStarts[row]! + byteDelta)
      }
    }

    this.content = newContent
    this.utf16LineStarts = nextUtf16LineStarts
    this.utf8LineStarts = nextUtf8LineStarts
    this.totalByteLength += byteDelta
  }

  private rebuild(content: string): void {
    this.utf16LineStarts = [0]
    this.utf8LineStarts = [0]
    let byteIndex = 0
    for (let index = 0; index < content.length; ) {
      const codePoint = content.codePointAt(index)!
      const character = String.fromCodePoint(codePoint)
      const utf16Length = codePoint > 0xffff ? 2 : 1
      byteIndex += utf8Length(character)
      index += utf16Length
      if (character === "\n") {
        this.utf16LineStarts.push(index)
        this.utf8LineStarts.push(byteIndex)
      }
    }
    this.totalByteLength = byteIndex
  }
}

export function createTreeSitterEdit(edit: Omit<TreeSitterEdit, "coordinateSpace">): TreeSitterEdit {
  return { ...edit, coordinateSpace: "utf16" }
}

export function convertUtf8EditChanges(
  previousContent: string,
  newContent: string,
  edits: readonly Utf8EditChange[],
  previousIndex = new Utf8ContentIndex(previousContent),
): { edits: TreeSitterEdit[]; index: Utf8ContentIndex } {
  if (edits.length === 1) {
    const edit = edits[0]!
    if (
      previousIndex.byteIndexAtPoint(edit.startPosition) !== edit.startIndex ||
      previousIndex.byteIndexAtPoint(edit.oldEndPosition) !== edit.oldEndIndex
    ) {
      throw new RangeError("UTF-8 edit byte indices do not match its old-content points")
    }
    const startIndex = previousIndex.utf16IndexAtPoint(edit.startPosition)
    const oldEndIndex = previousIndex.utf16IndexAtPoint(edit.oldEndPosition)
    const newEndIndex = newContent.length - (previousContent.length - oldEndIndex)
    const replacement = newContent.slice(startIndex, newEndIndex)
    const lastLineBreak = replacement.lastIndexOf("\n")
    const replacementRowCount = replacement.split("\n").length - 1
    const newEndLineStart =
      lastLineBreak >= 0
        ? startIndex + lastLineBreak + 1
        : previousIndex.utf16IndexAtPoint({ row: edit.startPosition.row, column: 0 })
    if (
      edit.newEndPosition.row !== edit.startPosition.row + replacementRowCount ||
      edit.newEndPosition.column !== utf8Length(newContent.slice(newEndLineStart, newEndIndex)) ||
      edit.newEndIndex !== edit.startIndex + utf8Length(replacement)
    ) {
      throw new RangeError("UTF-8 edit new end does not match new content")
    }
    const converted = createTreeSitterEdit({
      startIndex,
      oldEndIndex,
      newEndIndex,
      startPosition: {
        row: edit.startPosition.row,
        column: startIndex - previousIndex.utf16IndexAtPoint({ row: edit.startPosition.row, column: 0 }),
      },
      oldEndPosition: {
        row: edit.oldEndPosition.row,
        column: oldEndIndex - previousIndex.utf16IndexAtPoint({ row: edit.oldEndPosition.row, column: 0 }),
      },
      newEndPosition: {
        row: edit.newEndPosition.row,
        column: newEndIndex - newEndLineStart,
      },
    })
    const index = previousIndex
    index.updateSingleEdit(newContent, converted)
    return { edits: [converted], index }
  }

  const nextIndex = new Utf8ContentIndex(newContent)
  return {
    edits: edits.map((edit) => {
      if (
        previousIndex.byteIndexAtPoint(edit.startPosition) !== edit.startIndex ||
        previousIndex.byteIndexAtPoint(edit.oldEndPosition) !== edit.oldEndIndex ||
        nextIndex.byteIndexAtPoint(edit.newEndPosition) !== edit.newEndIndex
      ) {
        throw new RangeError("UTF-8 edit byte indices do not match its content points")
      }
      return createTreeSitterEdit({
        startIndex: previousIndex.utf16IndexAtPoint(edit.startPosition),
        oldEndIndex: previousIndex.utf16IndexAtPoint(edit.oldEndPosition),
        newEndIndex: nextIndex.utf16IndexAtPoint(edit.newEndPosition),
        startPosition: {
          row: edit.startPosition.row,
          column:
            previousIndex.utf16IndexAtPoint(edit.startPosition) -
            previousIndex.utf16IndexAtPoint({ row: edit.startPosition.row, column: 0 }),
        },
        oldEndPosition: {
          row: edit.oldEndPosition.row,
          column:
            previousIndex.utf16IndexAtPoint(edit.oldEndPosition) -
            previousIndex.utf16IndexAtPoint({ row: edit.oldEndPosition.row, column: 0 }),
        },
        newEndPosition: {
          row: edit.newEndPosition.row,
          column:
            nextIndex.utf16IndexAtPoint(edit.newEndPosition) -
            nextIndex.utf16IndexAtPoint({ row: edit.newEndPosition.row, column: 0 }),
        },
      })
    }),
    index: nextIndex,
  }
}
