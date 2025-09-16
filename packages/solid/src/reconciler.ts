/* @refresh skip */
import {
  BaseRenderable,
  createTextAttributes,
  InputRenderable,
  InputRenderableEvents,
  isTextNodeRenderable,
  parseColor,
  Renderable,
  RootTextNodeRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextNodeRenderable,
  TextRenderable,
  type TextNodeOptions,
} from "@opentui/core"
import { createRoot, createEffect, createMemo, untrack, useContext, mergeProps, createComponent } from "solid-js"
import { getComponentCatalogue, RendererContext } from "./elements"
import { getNextId } from "./utils/id-counter"
import { log } from "./utils/log"

class TextNode extends TextNodeRenderable {
  public static override fromString(text: string, options: Partial<TextNodeOptions> = {}): TextNode {
    const node = new TextNode(options)
    node.add(text)
    return node
  }
}

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

const getNodeChildren = (node: DomNode): any[] => {
  if (node instanceof TextRenderable) {
    return node.getTextChildren()
  } else if (isTextNodeRenderable(node)) {
    // Filter out string children for TextNodeRenderables, only return TextNodeRenderable children
    return node.children.filter((child): child is TextNodeRenderable => isTextNodeRenderable(child))
  } else {
    return node.getChildren()
  }
}

function createElement(tagName: string): DomNode {
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
}

function createTextNode(value: string | number): TextNode {
  log("Creating text node:", value)

  const id = getNextId("text-node")

  if (typeof value === "number") {
    value = value.toString()
  }

  return TextNode.fromString(value, { id })
}

function isTextNode(node: DomNode): boolean {
  return isTextNodeRenderable(node)
}

function replaceText(textNode: DomNode, value: string): void {
  log("Replacing text:", value, "in node:", logId(textNode))

  if (!isTextNodeRenderable(textNode)) return
  ;(textNode as TextNodeRenderable).replace(value, 0)
}

function insertNode(parent: DomNode, node: DomNode, anchor?: DomNode): void {
  log(
    "Inserting node:",
    logId(node),
    "into parent:",
    logId(parent),
    "with anchor:",
    logId(anchor),
    node instanceof TextNode,
  )

  // Text nodes should only be inserted into TextRenderable or TextNodeRenderable
  // This is now handled at higher levels by auto-wrapping text in TextRenderable
  if (isTextNodeRenderable(node)) {
    if (!(parent instanceof TextRenderable) && !isTextNodeRenderable(parent)) {
      // This should not happen if auto-wrapping is working correctly
      // But don't throw to avoid breaking during intermediate reconciliation states
      log(`[DEBUG] Text node ${node.id} in non-text parent ${parent.id} - should be auto-wrapped`)
    }
  }

  // Renderable nodes
  if (!(parent instanceof BaseRenderable)) {
    log("[INSERT]", "Tried to mount a non base renderable")
    throw new Error(`Tried to mount a non base renderable ${JSON.stringify(parent)} :: ${JSON.stringify(node)}`)
  }

  if (!anchor) {
    parent.add(node)
    return
  }

  // Special handling for TextNodeRenderables which use insertBefore differently
  if (isTextNodeRenderable(node) && isTextNodeRenderable(parent)) {
    // TextNodeRenderable.insertBefore expects the actual anchor node
    ;(parent as any).insertBefore(node, anchor)
    return
  }

  const children = getNodeChildren(parent)

  const anchorIndex = children.findIndex((el) => el.id === anchor.id)
  if (anchorIndex === -1) {
    log("[INSERT]", "Could not find anchor", logId(parent), logId(anchor), "[children]", ...children.map((c) => c.id))
  }

  parent.add(node, anchorIndex)
}

function removeNode(parent: DomNode, node: DomNode): void {
  log("Removing node:", logId(node), "from parent:", logId(parent))

  // Handle TextNodeRenderable removal differently
  if (isTextNodeRenderable(node) && isTextNodeRenderable(parent)) {
    // TextNodeRenderable.remove expects the actual child object
    ;(parent as any).remove(node)
  } else {
    // Regular renderables use ID-based removal
    parent.remove(node.id)
  }

  process.nextTick(() => {
    if ((node instanceof Renderable || isTextNodeRenderable(node)) && !node.parent) {
      if (node instanceof Renderable) {
        node.destroyRecursively()
      } else {
        // TextNodeRenderables need cleanup too
        node.destroy?.()
      }
      return
    }
  })
}

function getParentNode(childNode: DomNode): DomNode | undefined {
  log("Getting parent of node:", logId(childNode))

  let parent = childNode.parent ?? undefined
  if (parent instanceof RootTextNodeRenderable) {
    parent = parent.textParent ?? undefined
  }
  return parent
}

function getFirstChild(node: DomNode): DomNode | undefined {
  log("Getting first child of node:", logId(node))

  const firstChild = getNodeChildren(node)[0]

  if (!firstChild) {
    log("No first child found for node:", logId(node))
    return undefined
  }

  log("First child found:", logId(firstChild), "for node:", logId(node))
  return firstChild
}

function getNextSibling(node: DomNode): DomNode | undefined {
  log("Getting next sibling of node:", logId(node))
  if (!node) throw new Error("Node is undefined")
  const parent = getParentNode(node)
  if (!parent) {
    log("No parent found for node:", logId(node))
    return undefined
  }
  const siblings = getNodeChildren(parent)

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
}

function setProperty(node: DomNode, name: string, value: any, prev: any): void {
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

  if (isTextNodeRenderable(node)) {
    if (name !== "style") {
      return
    }
    node.attributes |= createTextAttributes(value)
    node.fg = value.fg ? parseColor(value.fg) : node.fg
    node.bg = value.bg ? parseColor(value.bg) : node.bg
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
}

// Reconciliation logic adapted from universal renderer
function insert(parent: DomNode, accessor: any, marker?: DomNode, initial?: any): void {
  if (marker !== undefined && !initial) initial = []
  if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker)
  createEffect((current: any) => insertExpression(parent, accessor(), current, marker), initial)
}

function insertExpression(parent: DomNode, value: any, current: any, marker?: DomNode, unwrapArray?: boolean): any {
  while (typeof current === "function") current = current()
  if (value === current) return current
  const t = typeof value,
    multi = marker !== undefined

  if (t === "string" || t === "number") {
    if (t === "number") value = value.toString()

    // Check if parent can accept text nodes
    const canAcceptText = parent instanceof TextRenderable || isTextNodeRenderable(parent)

    if (!canAcceptText) {
      // Auto-wrap in a TextRenderable and maintain state consistency
      // Check if current is already an auto-wrapped text element
      if (current && current instanceof TextRenderable && (current as any)._autoWrapped) {
        // Update existing wrapped text
        const textNode = getFirstChild(current)
        if (textNode && isTextNode(textNode)) {
          replaceText(textNode, value)
        } else {
          // Create new text node inside wrapper
          const newTextNode = createTextNode(value)
          cleanChildren(current, textNode, undefined, newTextNode)
        }
        return current
      } else {
        // Create new wrapper
        const wrapper = createElement("text")
        ;(wrapper as any)._autoWrapped = true
        const textNode = createTextNode(value)
        insertNode(wrapper, textNode)

        // Replace current with wrapper
        if (multi) {
          current = cleanChildren(parent, current, marker, wrapper)
        } else {
          if (current && current !== "") {
            const firstChild = getFirstChild(parent)
            if (firstChild) {
              replaceNode(parent, wrapper, firstChild)
            } else {
              insertNode(parent, wrapper, marker)
            }
          } else {
            insertNode(parent, wrapper, marker)
          }
          current = wrapper
        }
      }
    } else {
      // Parent can accept text nodes directly
      if (multi) {
        let node = current[0]
        if (node && isTextNode(node)) {
          replaceText(node, value)
        } else {
          node = createTextNode(value)
        }
        current = cleanChildren(parent, current, marker, node)
      } else {
        if (current !== "" && typeof current === "string") {
          const firstChild = getFirstChild(parent)
          if (firstChild && isTextNode(firstChild)) {
            replaceText(firstChild, value)
            current = value
          } else {
            cleanChildren(parent, current, marker, createTextNode(value))
            current = value
          }
        } else {
          cleanChildren(parent, current, marker, createTextNode(value))
          current = value
        }
      }
    }
  } else if (value == null || t === "boolean") {
    // Only clean if we actually have something to clean
    if (current != null && current !== "") {
      current = cleanChildren(parent, current, marker)
    }
  } else if (t === "function") {
    createEffect(() => {
      let v = value()
      while (typeof v === "function") v = v()
      current = insertExpression(parent, v, current, marker)
    })
    return () => current
  } else if (Array.isArray(value)) {
    const array: any[] = []
    if (normalizeIncomingArray(array, value, unwrapArray, parent)) {
      createEffect(() => (current = insertExpression(parent, array, current, marker, true)))
      return () => current
    }
    if (array.length === 0) {
      const replacement = cleanChildren(parent, current, marker)
      if (multi) return (current = replacement)
    } else {
      if (Array.isArray(current)) {
        if (current.length === 0) {
          appendNodes(parent, array, marker)
        } else reconcileArrays(parent, current, array)
      } else if (current == null || current === "") {
        appendNodes(parent, array)
      } else {
        reconcileArrays(parent, (multi && current) || [getFirstChild(parent)], array)
      }
    }
    current = array
  } else {
    if (Array.isArray(current)) {
      if (multi) return (current = cleanChildren(parent, current, marker, value))
      cleanChildren(parent, current, undefined, value)
    } else if (current == null || current === "" || !getFirstChild(parent)) {
      insertNode(parent, value)
    } else {
      const firstChild = getFirstChild(parent)
      if (firstChild) {
        replaceNode(parent, value, firstChild)
      }
    }
    current = value
  }

  return current
}

function normalizeIncomingArray(normalized: any[], array: any[], unwrap?: boolean, parent?: DomNode): boolean {
  let dynamic = false
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i],
      t
    if (item == null || item === true || item === false) {
      // matches null, undefined, true or false
      // skip
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item, false, parent) || dynamic
    } else if ((t = typeof item) === "string" || t === "number") {
      // Check if parent can accept text nodes
      const canAcceptText = parent && (parent instanceof TextRenderable || isTextNodeRenderable(parent))

      if (canAcceptText) {
        normalized.push(createTextNode(item))
      } else {
        // Auto-wrap in TextRenderable for non-text parents
        const textElement = createElement("text")
        ;(textElement as any)._autoWrapped = true // Mark as auto-wrapped
        const textNode = createTextNode(item)
        insertNode(textElement, textNode)
        normalized.push(textElement)
      }
    } else if (t === "function") {
      if (unwrap) {
        while (typeof item === "function") item = item()
        dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item], false, parent) || dynamic
      } else {
        normalized.push(item)
        dynamic = true
      }
    } else normalized.push(item)
  }
  return dynamic
}

function reconcileArrays(parentNode: DomNode, a: any[], b: any[]): void {
  let bLength = b.length,
    aEnd = a.length,
    bEnd = bLength,
    aStart = 0,
    bStart = 0,
    after = getNextSibling(a[aEnd - 1]),
    map = null

  while (aStart < aEnd || bStart < bEnd) {
    // common prefix
    if (a[aStart] === b[bStart]) {
      aStart++
      bStart++
      continue
    }
    // common suffix
    while (a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--
      bEnd--
    }
    // append
    if (aEnd === aStart) {
      const node = bEnd < bLength ? (bStart ? getNextSibling(b[bStart - 1]) : b[bEnd - bStart]) : after

      while (bStart < bEnd) insertNode(parentNode, b[bStart++], node)
      // remove
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        if (!map || !map.has(a[aStart])) removeNode(parentNode, a[aStart])
        aStart++
      }
      // swap backward
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      const node = getNextSibling(a[--aEnd])
      insertNode(parentNode, b[bStart++], getNextSibling(a[aStart++]))
      insertNode(parentNode, b[--bEnd], node)

      a[aEnd] = b[bEnd]
      // fallback to map
    } else {
      if (!map) {
        map = new Map()
        let i = bStart

        while (i < bEnd) map.set(b[i], i++)
      }

      const index = map.get(a[aStart])
      if (index != null) {
        if (bStart < index && index < bEnd) {
          let i = aStart,
            sequence = 1,
            t

          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i])) == null || t !== index + sequence) break
            sequence++
          }

          if (sequence > index - bStart) {
            const node = a[aStart]
            while (bStart < index) insertNode(parentNode, b[bStart++], node)
          } else replaceNode(parentNode, b[bStart++], a[aStart++])
        } else aStart++
      } else removeNode(parentNode, a[aStart++])
    }
  }
}

function cleanChildren(parent: DomNode, current: any, marker?: DomNode, replacement?: DomNode): any {
  if (marker === undefined) {
    // Only clean all children if we're explicitly replacing with something or current is non-empty
    if (replacement || (current && current !== "")) {
      let removed
      while ((removed = getFirstChild(parent))) removeNode(parent, removed)
      replacement && insertNode(parent, replacement)
    }
    return replacement || ""
  }

  // If no replacement and parent can't accept text, create an empty text element instead
  let node = replacement
  if (!node) {
    const canAcceptText = parent instanceof TextRenderable || isTextNodeRenderable(parent)
    if (canAcceptText) {
      node = createTextNode("")
    } else {
      // Create an empty text element for non-text parents
      node = createElement("text")
      const emptyTextNode = createTextNode("")
      insertNode(node, emptyTextNode)
    }
  }

  if (current.length) {
    let inserted = false
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i]
      if (node !== el) {
        const isParent = getParentNode(el) === parent
        if (!inserted && !i) isParent ? replaceNode(parent, node, el) : insertNode(parent, node, marker)
        else isParent && removeNode(parent, el)
      } else inserted = true
    }
  } else insertNode(parent, node, marker)
  return [node]
}

function appendNodes(parent: DomNode, array: any[], marker?: DomNode): void {
  for (let i = 0, len = array.length; i < len; i++) insertNode(parent, array[i], marker)
}

function replaceNode(parent: DomNode, newNode: DomNode, oldNode: DomNode): void {
  insertNode(parent, newNode, oldNode)
  removeNode(parent, oldNode)
}

function spreadExpression(node: DomNode, props: any, prevProps: any = {}, skipChildren?: boolean): any {
  props || (props = {})
  if (!skipChildren) {
    createEffect(() => (prevProps.children = insertExpression(node, props.children, prevProps.children)))
  }
  createEffect(() => props.ref && props.ref(node))
  createEffect(() => {
    for (const prop in props) {
      if (prop === "children" || prop === "ref") continue
      const value = props[prop]
      if (value === prevProps[prop]) continue
      setProperty(node, prop, value, prevProps[prop])
      prevProps[prop] = value
    }
  })
  return prevProps
}

// Export the renderer API
export {
  createElement,
  createTextNode,
  insertNode,
  insert,
  createEffect as effect,
  createMemo as memo,
  createComponent,
  mergeProps,
}

export function render(code: () => any, element: DomNode) {
  let disposer: any
  createRoot((dispose: any) => {
    disposer = dispose
    insert(element, code())
  })
  return disposer
}

export function spread(node: DomNode, accessor: any, skipChildren?: boolean) {
  if (typeof accessor === "function") {
    createEffect((current: any) => spreadExpression(node, accessor(), current, skipChildren))
  } else spreadExpression(node, accessor, undefined, skipChildren)
}

export function setProp(node: DomNode, name: string, value: any, prev: any) {
  setProperty(node, name, value, prev)
  return value
}

export function use(fn: any, element: any, arg: any) {
  return untrack(() => fn(element, arg))
}
