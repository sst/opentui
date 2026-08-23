import type { EditBuffer } from "../edit-buffer.js"
import type { EditorView } from "../editor-view.js"
import {
  TEXT_ANNOTATION_KIND_EXTMARK,
  TEXT_ANNOTATION_KIND_EXTMARK_EMPTY,
  TEXT_ANNOTATION_KIND_EXTMARK_PRIORITY,
  TEXT_ANNOTATION_KIND_STYLE,
  TEXT_ANNOTATION_KIND_VIRTUAL,
  type TextAnnotation,
  type TextAnnotationQuery,
} from "../zig.js"

export interface Extmark {
  id: number
  start: number // Display-width offset (including newlines), NOT JS string index
  end: number // Display-width offset (including newlines), NOT JS string index
  virtual: boolean
  styleId?: number
  priority?: number
  data?: any
  typeId: number
}

export interface ExtmarkOptions {
  start: number // Display-width offset (including newlines), NOT JS string index
  end: number // Display-width offset (including newlines), NOT JS string index
  virtual?: boolean
  styleId?: number
  priority?: number
  data?: any
  typeId?: number
  metadata?: any
}

interface ExtmarkSidecar {
  nativeId: bigint
  data?: any
  metadata?: any
}

const UINT32_MAX = 0xffffffff

export class ExtmarksController {
  private readonly editBuffer: EditBuffer
  private readonly sidecars = new Map<number, ExtmarkSidecar>()
  private nextId = 1
  private destroyed = false
  private readonly typeNameToId = new Map<string, number>()
  private readonly typeIdToName = new Map<number, string>()
  private nextTypeId = 1
  private readonly handleAnnotationsReset = (): void => {
    this.sidecars.clear()
  }

  constructor(editBuffer: EditBuffer, _editorView: EditorView) {
    this.editBuffer = editBuffer
    this.editBuffer.setVirtualAnnotationPolicy(true)
    this.editBuffer.on("annotations-reset", this.handleAnnotationsReset)
  }

  private offsetToPosition(offset: number): { row: number; col: number } {
    const position = this.editBuffer.offsetToPosition(offset)
    if (!position) throw new RangeError(`Invalid extmark display offset: ${offset}`)
    return position
  }

  private displayOffsetToByte(offset: number, affinity: "before" | "after"): number {
    const position = this.offsetToPosition(offset)
    return this.editBuffer.displayPointToNormalizedByte(position.row, position.col, affinity)
  }

  private byteToDisplayOffset(byte: number, affinity: "before" | "after"): number {
    const point = this.editBuffer.normalizedByteToDisplayPoint(byte, affinity)
    return this.editBuffer.positionToOffset(point.row, point.col)
  }

  private query(query: TextAnnotationQuery): TextAnnotation[] {
    return this.editBuffer
      .queryAnnotations(query)
      .filter((annotation) => annotation.kindFlags & TEXT_ANNOTATION_KIND_EXTMARK)
      .filter((annotation) => {
        const publicId = Number(annotation.clientToken)
        return Number.isSafeInteger(publicId) && this.sidecars.get(publicId)?.nativeId === annotation.id
      })
      .sort((a, b) => Number(a.clientToken - b.clientToken))
  }

  private toExtmark(annotation: TextAnnotation): Extmark {
    const id = Number(annotation.clientToken)
    const sidecar = this.sidecars.get(id)!
    const start = this.byteToDisplayOffset(annotation.startByte, "before")
    const empty = (annotation.kindFlags & TEXT_ANNOTATION_KIND_EXTMARK_EMPTY) !== 0
    return {
      id,
      start,
      end: empty ? start : this.byteToDisplayOffset(annotation.endByte, "after"),
      virtual: (annotation.kindFlags & TEXT_ANNOTATION_KIND_VIRTUAL) !== 0,
      styleId: annotation.kindFlags & TEXT_ANNOTATION_KIND_STYLE ? annotation.styleId : undefined,
      priority: annotation.kindFlags & TEXT_ANNOTATION_KIND_EXTMARK_PRIORITY ? annotation.priority : undefined,
      data: sidecar.data,
      typeId: annotation.namespace,
    }
  }

  public create(options: ExtmarkOptions): number {
    if (this.destroyed) throw new Error("ExtmarksController is destroyed")
    if (!Number.isSafeInteger(this.nextId)) throw new Error("Extmark public ID space exhausted")
    if (!Number.isInteger(options.priority ?? 0) || (options.priority ?? 0) < 0 || (options.priority ?? 0) > 255) {
      throw new RangeError("Extmark priority must be an integer from 0 to 255")
    }
    const typeId = options.typeId ?? 0
    if (!Number.isInteger(typeId) || typeId < 0 || typeId > UINT32_MAX) {
      throw new RangeError("Extmark typeId must be an unsigned 32-bit integer")
    }
    if (
      !Number.isSafeInteger(options.start) ||
      options.start < 0 ||
      !Number.isSafeInteger(options.end) ||
      options.end < 0
    ) {
      throw new RangeError("Extmark offsets must be non-negative safe integers")
    }
    if (options.start > options.end) throw new RangeError("Extmark start must not exceed end")

    const startByte = this.displayOffsetToByte(options.start, "before")
    const endByte = this.displayOffsetToByte(options.end, "after")
    const id = this.nextId
    let kindFlags = TEXT_ANNOTATION_KIND_EXTMARK
    if (options.virtual) kindFlags |= TEXT_ANNOTATION_KIND_VIRTUAL
    if (options.styleId !== undefined) kindFlags |= TEXT_ANNOTATION_KIND_STYLE
    if (options.priority !== undefined) kindFlags |= TEXT_ANNOTATION_KIND_EXTMARK_PRIORITY
    if (options.start === options.end) kindFlags |= TEXT_ANNOTATION_KIND_EXTMARK_EMPTY

    const { createdIds } = this.editBuffer.applyAnnotationOperations([
      {
        kind: "addRange",
        startByte,
        endByte,
        startGravity: "right",
        endGravity: "left",
        namespace: typeId,
        styleId: options.styleId,
        priority: options.priority,
        clientToken: BigInt(id),
        kindFlags,
        splicePolicy: "deleteWhenCovered",
      },
    ])
    const nativeId = createdIds[0]
    if (nativeId === undefined) throw new Error("Native extmark creation returned no ID")

    this.sidecars.set(id, { nativeId, data: options.data, metadata: options.metadata })
    this.nextId++
    return id
  }

  public delete(id: number): boolean {
    if (this.destroyed) throw new Error("ExtmarksController is destroyed")
    const sidecar = this.sidecars.get(id)
    if (!sidecar || this.editBuffer.queryAnnotations({ kind: "byId", id: sidecar.nativeId }).length === 0) return false
    this.editBuffer.applyAnnotationOperations([{ kind: "remove", id: sidecar.nativeId }])
    this.sidecars.delete(id)
    return true
  }

  public get(id: number): Extmark | null {
    if (this.destroyed) return null
    const nativeId = this.sidecars.get(id)?.nativeId
    if (nativeId === undefined) return null
    const annotation = this.query({ kind: "byId", id: nativeId })[0]
    return annotation ? this.toExtmark(annotation) : null
  }

  public getAll(): Extmark[] {
    if (this.destroyed) return []
    return this.query({ kind: "kindMask", kindMask: TEXT_ANNOTATION_KIND_EXTMARK }).map((value) =>
      this.toExtmark(value),
    )
  }

  public getVirtual(): Extmark[] {
    if (this.destroyed) return []
    return this.query({ kind: "kindMask", kindMask: TEXT_ANNOTATION_KIND_VIRTUAL }).map((value) =>
      this.toExtmark(value),
    )
  }

  public getAtOffset(offset: number): Extmark[] {
    if (this.destroyed) return []
    if (!Number.isSafeInteger(offset) || offset < 0) return []
    const position = this.editBuffer.offsetToPosition(offset)
    if (!position) return []
    const byte = this.editBuffer.displayPointToNormalizedByte(position.row, position.col, "before")
    return this.query({ kind: "containingByte", byte }).map((value) => this.toExtmark(value))
  }

  public getAllForTypeId(typeId: number): Extmark[] {
    if (this.destroyed) return []
    return this.query({ kind: "namespace", namespace: typeId }).map((value) => this.toExtmark(value))
  }

  public clear(): void {
    if (this.destroyed) return
    const annotations = this.query({ kind: "kindMask", kindMask: TEXT_ANNOTATION_KIND_EXTMARK })
    if (annotations.length > 0) {
      this.editBuffer.applyAnnotationOperations(
        annotations.map((annotation) => ({ kind: "remove", id: annotation.id })),
      )
    }
    this.sidecars.clear()
  }

  public registerType(typeName: string): number {
    if (this.destroyed) throw new Error("ExtmarksController is destroyed")
    const existing = this.typeNameToId.get(typeName)
    if (existing !== undefined) return existing
    if (this.nextTypeId > UINT32_MAX) throw new Error("Extmark type ID space exhausted")

    const typeId = this.nextTypeId++
    this.typeNameToId.set(typeName, typeId)
    this.typeIdToName.set(typeId, typeName)
    return typeId
  }

  public getTypeId(typeName: string): number | null {
    if (this.destroyed) return null
    return this.typeNameToId.get(typeName) ?? null
  }

  public getTypeName(typeId: number): string | null {
    if (this.destroyed) return null
    return this.typeIdToName.get(typeId) ?? null
  }

  public getMetadataFor(extmarkId: number): any {
    if (this.destroyed || !this.get(extmarkId)) return undefined
    return this.sidecars.get(extmarkId)?.metadata
  }

  public destroy(): void {
    if (this.destroyed) return
    this.clear()
    this.editBuffer.off("annotations-reset", this.handleAnnotationsReset)
    this.editBuffer.setVirtualAnnotationPolicy(false)
    this.typeNameToId.clear()
    this.typeIdToName.clear()
    this.destroyed = true
  }
}

export function createExtmarksController(editBuffer: EditBuffer, editorView: EditorView): ExtmarksController {
  return new ExtmarksController(editBuffer, editorView)
}
