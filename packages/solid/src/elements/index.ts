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
import { onCleanup, children as resolveChildren, type JSX, type Ref } from "solid-js";
import { createElement, effect, insert, setProp, spread, use } from "../reconciler";
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

export type Element = keyof typeof elements;

type RenderableNonStyleKeys = "buffered";

type ElementProps<
  T extends RenderableOptions,
  K extends Renderable = Renderable,
  NonStyleKeys extends keyof T = RenderableNonStyleKeys,
> = {
  style?: Omit<T, NonStyleKeys | RenderableNonStyleKeys>;
  ref?: Ref<K>;
} & T;

const createCustomElement = <T extends Record<string, any>>(tagName: string, acceptChildren?: string | true) => {
  return (props: T) => {
    const element = createElement(tagName);
    // onCleanup(() => {
    //   element.destroy();
    // });
    if (props.ref) {
      typeof props.ref === "function"
        ? use(props.ref, element, undefined)
        : // @ts-expect-error: directly assigning to ref as is done after transpile
          (props.ref = element);
    }
    spread(element, props, true);
    if (acceptChildren) {
      const resolved = resolveChildren(() => props.children);
      if (acceptChildren === true) {
        insert(element, resolved);
      } else {
        effect((prev) => {
          const value = resolved();
          if (prev !== value) {
            setProp(element, acceptChildren, value, prev);
          }

          return value;
        }, "");
      }
    }

    return element as JSX.Element;
  };
};

type ContianerProps = { children?: JSX.Element };

export type BoxElementProps = ElementProps<BoxOptions, BoxRenderable> & ContianerProps;
export const Box = createCustomElement<BoxElementProps>("box", true);

export type GroupElementProps = ElementProps<RenderableOptions, GroupRenderable> & ContianerProps;
export const Group = createCustomElement<GroupElementProps>("group", true);

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
export const Input = createCustomElement<InputElementProps>("input");

export type TabSelectElementProps = ElementProps<
  TabSelectRenderableOptions,
  TabSelectRenderable,
  "options" | "showScrollArrows" | "showDescription" | "wrapSelection"
>;
export const TabSelect = createCustomElement<TabSelectElementProps>("tab_select");

type SelectEventCallback = (index: number, option: SelectOption) => void;

export type SelectElementProps = ElementProps<
  SelectRenderableOptions,
  SelectRenderable,
  "options" | "showScrollIndicator" | "wrapSelection" | "fastScrollStep"
> & {
  onSelect?: SelectEventCallback;
  onChange?: SelectEventCallback;
  focused?: boolean;
  children?: JSX.Element;
};
export const Select = createCustomElement<SelectElementProps>("select");

type TextChildTypes = (string & {}) | number | boolean | null | undefined;
type TextProps = {
  children: TextChildTypes | Array<TextChildTypes> | StyledText;
};

export type ASCIIFontElementProps = ElementProps<
  ASCIIFontOptions,
  ASCIIFontRenderable,
  "text" | "selectable" // NonStyleKeys
>;

export const ASCIIFont = createCustomElement<ASCIIFontElementProps & TextProps>("ascii_font", "text");

export type TextElementProps = ElementProps<TextOptions, TextRenderable, "content" | "selectable">;
export const Text = createCustomElement<TextElementProps & TextProps>("text", "content");
