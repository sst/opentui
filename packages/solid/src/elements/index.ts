import type {
  ASCIIFontOptions,
  BoxOptions,
  InputRenderableOptions,
  Renderable,
  RenderableOptions,
  SelectOption,
  SelectRenderableOptions,
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
  opentui_box: BoxRenderable,
  opentui_group: GroupRenderable,
  opentui_input: InputRenderable,
  opentui_tab_select: TabSelectRenderable,
  opentui_text: TextRenderable,
  opentui_select: SelectRenderable,
  opentui_ascii_font: ASCIIFontRenderable,
};

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
    onCleanup(() => {
      element.destroy();
    });
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

export const Box = createCustomElement<ElementProps<BoxOptions, BoxRenderable> & ContianerProps>("opentui_box", true);

export const Group = createCustomElement<ElementProps<RenderableOptions, GroupRenderable> & ContianerProps>(
  "opentui_group",
  true,
);

export const Input = createCustomElement<
  ElementProps<
    InputRenderableOptions,
    InputRenderable,
    "value" | "maxLength" | "placeholder" // NonStyleKeys
  > & {
    onInput?: (value: string) => void;
    onSubmit?: (value: string) => void;
    onChange?: (value: string) => void;
    focused?: boolean;
  }
>("opentui_input");

export const TabSelect = createCustomElement<
  ElementProps<
    TabSelectRenderableOptions,
    TabSelectRenderable,
    "options" | "showScrollArrows" | "showDescription" | "wrapSelection" // NonStyleKeys
  >
>("opentui_tab_select");

type SelectEventCallback = (index: number, option: SelectOption) => void;

export const Select = createCustomElement<
  ElementProps<
    SelectRenderableOptions,
    SelectRenderable,
    "options" | "showScrollIndicator" | "wrapSelection" | "fastScrollStep" // NonStyleKeys
  > & {
    onSelect?: SelectEventCallback;
    onChange?: SelectEventCallback;
    focused?: boolean;
    children?: JSX.Element;
  }
>("opentui_select");

type TextChildTypes = (string & {}) | number | boolean | null | undefined;
type TextProps = {
  children: TextChildTypes | Array<TextChildTypes>;
};

export const ASCIIFont = createCustomElement<
  ElementProps<
    ASCIIFontOptions,
    ASCIIFontRenderable,
    "text" | "selectable" // NonStyleKeys
  > &
    TextProps
>("opentui_ascii_font", "text");

export const Text = createCustomElement<
  ElementProps<TextOptions, TextRenderable, "content" | "selectable"> & TextProps
>("opentui_text", "content");
