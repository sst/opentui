import {
  ASCIIFontElementProps,
  BoxElementProps,
  GroupElementProps,
  InputElementProps,
  SelectElementProps,
  TabSelectElementProps,
  TextElementProps,
} from "./src/elements/index";

declare namespace JSX {
  interface ElementChildrenAttribute {
    children: {};
  }

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
