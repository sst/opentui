import { Renderable, TextRenderable, type RenderContext, type TextChunk, type TextOptions } from "@opentui/core"
import { type DomNode, insertNode as insertRenderable } from "../reconciler"
import { getNextId } from "../utils/id-counter"
import { log } from "../utils/log"

const GHOST_NODE_TAG = "text-ghost" as const

const ChunkToTextNodeMap = new WeakMap<TextChunk, TextNode>()

export const isTextChunk = (node: any): node is TextChunk => {
  return typeof node === "object" && "__isChunk" in node
}

/**
 * Represents a text node in the SolidJS reconciler.
 */
export class TextNode {
  id: string
  chunk: TextChunk
  parent?: Renderable
  textParent?: TextRenderable | GhostTextRenderable

  constructor(chunk: TextChunk) {
    this.id = getNextId("text-node")
    this.chunk = chunk
    ChunkToTextNodeMap.set(chunk, this)
  }

  /**
   * Replaces the current text chunk with a new one.
   * @param newChunk The new text chunk to replace with.
   */
  replaceText(newChunk: TextChunk): void {
    const textParent = this.textParent
    if (!textParent) {
      log("No parent found for text node:", this.id)
      return
    }
    textParent.content = textParent.content.replace(newChunk, this.chunk)
    this.chunk = newChunk
    ChunkToTextNodeMap.set(newChunk, this)
  }

  /**
   * Retrieves the TextNode associated with a given TextChunk.
   * @param chunk The text chunk to look up.
   * @returns The associated TextNode or undefined if not found.
   */
  static getTextNodeFromChunk(chunk: TextChunk): TextNode | undefined {
    return ChunkToTextNodeMap.get(chunk)
  }

  /**
   * Inserts this text node into the DOM structure.
   * @param parent The parent DOM node.
   * @param anchor The anchor node for positioning.
   */
  insert(parent: DomNode, anchor?: DomNode): void {
    if (!(parent instanceof Renderable)) {
      log("Attaching text node to parent text node, impossible")
      return
    }

    let textParent: TextRenderable
    if (!(parent instanceof TextRenderable)) {
      textParent = this.getOrCreateTextGhostNode(parent, anchor)
    } else {
      textParent = parent
    }

    this.textParent = textParent
    let styledText = textParent.content

    if (anchor && anchor instanceof TextNode) {
      const anchorIndex = styledText.chunks.indexOf(anchor.chunk)
      if (anchorIndex === -1) {
        log("anchor not found")
        return
      }
      styledText = styledText.insert(this.chunk, anchorIndex)
    } else {
      const firstChunk = textParent.content.chunks[0]
      if (firstChunk && !ChunkToTextNodeMap.has(firstChunk)) {
        styledText = styledText.replace(this.chunk, firstChunk)
      } else {
        styledText = styledText.insert(this.chunk)
      }
    }
    textParent.content = styledText
    // Solid creates empty text nodes to cleanup a child array. This
    // handles such cases.
    textParent.visible = styledText.toString() !== ""
    this.parent = parent
  }

  /**
   * Removes this text node from the DOM structure.
   * @param parent The parent DOM node.
   */
  remove(parent: DomNode): void {
    if (!(parent instanceof Renderable)) {
      ChunkToTextNodeMap.delete(this.chunk)
      return
    }
    if (parent === this.textParent && parent instanceof TextRenderable) {
      ChunkToTextNodeMap.delete(this.chunk)
      parent.content = parent.content.remove(this.chunk)
      return
    }
    if (this.textParent) {
      ChunkToTextNodeMap.delete(this.chunk)
      let styledText = this.textParent.content
      styledText = styledText.remove(this.chunk)

      if (styledText.chunks.length > 0) {
        this.textParent.content = styledText
      } else {
        this.parent?.remove(this.textParent.id)
        this.textParent.destroyRecursively()
      }
    }
  }

  /**
   * Gets or creates a ghost text node for rendering text content.
   * @param parent The parent renderable.
   * @param anchor The anchor node for positioning.
   * @returns The text renderable ghost node.
   * @private
   */
  private getOrCreateTextGhostNode(parent: Renderable, anchor?: DomNode): TextRenderable {
    if (anchor instanceof TextNode && anchor.textParent) {
      return anchor.textParent
    }
    const children = parent.getChildren()

    if (anchor instanceof Renderable) {
      const anchorIndex = children.findIndex((el) => el.id === anchor.id)
      const beforeAnchor = children[anchorIndex - 1]
      if (beforeAnchor instanceof GhostTextRenderable) {
        return beforeAnchor
      }
    }

    const lastChild = children.at(-1)
    if (lastChild instanceof GhostTextRenderable) {
      return lastChild
    }

    const ghostNode = new GhostTextRenderable(parent.ctx, {
      id: getNextId(GHOST_NODE_TAG),
    })

    insertRenderable(parent, ghostNode, anchor)

    return ghostNode
  }
}

class GhostTextRenderable extends TextRenderable {
  constructor(ctx: RenderContext, options: TextOptions) {
    super(ctx, options)
  }

  static isGhostNode(node: DomNode) {
    return node instanceof GhostTextRenderable
  }
}
