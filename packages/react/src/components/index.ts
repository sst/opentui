import {
  BoxRenderable,
  GroupRenderable,
  InputRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextRenderable,
} from "@opentui/core"
import React from "react"
import type { BoxProps, GroupProps, InputProps, SelectProps, TabSelectProps, TextProps } from "../types/components"
import type { RenderableConstructor, Type } from "../types/host"

export const components = {
  "opentui-box": BoxRenderable,
  "opentui-text": TextRenderable,
  "opentui-group": GroupRenderable,
  "opentui-input": InputRenderable,
  "opentui-select": SelectRenderable,
  "opentui-tab-select": TabSelectRenderable,
} satisfies Record<Type, RenderableConstructor>

export const Text = (props: TextProps) => React.createElement("opentui-text", props)
export const Box = (props: BoxProps) => React.createElement("opentui-box", props)
export const Group = (props: GroupProps) => React.createElement("opentui-group", props)
export const Input = (props: InputProps) => React.createElement("opentui-input", props)
export const Select = (props: SelectProps) => React.createElement("opentui-select", props)
export const TabSelect = (props: TabSelectProps) => React.createElement("opentui-tab-select", props)
