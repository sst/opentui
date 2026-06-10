import type { ActivationService } from "./activation.js"
import type { CommandCatalogService } from "./command-catalog.js"
import type { ConditionService } from "./conditions.js"
import type { State } from "./state.js"
import type { KeymapEvent, KeymapHost } from "../types.js"

export const KEYMAP_EXTENSION_CONTEXT = Symbol("keymap-extension-context")

export interface KeymapExtensionContext<TTarget extends object, TEvent extends KeymapEvent> {
  state: State<TTarget, TEvent>
  host: KeymapHost<TTarget, TEvent>
  conditions: ConditionService<TTarget, TEvent>
  catalog: CommandCatalogService<TTarget, TEvent>
  activation: ActivationService<TTarget, TEvent>
}

export interface KeymapExtensionProvider<TTarget extends object, TEvent extends KeymapEvent> {
  [KEYMAP_EXTENSION_CONTEXT](): KeymapExtensionContext<TTarget, TEvent>
}
