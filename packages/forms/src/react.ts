import { extend } from "@opentui/react"
import { createElement, forwardRef, useImperativeHandle, useLayoutEffect, useRef, type Key, type Ref } from "react"
import { RadioButtonRenderable, RadioButtonRenderableEvents, type RadioButtonRenderableOptions } from "./RadioButton.js"

declare module "@opentui/react" {
  interface OpenTUIComponents {
    "radio-button": typeof RadioButtonRenderable
  }
}

export function registerRadioButton(): void {
  extend({ "radio-button": RadioButtonRenderable })
}

export type RadioButtonProps = Omit<RadioButtonRenderableOptions, "id"> & {
  key?: Key
  focused?: boolean
  onChange?: (checked: boolean, value: any) => void
  onSelect?: (value: any) => void
}

export const RadioButton = forwardRef(function RadioButton(
  { onChange, onSelect, ...props }: RadioButtonProps,
  ref: Ref<RadioButtonRenderable>,
) {
  const innerRef = useRef<RadioButtonRenderable | null>(null)
  useImperativeHandle(ref, () => innerRef.current as RadioButtonRenderable, [])

  useLayoutEffect(() => {
    const instance = innerRef.current
    if (!instance || !onChange) return
    instance.on(RadioButtonRenderableEvents.CHANGED, onChange)
    return () => {
      instance.off(RadioButtonRenderableEvents.CHANGED, onChange)
    }
  }, [onChange])

  useLayoutEffect(() => {
    const instance = innerRef.current
    if (!instance || !onSelect) return
    instance.on(RadioButtonRenderableEvents.SELECTED, onSelect)
    return () => {
      instance.off(RadioButtonRenderableEvents.SELECTED, onSelect)
    }
  }, [onSelect])

  return createElement("radio-button", { ...props, ref: innerRef })
})

export * from "./index.js"
