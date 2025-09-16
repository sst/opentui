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
} from "@opentui/core"
import { createRoot, createEffect, createMemo, untrack, useContext, mergeProps, createComponent } from "solid-js"
import { getComponentCatalogue, RendererContext } from "./elements"
import { getNextId } from "./utils/id-counter"
import { log } from "./utils/log"

// Create OpenTUI renderables
function createRenderable(tagName: string): BaseRenderable {
  const id = getNextId(tagName)
  const renderer = useContext(RendererContext)
  if (!renderer) throw new Error("No renderer context found")

  const components = getComponentCatalogue()
  if (!components[tagName]) {
    throw new Error(`Unknown component: ${tagName}`)
  }

  return new components[tagName](renderer, { id })
}

// Create text nodes
function createTextNode(value: string | number): TextNodeRenderable {
  const text = typeof value === "number" ? value.toString() : value
  return TextNodeRenderable.fromString(text, { id: getNextId("text-node") })
}

// Add child to parent
function addChild(parent: BaseRenderable, child: BaseRenderable, anchor?: BaseRenderable): void {
  if (!anchor) {
    parent.add(child)
    return
  }

  // Find anchor position
  const children = getChildren(parent)
  const index = children.findIndex((c) => c.id === anchor.id)
  parent.add(child, index >= 0 ? index : undefined)
}

// Remove child from parent
function removeChild(parent: BaseRenderable, child: BaseRenderable): void {
  // TextNodeRenderable special case
  if (isTextNodeRenderable(child) && isTextNodeRenderable(parent)) {
    ;(parent as any).remove(child)
  } else {
    parent.remove(child.id)
  }

  // Clean up if orphaned
  process.nextTick(() => {
    if (!child.parent) {
      if (child instanceof Renderable) {
        child.destroyRecursively()
      } else {
        child.destroy?.()
      }
    }
  })
}

// Get children based on type
function getChildren(renderable: BaseRenderable): BaseRenderable[] {
  if (renderable instanceof TextRenderable) {
    return renderable.getTextChildren()
  } else if (isTextNodeRenderable(renderable)) {
    return renderable.children.filter((c): c is TextNodeRenderable => isTextNodeRenderable(c))
  } else {
    return renderable.getChildren()
  }
}

// Get parent (handle RootTextNodeRenderable)
function getParent(child: BaseRenderable): BaseRenderable | undefined {
  let parent = child.parent ?? undefined
  if (parent instanceof RootTextNodeRenderable) {
    parent = parent.textParent ?? undefined
  }
  return parent
}

// Apply properties to renderables
function setProperty(renderable: BaseRenderable, name: string, value: any, prev: any): void {
  // Handle events
  if (name.startsWith("on:")) {
    const eventName = name.slice(3)
    if (value) renderable.on(eventName, value)
    if (prev) renderable.off(eventName, prev)
    return
  }

  // Handle text node styles
  if (isTextNodeRenderable(renderable) && name === "style") {
    renderable.attributes |= createTextAttributes(value)
    renderable.fg = value.fg ? parseColor(value.fg) : renderable.fg
    renderable.bg = value.bg ? parseColor(value.bg) : renderable.bg
    return
  }

  // Only continue for actual Renderables
  if (!(renderable instanceof Renderable)) return

  // Handle common properties
  switch (name) {
    case "focused":
      value ? renderable.focus() : renderable.blur()
      break

    case "onChange":
      if (renderable instanceof SelectRenderable) {
        updateEvent(renderable, SelectRenderableEvents.SELECTION_CHANGED, value, prev)
      } else if (renderable instanceof TabSelectRenderable) {
        updateEvent(renderable, TabSelectRenderableEvents.SELECTION_CHANGED, value, prev)
      } else if (renderable instanceof InputRenderable) {
        updateEvent(renderable, InputRenderableEvents.CHANGE, value, prev)
      }
      break

    case "onInput":
      if (renderable instanceof InputRenderable) {
        updateEvent(renderable, InputRenderableEvents.INPUT, value, prev)
      }
      break

    case "onSubmit":
      if (renderable instanceof InputRenderable) {
        updateEvent(renderable, InputRenderableEvents.ENTER, value, prev)
      }
      break

    case "onSelect":
      if (renderable instanceof SelectRenderable) {
        updateEvent(renderable, SelectRenderableEvents.ITEM_SELECTED, value, prev)
      } else if (renderable instanceof TabSelectRenderable) {
        updateEvent(renderable, TabSelectRenderableEvents.ITEM_SELECTED, value, prev)
      }
      break

    case "style":
      Object.entries(value).forEach(([prop, val]) => {
        if (!prev || val !== prev[prop]) {
          ;(renderable as any)[prop] = val
        }
      })
      break

    case "text":
    case "content":
      ;(renderable as any)[name] = String(value)
      break

    default:
      ;(renderable as any)[name] = value
  }
}

function updateEvent(renderable: Renderable, event: string, value: any, prev: any): void {
  if (value) renderable.on(event, value)
  if (prev) renderable.off(event, prev)
}

// Simple insert for OpenTUI
function insert(parent: BaseRenderable, accessor: any, anchor?: BaseRenderable): void {
  if (typeof accessor !== "function") {
    insertValue(parent, accessor, undefined, anchor)
  } else {
    createEffect(() => {
      const value = accessor()
      insertValue(parent, value, undefined, anchor)
    })
  }
}

// Insert a value into parent
function insertValue(parent: BaseRenderable, value: any, current: any, anchor?: BaseRenderable): any {
  // Skip functions (resolve them)
  while (typeof value === "function") value = value()

  // Skip if unchanged
  if (value === current) return current

  // Clean up current content if needed
  if (current && current !== value) {
    cleanContent(parent, current, anchor)
  }

  // Handle different value types
  if (value == null || value === false) {
    return null
  }

  if (typeof value === "string" || typeof value === "number") {
    // Text content - needs wrapping if parent isn't text-compatible
    const canAcceptText = parent instanceof TextRenderable || isTextNodeRenderable(parent)

    if (canAcceptText) {
      const textNode = createTextNode(value)
      addChild(parent, textNode, anchor)
      return textNode
    } else {
      // Auto-wrap in TextRenderable
      const wrapper = createRenderable("text")
      const textNode = createTextNode(value)
      addChild(wrapper, textNode)
      addChild(parent, wrapper, anchor)
      return wrapper
    }
  }

  if (Array.isArray(value)) {
    // Simple array handling - just add all items
    const nodes: BaseRenderable[] = []
    for (const item of value) {
      const node = insertValue(parent, item, undefined, anchor)
      if (node) nodes.push(node)
    }
    return nodes
  }

  // Must be a renderable
  if (value instanceof BaseRenderable) {
    addChild(parent, value, anchor)
    return value
  }

  return current
}

// Clean up content
function cleanContent(parent: BaseRenderable, content: any, anchor?: BaseRenderable): void {
  if (!content) return

  if (Array.isArray(content)) {
    content.forEach((item) => {
      if (item instanceof BaseRenderable) {
        removeChild(parent, item)
      }
    })
  } else if (content instanceof BaseRenderable) {
    removeChild(parent, content)
  }
}

// Spread props onto a renderable
function spreadProps(renderable: BaseRenderable, props: any, skipChildren?: boolean): void {
  if (!props) return

  // Handle children
  if (!skipChildren && props.children !== undefined) {
    createEffect(() => {
      // Clear existing children first
      const children = getChildren(renderable)
      children.forEach((child) => removeChild(renderable, child))

      // Add new children
      insert(renderable, props.children)
    })
  }

  // Handle ref
  if (props.ref) {
    createEffect(() => props.ref(renderable))
  }

  // Handle other props
  createEffect(() => {
    Object.entries(props).forEach(([key, value]) => {
      if (key === "children" || key === "ref") return
      setProperty(renderable, key, value, undefined)
    })
  })
}

// Public API
export {
  createRenderable as createElement,
  createTextNode,
  addChild as insertNode,
  insert,
  createEffect as effect,
  createMemo as memo,
  createComponent,
  mergeProps,
}

export function render(code: () => any, rootRenderable: BaseRenderable) {
  let disposer: any
  createRoot((dispose: any) => {
    disposer = dispose
    insert(rootRenderable, code())
  })
  return disposer
}

export function spread(renderable: BaseRenderable, accessor: any, skipChildren?: boolean) {
  const props = typeof accessor === "function" ? accessor() : accessor
  spreadProps(renderable, props, skipChildren)
}

export function setProp(renderable: BaseRenderable, name: string, value: any, prev: any) {
  setProperty(renderable, name, value, prev)
  return value
}

export function use(fn: any, element: any, arg: any) {
  return untrack(() => fn(element, arg))
}
