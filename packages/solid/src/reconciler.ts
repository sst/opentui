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
import { elements, RendererContext, type Element } from "./elements"
import { TextNode } from "./elements/text-node"
import { getNextId } from "./utils/id-counter"
import { log } from "./utils/log"
import { useContext } from "solid-js"

export type DomNode = Renderable | TextNode

function _insertNode(parent: DomNode, node: DomNode, anchor?: DomNode): void {
  log("Inserting node:", node.id, "into parent:", parent.id, "with anchor:", anchor?.id)

  if (node instanceof TextNode) {
    return node.insert(parent, anchor)
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
    return node.remove(parent)
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
    const solidRenderer = useContext(RendererContext)
    if (!solidRenderer) {
      throw new Error("No renderer found")
    }
    const element = new elements[tagName as Element](solidRenderer, { id })
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
    textNode.replaceText(newChunk)
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
        return TextNode.getTextNodeFromChunk(chunk)
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

        return TextNode.getTextNodeFromChunk(nextSibling)
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
      const node = TextNode.getTextNodeFromChunk(current)
      if (node) {
        // log("[Reconciler] Removing chunk:", current.text);
        _removeNode(parent, node)
      }
    } else if (current instanceof StyledText) {
      // log("[Reconciler] Removing current:", current);
      for (const chunk of current.chunks) {
        const chunkNode = TextNode.getTextNodeFromChunk(chunk)
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
