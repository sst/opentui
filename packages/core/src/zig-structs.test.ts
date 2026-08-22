import { describe, expect, test } from "bun:test"
import {
  AnnotationStyleStruct,
  DocumentOperationStruct,
  DocumentRangeInputStruct,
  DocumentStyledChunkStruct,
} from "./zig-structs.js"

describe("document transaction ABI", () => {
  test("matches native sizes and style discriminator offsets", () => {
    expect(DocumentStyledChunkStruct.size).toBe(64)
    expect(DocumentStyledChunkStruct.layoutByName.get("styleKind")?.offset).toBe(40)
    expect(DocumentStyledChunkStruct.layoutByName.get("syntaxStyle")?.offset).toBe(44)
    expect(DocumentStyledChunkStruct.layoutByName.get("link")?.offset).toBe(48)

    expect(AnnotationStyleStruct.size).toBe(48)
    expect(AnnotationStyleStruct.layoutByName.get("styleKind")?.offset).toBe(24)
    expect(AnnotationStyleStruct.layoutByName.get("syntaxStyle")?.offset).toBe(28)

    expect(DocumentRangeInputStruct.size).toBe(80)
    expect(DocumentRangeInputStruct.layoutByName.get("styleKind")?.offset).toBe(48)
    expect(DocumentRangeInputStruct.layoutByName.get("syntaxStyle")?.offset).toBe(52)

    expect(DocumentOperationStruct.size).toBe(112)
    expect(DocumentOperationStruct.layoutByName.get("styleKind")?.offset).toBe(88)
    expect(DocumentOperationStruct.layoutByName.get("syntaxStyle")?.offset).toBe(92)
    expect(DocumentOperationStruct.layoutByName.get("link")?.offset).toBe(96)
  })

  test("packs value and registered styles distinctly", () => {
    const value = DocumentStyledChunkStruct.unpack(DocumentStyledChunkStruct.pack({ text: "value" })) as Record<
      string,
      number
    >
    const registered = DocumentStyledChunkStruct.unpack(
      DocumentStyledChunkStruct.pack({ text: "registered", styleId: 7, syntaxStyle: 123 }),
    ) as Record<string, number>

    expect(value.styleKind).toBe(0)
    expect(value.styleId).toBe(0)
    expect(value.syntaxStyle).toBe(0)
    expect(registered.styleKind).toBe(1)
    expect(registered.styleId).toBe(7)
    expect(registered.syntaxStyle).toBe(123)
  })
})
