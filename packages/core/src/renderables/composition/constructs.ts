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
import { TextNodeRenderable, type TextNodeOptions } from "../TextNode"
import { h, type VChild } from "./vnode"
import { TextAttributes } from "../../types"
import type { RGBA } from "../../lib/RGBA"

export function Generic(props?: VRenderableOptions, ...children: VChild[]) {
  return h(VRenderable, props || {}, ...children)
}

export function Box(props?: BoxOptions, ...children: VChild[]) {
  return h(BoxRenderable, props || {}, ...children)
}

export function Text(props?: TextOptions & { content?: any }, ...children: VChild[] | TextNodeRenderable[]) {
  return h(TextRenderable, props || {}, ...(children as VChild[]))
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

interface StyledTextProps extends Omit<TextNodeOptions, "attributes"> {
  attributes?: number
}

function StyledText(props?: StyledTextProps, ...children: (string | TextNodeRenderable)[]): TextNodeRenderable {
  const styledProps = props as StyledTextProps
  const textNodeOptions: TextNodeOptions = {
    ...styledProps,
    attributes: styledProps?.attributes ?? 0,
  }

  const textNode = new TextNodeRenderable(textNodeOptions)

  for (const child of children) {
    textNode.add(child)
  }

  return textNode
}

// Text styling convenience functions - these create TextNodeRenderable instances that can be nested and stacked
export const vstyles = {
  // Basic text styles
  bold: (...children: (string | TextNodeRenderable)[]) => StyledText({ attributes: TextAttributes.BOLD }, ...children),
  italic: (...children: (string | TextNodeRenderable)[]) =>
    StyledText({ attributes: TextAttributes.ITALIC }, ...children),
  underline: (...children: (string | TextNodeRenderable)[]) =>
    StyledText({ attributes: TextAttributes.UNDERLINE }, ...children),
  dim: (...children: (string | TextNodeRenderable)[]) => StyledText({ attributes: TextAttributes.DIM }, ...children),
  blink: (...children: (string | TextNodeRenderable)[]) =>
    StyledText({ attributes: TextAttributes.BLINK }, ...children),
  inverse: (...children: (string | TextNodeRenderable)[]) =>
    StyledText({ attributes: TextAttributes.INVERSE }, ...children),
  hidden: (...children: (string | TextNodeRenderable)[]) =>
    StyledText({ attributes: TextAttributes.HIDDEN }, ...children),
  strikethrough: (...children: (string | TextNodeRenderable)[]) =>
    StyledText({ attributes: TextAttributes.STRIKETHROUGH }, ...children),

  // Combined styles
  boldItalic: (...children: (string | TextNodeRenderable)[]) =>
    StyledText({ attributes: TextAttributes.BOLD | TextAttributes.ITALIC }, ...children),
  boldUnderline: (...children: (string | TextNodeRenderable)[]) =>
    StyledText({ attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE }, ...children),
  italicUnderline: (...children: (string | TextNodeRenderable)[]) =>
    StyledText({ attributes: TextAttributes.ITALIC | TextAttributes.UNDERLINE }, ...children),
  boldItalicUnderline: (...children: (string | TextNodeRenderable)[]) =>
    StyledText({ attributes: TextAttributes.BOLD | TextAttributes.ITALIC | TextAttributes.UNDERLINE }, ...children),

  // Color helpers
  color: (color: string | RGBA, ...children: (string | TextNodeRenderable)[]) => StyledText({ fg: color }, ...children),
  bgColor: (bgColor: string | RGBA, ...children: (string | TextNodeRenderable)[]) =>
    StyledText({ bg: bgColor }, ...children),
  fg: (color: string | RGBA, ...children: (string | TextNodeRenderable)[]) => StyledText({ fg: color }, ...children),
  bg: (bgColor: string | RGBA, ...children: (string | TextNodeRenderable)[]) =>
    StyledText({ bg: bgColor }, ...children),

  // Custom styling function
  styled: (attributes: number = 0, ...children: (string | TextNodeRenderable)[]) =>
    StyledText({ attributes }, ...children),
}
