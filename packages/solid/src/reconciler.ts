/* @refresh skip */
import {
  BaseRenderable,
  InputRenderable,
  InputRenderableEvents,
  isTextNodeRenderable,
  Renderable,
  SelectRenderable,
  SelectRenderableEvents,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextNodeRenderable,
  TextRenderable,
} from "@opentui/core"
import { useContext } from "solid-js"
import { createRenderer } from "solid-js/universal"
import { getComponentCatalogue, RendererContext } from "./elements"
import { getNextId } from "./utils/id-counter"
import { log } from "./utils/log"

export type DomNode = BaseRenderable

/**
 * Gets the id of a node, or content if it's a text chunk.
 * Intended for use in logging.
 * @param node The node to get the id of.
 * @returns Log-friendly id of the node.
 */
const logId = (node?: DomNode): string | undefined => {
  if (!node) return undefined
  return node.id
}

const getNodeChildren = (node: DomNode) => {
  let children
  if (node instanceof TextRenderable) {
    children = node.getTextChildren()
  } else {
    children = node.getChildren()
  }
  return children
}

function _insertNode(parent: DomNode, node: DomNode, anchor?: DomNode): void {
  log(
    "Inserting node:",
    logId(node),
    "into parent:",
    logId(parent),
    "with anchor:",
    logId(anchor),
    node instanceof TextNodeRenderable,
  )

  if (isTextNodeRenderable(node)) {
    if (!(parent instanceof TextRenderable) && !isTextNodeRenderable(parent)) {
      // TODO random text nodes
      throw new Error("Unhandled")
    }
  }

  // Renderable nodes
  if (!(parent instanceof BaseRenderable)) {
    log("[INSERT]", "Tried to mount a non base renderable")
    return
  }

  if (!anchor) {
    parent.add(node)
    return
  }

  const children = getNodeChildren(parent)

  const anchorIndex = children.findIndex((el) => el.id === anchor.id)
  if (anchorIndex === -1) {
    log("[INSERT]", "Could not find anchor", logId(parent), logId(anchor), "[children]", ...children.map((c) => c.id))
  }

  parent.add(node, anchorIndex)
}

function _removeNode(parent: DomNode, node: DomNode): void {
  log("Removing node:", logId(node), "from parent:", logId(parent))

  parent.remove(node.id)
  process.nextTick(() => {
    if (!node.parent) {
      if (node instanceof Renderable) {
        node.destroyRecursively()
      } else {
        log("[REMOVE]", "handle destroyed text node")
      }
    }
  })
}

function _createTextNode(value: string | number): TextNodeRenderable {
  log("Creating text node:", value)

  const id = getNextId("text-node")
  const textNode = new TextNodeRenderable({ id })

  if (typeof value === "number") {
    value = value.toString()
  }
  textNode.add(value)
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

  replaceText(textNode: TextNodeRenderable, value: string): void {
    log("Replacing text:", value, "in node:", logId(textNode))
    if (!(textNode instanceof TextNodeRenderable)) return
    textNode.clear()
    textNode.add(value)
  },

  setProperty(node: DomNode, name: string, value: any, prev: any): void {
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
        if (!(node instanceof Renderable)) return
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
    return node instanceof TextNodeRenderable
  },

  insertNode: _insertNode,

  removeNode: _removeNode,

  getParentNode(childNode: DomNode): DomNode | undefined {
    log("Getting parent of node:", logId(childNode))
    return childNode.parent ?? undefined
  },

  getFirstChild(node: DomNode): DomNode | undefined {
    log("Getting first child of node:", logId(node))

    const firstChild = getNodeChildren(node)[0]

    if (!firstChild) {
      log("No first child found for node:", logId(node))
      return undefined
    }

    log("First child found:", logId(firstChild), "for node:", logId(node))
    return firstChild
  },

  getNextSibling(node: DomNode): DomNode | undefined {
    log("Getting next sibling of node:", logId(node))

    const parent = node.parent
    if (!parent) {
      log("No parent found for node:", logId(node))
      return undefined
    }
    const siblings = getNodeChildren(node)

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
