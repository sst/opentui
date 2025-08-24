import { Renderable, TextRenderable, type TextChunk } from "@opentui/core"
import { getNextId } from "../utils/id-counter"
import type { DomNode } from "../reconciler"
import { log } from "../utils/log"

const GHOST_NODE_TAG = "text-ghost" as const

const ChunkToTextNodeMap = new WeakMap<TextChunk, TextNode>()

export class TextNode {
  id: string
  chunk: TextChunk
  parent?: Renderable
  textParent?: TextRenderable

  constructor(chunk: TextChunk) {
    this.id = getNextId("text-node")
    this.chunk = chunk

    ChunkToTextNodeMap.set(chunk, this)
  }

  replaceText(newChunk: TextChunk) {
    const textParent = this.textParent
    if (!textParent) {
      log("No parent found for text node:", this.id)
      return
    }

    textParent.content = textParent.content.replace(newChunk, this.chunk)

    this.chunk = newChunk
    ChunkToTextNodeMap.set(newChunk, this)
  }

  static getTextNodeFromChunk(chunk: TextChunk) {
    return ChunkToTextNodeMap.get(chunk)
  }
}

function getOrCreateTextGhostNode(parent: Renderable, anchor?: DomNode | null): TextRenderable {
  if (anchor instanceof TextNode && anchor.textParent) {
    // prepend text to anchor
    return anchor.textParent
  }
  const children = parent.getChildren()

  if (anchor instanceof Renderable) {
    const anchorIndex = children.findIndex((el) => el.id === anchor.id)
    const beforeAnchor = children[anchorIndex - 1]
    if (beforeAnchor instanceof TextRenderable && beforeAnchor.id.startsWith(GHOST_NODE_TAG)) {
      // append text to previous
      return beforeAnchor
    }
  }

  const lastChild = children.at(-1)
  if (lastChild instanceof TextRenderable && lastChild.id.startsWith(GHOST_NODE_TAG)) {
    // Append text to last child if exists
    return lastChild
  }

  // Create a new ghost node
  const ghostNode = new TextRenderable(getNextId(GHOST_NODE_TAG), {})

  if (anchor) {
    const anchorIndex = parent.getChildren().findIndex((el) => {
      if (anchor instanceof TextNode) {
        return el.id === anchor.textParent?.id
      }
      return el.id === anchor.id
    })
    parent.add(ghostNode, anchorIndex)
  } else {
    parent.add(ghostNode)
  }

  return ghostNode
}

export function insertTextNode(parent: DomNode, node: TextNode, anchor?: DomNode | null): void {
  if (!(parent instanceof Renderable)) {
    console.warn("Attaching text node to parent text node, impossible")
    return
  }

  let textParent: TextRenderable
  // get parent text renderable
  if (!(parent instanceof TextRenderable)) {
    textParent = getOrCreateTextGhostNode(parent, anchor)
  } else {
    textParent = parent
  }

  node.textParent = textParent
  let styledText = textParent.content

  if (anchor && anchor instanceof TextNode) {
    const anchorIndex = styledText.chunks.indexOf(anchor.chunk)
    if (anchorIndex == -1) {
      console.log("anchor not found")
      return
    }
    styledText = styledText.insert(node.chunk, anchorIndex)
  } else {
    const firstChunk = textParent.content.chunks[0]
    // Handles the default unlinked chunk
    if (firstChunk && !ChunkToTextNodeMap.has(firstChunk)) {
      styledText = styledText.replace(node.chunk, firstChunk)
    } else {
      styledText = styledText.insert(node.chunk)
    }
  }
  textParent.content = styledText
  node.parent = parent
  return
}

export function removeTextNode(parent: DomNode, node: TextNode): void {
  if (!(parent instanceof Renderable)) {
    // cleanup orphaned node
    ChunkToTextNodeMap.delete(node.chunk)
    return
  }
  if (parent === node.textParent && parent instanceof TextRenderable) {
    ChunkToTextNodeMap.delete(node.chunk)
    parent.content = parent.content.remove(node.chunk)
  } else if (node.textParent) {
    // check to remove ghost node
    ChunkToTextNodeMap.delete(node.chunk)
    let styledText = node.textParent.content
    styledText = styledText.remove(node.chunk)

    if (styledText.chunks.length > 0) {
      node.textParent.content = styledText
    } else {
      node.parent?.remove(node.textParent.id)
      node.textParent.destroyRecursively()
    }
  }
}
