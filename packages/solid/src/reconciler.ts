/* @refresh skip */
import {
  InputRenderable,
  InputRenderableEvents,
  Renderable,
  SelectRenderable,
  SelectRenderableEvents,
  StyledText,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable,
  type TextChunk,
} from "@opentui/core"
import { createRenderer } from "solid-js/universal"
import { elements, type Element } from "./elements"
import { getNextId } from "./utils/id-counter"

const GHOST_NODE_TAG = "text-ghost" as const

class TextNode {
  id: string
  chunk: TextChunk
  parent?: Renderable
  textParent?: TextRenderable

  constructor(chunk: TextChunk) {
    this.id = getNextId("text-node")
    this.chunk = chunk
  }
}

const ChunkToTextNodeMap = new WeakMap<TextChunk, TextNode>()

type DomNode = Renderable | TextNode

const log = (...args: any[]) => {
  console.log("[Reconciler]", ...args)
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

  _insertNode(parent, ghostNode, anchor)

  return ghostNode
}

function insertTextNode(parent: DomNode, node: TextNode, anchor?: DomNode | null): void {
  if (!(parent instanceof Renderable)) {
    console.warn("Attaching text node to parent text node, impossible")
    return
  }
  log("Inserting text node:", node.id, "into parent:", parent.id, "with anchor:", anchor?.id)

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

function removeTextNode(parent: DomNode, node: TextNode): void {
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

function _insertNode(parent: DomNode, node: DomNode, anchor?: DomNode | null): void {
  log("Inserting node:", node.id, "into parent:", parent.id, "with anchor:", anchor?.id)

  if (node instanceof TextNode) {
    return insertTextNode(parent, node, anchor)
  }

  // Renderable nodes
  if (!(parent instanceof Renderable)) {
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

function _removeNode(parent: DomNode, node: DomNode): void {
  log("Removing node:", node.id, "from parent:", parent.id)
  if (node instanceof TextNode) {
    return removeTextNode(parent, node)
  }
  if (parent instanceof Renderable && node instanceof Renderable) {
    parent.remove(node.id)
    node.destroyRecursively()
  }
}

export const {
  render: _render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert: solidUniversalInsert,
  spread,
  setProp,
  mergeProps,
  use,
} = createRenderer<DomNode>({
  createElement(tagName: string): DomNode {
    log("Creating element:", tagName)
    const id = getNextId(tagName)
    const element = new elements[tagName as Element](id, {})
    log("Element created with id:", id)
    return element
  },

  createTextNode(value: string | number | boolean | TextChunk): DomNode {
    log("Creating text node:", value)
    const chunk: TextChunk =
      typeof value === "object" && "__isChunk" in value
        ? value
        : {
            __isChunk: true,
            text: new TextEncoder().encode(`${value}`),
            plainText: `${value}`,
          }
    const textNode = new TextNode(chunk)
    ChunkToTextNodeMap.set(chunk, textNode)
    return textNode
  },

  replaceText(textNode: DomNode, value: string): void {
    log("Replacing text:", value, "in node:", textNode.id)
    if (textNode instanceof Renderable) return
    const newChunk: TextChunk = {
      __isChunk: true,
      text: new TextEncoder().encode(value),
      plainText: value,
    }

    const textParent = textNode.textParent
    if (!textParent) {
      log("No parent found for text node:", textNode.id)
      return
    }
    if (textParent instanceof TextRenderable) {
      textParent.content = textParent.content.replace(newChunk, textNode.chunk)

      textNode.chunk = newChunk
      ChunkToTextNodeMap.set(newChunk, textNode)
    }
  },

  setProperty(node: DomNode, name: string, value: any, prev: any): void {
    // log("Setting property:", name, "on node:", node.id);
    if (node instanceof TextNode) {
      // TODO: implement <b> and <i> tags property setters here
      console.warn("Cannot set property on text node:", node.id)
      return
    }

    if (name.startsWith("on:")) {
      const eventName = name.slice(3)
      if (value) {
        node.on(eventName, value)
      }
      if (prev) {
        node.off(eventName, prev)
      }

      return
    }

    switch (name) {
      case "focused":
        if (value) {
          node.focus()
        } else {
          node.blur()
        }
        break
      case "onChange":
        let event: string | undefined = undefined
        if (node instanceof SelectRenderable) {
          event = SelectRenderableEvents.SELECTION_CHANGED
        } else if (node instanceof TabSelectRenderable) {
          event = TabSelectRenderableEvents.SELECTION_CHANGED
        } else if (node instanceof InputRenderable) {
          event = InputRenderableEvents.CHANGE
        }
        if (!event) break

        if (value) {
          node.on(event, value)
        }
        if (prev) {
          node.off(event, prev)
        }
        break
      case "onInput":
        if (node instanceof InputRenderable) {
          if (value) {
            node.on(InputRenderableEvents.INPUT, value)
          }

          if (prev) {
            node.off(InputRenderableEvents.INPUT, prev)
          }
        }

        break
      case "onSubmit":
        if (node instanceof InputRenderable) {
          if (value) {
            node.on(InputRenderableEvents.ENTER, value)
          }

          if (prev) {
            node.off(InputRenderableEvents.ENTER, prev)
          }
        }
        break
      case "onSelect":
        if (node instanceof SelectRenderable) {
          if (value) {
            node.on(SelectRenderableEvents.ITEM_SELECTED, value)
          }

          if (prev) {
            node.off(SelectRenderableEvents.ITEM_SELECTED, prev)
          }
        } else if (node instanceof TabSelectRenderable) {
          if (value) {
            node.on(TabSelectRenderableEvents.ITEM_SELECTED, value)
          }

          if (prev) {
            node.off(TabSelectRenderableEvents.ITEM_SELECTED, prev)
          }
        }
        break
      case "style":
        for (const prop in value) {
          const propVal = value[prop]
          if (prev !== undefined && propVal === prev[prop]) continue
          // @ts-expect-error todo validate if prop is actually settable
          node[prop] = propVal
        }
        break
      case "text":
      case "content":
        // @ts-expect-error todo validate if prop is actually settable
        node[name] = typeof value === "string" ? value : Array.isArray(value) ? value.join("") : `${value}`
        break
      default:
        // @ts-expect-error todo validate if prop is actually settable
        node[name] = value
    }
  },

  isTextNode(node: DomNode): boolean {
    return node instanceof TextNode
  },

  insertNode: _insertNode,

  removeNode: _removeNode,

  getParentNode(node: DomNode): DomNode | undefined {
    log("Getting parent of node:", node.id)
    const parent = node.parent

    if (!parent) {
      log("No parent found for node:", node.id)
      return undefined
    }

    log("Parent found:", parent.id, "for node:", node.id)
    return parent
  },

  getFirstChild(node: DomNode): DomNode | undefined {
    log("Getting first child of node:", node.id)
    if (node instanceof TextRenderable) {
      const chunk = node.content.chunks[0]
      if (chunk) {
        return ChunkToTextNodeMap.get(chunk)
      } else {
        return undefined
      }
    }
    if (node instanceof TextNode) {
      return undefined
    }
    const firstChild = node.getChildren()[0]

    if (!firstChild) {
      log("No first child found for node:", node.id)
      return undefined
    }

    log("First child found:", firstChild.id, "for node:", node.id)
    return firstChild
  },

  getNextSibling(node: DomNode): DomNode | undefined {
    log("Getting next sibling of node:", node.id)
    const parent = node.parent
    if (!parent) {
      log("No parent found for node:", node.id)
      return undefined
    }

    if (node instanceof TextNode) {
      if (parent instanceof TextRenderable) {
        const siblings = parent.content.chunks
        const index = siblings.indexOf(node.chunk)

        if (index === -1 || index === siblings.length - 1) {
          log("No next sibling found for node:", node.id)
          return undefined
        }

        const nextSibling = siblings[index + 1]

        if (!nextSibling) {
          log("Next sibling is null for node:", node.id)
          return undefined
        }

        return ChunkToTextNodeMap.get(nextSibling)
      }
      console.warn("Text parent is not a text node:", node.id)
      return undefined
    }

    const siblings = parent.getChildren()
    const index = siblings.indexOf(node)

    if (index === -1 || index === siblings.length - 1) {
      log("No next sibling found for node:", node.id)
      return undefined
    }

    const nextSibling = siblings[index + 1]

    if (!nextSibling) {
      log("Next sibling is null for node:", node.id)
      return undefined
    }

    log("Next sibling found:", nextSibling.id, "for node:", node.id)
    return nextSibling
  },
})

const insertStyledText = (parent: any, value: any, current: any, marker: any) => {
  while (typeof current === "function") current = current()
  if (value === current) return current

  if (current) {
    if (typeof current === "object" && "__isChunk" in current) {
      // log("[Reconciler] Removing current:", current);
      const node = ChunkToTextNodeMap.get(current)
      if (node) {
        // log("[Reconciler] Removing chunk:", current.text);
        _removeNode(parent, node)
      }
    } else if (current instanceof StyledText) {
      // log("[Reconciler] Removing current:", current);
      for (const chunk of current.chunks) {
        const chunkNode = ChunkToTextNodeMap.get(chunk)
        if (!chunkNode) continue
        // log("[Reconciler] Removing styled text:", chunk.text);
        _removeNode(parent, chunkNode)
      }
    }
  }

  if (value instanceof StyledText) {
    log("Inserting styled text:", value.toString())
    for (const chunk of value.chunks) {
      // @ts-expect-error: Sending chunk to createTextNode which is not typed but supported
      insertNode(parent, createTextNode(chunk), marker)
    }
    return value
  } else if (value && typeof value === "object" && "__isChunk" in value) {
    insertNode(parent, createTextNode(value), marker)
    return value
  }
  return solidUniversalInsert(parent, value, marker, current)
}

export const insert: typeof solidUniversalInsert = (parent, accessor, marker, initial) => {
  if (marker !== undefined && !initial) initial = []
  if (typeof accessor !== "function") return insertStyledText(parent, accessor, initial, marker)
  // @ts-expect-error: Copied from js implementation, not typed
  effect((current) => insertStyledText(parent, accessor(), current, marker), initial)
}
