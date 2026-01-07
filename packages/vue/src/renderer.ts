import { createRenderer } from "@vue/runtime-core"
import {
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable,
  TextareaRenderable,
  StyledText,
  TextNodeRenderable,
  type TextChunk,
  Renderable,
  type CliRenderer,
} from "@opentui/core"
import { getNextId } from "./utils"
import {
  type OpenTUINode,
  type OpenTUIElement,
  CommentNode,
  TextNode,
  WhiteSpaceNode,
  ChunkToTextNodeMap,
} from "./nodes"
import { elements, type Element } from "./elements"
import { insertNode, removeNode } from "./noOps"

export function createOpenTUIRenderer(cliRenderer: CliRenderer) {
  function createText(value: string | number | boolean | TextChunk): OpenTUINode {
    const plainText = typeof value === "object" ? (value as TextChunk).text : String(value)

    if (plainText?.trim() === "") {
      return new WhiteSpaceNode(cliRenderer)
    }

    const chunk: TextChunk =
      typeof value === "object" && "__isChunk" in value
        ? value
        : {
          __isChunk: true,
          text: `${value}`,
        }
    const textNode = new TextNode(chunk)
    ChunkToTextNodeMap.set(chunk, textNode)
    return textNode
  }

  return createRenderer<OpenTUINode, OpenTUIElement>({
    createElement(
      type: string,
      _namespace?: string,
      _isCustomizedBuiltIn?: string,
      vnodeProps?: Record<string, any> | null,
    ) {
      const RenderableClass = elements[type as Element]
      if (!RenderableClass) throw new Error(`${type} is not a valid element`)

      const id = getNextId(type)
      //we don't pass content directly, we handle it in patchProp
      const { style = {}, content, ...options } = vnodeProps || {}
      return new RenderableClass(cliRenderer, { id, ...style, ...options })
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
      if (el instanceof TextNode) {
        return
      }

      switch (key) {
        case "focused":
          if (el instanceof Renderable) {
            if (nextValue) {
              el.focus()
            } else {
              el.blur()
            }
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
          let selectEvent: string | undefined = undefined
          if (el instanceof SelectRenderable) {
            selectEvent = SelectRenderableEvents.ITEM_SELECTED
          } else if (el instanceof TabSelectRenderable) {
            selectEvent = TabSelectRenderableEvents.ITEM_SELECTED
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
          } else if (el instanceof TextareaRenderable) {
            el.onSubmit = nextValue
          }
          break

        case "onKeyDown":
          if (el instanceof Renderable) {
            el.onKeyDown = nextValue
          }
          break

        case "onContentChange":
          if (el instanceof TextareaRenderable) {
            el.onContentChange = nextValue
          }
          break

        case "onCursorChange":
          if (el instanceof TextareaRenderable) {
            el.onCursorChange = nextValue
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
                  text: child,
                })
              } else if (child && typeof child === "object" && "__isChunk" in child) {
                chunks.push(child as TextChunk)
              } else if (child instanceof StyledText) {
                chunks.push(...child.chunks)
              } else if (child != null) {
                const stringValue = String(child)
                chunks.push({
                  __isChunk: true,
                  text: stringValue,
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
      if (!el) return

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
        const textChild = new TextRenderable(cliRenderer, { id: getNextId("text"), content: text })
        node.add(textChild)
      }
    },

    setText(node, text) {
      if (node instanceof TextNode) {
        if (node.nodeRenderable) {
          node.nodeRenderable.children = [text]
          node.nodeRenderable.requestRender()
          return
        }

        const textParent = node.textParent
        if (textParent instanceof TextRenderable) {
          textParent.content = text
          textParent.requestRender()
        }
      }
    },

    parentNode: (node) => node.parent! as OpenTUIElement,

    nextSibling(node) {
      if (!node) return null

      const parent = node.parent
      if (!parent) return null

      if (node instanceof TextNode) {
        if (parent instanceof TextNodeRenderable && node.nodeRenderable) {
          const siblings = parent.getChildren()
          const index = siblings.findIndex((child) => child.id === node.nodeRenderable?.id)
          return siblings[index + 1] || null
        }

        const textParent = node.textParent

        if (textParent instanceof TextRenderable) {
          const chunks = textParent.content.chunks
          const index = chunks.indexOf(node.chunk)
          const nextChunk = chunks[index + 1]
          if (nextChunk) {
            return ChunkToTextNodeMap.get(nextChunk) || null
          }

          const container = textParent.parent
          if (!container) return null

          const siblings = container.getChildren()
          const textParentIndex = siblings.findIndex((child) => child.id === textParent.id)
          return siblings[textParentIndex + 1] || null
        }

        return null
      }

      const siblings = parent.getChildren()
      const index = siblings.findIndex((child) => child.id === node.id)
      return siblings[index + 1] || null
    },

    cloneNode(el) {
      if (el instanceof TextNode) {
        return new TextNode(el.chunk)
      }

      const Constructor = el.constructor as new (ctx: CliRenderer, props: any) => typeof el
      const cloned = new Constructor(cliRenderer, { id: getNextId(el.id.split("-")[0] || "cloned") })

      return cloned
    },

    createComment: () => new CommentNode(cliRenderer),
  })
}
