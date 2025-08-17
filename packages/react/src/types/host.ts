import type { Renderable, RootRenderable, TextRenderable } from "@opentui/core"

export type Type =
  | "opentui-text"
  | "opentui-box"
  | "opentui-group"
  | "opentui-input"
  | "opentui-select"
  | "opentui-tab-select"
export type Props = Record<string, any>
export type Container = RootRenderable
export type Instance = Renderable
export type TextInstance = TextRenderable
export type PublicInstance = Instance
export type HostContext = Record<string, any>

export type RenderableConstructor<T extends Instance = Instance> = new (id: string, props: Record<string, any>) => T
