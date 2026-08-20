import {
  InputRenderable,
  InputRenderableEvents,
  isRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextareaRenderable,
} from "@opentui/core"
import type { Instance, Props, Type } from "../types/host.js"

function initEventListeners(instance: Instance, eventName: string, listener: any, previousListener?: any) {
  if (previousListener) {
    instance.off(eventName, previousListener)
  }

  if (listener) {
    instance.on(eventName, listener)
  }
}

function setStyle(instance: Instance, styles: any, oldStyles: any): boolean {
  let changed = false
  if (oldStyles != null && typeof oldStyles === "object") {
    for (const styleName in oldStyles) {
      if (oldStyles.hasOwnProperty(styleName)) {
        if (styles == null || !styles.hasOwnProperty(styleName)) {
          // @ts-expect-error props are not strongly typed in the reconciler
          instance[styleName] = null
          changed = true
        }
      }
    }
  }

  if (styles != null && typeof styles === "object") {
    for (const styleName in styles) {
      if (styles.hasOwnProperty(styleName)) {
        const value = styles[styleName]
        const oldValue = oldStyles?.[styleName]
        if (value !== oldValue) {
          // @ts-expect-error props are not strongly typed in the reconciler
          instance[styleName] = value
          changed = true
        }
      }
    }
  }
  return changed
}

function setProperty(instance: Instance, type: Type, propKey: string, propValue: any, oldPropValue?: any): boolean {
  switch (propKey) {
    case "onChange":
      if (instance instanceof InputRenderable) {
        initEventListeners(instance, InputRenderableEvents.CHANGE, propValue, oldPropValue)
      } else if (instance instanceof SelectRenderable) {
        initEventListeners(instance, SelectRenderableEvents.SELECTION_CHANGED, propValue, oldPropValue)
      } else if (instance instanceof TabSelectRenderable) {
        initEventListeners(instance, TabSelectRenderableEvents.SELECTION_CHANGED, propValue, oldPropValue)
      }
      return false
    case "onInput":
      if (instance instanceof InputRenderable) {
        initEventListeners(instance, InputRenderableEvents.INPUT, propValue, oldPropValue)
      }
      return false
    case "onSubmit":
      if (instance instanceof InputRenderable) {
        initEventListeners(instance, InputRenderableEvents.ENTER, propValue, oldPropValue)
      } else if (instance instanceof TextareaRenderable) {
        instance.onSubmit = propValue
      }
      return false
    case "onSelect":
      if (instance instanceof SelectRenderable) {
        initEventListeners(instance, SelectRenderableEvents.ITEM_SELECTED, propValue, oldPropValue)
      } else if (instance instanceof TabSelectRenderable) {
        initEventListeners(instance, TabSelectRenderableEvents.ITEM_SELECTED, propValue, oldPropValue)
      }
      return false
    case "focused":
      if (isRenderable(instance)) {
        if (!!propValue) {
          instance.focus()
        } else {
          instance.blur()
        }
      }
      return false
    case "style":
      return setStyle(instance, propValue, oldPropValue)
    case "children":
      // Skip children handling - React reconciler handles this automatically
      return false
    default:
      // @ts-expect-error props are not strongly typed in the reconciler, so we need to allow dynamic property access
      instance[propKey] = propValue
      return true
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

export function updateProperties(instance: Instance, type: Type, oldProps: Props, newProps: Props): boolean {
  let changed = false
  for (const propKey in oldProps) {
    const oldProp = oldProps[propKey]
    if (oldProps.hasOwnProperty(propKey) && oldProp != null && !newProps.hasOwnProperty(propKey)) {
      changed = setProperty(instance, type, propKey, null, oldProp) || changed
    }
  }

  for (const propKey in newProps) {
    const newProp = newProps[propKey]
    const oldProp = oldProps[propKey]

    if (newProps.hasOwnProperty(propKey) && newProp !== oldProp && (newProp != null || oldProp != null)) {
      changed = setProperty(instance, type, propKey, newProp, oldProp) || changed
    }
  }
  return changed
}
