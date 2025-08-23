import {
  ASCIIFontRenderable,
  BoxRenderable,
  GroupRenderable,
  InputRenderable,
  Renderable,
  SelectRenderable,
  TabSelectRenderable,
  TextRenderable,
  InputRenderableEvents,
  SelectRenderableEvents,
  TabSelectRenderableEvents,
  type TextChunk,
  StyledText,
} from "@opentui/core"
import { createRenderer } from "@vue/runtime-core"
import { getNextId } from "./src/utils"
import { createCliRenderer, type CliRendererConfig } from "@opentui/core"

export const elements = {
  "ascii-font": ASCIIFontRenderable,
  box: BoxRenderable,
  group: GroupRenderable,
  input: InputRenderable,
  select: SelectRenderable,
  "tab-select": TabSelectRenderable,
  text: TextRenderable,
}

type ElementsMap = typeof elements
export type Element = keyof ElementsMap

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

class CommentNode extends GroupRenderable {
  constructor() {
    super(getNextId("comment"), {})
  }
}

export type OpenTUINode = Renderable | TextNode | CommentNode
type ElementConstructor = ElementsMap[keyof ElementsMap]
export type OpenTUIElement = InstanceType<ElementConstructor>

const ChunkToTextNodeMap = new WeakMap<TextChunk, TextNode>()
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

  const ghostNode = new TextRenderable(getNextId(GHOST_NODE_TAG), {})
  insertNode(parent, ghostNode, anchor)
  return ghostNode
}

function insertTextNode(parent: OpenTUINode, node: TextNode, anchor?: OpenTUINode | null): void {
  if (!(parent instanceof Renderable)) {
    console.log(`[WARN] Attempted to attach text node ${node.id} to a non-renderable parent ${parent.id}.`)
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
      console.log(`[WARN] TextNode anchor not found for node ${node.id}.`)
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

function insertNode(parent: OpenTUINode, node: OpenTUINode, anchor?: OpenTUINode | null): void {
  if (node instanceof TextNode) {
    return insertTextNode(parent, node, anchor)
  }

  if (!(parent instanceof Renderable)) {
    console.log(`[WARN] Attempted to insert node ${node.id} into a non-renderable parent ${parent.id}.`)
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

function removeNode(parent: OpenTUINode, node: OpenTUINode): void {
  if (node instanceof TextNode) {
    return removeTextNode(parent, node)
  }

  if (parent instanceof Renderable && (node instanceof Renderable || node instanceof CommentNode)) {
    parent.remove(node.id)
    if (node instanceof Renderable && !(node instanceof CommentNode)) {
      node.destroyRecursively()
    }
  }
}

function _createText(value: string | number | boolean | TextChunk): OpenTUINode {
  const plainText = typeof value === "object" ? (value as TextChunk).plainText : String(value)

  if (plainText?.trim() === "") {
    return new TextRenderable(getNextId("text"), { content: "" })
  }

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
}

const { createApp } = createRenderer<OpenTUINode, OpenTUIElement>({
  createElement(type, namespace, isCustomizedBuiltIn, vnodeProps) {
    console.log(`createElement: type="${type}"`)
    const RenderableClass = elements[type as Element]
    if (!RenderableClass) throw new Error(`${type} is not valid element`)

    const id = getNextId(type)
    const renderableInstance = new RenderableClass(id, {})

    return renderableInstance
  },

  createText: _createText,

  insert(el, parent, anchor) {
    if (!el) {
      console.log(`insert: SKIPPING null element.`)
      return
    }
    console.log(`insert: el.id="${el.id}" into parent.id="${parent.id}" at anchor.id="${anchor?.id || "null"}"`)
    insertNode(parent, el, anchor)
  },

  patchProp(el, key, prevValue, nextValue) {
    console.log(`patchProp: el.id="${el.id}" key="${key}" nextValue="${String(nextValue)}"`)
    if (el instanceof TextNode || el instanceof CommentNode) {
      return
    }

    // Handle special properties
    switch (key) {
      case "focused":
        if (nextValue) {
          el.focus()
        } else {
          el.blur()
        }
        break

      case "onChange":
        let changeEvent: string | undefined = undefined
        if (el instanceof SelectRenderable) {
          changeEvent = SelectRenderableEvents.SELECTION_CHANGED
        } else if (el instanceof TabSelectRenderable) {
          changeEvent = TabSelectRenderableEvents.SELECTION_CHANGED
        } else if (el instanceof InputRenderable) {
          changeEvent = InputRenderableEvents.CHANGE
        }

        if (changeEvent) {
          if (prevValue) {
            el.off(changeEvent, prevValue)
          }
          if (nextValue) {
            el.on(changeEvent, nextValue)
          }
        }
        break

      case "onSelect":
        let selectEvent: SelectRenderableEvents.ITEM_SELECTED | undefined = undefined
        if (el instanceof SelectRenderable) {
          selectEvent = SelectRenderableEvents.ITEM_SELECTED
        }
        if (selectEvent) {
          if (prevValue) {
            el.off(selectEvent, prevValue)
          }
          if (nextValue) {
            el.on(selectEvent, nextValue)
          }
        }
        break

      case "onInput":
        if (el instanceof InputRenderable) {
          if (prevValue) {
            el.off(InputRenderableEvents.INPUT, prevValue)
          }
          if (nextValue) {
            el.on(InputRenderableEvents.INPUT, nextValue)
          }
        }
        break

      case "onSubmit":
        if (el instanceof InputRenderable) {
          if (prevValue) {
            el.off(InputRenderableEvents.ENTER, prevValue)
          }
          if (nextValue) {
            el.on(InputRenderableEvents.ENTER, nextValue)
          }
        }
        break

      case "style":
        if (nextValue && typeof nextValue === "object") {
          for (const prop in nextValue) {
            const propVal = nextValue[prop]
            if (prevValue && typeof prevValue === "object" && propVal === prevValue[prop]) {
              continue
            }
            // @ts-expect-error - Dynamic property assignment
            el[prop] = propVal
          }
        }
        break

      case "content":
        const textInstance = el as TextRenderable
        if (nextValue == null) {
          textInstance.content = ""
          return
        }

        // Handle array of children
        if (Array.isArray(nextValue)) {
          const chunks: TextChunk[] = []

          for (const child of nextValue) {
            if (typeof child === "string") {
              // Convert string to TextChunk
              chunks.push({
                __isChunk: true,
                text: new TextEncoder().encode(child),
                plainText: child,
              })
            } else if (child && typeof child === "object" && "__isChunk" in child) {
              // Already a TextChunk
              chunks.push(child as TextChunk)
            } else if (child instanceof StyledText) {
              // Add all chunks from StyledText
              chunks.push(...child.chunks)
            } else if (child != null) {
              // Convert other types to string and then TextChunk
              const stringValue = String(child)
              chunks.push({
                __isChunk: true,
                text: new TextEncoder().encode(stringValue),
                plainText: stringValue,
              })
            }
          }

          textInstance.content = new StyledText(chunks)
          return
        }

        // Handle single child - optimize for direct assignment when possible
        if (typeof nextValue === "string") {
          // Direct assignment for string
          textInstance.content = nextValue
        } else if (nextValue instanceof StyledText) {
          // Direct assignment for StyledText
          textInstance.content = nextValue
        } else if (nextValue && typeof nextValue === "object" && "__isChunk" in nextValue) {
          // Single TextChunk - create StyledText wrapper
          textInstance.content = new StyledText([nextValue as TextChunk])
        } else {
          // Convert to string and assign directly
          textInstance.content = String(nextValue)
        }

        break

      default:
        // @ts-expect-error - Dynamic property assignment
        el[key] = nextValue
    }
  },

  remove(el) {
    console.log(`remove: el.id="${el.id}"`)
    const parent = el.parent
    if (parent) {
      const siblings = parent.getChildren()
      const index = siblings.findIndex((child) => child.id === el.id)

      if (index > -1 && index < siblings.length - 1) {
        const nextSibling = siblings[index + 1]
        console.log(`-- Caching next sibling for ${el.id}: ${nextSibling?.id}`)
        // @ts-expect-error - Attaching temporary property
        el._cachedNextSibling = nextSibling
      } else {
        console.log(`-- No next sibling to cache for ${el.id}`)
      }
      removeNode(parent, el)
    } else {
      console.log(`-- remove called on detached node: ${el.id}`)
    }
  },

  setElementText(node, text) {
    console.log(`setElementText: node.id="${node.id}" text="${text.replace(/\n/g, "\\n")}"`)
    if (node instanceof TextRenderable) {
      node.content = text
    } else if (node instanceof Renderable) {
      // Clear existing children and set text content
      const children = node.getChildren()
      children.forEach((child) => node.remove(child.id))

      // Create a text child
      const textChild = new TextRenderable(getNextId("text"), { content: text })
      node.add(textChild)
    }
  },

  setText(node, text) {
    console.log(`setText: node.id="${node.id}" text="${text.replace(/\n/g, "\\n")}"`)
    if (node instanceof TextNode) {
      const newChunk: TextChunk = {
        __isChunk: true,
        text: new TextEncoder().encode(text),
        plainText: text,
      }

      const textParent = node.textParent
      if (textParent instanceof TextRenderable) {
        const styledText = textParent.content
        styledText.replace(newChunk, node.chunk)
        textParent.content = styledText

        ChunkToTextNodeMap.delete(node.chunk)
        node.chunk = newChunk
        ChunkToTextNodeMap.set(newChunk, node)
      }
    }
  },

  parentNode(node) {
    console.log(`parentNode: for node.id="${node.id}", returning parent.id="${node.parent?.id || "null"}"`)
    return node.parent!
  },

  nextSibling(node) {
    console.log(`nextSibling: for node.id="${node.id}"`)
    // @ts-expect-error - Checking for temporary property
    if (node._cachedNextSibling) {
      // @ts-expect-error
      const sibling = node._cachedNextSibling
      console.log(`-- Found cached sibling for ${node.id}: ${sibling.id}`)
      // @ts-expect-error
      delete node._cachedNextSibling
      return sibling
    }

    const parent = node.parent
    if (!parent) {
      console.log(`-- Parent not found for ${node.id}, returning null`)
      return null
    }

    if (node instanceof TextNode && parent instanceof TextRenderable) {
      const siblings = parent.content.chunks
      const index = siblings.indexOf(node.chunk)
      if (index === -1 || index === siblings.length - 1) {
        return null
      }
      const nextSibling = siblings[index + 1]
      if (!nextSibling) {
        return null
      }
      return ChunkToTextNodeMap.get(nextSibling) || null
    }

    const siblings = parent.getChildren()
    const index = siblings.findIndex((child) => child.id === node.id)
    if (index === -1 || index === siblings.length - 1) {
      return null
    }
    return siblings[index + 1] || null
  },

  cloneNode(el) {
    console.log(`cloneNode: el.id="${el?.id}"`)
    if (el instanceof TextNode) {
      return new TextNode(el.chunk)
    }
    if (el instanceof CommentNode) {
      return new CommentNode()
    }

    const Constructor = el.constructor as new (id: string, props: any) => typeof el
    const cloned = new Constructor(getNextId(el.id.split("-")[0] || "cloned"), {})

    return cloned
  },

  createComment(text) {
    console.log(`createComment: text="${text.replace(/\n/g, "\\n")}"`)
    const commentNode = new CommentNode()
    return commentNode
  },
})

export async function _render(component: any, rendererConfig: CliRendererConfig = {}): Promise<void> {
  const renderer = await createCliRenderer(rendererConfig)
  const app = createApp(component)

  // renderer.console.show()

  app.mount(renderer.root)
}

export * from "@vue/runtime-core"
