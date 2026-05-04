import type { CompilerService } from "./compiler.js"
import type { LayerService } from "./layers.js"
import type { NotificationService } from "./notify.js"
import type { State } from "./state.js"
import { RESERVED_BINDING_FIELDS, RESERVED_COMMAND_FIELDS, RESERVED_LAYER_FIELDS } from "../schema.js"
import type {
  BindingExpander,
  BindingFieldCompiler,
  LayerBindingsTransformer,
  BindingParser,
  BindingTransformer,
  CommandFieldCompiler,
  CommandTransformer,
  KeySequencePart,
  KeyToken,
  KeymapEvent,
  LayerFieldCompiler,
  ResolvedKeyToken,
  ResolvedSequencePattern,
  SequencePattern,
} from "../types.js"
import { createTextKeyMatch, normalizeBindingTokenName } from "./keys.js"
import { getErrorMessage } from "./values.js"

const NOOP = (): void => {}

type FieldKind = "layer" | "binding" | "command"

function normalizePatternLimit(name: string, field: "min" | "max", value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Keymap sequence pattern "${name}" ${field} must be a non-negative integer`)
  }

  return value
}

function registerFieldCompilers<T>(
  fields: Record<string, T>,
  options: {
    kind: FieldKind
    reservedFields: ReadonlySet<string>
    registeredFields: Map<string, T>
    emitError(code: string, error: unknown, message: string): void
  },
): () => void {
  const { kind, reservedFields, registeredFields, emitError } = options
  const entries = Object.entries(fields)
  const registered: Array<[string, T]> = []

  for (const [name] of entries) {
    if (reservedFields.has(name)) {
      emitError(`reserved-${kind}-field`, { field: name, kind }, `Keymap ${kind} field "${name}" is reserved`)
      continue
    }

    if (registeredFields.has(name)) {
      emitError(
        `duplicate-${kind}-field`,
        { field: name, kind },
        `Keymap ${kind} field "${name}" is already registered`,
      )
    }
  }

  for (const [name, compiler] of entries) {
    if (reservedFields.has(name) || registeredFields.has(name)) {
      continue
    }

    registeredFields.set(name, compiler)
    registered.push([name, compiler])
  }

  return () => {
    for (const [name, compiler] of registered) {
      const current = registeredFields.get(name)
      if (current === compiler) {
        registeredFields.delete(name)
      }
    }
  }
}

export class EnvironmentService<TTarget extends object, TEvent extends KeymapEvent> {
  #state: State<TTarget, TEvent>
  #notify: NotificationService<TTarget, TEvent>
  #compiler: CompilerService<TTarget, TEvent>
  #layers: LayerService<TTarget, TEvent>

  constructor(
    state: State<TTarget, TEvent>,
    notify: NotificationService<TTarget, TEvent>,
    compiler: CompilerService<TTarget, TEvent>,
    layers: LayerService<TTarget, TEvent>,
  ) {
    this.#state = state
    this.#notify = notify
    this.#compiler = compiler
    this.#layers = layers
  }

  public prependBindingTransformer(transformer: BindingTransformer<TTarget, TEvent>): () => void {
    return this.#state.environment.bindingTransformers.prepend(transformer)
  }

  public prependLayerBindingsTransformer(transformer: LayerBindingsTransformer<TTarget, TEvent>): () => void {
    return this.#state.environment.layerBindingsTransformers.prepend(transformer)
  }

  public appendLayerBindingsTransformer(transformer: LayerBindingsTransformer<TTarget, TEvent>): () => void {
    return this.#state.environment.layerBindingsTransformers.append(transformer)
  }

  public clearLayerBindingsTransformers(): void {
    this.#state.environment.layerBindingsTransformers.clear()
  }

  public appendBindingTransformer(transformer: BindingTransformer<TTarget, TEvent>): () => void {
    return this.#state.environment.bindingTransformers.append(transformer)
  }

  public clearBindingTransformers(): void {
    this.#state.environment.bindingTransformers.clear()
  }

  public prependCommandTransformer(transformer: CommandTransformer<TTarget, TEvent>): () => void {
    return this.#state.environment.commandTransformers.prepend(transformer)
  }

  public appendCommandTransformer(transformer: CommandTransformer<TTarget, TEvent>): () => void {
    return this.#state.environment.commandTransformers.append(transformer)
  }

  public clearCommandTransformers(): void {
    this.#state.environment.commandTransformers.clear()
  }

  public prependBindingParser(parser: BindingParser): () => void {
    return this.#state.environment.bindingParsers.prepend(parser)
  }

  public appendBindingParser(parser: BindingParser): () => void {
    return this.#state.environment.bindingParsers.append(parser)
  }

  public clearBindingParsers(): void {
    this.#state.environment.bindingParsers.clear()
  }

  public registerToken(token: KeyToken): () => void {
    let normalizedToken: string

    try {
      normalizedToken = normalizeBindingTokenName(token.name)
    } catch (error) {
      this.#notify.emitError(
        "token-name-normalize-error",
        error,
        getErrorMessage(error, "Failed to register keymap token"),
      )
      return NOOP
    }

    if (
      this.#state.environment.tokens.has(normalizedToken) ||
      this.#state.environment.sequencePatterns.has(normalizedToken)
    ) {
      this.#notify.emitError(
        "duplicate-token",
        { token: normalizedToken },
        `Keymap token "${normalizedToken}" is already registered`,
      )
      return NOOP
    }

    let parsedToken: KeySequencePart

    try {
      parsedToken = this.#compiler.parseTokenKey(token.key)
      if (parsedToken.patternName) {
        throw new Error(`Invalid key "${String(token.key)}": expected a concrete key stroke`)
      }
    } catch (error) {
      this.#notify.emitError(
        "token-parse-error",
        error,
        getErrorMessage(error, `Failed to register keymap token "${normalizedToken}"`),
      )
      return NOOP
    }

    const registeredToken: ResolvedKeyToken = {
      stroke: parsedToken.stroke,
      match: parsedToken.match,
    }

    const nextTokens = new Map(this.#state.environment.tokens)
    nextTokens.set(normalizedToken, registeredToken)

    try {
      this.#layers.applyTokenState(nextTokens)
    } catch (error) {
      this.#notify.emitError(
        "token-register-error",
        error,
        getErrorMessage(error, `Failed to register keymap token "${normalizedToken}"`),
      )
      return NOOP
    }

    return () => {
      const current = this.#state.environment.tokens.get(normalizedToken)
      if (current !== registeredToken) {
        return
      }

      const nextTokens = new Map(this.#state.environment.tokens)
      nextTokens.delete(normalizedToken)

      try {
        this.#layers.applyTokenState(nextTokens)
      } catch (error) {
        this.#notify.emitError(
          "token-unregister-error",
          error,
          getErrorMessage(error, `Failed to unregister keymap token "${normalizedToken}"`),
        )
      }
    }
  }

  public registerSequencePattern(pattern: SequencePattern<TEvent>): () => void {
    let normalizedName: string
    let resolvedPattern: ResolvedSequencePattern<TEvent>

    try {
      normalizedName = normalizeBindingTokenName(pattern.name)
      const min = normalizePatternLimit(normalizedName, "min", pattern.min, 1)
      const max = normalizePatternLimit(normalizedName, "max", pattern.max, Number.MAX_SAFE_INTEGER)
      if (max < min) {
        throw new Error(`Keymap sequence pattern "${normalizedName}" max must be greater than or equal to min`)
      }

      resolvedPattern = {
        name: normalizedName,
        display: pattern.display,
        payloadKey: pattern.payloadKey ?? normalizedName,
        match: createTextKeyMatch(`pattern:${normalizedName}`),
        min,
        max,
        matcher: (event) => pattern.match(event),
        finalize: pattern.finalize,
      }
    } catch (error) {
      this.#notify.emitError(
        "sequence-pattern-register-error",
        error,
        getErrorMessage(error, "Failed to register keymap sequence pattern"),
      )
      return NOOP
    }

    if (
      this.#state.environment.tokens.has(normalizedName) ||
      this.#state.environment.sequencePatterns.has(normalizedName)
    ) {
      this.#notify.emitError(
        "duplicate-sequence-pattern",
        { pattern: normalizedName },
        `Keymap sequence pattern "${normalizedName}" is already registered`,
      )
      return NOOP
    }

    this.#state.environment.sequencePatterns.set(normalizedName, resolvedPattern)
    this.#layers.recompileBindings()

    return () => {
      const current = this.#state.environment.sequencePatterns.get(normalizedName)
      if (current !== resolvedPattern) {
        return
      }

      this.#state.environment.sequencePatterns.delete(normalizedName)
      this.#layers.recompileBindings()
    }
  }

  public prependBindingExpander(expander: BindingExpander): () => void {
    return this.#state.environment.bindingExpanders.prepend(expander)
  }

  public appendBindingExpander(expander: BindingExpander): () => void {
    return this.#state.environment.bindingExpanders.append(expander)
  }

  public clearBindingExpanders(): void {
    this.#state.environment.bindingExpanders.clear()
  }

  public registerLayerFields(fields: Record<string, LayerFieldCompiler>): () => void {
    return registerFieldCompilers(fields, {
      kind: "layer",
      reservedFields: RESERVED_LAYER_FIELDS,
      registeredFields: this.#state.environment.layerFields,
      emitError: (code, error, message) => {
        this.#notify.emitError(code, error, message)
      },
    })
  }

  public registerBindingFields(fields: Record<string, BindingFieldCompiler>): () => void {
    return registerFieldCompilers(fields, {
      kind: "binding",
      reservedFields: RESERVED_BINDING_FIELDS,
      registeredFields: this.#state.environment.bindingFields,
      emitError: (code, error, message) => {
        this.#notify.emitError(code, error, message)
      },
    })
  }

  public registerCommandFields(fields: Record<string, CommandFieldCompiler>): () => void {
    return registerFieldCompilers(fields, {
      kind: "command",
      reservedFields: RESERVED_COMMAND_FIELDS,
      registeredFields: this.#state.environment.commandFields,
      emitError: (code, error, message) => {
        this.#notify.emitError(code, error, message)
      },
    })
  }
}
