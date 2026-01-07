import {
  Renderable,
  StyledText,
  TextNodeRenderable,
  TextRenderable,
  type RenderContext,
  type TextChunk,
  type TextOptions,
} from "@opentui/core"
import { TextNode, WhiteSpaceNode, CommentNode, type OpenTUINode, ChunkToTextNodeMap } from "./nodes"
import { getNextId } from "./utils"

const GHOST_NODE_TAG = "text-ghost" as const

export class GhostTextRenderable extends TextRenderable {
  constructor(ctx: RenderContext, options: TextOptions) {
    super(ctx, options)
  }
}

function isPlaceholderChunk(chunk: TextChunk): boolean {
  return chunk.text === "" && !ChunkToTextNodeMap.has(chunk)
}

function isEffectivelyEmptyStyledText(styledText: StyledText): boolean {
  if (styledText.chunks.length === 0) return true
  return styledText.chunks.length === 1 && isPlaceholderChunk(styledText.chunks[0]!)
}

function createPlaceholderStyledText(): StyledText {
  return new StyledText([{ __isChunk: true, text: "" }])
}

function insertChunk(styledText: StyledText, chunk: TextChunk, index?: number): StyledText {
  const chunks = styledText.chunks.slice()

  if (index === undefined) {
    chunks.push(chunk)
  } else {
    chunks.splice(index, 0, chunk)
  }

  return new StyledText(chunks)
}

function replaceChunk(styledText: StyledText, next: TextChunk, prev: TextChunk): StyledText {
  const index = styledText.chunks.indexOf(prev)
  if (index === -1) return insertChunk(styledText, next)

  const chunks = styledText.chunks.slice()
  chunks[index] = next
  return new StyledText(chunks)
}

function removeChunk(styledText: StyledText, chunk: TextChunk): StyledText {
  const index = styledText.chunks.indexOf(chunk)
  if (index === -1) return styledText

  const chunks = styledText.chunks.slice()
  chunks.splice(index, 1)
  return new StyledText(chunks)
}

function getOrCreateTextGhostNode(parent: Renderable, anchor?: OpenTUINode | null): TextRenderable {
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

  const ghostNode = new GhostTextRenderable(parent.ctx, { id: getNextId(GHOST_NODE_TAG) })
  insertNode(parent, ghostNode, anchor)
  return ghostNode
}

function insertTextNode(parent: OpenTUINode, node: TextNode, anchor?: OpenTUINode | null): void {
  if (parent instanceof TextNodeRenderable) {
    const textNodeRenderable =
      node.nodeRenderable ??
      new TextNodeRenderable({
        id: node.id,
        fg: node.chunk.fg,
        bg: node.chunk.bg,
        attributes: node.chunk.attributes,
        link: node.chunk.link,
      })

    if (!node.nodeRenderable) {
      textNodeRenderable.add(node.chunk.text)
      node.nodeRenderable = textNodeRenderable
    }

    node.parent = parent

    const normalizedAnchor =
      anchor instanceof TextNode
        ? (anchor.nodeRenderable ?? null)
        : anchor instanceof TextNodeRenderable
          ? anchor
          : null

    if (normalizedAnchor) {
      parent.insertBefore(textNodeRenderable, normalizedAnchor)
    } else {
      parent.add(textNodeRenderable)
    }

    return
  }

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
    styledText = insertChunk(styledText, node.chunk, anchorIndex)
  } else {
    const chunks = textParent.content.chunks
    const firstChunk = chunks.length > 0 ? chunks[0] : undefined
    if (firstChunk && isPlaceholderChunk(firstChunk)) {
      styledText = replaceChunk(styledText, node.chunk, firstChunk)
    } else {
      styledText = insertChunk(styledText, node.chunk)
    }
  }

  textParent.content = styledText
  node.parent = parent
  ChunkToTextNodeMap.set(node.chunk, node)
}

function removeTextNode(parent: OpenTUINode, node: TextNode): void {
  if (parent instanceof TextNodeRenderable) {
    ChunkToTextNodeMap.delete(node.chunk)

    if (node.nodeRenderable) {
      try {
        parent.remove(node.nodeRenderable.id)
      } catch { }
    }

    node.nodeRenderable = undefined
    return
  }

  if (!(parent instanceof Renderable)) {
    ChunkToTextNodeMap.delete(node.chunk)
    return
  }

  const textParent = node.textParent
  if (!textParent) {
    ChunkToTextNodeMap.delete(node.chunk)
    return
  }

  if (parent === textParent && parent instanceof TextRenderable) {
    ChunkToTextNodeMap.delete(node.chunk)
    const next = removeChunk(parent.content, node.chunk)

    if (parent instanceof GhostTextRenderable && isEffectivelyEmptyStyledText(next)) {
      const container = parent.parent
      if (container) {
        container.remove(parent.id)
      }
      parent.destroyRecursively()
      node.textParent = undefined
      return
    }

    parent.content = isEffectivelyEmptyStyledText(next) ? createPlaceholderStyledText() : next
  } else {
    ChunkToTextNodeMap.delete(node.chunk)
    let styledText = textParent.content
    styledText = removeChunk(styledText, node.chunk)

    if (!isEffectivelyEmptyStyledText(styledText)) {
      textParent.content = styledText
    } else {
      const container = textParent.parent
      if (container) {
        container.remove(textParent.id)
      }
      textParent.destroyRecursively()
      node.textParent = undefined
    }
  }
}

export function insertNode(parent: OpenTUINode, node: OpenTUINode, anchor?: OpenTUINode | null): void {
  if (node instanceof TextNode) {
    return insertTextNode(parent, node, anchor)
  }

  if (parent instanceof TextNodeRenderable) {
    if (!(node instanceof TextNodeRenderable)) {
      console.warn(`[WARN] Attempted to insert node ${node.id} into a text-node parent ${parent.id}.`)
      return
    }

    const normalizedAnchor =
      anchor instanceof TextNode
        ? (anchor.nodeRenderable ?? null)
        : anchor instanceof TextNodeRenderable
          ? anchor
          : null

    if (normalizedAnchor) {
      parent.insertBefore(node, normalizedAnchor)
    } else {
      parent.add(node)
    }

    return
  }

  if (!(parent instanceof Renderable)) {
    console.warn(`[WARN] Attempted to insert node ${node.id} into a non-renderable parent ${parent.id}.`)
    return
  }

  // TextRenderable.add() delegates to TextNodeRenderable.add() which only accepts
  // strings, TextNodeRenderable instances, or StyledText instances.
  // Skip non-compatible nodes like WhiteSpaceNode and CommentNode.
  if (parent instanceof TextRenderable) {
    if (node instanceof WhiteSpaceNode || node instanceof CommentNode) {
      return
    }
    if (!(node instanceof TextNodeRenderable)) {
      console.warn(`[WARN] Attempted to insert non-text node ${node.id} into TextRenderable ${parent.id}.`)
      return
    }
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

  if (parent instanceof TextNodeRenderable && node instanceof TextNodeRenderable) {
    try {
      parent.remove(node.id)
    } catch { }
    return
  }

  if (parent instanceof Renderable && node instanceof Renderable) {
    parent.remove(node.id)
    node.destroyRecursively()
  }
}
