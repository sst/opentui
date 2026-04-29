import type { ConditionService } from "./conditions.js"
import type { State } from "./state.js"
import type { NotificationService } from "./notify.js"
import { normalizeBindingCommand } from "./primitives/command-normalization.js"
import type {
  Attributes,
  BindingCommand,
  BindingEvent,
  BindingExpander,
  BindingExpanderContext,
  BindingInput,
  BindingParser,
  BindingParserContext,
  EventData,
  ParsedBindingInput,
  ReactiveMatcher,
  CompiledBinding,
  CompiledBindingsResult,
  KeyLike,
  KeyMatch,
  KeymapEvent,
  KeyStrokeInput,
  KeySequencePart,
  ResolvedKeyToken,
  RuntimeMatcher,
  SequenceNode,
  StringifyOptions,
} from "../types.js"
import { RESERVED_BINDING_FIELDS } from "../schema.js"
import {
  cloneKeySequence,
  cloneKeySequencePart,
  createKeySequencePart,
  createTextKeyMatch,
  normalizeBindingTokenName,
  stringifyKeySequence,
} from "./keys.js"
import { snapshotParsedBindingInput } from "./primitives/binding-inputs.js"
import { mergeAttribute, mergeRequirement } from "./primitives/field-invariants.js"
import { getErrorMessage, snapshotDataValue } from "./values.js"

const EMPTY_COMPILE_FIELDS: Readonly<Record<string, unknown>> = Object.freeze({})
const EMPTY_REQUIRES: readonly [name: string, value: unknown][] = []
const EMPTY_MATCHERS: readonly RuntimeMatcher[] = []
const EMPTY_CONDITION_KEYS: readonly string[] = []

function createSequenceNode<TTarget extends object, TEvent extends KeymapEvent>(
  parent: SequenceNode<TTarget, TEvent> | null,
  stroke: KeySequencePart["stroke"] | null,
  match: KeySequencePart["match"] | null,
): SequenceNode<TTarget, TEvent> {
  return {
    parent,
    depth: parent ? parent.depth + 1 : 0,
    stroke,
    match,
    children: new Map(),
    bindings: [],
    reachableBindings: [],
  }
}

function snapshotAttributes(attrs: Attributes): Readonly<Attributes> | undefined {
  if (Object.keys(attrs).length === 0) {
    return undefined
  }

  return snapshotDataValue(attrs, { freeze: true }) as Readonly<Attributes>
}

interface ParsedBindingSequenceResult {
  parts: KeySequencePart[]
  usedTokens: readonly string[]
  unknownTokens: readonly string[]
  hasTokenBindings: boolean
}

export interface CompilerOptions {
  warnUnknownField: (kind: "binding" | "layer", fieldName: string) => void
  warnUnknownToken: (token: string, sequence: string) => void
}

export class CompilerService<TTarget extends object, TEvent extends KeymapEvent> {
  constructor(
    private readonly state: State<TTarget, TEvent>,
    private readonly notify: NotificationService<TTarget, TEvent>,
    private readonly conditions: ConditionService<TTarget, TEvent>,
    private readonly options: CompilerOptions,
  ) {}

  public parseTokenKey(key: KeyLike): KeySequencePart {
    return parseSingleKeyPartWithParsers(key, this.state.environment.bindingParsers.values(), {
      tokens: this.state.environment.tokens,
      layer: EMPTY_COMPILE_FIELDS,
      parseObjectKey: (value, options) => this.parseObjectKeyPart(value, options),
    })
  }

  public parseKeySequence(key: KeyLike): KeySequencePart[] {
    if (typeof key !== "string") {
      return [this.parseObjectKeyPart(key)]
    }

    const parsed = parseBindingSequenceWithParsers(key, this.state.environment.bindingParsers.values(), {
      tokens: this.state.environment.tokens,
      layer: EMPTY_COMPILE_FIELDS,
      parseObjectKey: (value, options) => this.parseObjectKeyPart(value, options),
    })

    for (const tokenName of parsed.unknownTokens) {
      this.options.warnUnknownToken(tokenName, key)
    }

    return parsed.parts
  }

  public formatKey(key: KeyLike, options?: StringifyOptions): string {
    return stringifyKeySequence(this.parseKeySequence(key), options)
  }

  public compileBindings(
    bindings: readonly BindingInput<TTarget, TEvent>[],
    tokens: ReadonlyMap<string, ResolvedKeyToken>,
    sourceTarget: TTarget | undefined,
    sourceLayerOrder: number,
    compileFields?: Readonly<Record<string, unknown>>,
  ): CompiledBindingsResult<TTarget, TEvent> {
    const root = createSequenceNode<TTarget, TEvent>(null, null, null)
    const compiledBindings: CompiledBinding<TTarget, TEvent>[] = []
    let hasTokenBindings = false
    const bindingExpanders = this.state.environment.bindingExpanders.values()
    const bindingParsers = this.state.environment.bindingParsers.values()
    const bindingFieldCompilers = this.state.environment.bindingFields
    const allowExactPrefixAmbiguity = this.state.dispatch.disambiguationResolvers.has()
    const warnUnknownField = this.options.warnUnknownField
    const warnUnknownToken = this.options.warnUnknownToken
    const conditions = this.conditions

    for (const [bindingIndex, binding] of bindings.entries()) {
      let expandedBindingKeys: readonly KeyLike[]

      try {
        expandedBindingKeys = expandBindingInputWithExpanders(binding.key, bindingExpanders, {
          layer: compileFields,
        })
      } catch (error) {
        this.notify.emitError("binding-expand-error", error, getErrorMessage(error, "Failed to expand keymap binding"))
        continue
      }

      for (const expandedBindingKey of expandedBindingKeys) {
        let parsed: ParsedBindingSequenceResult | undefined

        try {
          parsed =
            typeof expandedBindingKey === "string"
              ? parseBindingSequenceWithParsers(expandedBindingKey, bindingParsers, {
                  tokens,
                  layer: compileFields,
                  parseObjectKey: (value, options) => this.parseObjectKeyPart(value, options),
                })
              : {
                  parts: [this.parseObjectKeyPart(expandedBindingKey)],
                  usedTokens: [] as readonly string[],
                  unknownTokens: [] as readonly string[],
                  hasTokenBindings: false,
                }
        } catch (error) {
          this.notify.emitError("binding-parse-error", error, getErrorMessage(error, "Failed to parse keymap binding"))
          continue
        }

        const sequence = parsed.parts
        hasTokenBindings ||= parsed.hasTokenBindings

        for (const tokenName of parsed.unknownTokens) {
          warnUnknownToken(
            tokenName,
            typeof expandedBindingKey === "string" ? expandedBindingKey : String(expandedBindingKey.name),
          )
        }

        for (const compiledInput of this.applyBindingTransformers(
          binding,
          sequence,
          tokens,
          bindingParsers,
          compileFields,
        )) {
          try {
            const event = this.normalizeBindingEvent(compiledInput.event)
            const compiledSequence = compiledInput.sequence
            let mergedRequires: EventData | undefined
            let mergedAttrs: Attributes | undefined
            let matchers: RuntimeMatcher[] | undefined
            let conditionKeys: Set<string> | undefined
            let hasUnkeyedMatchers = false

            for (const fieldName in compiledInput) {
              if (fieldName === "sequence") {
                continue
              }

              if (RESERVED_BINDING_FIELDS.has(fieldName)) {
                continue
              }

              const value = compiledInput[fieldName as keyof ParsedBindingInput]

              if (value === undefined) {
                continue
              }

              const compiler = bindingFieldCompilers.get(fieldName)
              if (!compiler) {
                warnUnknownField("binding", fieldName)
                continue
              }

              compiler(value, {
                require(name, requiredValue) {
                  if (!mergedRequires) {
                    mergedRequires = {}
                  }
                  mergeRequirement(mergedRequires, name, requiredValue, `field ${fieldName}`)
                  if (!conditionKeys) {
                    conditionKeys = new Set<string>()
                  }
                  conditionKeys.add(name)
                },
                attr(name, attributeValue) {
                  if (!mergedAttrs) {
                    mergedAttrs = {}
                  }
                  mergeAttribute(mergedAttrs, name, attributeValue, `field ${fieldName}`)
                },
                activeWhen: (matcher) => {
                  const runtimeMatcher = conditions.buildRuntimeMatcher(matcher, `field ${fieldName}`)
                  if (!runtimeMatcher.cacheable) {
                    hasUnkeyedMatchers = true
                  }
                  if (!matchers) {
                    matchers = []
                  }
                  matchers.push(runtimeMatcher)
                },
              })
            }

            const attrs = mergedAttrs ? snapshotAttributes(mergedAttrs) : undefined
            const command = normalizeBindingCommand(compiledInput.cmd)
            const compiledBinding: CompiledBinding<TTarget, TEvent> = {
              sequence: compiledSequence,
              command,
              event,
              sourceBinding: snapshotParsedBindingInput(compiledInput),
              sourceTarget,
              sourceLayerOrder,
              sourceBindingIndex: bindingIndex,
              requires: mergedRequires ? Object.entries(mergedRequires) : EMPTY_REQUIRES,
              matchers: matchers ?? EMPTY_MATCHERS,
              conditionKeys: conditionKeys ? [...conditionKeys] : EMPTY_CONDITION_KEYS,
              hasUnkeyedMatchers,
              matchCacheDirty: true,
              preventDefault: compiledInput.preventDefault !== false,
              fallthrough: compiledInput.fallthrough ?? false,
            }

            if (attrs) {
              compiledBinding.attrs = attrs
            }

            if (typeof command === "function") {
              compiledBinding.run = command
            }

            if (compiledSequence.length === 0) {
              continue
            }

            if (event === "release" && compiledSequence.length > 1) {
              throw new Error("Keymap release bindings only support a single key stroke")
            }

            if (event === "press") {
              this.insertBinding(root, compiledBinding, allowExactPrefixAmbiguity)
            }

            compiledBindings.push(compiledBinding)
          } catch (error) {
            this.notify.emitError(
              "binding-compile-error",
              error,
              getErrorMessage(error, "Failed to compile keymap binding"),
            )
          }
        }
      }
    }

    return {
      root,
      bindings: compiledBindings,
      hasTokenBindings,
    }
  }

  private parseObjectKeyPart(
    key: KeyStrokeInput,
    options?: {
      display?: string
      match?: KeyMatch
      tokenName?: string
    },
  ): KeySequencePart {
    return createKeySequencePart(key, options)
  }

  private normalizeBindingEvent(event: unknown): BindingEvent {
    if (event === undefined || event === "press") {
      return "press"
    }

    if (event === "release") {
      return "release"
    }

    throw new Error(`Invalid keymap binding event "${String(event)}": expected "press" or "release"`)
  }

  private applyBindingTransformers(
    binding: BindingInput<TTarget, TEvent>,
    sequence: KeySequencePart[],
    tokens: ReadonlyMap<string, ResolvedKeyToken>,
    bindingParsers: readonly BindingParser[],
    compileFields?: Readonly<Record<string, unknown>>,
  ): ParsedBindingInput<TTarget, TEvent>[] {
    const bindingTransformers = this.state.environment.bindingTransformers.values()

    if (bindingTransformers.length === 0) {
      return [{ ...binding, sequence: cloneKeySequence(sequence) }]
    }

    const parsedBinding: ParsedBindingInput<TTarget, TEvent> = {
      ...binding,
      sequence: cloneKeySequence(sequence),
    }
    const extraBindings: ParsedBindingInput<TTarget, TEvent>[] = []
    let keepOriginal = true
    const layer = compileFields ?? EMPTY_COMPILE_FIELDS

    for (const transformer of bindingTransformers) {
      try {
        transformer(parsedBinding, {
          layer,
          parseKey: (key) => {
            return parseSingleKeyPartWithParsers(key, bindingParsers, {
              tokens,
              layer,
              parseObjectKey: (value, options) => this.parseObjectKeyPart(value, options),
            })
          },
          add: (nextBinding) => {
            extraBindings.push(snapshotParsedBindingInput(nextBinding))
          },
          skipOriginal: () => {
            keepOriginal = false
          },
        })
      } catch (error) {
        this.notify.emitError("binding-transformer-error", error, "[Keymap] Error in binding transformer:")
      }
    }

    if (!keepOriginal) {
      return extraBindings
    }

    if (extraBindings.length === 0) {
      return [parsedBinding]
    }

    return [parsedBinding, ...extraBindings]
  }

  private insertBinding(
    root: SequenceNode<TTarget, TEvent>,
    binding: CompiledBinding<TTarget, TEvent>,
    allowExactPrefixAmbiguity: boolean,
  ): void {
    let node = root
    const touchedNodes: SequenceNode<TTarget, TEvent>[] = []
    const createdNodes: Array<{ parent: SequenceNode<TTarget, TEvent>; key: KeyMatch }> = []

    try {
      for (const part of binding.sequence) {
        if (!allowExactPrefixAmbiguity && node.bindings.some((candidate) => candidate.command !== undefined)) {
          throw new Error(
            "Keymap bindings cannot use the same sequence as both an exact match and a prefix in the same layer",
          )
        }

        const bindingKey = part.match
        let child = node.children.get(bindingKey)
        if (!child) {
          child = createSequenceNode<TTarget, TEvent>(node, cloneKeySequencePart(part).stroke, part.match)
          node.children.set(bindingKey, child)
          createdNodes.push({ parent: node, key: bindingKey })
        }

        child.reachableBindings.push(binding)
        touchedNodes.push(child)
        node = child
      }

      if (!allowExactPrefixAmbiguity && binding.command !== undefined && node.children.size > 0) {
        throw new Error(
          "Keymap bindings cannot use the same sequence as both an exact match and a prefix in the same layer",
        )
      }

      node.bindings = [...node.bindings, binding]
    } catch (error) {
      for (let index = touchedNodes.length - 1; index >= 0; index -= 1) {
        const touchedNode = touchedNodes[index]
        if (!touchedNode) {
          continue
        }

        if (touchedNode.reachableBindings.at(-1) === binding) {
          touchedNode.reachableBindings.pop()
          continue
        }

        touchedNode.reachableBindings = touchedNode.reachableBindings.filter((candidate) => candidate !== binding)
      }

      for (let index = createdNodes.length - 1; index >= 0; index -= 1) {
        const createdNode = createdNodes[index]
        if (!createdNode) {
          continue
        }

        const child = createdNode.parent.children.get(createdNode.key)
        if (!child) {
          continue
        }

        if (child.children.size > 0 || child.reachableBindings.length > 0 || child.bindings.length > 0) {
          continue
        }

        createdNode.parent.children.delete(createdNode.key)
      }

      throw error
    }
  }
}

function expandBindingInputWithExpanders(
  key: KeyLike,
  expanders: readonly BindingExpander[],
  options?: {
    layer?: Readonly<Record<string, unknown>>
  },
): readonly KeyLike[] {
  if (typeof key !== "string" || expanders.length === 0) {
    return [key]
  }

  const layer = options?.layer ?? EMPTY_COMPILE_FIELDS
  let candidates = [key]

  for (const expander of expanders) {
    const nextCandidates: string[] = []

    for (const input of candidates) {
      const result = expander({ input, layer } satisfies BindingExpanderContext)
      if (!result) {
        nextCandidates.push(input)
        continue
      }

      if (result.length === 0) {
        throw new Error(`Keymap binding expander must return at least one key sequence for "${input}"`)
      }

      for (const expandedInput of result) {
        if (typeof expandedInput !== "string") {
          throw new Error(`Keymap binding expander must return string key sequences for "${input}"`)
        }

        nextCandidates.push(expandedInput)
      }
    }

    candidates = nextCandidates
  }

  return candidates
}

function parseBindingSequenceWithParsers(
  key: string,
  parsers: readonly BindingParser[],
  options: {
    tokens?: ReadonlyMap<string, ResolvedKeyToken>
    layer?: Readonly<Record<string, unknown>>
    parseObjectKey: (
      key: KeyStrokeInput,
      options?: { display?: string; match?: KeyMatch; tokenName?: string },
    ) => KeySequencePart
  },
): ParsedBindingSequenceResult {
  if (key.length === 0) {
    throw new Error("Invalid key sequence: sequence cannot be empty")
  }

  if (parsers.length === 0) {
    throw new Error("No keymap binding parsers are registered")
  }

  const tokens = options.tokens ?? new Map<string, ResolvedKeyToken>()
  const layer = options.layer ?? EMPTY_COMPILE_FIELDS
  const parseObjectKey = options.parseObjectKey
  const parts: KeySequencePart[] = []
  const usedTokens = new Set<string>()
  const unknownTokens = new Set<string>()

  let index = 0
  while (index < key.length) {
    let matched = false

    for (const parser of parsers) {
      const result = parser({
        input: key,
        index,
        layer,
        tokens,
        normalizeTokenName: normalizeBindingTokenName,
        createMatch: createTextKeyMatch,
        parseObjectKey,
      } satisfies BindingParserContext)
      if (!result) {
        continue
      }

      if (result.nextIndex <= index || result.nextIndex > key.length) {
        throw new Error(`Keymap binding parser must advance the input for "${key}" at index ${index}`)
      }

      parts.push(...result.parts)
      for (const tokenName of result.usedTokens ?? []) {
        usedTokens.add(tokenName)
      }
      for (const tokenName of result.unknownTokens ?? []) {
        unknownTokens.add(tokenName)
      }

      index = result.nextIndex
      matched = true
      break
    }

    if (!matched) {
      throw new Error(`No keymap binding parser handled input at index ${index} in "${key}"`)
    }
  }

  return {
    parts,
    usedTokens: [...usedTokens],
    unknownTokens: [...unknownTokens],
    hasTokenBindings: usedTokens.size > 0 || unknownTokens.size > 0,
  }
}

function parseSingleKeyPartWithParsers(
  key: KeyLike,
  parsers: readonly BindingParser[],
  options: {
    tokens?: ReadonlyMap<string, ResolvedKeyToken>
    layer?: Readonly<Record<string, unknown>>
    parseObjectKey: (
      key: KeyStrokeInput,
      options?: { display?: string; match?: KeyMatch; tokenName?: string },
    ) => KeySequencePart
  },
): KeySequencePart {
  if (typeof key !== "string") {
    return options.parseObjectKey(key)
  }

  const { parts } = parseBindingSequenceWithParsers(key, parsers, options)
  const [part] = parts
  if (!part || parts.length !== 1) {
    throw new Error(`Invalid key "${String(key)}": expected a single key stroke`)
  }

  return part
}
