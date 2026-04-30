import { stringifyKeyStroke } from "../services/keys.js"
import type { KeySequencePart } from "../types.js"

export type KeyModifierName = "ctrl" | "shift" | "meta" | "super" | "hyper"

export type TokenDisplayResolver =
  | Readonly<Record<string, string>>
  | ((tokenName: string, part: KeySequencePart) => string | undefined)

export interface FormatKeySequenceOptions {
  tokenDisplay?: TokenDisplayResolver
  keyNameAliases?: Readonly<Record<string, string>>
  modifierAliases?: Partial<Record<KeyModifierName, string>>
  separator?: string
}

export interface FormatCommandBindingsOptions extends FormatKeySequenceOptions {
  bindingSeparator?: string
  dedupe?: boolean
}

export interface SequenceBindingLike {
  sequence: readonly KeySequencePart[]
}

function resolveTokenDisplay(part: KeySequencePart, tokenDisplay: TokenDisplayResolver | undefined) {
  if (!part.tokenName) return
  if (!tokenDisplay) return part.display
  if (typeof tokenDisplay === "function") return tokenDisplay(part.tokenName, part) ?? part.display
  return tokenDisplay[part.tokenName] ?? part.display
}

function resolveModifierAlias(name: KeyModifierName, modifierAliases: FormatKeySequenceOptions["modifierAliases"]) {
  return modifierAliases?.[name] ?? name
}

function resolveKeyName(part: KeySequencePart, keyNameAliases: FormatKeySequenceOptions["keyNameAliases"]) {
  const name = stringifyKeyStroke({ name: part.stroke.name })
  return keyNameAliases?.[name] ?? name
}

function formatStroke(part: KeySequencePart, options: FormatKeySequenceOptions) {
  const tokenDisplay = resolveTokenDisplay(part, options.tokenDisplay)
  if (tokenDisplay) return tokenDisplay

  const pieces: string[] = []
  if (part.stroke.ctrl) pieces.push(resolveModifierAlias("ctrl", options.modifierAliases))
  if (part.stroke.shift) pieces.push(resolveModifierAlias("shift", options.modifierAliases))
  if (part.stroke.meta) pieces.push(resolveModifierAlias("meta", options.modifierAliases))
  if (part.stroke.super) pieces.push(resolveModifierAlias("super", options.modifierAliases))
  if (part.stroke.hyper) pieces.push(resolveModifierAlias("hyper", options.modifierAliases))
  pieces.push(resolveKeyName(part, options.keyNameAliases))
  return pieces.join("+")
}

export function formatKeySequence(parts: readonly KeySequencePart[] | undefined, options: FormatKeySequenceOptions = {}) {
  if (!parts || parts.length === 0) return ""
  return parts.map((part) => formatStroke(part, options)).join(options.separator ?? " ")
}

export function formatCommandBindings(
  bindings: readonly SequenceBindingLike[] | undefined,
  options: FormatCommandBindingsOptions = {},
) {
  if (!bindings?.length) return
  const seen = new Set<string>()

  return bindings
    .map((binding) => formatKeySequence(binding.sequence, options))
    .filter((item) => {
      if (!item) return false
      if (options.dedupe === false) return true
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
    .join(options.bindingSeparator ?? ", ")
}
