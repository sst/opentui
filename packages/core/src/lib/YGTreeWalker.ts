import type { Renderable } from "../Renderable"
import type { TrackedNode } from "./TrackedNode"

export class YGTreeWalker {
  public readonly root: Renderable
  public readonly rootNode: TrackedNode
  private _current: Renderable
  private readonly accept?: (node: Renderable) => boolean

  constructor(root: Renderable, accept?: (node: Renderable) => boolean) {
    this.root = root
    this._current = root
    this.accept = accept
    this.rootNode = this.root.getLayoutNode()

    this.rootNode.on("treeChanged", () => {
      this.reset()
    })
  }

  public reset() {
    this._current = this.root
  }

  public get currentNode(): Renderable {
    return this._current
  }

  public set currentNode(node: Renderable) {
    this._current = node
  }

  private isAccepted(node: Renderable): boolean {
    return this.accept ? this.accept(node) : true
  }

  private getParent(node: Renderable): Renderable | null {
    return node.parent || null
  }

  private getChildAt(node: Renderable, index: number): Renderable | null {
    const children = node.getChildren()
    return children[index] ?? null
  }

  private getFirstChild(node: Renderable): Renderable | null {
    return this.getChildAt(node, 0)
  }

  private getLastChild(node: Renderable): Renderable | null {
    const children = node.getChildren()
    return children.length > 0 ? children[children.length - 1] : null
  }

  private getNextSibling(node: Renderable): Renderable | null {
    const parent = this.getParent(node)
    if (!parent) return null
    const siblings = parent.getChildren()
    const idx = siblings.indexOf(node)
    return idx >= 0 && idx + 1 < siblings.length ? siblings[idx + 1] : null
  }

  private getPrevSibling(node: Renderable): Renderable | null {
    const parent = this.getParent(node)
    if (!parent) return null
    const siblings = parent.getChildren()
    const idx = siblings.indexOf(node)
    return idx > 0 ? siblings[idx - 1] : null
  }

  private nextRaw(from: Renderable): Renderable | null {
    const child = this.getFirstChild(from)
    if (child) return child
    let node: Renderable | null = from
    while (node) {
      const sibling = this.getNextSibling(node)
      if (sibling) return sibling
      node = this.getParent(node)
    }
    return null
  }

  private prevRaw(from: Renderable): Renderable | null {
    const prevSibling = this.getPrevSibling(from)
    if (prevSibling) {
      let deepest: Renderable = prevSibling
      while (true) {
        const child = this.getLastChild(deepest)
        if (!child) break
        deepest = child
      }
      return deepest
    }
    return this.getParent(from)
  }

  private *traverseForward(from: Renderable): Generator<Renderable> {
    let node: Renderable | null = from
    while ((node = this.nextRaw(node))) {
      yield node
    }
  }

  private *traverseBackward(from: Renderable): Generator<Renderable> {
    let node: Renderable | null = from
    while ((node = this.prevRaw(node))) {
      yield node
    }
  }

  public firstAccepted(): Renderable | null {
    const stack: Renderable[] = [this.root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (this.isAccepted(node)) return node
      stack.push(...node.getChildren().reverse())
    }
    return null
  }

  public lastAccepted(): Renderable | null {
    let node: Renderable | null = this.root
    while (true) {
      const lastChild: Renderable | null = node ? this.getLastChild(node) : null
      if (!lastChild) break
      node = lastChild
    }
    while (node) {
      if (this.isAccepted(node)) return node
      node = this.prevRaw(node)
    }
    return null
  }

  public nextAccepted(): Renderable | null {
    for (const node of this.traverseForward(this._current)) {
      if (this.isAccepted(node)) return node
    }
    return null
  }

  public prevAccepted(): Renderable | null {
    for (const node of this.traverseBackward(this._current)) {
      if (this.isAccepted(node)) return node
    }
    return null
  }
}
