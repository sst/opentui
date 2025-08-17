import type {
  ASCIIFontOptions,
  BoxOptions,
  InputRenderableOptions,
  Renderable,
  RenderableOptions,
  SelectOption,
  SelectRenderableOptions,
  StyledText,
  TabSelectRenderableOptions,
  TextChunk,
  TextOptions,
} from "@opentui/core";
import {
  ASCIIFontRenderable,
  BoxRenderable,
  GroupRenderable,
  InputRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextRenderable,
} from "@opentui/core";
import type { JSX, Ref } from "solid-js";
export * from "./hooks";

export const elements = {
  ascii_font: ASCIIFontRenderable,
  box: BoxRenderable,
  group: GroupRenderable,
  input: InputRenderable,
  select: SelectRenderable,
  tab_select: TabSelectRenderable,
  text: TextRenderable,
};
export type Element = keyof typeof elements;

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      ascii_font: ASCIIFontElementProps;
      box: BoxElementProps;
      group: GroupElementProps;
      input: InputElementProps;
      select: SelectElementProps;
      tab_select: TabSelectElementProps;
      text: TextElementProps;
    }
  }
}

type RenderableNonStyleKeys = "buffered";

type ElementProps<
  T extends RenderableOptions,
  K extends Renderable = Renderable,
  NonStyleKeys extends keyof T = RenderableNonStyleKeys,
> = {
  style?: Omit<T, NonStyleKeys | RenderableNonStyleKeys>;
  ref?: Ref<K>;
} & T;
// } & Pick<T, NonStyleKeys>;

type ContianerProps = { children?: JSX.Element };

export type BoxElementProps = ElementProps<BoxOptions, BoxRenderable, "title"> & ContianerProps;

export type GroupElementProps = ElementProps<RenderableOptions, GroupRenderable> & ContianerProps;

export type InputElementProps = ElementProps<
  InputRenderableOptions,
  InputRenderable,
  "value" | "maxLength" | "placeholder"
> & {
  onInput?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
  focused?: boolean;
};

export type TabSelectElementProps = ElementProps<
  TabSelectRenderableOptions,
  TabSelectRenderable,
  "options" | "showScrollArrows" | "showDescription" | "wrapSelection"
>;

type SelectEventCallback = (index: number, option: SelectOption) => void;

export type SelectElementProps = ElementProps<
  SelectRenderableOptions,
  SelectRenderable,
  "options" | "showScrollIndicator" | "wrapSelection" | "fastScrollStep"
> & {
  onSelect?: SelectEventCallback;
  onChange?: SelectEventCallback;
  focused?: boolean;
};

type TextChildTypes = (string & {}) | number | boolean | null | undefined;
type TextProps = {
  children: TextChildTypes | StyledText | TextChunk | Array<TextChildTypes | TextChunk>;
};

export type ASCIIFontElementProps = ElementProps<
  ASCIIFontOptions,
  ASCIIFontRenderable,
  "text" | "selectable" // NonStyleKeys
> & {
  children?: TextChildTypes | Array<TextChildTypes>;
};

export type TextElementProps = ElementProps<TextOptions, TextRenderable, "content" | "selectable"> & TextProps;
