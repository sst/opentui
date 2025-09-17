/* @refresh skip */
import {
  BaseRenderable,
  createTextAttributes,
  createTrackedNode,
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
  TrackedNode,
  type RenderableOptions,
  type RenderContext,
  type TextNodeOptions,
} from "@opentui/core"
import { useContext } from "solid-js"
import { createRenderer } from "solid-js/universal"
import { getComponentCatalogue, RendererContext } from "./elements"
import { getNextId } from "./utils/id-counter"
import { log } from "./utils/log"
import type { JSX } from "../jsx-runtime.d.ts"
import { useRenderer } from "./elements/hooks"
import { getOwner } from "solid-js"
import { createEffect } from "solid-js"
import { runWithOwner } from "solid-js"
import { createMemo } from "solid-js"
import { onCleanup } from "solid-js"
import type { ValidComponent } from "solid-js"
import type { ComponentProps } from "solid-js"
import { splitProps } from "solid-js"
import { untrack } from "solid-js"

class TextNode extends TextNodeRenderable {
  public static override fromString(text: string, options: Partial<TextNodeOptions> = {}): TextNode {
    const node = new TextNode(options)
    node.add(text)
    return node
  }
}

class AnchorNode extends Renderable {
  constructor(context: RenderContext, id: string) {
    super(context, {
      id,
      visible: false,
    })
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
    node instanceof TextNode,
  )

  if (isTextNodeRenderable(node)) {
    if (!(parent instanceof TextRenderable) && !isTextNodeRenderable(parent)) {
      // TODO this can happen naturally with match and show, probably should handle better
      log(`Text must have a <text> as a parent: ${parent.id} above ${node.id}`)
      // TODO: Workaround for now, final implementation to be decided
      let anchorIndex = undefined
      if (anchor) {
        anchorIndex = getNodeChildren(parent).findIndex((el) => el.id === anchor.id)
      }
      const renderer = useRenderer()
      parent.add(createAnchorNode(renderer), anchorIndex)
      return
    }
  }

  // Renderable nodes
  if (!(parent instanceof BaseRenderable)) {
    console.error("[INSERT]", "Tried to mount a non base renderable")
    // Can't be a noop, have to panic
    throw new Error("Tried to mount a non base renderable")
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
    if (node instanceof Renderable && !node.parent) {
      node.destroyRecursively()
      return
    }
  })
}

function _createTextNode(value: string | number): TextNode {
  log("Creating text node:", value)

  const id = getNextId("text-node")

  if (typeof value === "number") {
    value = value.toString()
  }

  return TextNode.fromString(value, { id })
}

function createAnchorNode(ctx: RenderContext): AnchorNode {
  return new AnchorNode(ctx, getNextId("anchor-node"))
}

function _getParentNode(childNode: DomNode): DomNode | undefined {
  log("Getting parent of node:", logId(childNode))

  let parent = childNode.parent ?? undefined
  if (parent instanceof RootTextNodeRenderable) {
    parent = parent.textParent ?? undefined
  }
  return parent
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

    if (!(textNode instanceof TextNode)) return
    textNode.replace(value, 0)
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
  },

  isTextNode(node: DomNode): boolean {
    return node instanceof TextNode
  },

  insertNode: _insertNode,

  removeNode: _removeNode,

  getParentNode: _getParentNode,

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

    const parent = _getParentNode(node)
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

export function Portal(props: { mount?: DomNode; ref?: (el: {}) => void; children: JSX.Element }) {
  const renderer = useRenderer()

  const marker = createAnchorNode(renderer),
    mount = () => props.mount || renderer.root,
    owner = getOwner()
  let content: undefined | (() => JSX.Element)

  createEffect(
    () => {
      // basically we backdoor into a sort of renderEffect here
      content || (content = runWithOwner(owner, () => createMemo(() => props.children)))
      const el = mount()
      const container = createElement("box"),
        renderRoot = container

      Object.defineProperty(container, "_$host", {
        get() {
          return marker.parent
        },
        configurable: true,
      })
      insert(renderRoot, content)
      el.add(container)
      props.ref && (props as any).ref(container)
      onCleanup(() => el.remove(container.id))
    },
    undefined,
    { render: true },
  )
  return marker
}

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K]
} & {
  component: T | undefined
}

/**
 * Renders an arbitrary component or element with the given props
 *
 * This is a lower level version of the `Dynamic` component, useful for
 * performance optimizations in libraries. Do not use this unless you know
 * what you are doing.
 * ```typescript
 * const element = () => multiline() ? 'textarea' : 'input';
 * createDynamic(element, { value: value() });
 * ```
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function createDynamic<T extends ValidComponent>(
  component: () => T | undefined,
  props: ComponentProps<T>,
): JSX.Element {
  const cached = createMemo<Function | string | undefined>(component)
  return createMemo(() => {
    const component = cached()
    switch (typeof component) {
      case "function":
        // if (isDev) Object.assign(component, { [$DEVCOMP]: true })
        return untrack(() => component(props))

      case "string":
        const el = createElement(component)
        spread(el, props)
        return el

      default:
        break
    }
  }) as unknown as JSX.Element
}

/**
 * Renders an arbitrary custom or native component and passes the other props
 * ```typescript
 * <Dynamic component={multiline() ? 'textarea' : 'input'} value={value()} />
 * ```
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const [, others] = splitProps(props, ["component"])
  return createDynamic(() => props.component, others as ComponentProps<T>)
}
