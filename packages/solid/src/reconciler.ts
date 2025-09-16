/* @refresh skip */
import {
  BaseRenderable,
  createTextAttributes,
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
import { createRoot, createEffect, createMemo, untrack, useContext, mergeProps, createComponent } from "solid-js"
import { getComponentCatalogue, RendererContext } from "./elements"
import { getNextId } from "./utils/id-counter"
import { log } from "./utils/log"

// Type definitions for the reconciler
type Accessor<T> = T | (() => T)
type Props = Record<string, any>
type Disposer = () => void
type EffectValue = BaseRenderable | BaseRenderable[] | null | undefined

// Event handler types
type EventHandler<T = any> = (...args: T[]) => void
type StyleObject = {
  fg?: string
  bg?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  [key: string]: any
}

// Create OpenTUI renderables
function createRenderable(tagName: string): BaseRenderable {
  const id = getNextId(tagName)
  const renderer = useContext(RendererContext)
  if (!renderer) throw new Error("No renderer context found")

  const components = getComponentCatalogue()
  const ComponentClass = components[tagName]
  if (!ComponentClass) {
    throw new Error(`Unknown component: ${tagName}`)
  }

  const renderable = new ComponentClass(renderer, { id })
  log("[CREATE] Created renderable:", tagName, "with id:", id)
  return renderable
}

// Create text nodes
function createTextNode(value: string | number): TextNodeRenderable {
  const text = typeof value === "number" ? value.toString() : value
  const id = getNextId("text-node")
  log("[CREATE] Creating text node:", text, "with id:", id)
  return TextNodeRenderable.fromString(text, { id })
}

// Add child to parent
function addChild(parent: BaseRenderable, child: BaseRenderable, anchor?: BaseRenderable): void {
  log("[ADD] Adding child:", child.id, "to parent:", parent.id, "anchor:", anchor?.id)

  if (!anchor) {
    parent.add(child)
    return
  }

  // Find anchor position
  const children = getChildren(parent)
  const index = children.findIndex((c) => c.id === anchor.id)
  log("[ADD] Found anchor at index:", index)
  parent.add(child, index >= 0 ? index : undefined)
}

// Remove child from parent
function removeChild(parent: BaseRenderable, child: BaseRenderable): void {
  log("[REMOVE] Removing child:", child.id, "from parent:", parent.id)

  // TextNodeRenderable special case
  if (isTextNodeRenderable(child) && isTextNodeRenderable(parent)) {
    parent.remove(child)
  } else {
    parent.remove(child.id)
  }

  // Clean up if orphaned
  process.nextTick(() => {
    if (!child.parent) {
      log("[DESTROY] Destroying orphaned node:", child.id)
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

// Apply properties to renderables
function setProperty(renderable: BaseRenderable, name: string, value: any, prev: any): void {
  // Handle events
  if (name.startsWith("on:")) {
    const eventName = name.slice(3)
    if (value) renderable.on(eventName, value as EventHandler)
    if (prev) renderable.off(eventName, prev as EventHandler)
    return
  }

  // Handle text node styles
  if (isTextNodeRenderable(renderable) && name === "style") {
    const styleValue = value as StyleObject
    renderable.attributes |= createTextAttributes(styleValue)
    renderable.fg = styleValue.fg ?? renderable.fg
    renderable.bg = styleValue.bg ?? renderable.bg
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
      const styles = value as Record<string, any>
      const prevStyles = prev as Record<string, any> | undefined
      Object.entries(styles).forEach(([prop, val]) => {
        if (!prevStyles || val !== prevStyles[prop]) {
          ;(renderable as Record<string, any>)[prop] = val
        }
      })
      break

    case "text":
    case "content":
      ;(renderable as Record<string, any>)[name] = String(value)
      break

    default:
      ;(renderable as Record<string, any>)[name] = value
  }
}

function updateEvent(renderable: Renderable, event: string, value: any, prev: any): void {
  if (value) renderable.on(event, value as EventHandler)
  if (prev) renderable.off(event, prev as EventHandler)
}

// Simple insert for OpenTUI
function insert(parent: BaseRenderable, accessor: Accessor<any>, anchor?: BaseRenderable): void {
  log("[INSERT] Starting insert into parent:", parent.id, "accessor type:", typeof accessor)

  if (typeof accessor !== "function") {
    // Static value - insert once
    log("[INSERT] Static value")
    insertExpression(parent, accessor, undefined, anchor)
  } else {
    // Reactive value - track changes
    log("[INSERT] Reactive value - setting up effect")
    createEffect((current: EffectValue) => {
      log("[INSERT] Effect running, current:", current != null ? "exists" : "null")
      const value = accessor()
      const result = insertExpression(parent, value, current, anchor)

      return result
    })
  }
}

// Insert/update expression in parent
function insertExpression(
  parent: BaseRenderable,
  value: any,
  current: EffectValue,
  anchor?: BaseRenderable,
): EffectValue {
  log("[INSERT] Expression in parent:", parent.id, "value type:", typeof value, "has current:", current != null)

  // Resolve functions
  while (typeof value === "function") value = value()

  // Skip if unchanged
  if (value === current) {
    log("[INSERT] Value unchanged, skipping")
    return current
  }

  // Handle null/undefined/false
  if (value == null || value === false) {
    log("[INSERT] Value is null/undefined/false")
    // Only clean up if we actually had content before
    if (current != null) {
      log("[INSERT] Cleaning up old content")
      cleanContent(parent, current)
    }
    return null
  }

  // Clean up old content before inserting new content
  if (current != null) {
    log("[INSERT] Cleaning up old content before inserting new")
    cleanContent(parent, current)
  }

  // Handle text content
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value)
    const canAcceptText = parent instanceof TextRenderable || isTextNodeRenderable(parent)
    log("[INSERT] Text content:", text, "canAcceptText:", canAcceptText)

    if (canAcceptText) {
      // Update existing text node if possible
      if (current && isTextNodeRenderable(current)) {
        log("[INSERT] Updating existing text node")
        current.replace(text, 0)
        return current
      }
      // Create new text node
      log("[INSERT] Creating new text node")
      const textNode = createTextNode(text)
      addChild(parent, textNode, anchor)
      return textNode
    } else {
      // Need to wrap in TextRenderable
      if (
        current &&
        current instanceof TextRenderable &&
        (current as TextRenderable & { _autoWrapped?: boolean })._autoWrapped
      ) {
        // Update existing wrapper's text
        log("[INSERT] Updating existing text wrapper")
        const firstChild = getChildren(current)[0]
        if (firstChild && isTextNodeRenderable(firstChild)) {
          firstChild.replace(text, 0)
        }
        return current
      }
      // Create new wrapper
      log("[INSERT] Creating new text wrapper")
      const wrapper = createRenderable("text")
      ;(wrapper as TextRenderable & { _autoWrapped?: boolean })._autoWrapped = true
      const textNode = createTextNode(text)
      addChild(wrapper, textNode)
      addChild(parent, wrapper, anchor)
      return wrapper
    }
  }

  // Handle arrays
  if (Array.isArray(value)) {
    log("[INSERT] Array with", value.length, "items")

    // If the array is empty and we have content, check if it's intentional
    if (value.length === 0 && Array.isArray(current) && current.length > 0) {
      log("[INSERT] WARNING: Replacing non-empty array with empty array")
    }

    const nodes: BaseRenderable[] = []

    // Simple approach: remove all old array items, add new ones
    if (Array.isArray(current)) {
      log("[INSERT] Removing", current.length, "old array items")
      current.forEach((node) => {
        if (node instanceof BaseRenderable) {
          removeChild(parent, node)
        }
      })
    }

    // Add new items
    log("[INSERT] Adding", value.length, "new array items")
    for (const item of value) {
      const node = insertExpression(parent, item, undefined, anchor)
      if (node && node instanceof BaseRenderable) nodes.push(node)
    }

    return nodes
  }

  // Handle renderables
  if (value instanceof BaseRenderable) {
    log("[INSERT] Adding renderable:", value.id)
    addChild(parent, value, anchor)
    return value
  }

  log("[INSERT] Unknown value type, returning null")
  return null
}

// Clean up content from parent
function cleanContent(parent: BaseRenderable, content: EffectValue): void {
  if (!content) {
    log("[CLEAN] No content to clean")
    return
  }

  if (Array.isArray(content)) {
    log("[CLEAN] Cleaning array of", content.length, "items from parent:", parent.id)
    content.forEach((item) => {
      if (item instanceof BaseRenderable && item.parent === parent) {
        removeChild(parent, item)
      }
    })
  } else if (content instanceof BaseRenderable && content.parent === parent) {
    log("[CLEAN] Cleaning single renderable:", content.id, "from parent:", parent.id)
    removeChild(parent, content)
  } else {
    log("[CLEAN] Content not cleanable, type:", typeof content)
  }
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

export function render(code: () => any, rootRenderable: BaseRenderable): Disposer {
  log("[RENDER] Starting render into root:", rootRenderable.id)
  let disposer: Disposer = () => {}
  createRoot((dispose: Disposer) => {
    disposer = dispose
    insert(rootRenderable, code())
  })
  log("[RENDER] Render complete")
  return disposer
}

export function setProp(renderable: BaseRenderable, name: string, value: any, prev: any): any {
  setProperty(renderable, name, value, prev)
  return value
}

// UNUSED
// The universal renderer exposes such methods, but we are not using them anywhere,
// where would these be needed?

// function spreadProps(renderable: BaseRenderable, props: Props, prevProps: Props = {}, skipChildren?: boolean): Props {
//   if (!props) return prevProps

//   // Handle children with proper tracking
//   if (!skipChildren && props.children !== undefined) {
//     createEffect((current: EffectValue) => {
//       prevProps.children = insertExpression(renderable, props.children, current)
//       return prevProps.children
//     }, prevProps.children)
//   }

//   // Handle ref
//   if (props.ref) {
//     const ref = props.ref as (el: BaseRenderable) => void
//     createEffect(() => ref(renderable))
//   }

//   // Handle other props with tracking
//   createEffect(() => {
//     Object.entries(props).forEach(([key, value]) => {
//       if (key === "children" || key === "ref") return
//       if (value !== prevProps[key]) {
//         setProperty(renderable, key, value, prevProps[key])
//         prevProps[key] = value
//       }
//     })
//   })

//   return prevProps
// }

// export function spread(renderable: BaseRenderable, accessor: Accessor<Props>, skipChildren?: boolean): void {
//   if (typeof accessor === "function") {
//     createEffect((current: Props | undefined) => {
//       const props = accessor()
//       return spreadProps(renderable, props, current || {}, skipChildren)
//     })
//   } else {
//     spreadProps(renderable, accessor, {}, skipChildren)
//   }
// }

// export function use<T>(fn: (element: BaseRenderable, arg: T) => any, element: BaseRenderable, arg: T): any {
//   return untrack(() => fn(element, arg))
// }
