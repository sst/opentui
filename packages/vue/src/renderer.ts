import { createRenderer } from "@vue/runtime-core"
import {
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable,
  StyledText,
  type TextChunk,
  Renderable,
} from "@opentui/core"
import { getNextId } from "./utils"
import { type OpenTUINode, type OpenTUIElement, TextNode, WhiteSpaceNode, ChunkToTextNodeMap } from "./nodes"
import { elements, type Element } from "./elements"
import { insertNode, removeNode } from "./noOps"
import { getCurrentCliRenderer } from "./cli-renderer-ref"

function createText(value: string | number | boolean | TextChunk): OpenTUINode {
  const plainText = typeof value === "object" ? (value as TextChunk).plainText : String(value)

  if (plainText?.trim() === "") {
    return new WhiteSpaceNode()
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

export const renderer = createRenderer<OpenTUINode, OpenTUIElement>({
  createElement(type: string) {
    const RenderableClass = elements[type as Element]
    if (!RenderableClass) throw new Error(`${type} is not a valid element`)

    const id = getNextId(type)
    return new RenderableClass(getCurrentCliRenderer(), { id })
  },

  createText,

  insert(el, parent, anchor) {
    if (!el) {
      console.log(`insert: SKIPPING null element.`)
      return
    }
    insertNode(parent, el, anchor)
  },

  patchProp(el, key, prevValue, nextValue) {
    console.log(el.id, key, nextValue)
    if (el instanceof TextNode) {
      return
    }

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
        if (Array.isArray(nextValue)) {
          const chunks: TextChunk[] = []
          for (const child of nextValue) {
            if (typeof child === "string") {
              chunks.push({
                __isChunk: true,
                text: new TextEncoder().encode(child),
                plainText: child,
              })
            } else if (child && typeof child === "object" && "__isChunk" in child) {
              chunks.push(child as TextChunk)
            } else if (child instanceof StyledText) {
              chunks.push(...child.chunks)
            } else if (child != null) {
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

        if (typeof nextValue === "string") {
          textInstance.content = nextValue
        } else if (nextValue instanceof StyledText) {
          textInstance.content = nextValue
        } else if (nextValue && typeof nextValue === "object" && "__isChunk" in nextValue) {
          textInstance.content = new StyledText([nextValue as TextChunk])
        } else {
          textInstance.content = String(nextValue)
        }
        break

      default:
        // @ts-expect-error - Dynamic property assignment
        el[key] = nextValue
    }
  },

  remove(el) {
    const parent = el.parent
    if (parent) {
      removeNode(parent, el)
    } else {
      console.log(`-- remove called on detached node: ${el.id}`)
    }
  },

  setElementText(node, text) {
    if (node instanceof TextRenderable) {
      node.content = text
    } else if (node instanceof Renderable) {
      const children = node.getChildren()
      children.forEach((child) => node.remove(child.id))
      const textChild = new TextRenderable(getCurrentCliRenderer(), { id: getNextId("text"), content: text })
      node.add(textChild)
    }
  },

  setText(node, text) {
    if (node instanceof TextNode) {
      const textParent = node.textParent
      if (textParent instanceof TextRenderable) {
        textParent.content = text
        textParent.requestRender()
      }
    }
  },

  parentNode: (node) => node.parent! as OpenTUIElement,

  nextSibling(node) {
    const parent = node.parent
    if (!parent) return null

    if (node instanceof TextNode && parent instanceof TextRenderable) {
      const siblings = parent.content.chunks
      const index = siblings.indexOf(node.chunk)
      const nextChunk = siblings[index + 1]
      return nextChunk ? ChunkToTextNodeMap.get(nextChunk) || null : null
    }

    const siblings = parent.getChildren()
    const index = siblings.findIndex((child) => child.id === node.id)
    return siblings[index + 1] || null
  },

  cloneNode(el) {
    if (el instanceof TextNode) {
      return new TextNode(el.chunk)
    }

    const Constructor = el.constructor as new (id: string, props: any) => typeof el
    const cloned = new Constructor(getNextId(el.id.split("-")[0] || "cloned"), {})

    return cloned
  },

  //@ts-expect-error : we don't do anything we comments
  createComment: () => null,
})
