// types/opentui.d.ts
import { DefineComponent } from "vue"
import {
  ASCIIFontRenderable,
  BoxRenderable,
  GroupRenderable,
  InputRenderable,
  SelectRenderable,
  TabSelectRenderable,
  TextRenderable,
  type TextChunk,
  type StyledText,
  type SelectOption,
  type Event,
} from "@opentui/core"

import "opentui/core"

declare module "@vue/runtime-core" {
  export interface GlobalComponents {
    // Define your custom OpenTUI elements
    "ascii-font": DefineComponent<{
      text?: string
      font?: "block" | "shade" | "slick" | "tiny"
      style?: Record<string, any>
    }>

    box: DefineComponent<{
      title?: string
      borderStyle?: "single" | "double" | "rounded" | "heavy"
      backgroundColor?: string
      padding?: number
      margin?: number
      alignItems?: "flex-start" | "center" | "flex-end"
      justifyContent?: "flex-start" | "center" | "flex-end" | "space-between"
      flexDirection?: "row" | "column"
      height?: number
      width?: number
      style?: Record<string, any>
    }>

    group: DefineComponent<{
      flexDirection?: "row" | "column"
      alignItems?: "flex-start" | "center" | "flex-end"
      justifyContent?: "flex-start" | "center" | "flex-end" | "space-between"
      style?: Record<string, any>
    }>

    input: DefineComponent<{
      placeholder?: string
      focused?: boolean
      onInput?: (value: string) => void
      onChange?: (value: string) => void
      onSubmit?: (value: string) => void
      style?: Record<string, any>
    }>

    select: DefineComponent<{
      options?: SelectOption[]
      focused?: boolean
      showScrollIndicator?: boolean
      onChange?: (event: Event, option: SelectOption | null) => void
      style?: Record<string, any>
    }>

    "tab-select": DefineComponent<{
      options?: SelectOption[]
      focused?: boolean
      onChange?: (event: Event, option: SelectOption | null) => void
      style?: Record<string, any>
    }>

    text: DefineComponent<{
      content?: string | StyledText | TextChunk
      fg?: string
      attributes?: number
      style?: Record<string, any>
    }>
  }
}

// // Also declare them as intrinsic elements for JSX/TSX support
declare module "@vue/runtime-dom" {
  export interface IntrinsicElementAttributes {
    "ascii-font": {
      text?: string
      font?: "block" | "shade" | "slick" | "tiny"
      style?: Record<string, any>
    }

    box: {
      title?: string
      borderStyle?: "single" | "double" | "rounded" | "heavy"
      backgroundColor?: string
      padding?: number
      margin?: number
      alignItems?: "flex-start" | "center" | "flex-end"
      justifyContent?: "flex-start" | "center" | "flex-end" | "space-between"
      flexDirection?: "row" | "column"
      height?: number
      width?: number
      style?: Record<string, any>
    }

    group: {
      flexDirection?: "row" | "column"
      alignItems?: "flex-start" | "center" | "flex-end"
      justifyContent?: "flex-start" | "center" | "flex-end" | "space-between"
      style?: Record<string, any>
    }

    input: {
      placeholder?: string
      focused?: boolean
      onInput?: (value: string) => void
      onChange?: (value: string) => void
      onSubmit?: (value: string) => void
      style?: Record<string, any>
    }

    select: {
      options?: SelectOption[]
      focused?: boolean
      showScrollIndicator?: boolean
      onChange?: (event: Event, option: SelectOption | null) => void
      style?: Record<string, any>
    }

    "tab-select": {
      options?: SelectOption[]
      focused?: boolean
      onChange?: (event: Event, option: SelectOption | null) => void
      style?: Record<string, any>
    }

    text: {
      content?: string | StyledText | TextChunk
      fg?: string
      attributes?: number
      style?: Record<string, any>
    }
  }
}

// Make sure to export the module
export {}
