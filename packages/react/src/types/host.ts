import type { Renderable, RootRenderable, TextRenderable } from "@opentui/core"
import { baseComponents } from "../components"

export type Type = keyof typeof baseComponents
export type Props = Record<string, any>
export type Container = RootRenderable
export type Instance = Renderable
export type TextInstance = TextRenderable
export type PublicInstance = Instance
export type HostContext = Record<string, any>
