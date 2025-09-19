import type { BaseRenderable, RootRenderable, TextNodeRenderable } from "@opentui/core"
import { baseComponents } from "../components"

export type Type = keyof typeof baseComponents
export type Props = Record<string, any>
export type Container = RootRenderable
export type Instance = BaseRenderable
export type TextInstance = TextNodeRenderable
export type PublicInstance = Instance
export type HostContext = Record<string, any> & { isInsideText?: boolean }
