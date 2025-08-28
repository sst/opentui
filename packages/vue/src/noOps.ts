import { Renderable, TextRenderable } from "@opentui/core"
import { TextNode, type OpenTUINode, ChunkToTextNodeMap } from "./nodes"
import { getNextId } from "./utils"

const GHOST_NODE_TAG = "text-ghost" as const

function getOrCreateTextGhostNode(parent: Renderable, anchor?: OpenTUINode | null): TextRenderable {
  if (anchor instanceof TextNode && anchor.textParent) {
    return anchor.textParent
  }

  const children = parent.getChildren()

  if (anchor instanceof Renderable) {
    const anchorIndex = children.findIndex((el) => el.id === anchor.id)
    const beforeAnchor = children[anchorIndex - 1]
    if (beforeAnchor instanceof TextRenderable && beforeAnchor.id.startsWith(GHOST_NODE_TAG)) {
      return beforeAnchor
    }
  }

  const lastChild = children.at(-1)
  if (lastChild instanceof TextRenderable && lastChild.id.startsWith(GHOST_NODE_TAG)) {
    return lastChild
  }

  const ghostNode = new TextRenderable(parent.ctx, { id: getNextId(GHOST_NODE_TAG) })
  insertNode(parent, ghostNode, anchor)
  return ghostNode
}

function insertTextNode(parent: OpenTUINode, node: TextNode, anchor?: OpenTUINode | null): void {
  if (!(parent instanceof Renderable)) {
    console.warn(`[WARN] Attempted to attach text node ${node.id} to a non-renderable parent ${parent.id}.`)
    return
  }

  let textParent: TextRenderable
  if (!(parent instanceof TextRenderable)) {
    textParent = getOrCreateTextGhostNode(parent, anchor)
  } else {
    textParent = parent
  }

  node.textParent = textParent
  let styledText = textParent.content

  if (anchor && anchor instanceof TextNode) {
    const anchorIndex = styledText.chunks.indexOf(anchor.chunk)
    if (anchorIndex === -1) {
      console.warn(`[WARN] TextNode anchor not found for node ${node.id}.`)
      return
    }
    styledText = styledText.insert(node.chunk, anchorIndex)
  } else {
    const firstChunk = textParent.content.chunks[0]
    if (firstChunk && !ChunkToTextNodeMap.has(firstChunk)) {
      styledText = styledText.replace(node.chunk, firstChunk)
    } else {
      styledText = styledText.insert(node.chunk)
    }
  }

  textParent.content = styledText
  node.parent = parent
  ChunkToTextNodeMap.set(node.chunk, node)
}

function removeTextNode(parent: OpenTUINode, node: TextNode): void {
  if (!(parent instanceof Renderable)) {
    ChunkToTextNodeMap.delete(node.chunk)
    return
  }

  if (parent === node.textParent && parent instanceof TextRenderable) {
    ChunkToTextNodeMap.delete(node.chunk)
    parent.content = parent.content.remove(node.chunk)
  } else if (node.textParent) {
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

export function insertNode(parent: OpenTUINode, node: OpenTUINode, anchor?: OpenTUINode | null): void {
  if (node instanceof TextNode) {
    return insertTextNode(parent, node, anchor)
  }

  if (!(parent instanceof Renderable)) {
    console.warn(`[WARN] Attempted to insert node ${node.id} into a non-renderable parent ${parent.id}.`)
    return
  }

  if (anchor) {
    const anchorIndex = parent.getChildren().findIndex((el) => {
      if (anchor instanceof TextNode) {
        return el.id === anchor.textParent?.id
      }
      return el.id === anchor.id
    })
    parent.add(node, anchorIndex)
  } else {
    parent.add(node)
  }
}

export function removeNode(parent: OpenTUINode, node: OpenTUINode): void {
  if (node instanceof TextNode) {
    return removeTextNode(parent, node)
  }

  if (parent instanceof Renderable && node instanceof Renderable) {
    parent.remove(node.id)
    node.destroyRecursively()
  }
}
