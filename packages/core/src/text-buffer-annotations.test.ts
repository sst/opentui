import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TextBuffer } from "./text-buffer.js"
import { TEXT_ANNOTATION_KIND_STYLE, TEXT_ANNOTATION_KIND_VIRTUAL } from "./zig.js"

describe("TextBuffer native annotations", () => {
  let buffer: TextBuffer

  beforeEach(() => {
    buffer = TextBuffer.create("unicode")
    buffer.setText("abcdef")
  })

  afterEach(() => buffer.destroy())

  test("batches CRUD and exposes every deterministic bulk query", () => {
    const added = buffer.applyAnnotationOperations([
      {
        kind: "addRange",
        startByte: 1,
        endByte: 5,
        namespace: 7,
        styleId: 11,
        highlightRef: 65000,
        priority: 3,
        kindFlags: TEXT_ANNOTATION_KIND_STYLE,
        splicePolicy: "invalidate",
      },
      {
        kind: "addPoint",
        byte: 1,
        gravity: "right",
        namespace: 8,
        kindFlags: TEXT_ANNOTATION_KIND_VIRTUAL,
      },
    ])

    expect(added.deletedIds).toEqual([])
    expect(added.createdIds).toHaveLength(2)
    const [rangeId, pointId] = added.createdIds
    const all = buffer.queryAnnotations()
    expect(all.map((annotation) => annotation.id)).toEqual([rangeId, pointId])
    expect(all[0]).toMatchObject({
      kind: "range",
      startByte: 1,
      endByte: 5,
      startGravity: "right",
      endGravity: "left",
      namespace: 7,
      styleId: 11,
      highlightRef: 65000,
      priority: 3,
      kindFlags: TEXT_ANNOTATION_KIND_STYLE,
      splicePolicy: "invalidate",
    })
    expect(all[1]).toMatchObject({ kind: "point", pointGravity: "right" })
    expect(all[1].highlightRef).toBeUndefined()
    expect(all[1].sequence).toBeGreaterThan(all[0].sequence)

    expect(buffer.queryAnnotations({ kind: "byId", id: rangeId }).map((value) => value.id)).toEqual([rangeId])
    expect(buffer.queryAnnotations({ kind: "namespace", namespace: 7 }).map((value) => value.id)).toEqual([rangeId])
    expect(
      buffer.queryAnnotations({ kind: "kindMask", kindMask: TEXT_ANNOTATION_KIND_STYLE }).map((value) => value.id),
    ).toEqual([rangeId])
    expect(buffer.queryAnnotations({ kind: "overlap", startByte: 2, endByte: 3 }).map((value) => value.id)).toEqual([
      rangeId,
    ])
    expect(buffer.queryAnnotations({ kind: "containingByte", byte: 2 }).map((value) => value.id)).toEqual([rangeId])
    expect(buffer.queryAnnotations({ kind: "startsAt", byte: 1 }).map((value) => value.id)).toEqual([rangeId])
    expect(buffer.queryAnnotations({ kind: "pointsAt", byte: 1 }).map((value) => value.id)).toEqual([pointId])

    const removed = buffer.applyAnnotationOperations([
      { kind: "updateRange", id: rangeId, startByte: 2, endByte: 6 },
      { kind: "updatePoint", id: pointId, byte: 3, gravity: "left" },
      {
        kind: "updatePayload",
        id: rangeId,
        namespace: 9,
        kindFlags: TEXT_ANNOTATION_KIND_STYLE,
      },
      { kind: "remove", id: pointId },
      { kind: "clearNamespace", namespace: 9 },
    ])
    expect(removed.createdIds).toEqual([])
    expect(removed.deletedIds).toEqual([pointId, rangeId])
    expect(buffer.queryAnnotations()).toEqual([])
  })

  test("applies gravity and splice policy through ordinary text transactions", () => {
    const { createdIds } = buffer.applyAnnotationOperations([
      { kind: "addPoint", byte: 2, gravity: "right", namespace: 1 },
      { kind: "addPoint", byte: 2, gravity: "left", namespace: 1, splicePolicy: "invalidate" },
    ])
    buffer.replaceStyledRangeBytes(2, 3, [{ text: "XY" }], 40)

    expect(buffer.queryAnnotations({ kind: "byId", id: createdIds[0] })[0]).toMatchObject({ startByte: 4 })
    expect(buffer.queryAnnotations({ kind: "byId", id: createdIds[1] })).toEqual([])
  })

  test("orders every multi-result query by lower byte then native ID", () => {
    const { createdIds: ids } = buffer.applyAnnotationOperations([
      { kind: "addRange", startByte: 4, endByte: 6, namespace: 7, kindFlags: TEXT_ANNOTATION_KIND_STYLE },
      { kind: "addRange", startByte: 1, endByte: 4, namespace: 7, kindFlags: TEXT_ANNOTATION_KIND_STYLE },
      { kind: "addRange", startByte: 1, endByte: 3, namespace: 7, kindFlags: TEXT_ANNOTATION_KIND_STYLE },
      { kind: "addPoint", byte: 1, namespace: 7, kindFlags: TEXT_ANNOTATION_KIND_STYLE },
      { kind: "addPoint", byte: 1, namespace: 7, kindFlags: TEXT_ANNOTATION_KIND_STYLE },
      { kind: "addRange", startByte: 0, endByte: 6, namespace: 7, kindFlags: TEXT_ANNOTATION_KIND_STYLE },
    ])
    const ordered = [ids[5], ids[1], ids[2], ids[3], ids[4], ids[0]]
    const ranges = [ids[5], ids[1], ids[2], ids[0]]

    expect(buffer.queryAnnotations().map(({ id }) => id)).toEqual(ordered)
    expect(buffer.queryAnnotations({ kind: "namespace", namespace: 7 }).map(({ id }) => id)).toEqual(ordered)
    expect(
      buffer.queryAnnotations({ kind: "kindMask", kindMask: TEXT_ANNOTATION_KIND_STYLE }).map(({ id }) => id),
    ).toEqual(ordered)
    expect(buffer.queryAnnotations({ kind: "overlap", startByte: 1, endByte: 5 }).map(({ id }) => id)).toEqual(ranges)
    expect(buffer.queryAnnotations({ kind: "containingByte", byte: 2 }).map(({ id }) => id)).toEqual(ranges.slice(0, 3))
    expect(buffer.queryAnnotations({ kind: "startsAt", byte: 1 }).map(({ id }) => id)).toEqual([ids[1], ids[2]])
    expect(buffer.queryAnnotations({ kind: "pointsAt", byte: 1 }).map(({ id }) => id)).toEqual([ids[3], ids[4]])
  })

  test("converts Unicode display points with explicit affinity", () => {
    buffer.setText("Aé\n界")
    expect(buffer.displayPointToNormalizedByte(0, 2, "after")).toBe(new TextEncoder().encode("Aé").length)
    expect(buffer.normalizedByteToDisplayPoint(2, "before")).toEqual({ row: 0, col: 1, exact: false })
    expect(() => buffer.displayPointToNormalizedByte(99, 0, "before")).toThrow("invalid argument")
  })

  test("rejects malformed batches without partial publication", () => {
    expect(() =>
      buffer.applyAnnotationOperations([{ kind: "addPoint", byte: 1, namespace: 1, priority: 256 }]),
    ).toThrow("invalid argument")
    expect(() => buffer.applyAnnotationOperations([{ kind: "addPoint", byte: 99, namespace: 1 }])).toThrow(
      "invalid argument",
    )
    expect(() =>
      buffer.applyAnnotationOperations([
        { kind: "addRange", startByte: 1, endByte: 2, namespace: 1, highlightRef: 65536 },
      ]),
    ).toThrow("unsigned 16-bit")
    expect(buffer.queryAnnotations()).toEqual([])
  })
})
