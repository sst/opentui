import {
  ASCIIFontRenderable,
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextRenderable,
  VRenderable,
  type ASCIIFontOptions,
  type BoxOptions,
  type TextOptions,
  type VRenderableOptions,
  type InputRenderableOptions,
  type SelectRenderableOptions,
  type TabSelectRenderableOptions,
  FrameBufferRenderable,
  type FrameBufferOptions,
} from "../"
import type { RenderableOptions } from "../../Renderable"
import { h, type VNode, type VChild, type ProxiedVNode } from "./vnode"

export function Generic(props?: VRenderableOptions, ...children: VChild[]) {
  return h(VRenderable, props || {}, ...children)
}

export function Box(props?: BoxOptions, ...children: VChild[]) {
  return h(BoxRenderable, props || {}, ...children)
}

export function Text(props?: TextOptions & { content?: any }, ...children: VChild[]) {
  return h(TextRenderable, props || {}, ...children)
}

export function ASCIIFont(props?: ASCIIFontOptions, ...children: VChild[]) {
  return h(ASCIIFontRenderable, props || {}, ...children)
}

export function Input(props?: InputRenderableOptions, ...children: VChild[]) {
  return h(InputRenderable, props || {}, ...children)
}

export function Select(props?: SelectRenderableOptions, ...children: VChild[]) {
  return h(SelectRenderable, props || {}, ...children)
}

export function TabSelect(props?: TabSelectRenderableOptions, ...children: VChild[]) {
  return h(TabSelectRenderable, props || {}, ...children)
}

export function FrameBuffer(props: FrameBufferOptions, ...children: VChild[]) {
  return h(FrameBufferRenderable, props, ...children)
}
