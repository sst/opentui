import type {
  BindingParser,
  EventMatchResolver,
  KeyMatch,
  Keymap,
  KeymapEvent,
  KeySequencePart,
  KeyStrokeInput,
} from "../../index.js"

const namedSingleStrokeKeys = new Set<string>([
  "up",
  "down",
  "left",
  "right",
  "clear",
  "escape",
  "return",
  "linefeed",
  "enter",
  "tab",
  "backspace",
  "delete",
  "insert",
  "home",
  "end",
  "pageup",
  "pagedown",
  "space",
  "lt",
  "gt",
  "plus",
  "minus",
  "equal",
  "comma",
  "period",
  "slash",
  "backslash",
  "semicolon",
  "quote",
  "backquote",
  "leftbracket",
  "rightbracket",
  "capslock",
  "numlock",
  "scrolllock",
  "printscreen",
  "pause",
  "menu",
  "apps",
  "kp0",
  "kp1",
  "kp2",
  "kp3",
  "kp4",
  "kp5",
  "kp6",
  "kp7",
  "kp8",
  "kp9",
  "kpdecimal",
  "kpdivide",
  "kpmultiply",
  "kpminus",
  "kpplus",
  "kpenter",
  "kpequal",
  "kpseparator",
  "kpleft",
  "kpright",
  "kpup",
  "kpdown",
  "kppageup",
  "kppagedown",
  "kphome",
  "kpend",
  "kpinsert",
  "kpdelete",
  "mediaplay",
  "mediapause",
  "mediaplaypause",
  "mediareverse",
  "mediastop",
  "mediafastforward",
  "mediarewind",
  "medianext",
  "mediaprev",
  "mediarecord",
  "volumedown",
  "volumeup",
  "mute",
  "leftshift",
  "leftctrl",
  "leftalt",
  "leftsuper",
  "lefthyper",
  "leftmeta",
  "rightshift",
  "rightctrl",
  "rightalt",
  "rightsuper",
  "righthyper",
  "rightmeta",
  "iso_level3_shift",
  "iso_level5_shift",
  "option",
  "alt",
  "meta",
  "super",
  "hyper",
  "control",
  "ctrl",
  "shift",
])

type DefaultParserContext = Parameters<BindingParser>[0]

function parseObjectKeyInput(
  ctx: DefaultParserContext,
  key: KeyStrokeInput,
  display?: string,
  match?: KeyMatch,
  tokenName?: string,
): KeySequencePart {
  return ctx.parseObjectKey(key, {
    display,
    match,
    tokenName,
  })
}

function isNamedSingleStrokeKey(input: string, extraNames?: ReadonlySet<string>): boolean {
  const normalized = input.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  if (namedSingleStrokeKeys.has(normalized)) {
    return true
  }

  if (extraNames?.has(normalized)) {
    return true
  }

  return /^f\d{1,2}$/i.test(normalized)
}

function isSingleStrokeString(input: string, extraNames?: ReadonlySet<string>): boolean {
  if (input === " " || input === "+") {
    return true
  }

  if (input.length === 1) {
    return true
  }

  if (input.includes("+")) {
    return true
  }

  return isNamedSingleStrokeKey(input, extraNames)
}

function parseStringKeyPart(input: string, ctx: DefaultParserContext): KeySequencePart {
  if (input === " ") {
    return ctx.parseObjectKey({ name: "space" }, { display: "space" })
  }

  if (input === "+") {
    return ctx.parseObjectKey({ name: "+" }, { display: "+" })
  }

  const parts = input.split("+")
  let name = ""
  let displayName = ""
  let ctrl = false
  let shift = false
  let meta = false
  let superKey = false
  let hyper = false

  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part) {
      continue
    }

    const lowered = part.toLowerCase()
    if (lowered === "ctrl" || lowered === "control") {
      ctrl = true
      continue
    }

    if (lowered === "shift") {
      shift = true
      continue
    }

    if (lowered === "meta" || lowered === "alt" || lowered === "option") {
      meta = true
      continue
    }

    if (lowered === "super") {
      superKey = true
      continue
    }

    if (lowered === "hyper") {
      hyper = true
      continue
    }

    if (name) {
      throw new Error(`Invalid key "${input}": multiple key names are not supported`)
    }

    name = part
    displayName = lowered
  }

  if (!name) {
    throw new Error(`Invalid key "${input}": missing key name`)
  }

  const displayParts: string[] = []
  if (ctrl) displayParts.push("ctrl")
  if (shift) displayParts.push("shift")
  if (meta) displayParts.push("meta")
  if (superKey) displayParts.push("super")
  if (hyper) displayParts.push("hyper")
  displayParts.push(displayName)

  return ctx.parseObjectKey(
    {
      name,
      ctrl,
      shift,
      meta,
      super: superKey,
      hyper: hyper || undefined,
    },
    {
      display: displayParts.join("+"),
    },
  )
}

export const defaultBindingParser: BindingParser = (ctx) => {
  const { input, index, tokens, normalizeTokenName } = ctx

  if (index === 0 && isSingleStrokeString(input)) {
    if (input === " " || input === "+") {
      return {
        parts: [parseStringKeyPart(input, ctx)],
        nextIndex: input.length,
      }
    }

    return {
      parts: [parseStringKeyPart(input, ctx)],
      nextIndex: input.length,
    }
  }

  const char = input[index]
  if (char === undefined) {
    return undefined
  }

  if (char === "<") {
    const end = input.indexOf(">", index)
    if (end === -1) {
      return {
        parts: [parseStringKeyPart(char, ctx)],
        nextIndex: index + 1,
      }
    }

    const tokenName = normalizeTokenName(input.slice(index + 1, end))
    const token = tokens.get(tokenName)
    if (!token) {
      return {
        parts: [],
        nextIndex: end + 1,
        unknownTokens: [tokenName],
      }
    }

    return {
      parts: [parseObjectKeyInput(ctx, token.stroke, `<${tokenName}>`, token.match, tokenName)],
      nextIndex: end + 1,
      usedTokens: [tokenName],
    }
  }

  if (char === "{") {
    const end = input.indexOf("}", index)
    if (end === -1) {
      return {
        parts: [parseStringKeyPart(char, ctx)],
        nextIndex: index + 1,
      }
    }

    const patternName = normalizeTokenName(input.slice(index + 1, end))
    const pattern = ctx.patterns.get(patternName)
    if (!pattern) {
      return {
        parts: [],
        nextIndex: end + 1,
        unknownTokens: [patternName],
      }
    }

    const part = ctx.parseObjectKey(
      { name: patternName, ctrl: false, shift: false, meta: false, super: false },
      { display: pattern.display ?? `{${patternName}}`, match: pattern.match },
    )

    return {
      parts: [{ ...part, patternName: pattern.name, payloadKey: pattern.payloadKey }],
      nextIndex: end + 1,
      usedTokens: [patternName],
    }
  }

  return {
    parts: [parseStringKeyPart(char, ctx)],
    nextIndex: index + 1,
  }
}

export const defaultEventMatchResolver: EventMatchResolver<KeymapEvent> = (event, ctx) => {
  return [
    ctx.resolveKey({
      name: event.name,
      ctrl: event.ctrl,
      shift: event.shift,
      meta: event.meta,
      super: event.super ?? false,
      hyper: event.hyper || undefined,
    }),
  ]
}

/**
 * Parses the built-in string binding syntax, including modifiers,
 * `<token>` aliases, and `{pattern}` dynamic sequence segments.
 */
export function registerDefaultBindingParser<TTarget extends object, TEvent extends KeymapEvent>(
  keymap: Keymap<TTarget, TEvent>,
): () => void {
  return keymap.appendBindingParser((ctx) => defaultBindingParser(ctx))
}

/**
 * Matches incoming key events against their canonical normalized stroke.
 */
export function registerDefaultEventMatchResolver<TTarget extends object, TEvent extends KeymapEvent>(
  keymap: Keymap<TTarget, TEvent>,
): () => void {
  return keymap.appendEventMatchResolver((event, ctx) => defaultEventMatchResolver(event, ctx))
}

/**
 * Installs the standard parser and event matcher used by most keymaps.
 */
export function registerDefaultKeys<TTarget extends object, TEvent extends KeymapEvent>(
  keymap: Keymap<TTarget, TEvent>,
): () => void {
  const offParser = registerDefaultBindingParser(keymap)
  const offResolver = registerDefaultEventMatchResolver(keymap)

  return () => {
    offResolver()
    offParser()
  }
}
