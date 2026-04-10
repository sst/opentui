import type {
  BoxProps,
  TextProps,
  SpanProps,
  CodeProps,
  DiffProps,
  MarkdownProps,
  InputProps,
  TextareaProps,
  SelectProps,
  ScrollBoxProps,
  AsciiFontProps,
  TabSelectProps,
  LineNumberProps,
  LineBreakProps,
  LinkProps,
} from "@opentui/react"

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      box: BoxProps
      text: TextProps
      span: SpanProps
      code: CodeProps
      diff: DiffProps
      markdown: MarkdownProps
      input: InputProps
      textarea: TextareaProps
      select: SelectProps
      scrollbox: ScrollBoxProps
      "ascii-font": AsciiFontProps
      "tab-select": TabSelectProps
      "line-number": LineNumberProps
      b: SpanProps
      i: SpanProps
      u: SpanProps
      strong: SpanProps
      em: SpanProps
      br: LineBreakProps
      a: LinkProps
    }
  }
}
