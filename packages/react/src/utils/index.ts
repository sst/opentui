import type { TextChunk } from "@opentui/core"
import {
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  StyledText,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable,
  stringToStyledText,
} from "@opentui/core"
import type { Instance, Props, Type } from "../types/host"

function initEventListeners(instance: Instance, eventName: string, listener: any, previousListener?: any) {
  if (previousListener) {
    instance.off(eventName, previousListener)
  }

  if (listener) {
    instance.on(eventName, listener)
  }
}

function handleTextChildren(textInstance: TextRenderable, children: any) {
  if (children == null) {
    textInstance.content = stringToStyledText("")
    return
  }

  // Handle array of children
  if (Array.isArray(children)) {
    const chunks: TextChunk[] = []

    for (const child of children) {
      if (typeof child === "string") {
        // Convert string to TextChunk
        chunks.push({
          __isChunk: true,
          text: child,
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
          text: stringValue,
        })
      }
    }

    textInstance.content = new StyledText(chunks)
    return
  }

  // Handle single child
  if (typeof children === "string") {
    textInstance.content = stringToStyledText(children)
  } else if (children && typeof children === "object" && "__isChunk" in children) {
    // Single TextChunk
    textInstance.content = new StyledText([children as TextChunk])
  } else if (children instanceof StyledText) {
    // Already StyledText
    textInstance.content = children
  } else {
    // Convert to string
    textInstance.content = stringToStyledText(String(children))
  }
}

function setStyle(instance: Instance, styles: any, oldStyles: any) {
  if (styles && typeof styles === "object") {
    if (oldStyles != null) {
      for (const styleName in styles) {
        const value = styles[styleName]
        if (styles.hasOwnProperty(styleName) && oldStyles[styleName] !== value) {
          // @ts-expect-error props are not strongly typed in the reconciler, so we need to allow dynamic property access
          instance[styleName] = value
        }
      }
    } else {
      for (const styleName in styles) {
        if (styles.hasOwnProperty(styleName)) {
          const value = styles[styleName]
          // @ts-expect-error props are not strongly typed in the reconciler, so we need to allow dynamic property access
          instance[styleName] = value
        }
      }
    }
  }
}

function setProperty(instance: Instance, type: Type, propKey: string, propValue: any, oldPropValue?: any) {
  switch (propKey) {
    case "onChange":
      if (instance instanceof InputRenderable) {
        initEventListeners(instance, InputRenderableEvents.CHANGE, propValue, oldPropValue)
      } else if (instance instanceof SelectRenderable) {
        initEventListeners(instance, SelectRenderableEvents.SELECTION_CHANGED, propValue, oldPropValue)
      } else if (instance instanceof TabSelectRenderable) {
        initEventListeners(instance, TabSelectRenderableEvents.SELECTION_CHANGED, propValue, oldPropValue)
      }
      break
    case "onInput":
      if (instance instanceof InputRenderable) {
        initEventListeners(instance, InputRenderableEvents.INPUT, propValue, oldPropValue)
      }
      break
    case "onSubmit":
      if (instance instanceof InputRenderable) {
        initEventListeners(instance, InputRenderableEvents.ENTER, propValue, oldPropValue)
      }
      break
    case "onSelect":
      if (instance instanceof SelectRenderable) {
        initEventListeners(instance, SelectRenderableEvents.ITEM_SELECTED, propValue, oldPropValue)
      } else if (instance instanceof TabSelectRenderable) {
        initEventListeners(instance, TabSelectRenderableEvents.ITEM_SELECTED, propValue, oldPropValue)
      }
      break
    case "focused":
      if (!!propValue) {
        instance.focus()
      } else {
        instance.blur()
      }
      break
    case "style":
      setStyle(instance, propValue, oldPropValue)
      break
    case "children":
      if (type === "text" && instance instanceof TextRenderable) {
        handleTextChildren(instance, propValue)
      }
      // skip
      break
    default:
      // @ts-expect-error props are not strongly typed in the reconciler, so we need to allow dynamic property access
      instance[propKey] = propValue
  }
}

export function setInitialProperties(instance: Instance, type: Type, props: Props) {
  for (const propKey in props) {
    if (!props.hasOwnProperty(propKey)) {
      continue
    }

    const propValue = props[propKey]
    if (propValue == null) {
      continue
    }

    setProperty(instance, type, propKey, propValue)
  }
}

export function updateProperties(instance: Instance, type: Type, oldProps: Props, newProps: Props) {
  for (const propKey in oldProps) {
    const oldProp = oldProps[propKey]
    if (oldProps.hasOwnProperty(propKey) && oldProp != null && !newProps.hasOwnProperty(propKey)) {
      setProperty(instance, type, propKey, null, oldProp)
    }
  }

  for (const propKey in newProps) {
    const newProp = newProps[propKey]
    const oldProp = oldProps[propKey]

    if (newProps.hasOwnProperty(propKey) && newProp !== oldProp && (newProp != null || oldProp != null)) {
      setProperty(instance, type, propKey, newProp, oldProp)
    }
  }
}
