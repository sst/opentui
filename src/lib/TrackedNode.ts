import Yoga, { type Config, type Node as YogaNode } from "yoga-layout"
import { EventEmitter } from "events"

// TrackedNode
// A TypeScript wrapper for Yoga nodes that tracks indices and maintains parent-child relationships.

interface NodeMetadata {
  [key: string]: any
}

let idCounter = 0

class TrackedNode<T extends NodeMetadata = NodeMetadata> extends EventEmitter {
  id: number
  yogaNode: YogaNode
  metadata: T
  parent: TrackedNode<any> | null
  children: TrackedNode<any>[]
  zIndex: number
  protected _destroyed: boolean = false

  // Yoga calculates subpixels and the setMeasureFunc throws all over the place when trying to use it,
  // so we make up for rounding errors by calculating the percentual manually.
  protected _width: number | "auto" | `${number}%` = "auto"
  protected _height: number | "auto" | `${number}%` = "auto"

  constructor(yogaNode: YogaNode, metadata: T = {} as T) {
    super()
    this.id = idCounter++
    this.yogaNode = yogaNode
    this.metadata = metadata
    this.parent = null
    this.children = []
    this.zIndex = 0
  }

  parseWidth(width: number | "auto" | `${number}%`): number | "auto" {
    if (this._destroyed) {
      // Fatal: Something is very wrong (debug why we are trying to parse width after destruction)
      throw new Error("Node is destroyed")
    }
    if (typeof width === "number" || width === "auto") {
      return width
    }
    if (!this.parent) {
      return this.yogaNode.getComputedWidth()
    }
    if (this.parent._destroyed) {
      // Fatal: Something is very wrong (debug why we are trying to parse width after destruction)
      throw new Error("Parent node is destroyed")
    }
    return Math.floor((this.parent.yogaNode.getComputedWidth() * parseInt(width)) / 100)
  }

  parseHeight(height: number | "auto" | `${number}%`): number | "auto" {
    if (this._destroyed) {
      // Fatal: Something is very wrong (debug why we are trying to parse height after destruction)
      throw new Error("Node is destroyed")
    }
    if (typeof height === "number" || height === "auto") {
      return height
    }
    if (!this.parent) {
      return this.yogaNode.getComputedHeight()
    }
    if (this.parent._destroyed) {
      // Fatal: Something is very wrong (debug why we are trying to parse height after destruction)
      throw new Error("Parent node is destroyed")
    }
    return Math.floor((this.parent.yogaNode.getComputedHeight() * parseInt(height)) / 100)
  }

  setWidth(width: number | "auto" | `${number}%`): void {
    this._width = width
    const parsedWidth = this.parseWidth(width)
    if (parsedWidth === "auto") {
      this.yogaNode.setWidthAuto()
    } else {
      this.yogaNode.setWidth(parsedWidth)
    }
  }

  setHeight(height: number | "auto" | `${number}%`): void {
    this._height = height
    const parsedHeight = this.parseHeight(height)
    if (parsedHeight === "auto") {
      this.yogaNode.setHeightAuto()
    } else {
      this.yogaNode.setHeight(parsedHeight)
    }
  }

  addChild<U extends NodeMetadata>(childNode: TrackedNode<U>): number {
    if (childNode.parent) {
      childNode.parent.removeChild(childNode)
    }

    childNode.parent = this

    const index = this.children.length
    this.children.push(childNode)

    if (!childNode.zIndex) {
      childNode.zIndex = this.zIndex + 100
    }

    this.yogaNode.insertChild(childNode.yogaNode, index)

    try {
      childNode.yogaNode.setWidth(childNode.parseWidth(childNode._width))
      childNode.yogaNode.setHeight(childNode.parseHeight(childNode._height))
    } catch (e) {
      console.error("Error setting width and height", e)
    }

    return index
  }

  getChildIndex<U extends NodeMetadata>(childNode: TrackedNode<U>): number {
    return this.children.indexOf(childNode)
  }

  removeChild<U extends NodeMetadata>(childNode: TrackedNode<U>): boolean {
    const index = this.children.indexOf(childNode)
    if (index === -1) {
      return false
    }

    this.children.splice(index, 1)
    this.yogaNode.removeChild(childNode.yogaNode)

    childNode.parent = null

    return true
  }

  removeChildAtIndex(index: number): TrackedNode<any> | null {
    if (index < 0 || index >= this.children.length) {
      return null
    }

    const childNode = this.children[index]

    this.children.splice(index, 1)
    this.yogaNode.removeChild(childNode.yogaNode)

    childNode.parent = null

    return childNode
  }

  moveChild<U extends NodeMetadata>(childNode: TrackedNode<U>, newIndex: number): number {
    const currentIndex = this.children.indexOf(childNode)
    if (currentIndex === -1) {
      throw new Error("Node is not a child of this parent")
    }

    const boundedNewIndex = Math.max(0, Math.min(newIndex, this.children.length - 1))

    if (currentIndex === boundedNewIndex) {
      return currentIndex
    }

    this.children.splice(currentIndex, 1)
    this.children.splice(boundedNewIndex, 0, childNode)

    this.yogaNode.removeChild(childNode.yogaNode)
    this.yogaNode.insertChild(childNode.yogaNode, boundedNewIndex)

    return boundedNewIndex
  }

  insertChild<U extends NodeMetadata>(childNode: TrackedNode<U>, index: number): number {
    if (childNode.parent) {
      childNode.parent.removeChild(childNode)
    }

    childNode.parent = this
    childNode.zIndex = this.zIndex + 100
    const boundedIndex = Math.max(0, Math.min(index, this.children.length))

    this.children.splice(boundedIndex, 0, childNode)
    this.yogaNode.insertChild(childNode.yogaNode, boundedIndex)

    try {
      childNode.yogaNode.setWidth(childNode.parseWidth(childNode._width))
      childNode.yogaNode.setHeight(childNode.parseHeight(childNode._height))
    } catch (e) {
      console.error("Error setting width and height", e)
    }

    return boundedIndex
  }

  getChildCount(): number {
    return this.children.length
  }

  getChildAtIndex(index: number): TrackedNode<any> | null {
    if (index < 0 || index >= this.children.length) {
      return null
    }
    return this.children[index]
  }

  setMetadata(key: keyof T, value: T[keyof T]): void {
    this.metadata[key] = value
  }

  getMetadata<K extends keyof T>(key: K): T[K] {
    return this.metadata[key]
  }

  removeMetadata<K extends keyof T>(key: K): void {
    delete this.metadata[key]
  }

  hasChild<U extends NodeMetadata>(childNode: TrackedNode<U>): boolean {
    return this.children.includes(childNode)
  }

  destroy(): void {
    if (this._destroyed) {
      return
    }
    if (this.parent) {
      this.parent.removeChild(this)
    }
    try {
      this.yogaNode.free()
    } catch (e) {
      // Might be already freed and will throw an error if we try to free it again
    }
    this._destroyed = true
  }
}

function createTrackedNode<T extends NodeMetadata>(metadata: T = {} as T, yogaConfig?: Config): TrackedNode<T> {
  const yogaNode = Yoga.Node.create(yogaConfig)
  return new TrackedNode<T>(yogaNode, metadata)
}

export { TrackedNode, createTrackedNode }
