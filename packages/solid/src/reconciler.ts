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
import { useContext } from "solid-js"
import { createRenderer } from "solid-js/universal"
import { getComponentCatalogue, RendererContext } from "./elements"
import { isTextChunk, TextNode } from "./elements/text-node"
import { getNextId } from "./utils/id-counter"
import { log } from "./utils/log"

export type DomNode = Renderable | TextNode | TextChunk

/**
 * Gets the id of a node, or content if it's a text chunk.
 * Intended for use in logging.
 * @param node The node to get the id of.
 * @returns Log-friendly id of the node.
 */
const logId = (node?: DomNode): string | undefined => {
  if (!node) return undefined
  if (isTextChunk(node)) {
    return node.plainText
  }
  return node.id
}

function _insertNode(parent: DomNode, node: DomNode, anchor?: DomNode): void {
  log(
    "Inserting node:",
    logId(node),
    "into parent:",
    logId(parent),
    "with anchor:",
    logId(anchor),
    node instanceof TextNode,
  )

  if (node instanceof StyledText) {
    log("Inserting styled text:", node.toString())
    for (const chunk of node.chunks) {
      _insertNode(parent, _createTextNode(chunk), anchor)
      return
    }
  }

  if (isTextChunk(node)) {
    _insertNode(parent, _createTextNode(node), anchor)
    return
  }

  if (node instanceof TextNode) {
    return node.insert(parent, anchor)
  }

  // Renderable nodes
  if (!(parent instanceof Renderable)) {
    return
  }

  if (anchor) {
    if (isTextChunk(anchor)) {
      console.warn("Cannot add non text node with text chunk anchor")
      return
    }

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
  log("Removing node:", logId(node), "from parent:", logId(parent))
  if (isTextChunk(node)) {
    const textNode = TextNode.getTextNodeFromChunk(node)
    if (textNode) {
      _removeNode(parent, textNode)
    }
  } else if (node instanceof StyledText) {
    for (const chunk of node.chunks) {
      const textNode = TextNode.getTextNodeFromChunk(chunk)
      if (!textNode) continue
      _removeNode(parent, textNode)
    }
  }
  if (node instanceof TextNode) {
    return node.remove(parent)
  }
  if (parent instanceof Renderable && node instanceof Renderable) {
    parent.remove(node.id)
    node.destroyRecursively()
  }
}

function _createTextNode(value?: string | number | boolean | TextChunk): TextNode {
  log("Creating text node:", value)
  const chunk: TextChunk =
    value && isTextChunk(value)
      ? value
      : {
          __isChunk: true,
          text: new TextEncoder().encode(`${value}`),
          plainText: `${value}`,
        }
  const textNode = new TextNode(chunk)
  return textNode
}

export const {
  render: _render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
} = createRenderer<DomNode>({
  createElement(tagName: string): DomNode {
    log("Creating element:", tagName)
    const id = getNextId(tagName)
    const solidRenderer = useContext(RendererContext)
    if (!solidRenderer) {
      throw new Error("No renderer found")
    }
    const elements = getComponentCatalogue()

    if (!elements[tagName]) {
      throw new Error(`[Reconciler] Unknown component type: ${tagName}`)
    }

    const element = new elements[tagName](solidRenderer, { id })
    log("Element created with id:", id)
    return element
  },

  createTextNode: _createTextNode,

  replaceText(textNode: TextNode, value: string): void {
    log("Replacing text:", value, "in node:", logId(textNode))
    if (textNode instanceof Renderable) return
    if (isTextChunk(textNode)) {
      console.warn("Cannot replace text on text chunk", logId(textNode))
      return
    }
    const newChunk: TextChunk = {
      __isChunk: true,
      text: new TextEncoder().encode(value),
      plainText: value,
    }
    textNode.replaceText(newChunk)
  },

  setProperty(node: DomNode, name: string, value: any, prev: any): void {
    // log("Setting property:", name, "on node:", node.id);
    if (node instanceof TextNode || isTextChunk(node)) {
      // TODO: implement <b> and <i> tags property setters here
      console.warn("Cannot set property on text node:", logId(node))
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

  getParentNode(childNode: DomNode): DomNode | undefined {
    log("Getting parent of node:", logId(childNode))
    let node = childNode as Renderable | TextNode
    if (isTextChunk(childNode)) {
      const parentTextNode = TextNode.getTextNodeFromChunk(childNode)
      if (!parentTextNode) return undefined
      node = parentTextNode
    }
    const parent = node.parent

    if (!parent) {
      log("No parent found for node:", logId(node))
      return undefined
    }

    log("Parent found:", logId(parent), "for node:", logId(node))
    return parent
  },

  getFirstChild(node: DomNode): DomNode | undefined {
    log("Getting first child of node:", logId(node))
    if (node instanceof TextRenderable) {
      const chunk = node.content.chunks[0]
      if (chunk) {
        return TextNode.getTextNodeFromChunk(chunk)
      } else {
        return undefined
      }
    }
    if (node instanceof TextNode || isTextChunk(node)) {
      return undefined
    }
    const firstChild = node.getChildren()[0]

    if (!firstChild) {
      log("No first child found for node:", logId(node))
      return undefined
    }

    log("First child found:", logId(firstChild), "for node:", logId(node))
    return firstChild
  },

  getNextSibling(node: DomNode): DomNode | undefined {
    log("Getting next sibling of node:", logId(node))
    if (isTextChunk(node)) {
      // unreachable
      console.warn("Cannot get next sibling of text chunk")
      return undefined
    }
    const parent = node.parent
    if (!parent) {
      log("No parent found for node:", logId(node))
      return undefined
    }

    if (node instanceof TextNode) {
      if (parent instanceof TextRenderable) {
        const siblings = parent.content.chunks
        const index = siblings.indexOf(node.chunk)

        if (index === -1 || index === siblings.length - 1) {
          log("No next sibling found for node:", logId(node))
          return undefined
        }

        const nextSibling = siblings[index + 1]

        if (!nextSibling) {
          log("Next sibling is null for node:", logId(node))
          return undefined
        }

        return TextNode.getTextNodeFromChunk(nextSibling)
      }
      console.warn("Text parent is not a text node:", logId(node))
      return undefined
    }

    const siblings = parent.getChildren()
    const index = siblings.indexOf(node)

    if (index === -1 || index === siblings.length - 1) {
      log("No next sibling found for node:", logId(node))
      return undefined
    }

    const nextSibling = siblings[index + 1]

    if (!nextSibling) {
      log("Next sibling is null for node:", logId(node))
      return undefined
    }

    log("Next sibling found:", logId(nextSibling), "for node:", logId(node))
    return nextSibling
  },
})
