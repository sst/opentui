import type { KeyLike, Keymap, KeymapEvent } from "../../index.js"

export interface LeaderOptions {
  trigger: KeyLike
  name?: string
}

/**
 * Defines a token such as `leader` that the default parser can reference as `<leader>`.
 */
export function registerLeader<TTarget extends object, TEvent extends KeymapEvent>(
  keymap: Keymap<TTarget, TEvent>,
  options: LeaderOptions,
): () => void {
  return keymap.registerToken({
    name: options.name ?? "leader",
    key: options.trigger,
  })
}
