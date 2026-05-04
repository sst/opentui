import type { CompilerService } from "./compiler.js"
import type { CommandCatalogService } from "./command-catalog.js"
import type { ConditionService } from "./conditions.js"
import type { ActivationService } from "./activation.js"
import type {
  Attributes,
  Binding,
  BindingState,
  BindingCompilationResult,
  Command,
  EventData,
  KeymapEvent,
  KeymapHost,
  Layer,
  ResolvedKeyToken,
  CommandState,
  RegisteredLayer,
  RuntimeMatchable,
  RuntimeMatcher,
  TargetMode,
} from "../types.js"
import { RESERVED_LAYER_FIELDS } from "../schema.js"
import type { State } from "./state.js"
import type { NotificationService } from "./notify.js"
import { snapshotBindings, validateBindings } from "./primitives/bindings.js"
import { createFieldCompilerContext } from "./primitives/field-invariants.js"
import { getErrorMessage, snapshotDataValue } from "./values.js"

const NOOP = (): void => {}

function sortLayers<TTarget extends object, TEvent extends KeymapEvent>(
  layers: readonly RegisteredLayer<TTarget, TEvent>[],
): RegisteredLayer<TTarget, TEvent>[] {
  return [...layers].sort((left, right) => {
    const priorityDiff = right.priority - left.priority
    if (priorityDiff !== 0) {
      return priorityDiff
    }

    return right.order - left.order
  })
}

function createCommandLookup<TTarget extends object, TEvent extends KeymapEvent>(
  commands: readonly CommandState<TTarget, TEvent>[],
): ReadonlyMap<string, CommandState<TTarget, TEvent>> | undefined {
  if (commands.length === 0) {
    return undefined
  }

  const lookup = new Map<string, CommandState<TTarget, TEvent>>()
  for (const commandState of commands) {
    lookup.set(commandState.command.name, commandState)
  }

  return lookup
}

function addCommandNameRefs<TTarget extends object, TEvent extends KeymapEvent>(
  target: Map<string, number>,
  commands: readonly CommandState<TTarget, TEvent>[],
): void {
  for (const commandState of commands) {
    target.set(commandState.command.name, (target.get(commandState.command.name) ?? 0) + 1)
  }
}

function removeCommandNameRefs<TTarget extends object, TEvent extends KeymapEvent>(
  target: Map<string, number>,
  commands: readonly CommandState<TTarget, TEvent>[],
): void {
  for (const commandState of commands) {
    const count = target.get(commandState.command.name)
    if (!count || count <= 1) {
      target.delete(commandState.command.name)
      continue
    }

    target.set(commandState.command.name, count - 1)
  }
}

interface CompileLayerRuntimeStateResult {
  requires: readonly [name: string, value: unknown][]
  matchers: readonly RuntimeMatcher[]
  compileFields?: Readonly<Record<string, unknown>>
  attrs?: Readonly<Attributes>
}

interface LayersOptions<TTarget extends object, TEvent extends KeymapEvent> {
  compiler: CompilerService<TTarget, TEvent>
  commands: CommandCatalogService<TTarget, TEvent>
  host: KeymapHost<TTarget, TEvent>
  diagnostics?: LayerDiagnostics<TTarget, TEvent>
  warnUnknownField: (kind: "binding" | "layer", fieldName: string) => void
}

export interface AnalyzeLayerOptions<TTarget extends object, TEvent extends KeymapEvent> {
  target?: TTarget
  order: number
  commandLookup?: ReadonlyMap<string, CommandState<TTarget, TEvent>>
  sourceBindings: readonly Binding<TTarget, TEvent>[]
  bindingStates: readonly BindingState<TTarget, TEvent>[]
  hasTokenBindings: boolean
}

export interface LayerDiagnostics<TTarget extends object, TEvent extends KeymapEvent> {
  analyzeLayer(options: AnalyzeLayerOptions<TTarget, TEvent>): void
}

export class LayerService<TTarget extends object, TEvent extends KeymapEvent> {
  #state: State<TTarget, TEvent>
  #notify: NotificationService<TTarget, TEvent>
  #conditions: ConditionService<TTarget, TEvent>
  #activation: ActivationService<TTarget, TEvent>
  #options: LayersOptions<TTarget, TEvent>

  constructor(
    state: State<TTarget, TEvent>,
    notify: NotificationService<TTarget, TEvent>,
    conditions: ConditionService<TTarget, TEvent>,
    activation: ActivationService<TTarget, TEvent>,
    options: LayersOptions<TTarget, TEvent>,
  ) {
    this.#state = state
    this.#notify = notify
    this.#conditions = conditions
    this.#activation = activation
    this.#options = options
  }

  public registerLayer(layer: Layer<TTarget, TEvent>): () => void {
    return this.#notify.runWithStateChangeBatch(() => {
      const target = layer.target
      if (target && this.#options.host.isTargetDestroyed(target)) {
        this.#notify.emitError(
          "destroyed-layer-target",
          { target },
          "Cannot register a keymap layer for a destroyed keymap target",
        )
        return NOOP
      }

      let sourceBindings: Binding<TTarget, TEvent>[]
      let requires: readonly [name: string, value: unknown][]
      let matchers: readonly RuntimeMatcher[]
      let compileFields: Readonly<Record<string, unknown>> | undefined
      let attrs: Readonly<Attributes> | undefined
      let commands: readonly CommandState<TTarget, TEvent>[]
      let commandLookup: ReadonlyMap<string, CommandState<TTarget, TEvent>> | undefined
      let targetMode: TargetMode | undefined

      try {
        targetMode = this.#normalizeTargetMode(layer)
        sourceBindings = this.#applyLayerBindingsTransformers(snapshotBindings(layer.bindings ?? []), layer)
        const sourceCommands = this.#applyCommandTransformers(layer.commands ?? [], layer)
        commands = sourceCommands.length === 0 ? [] : this.#options.commands.normalizeCommands(sourceCommands)
        commandLookup = createCommandLookup(commands)
        ;({ requires, matchers, compileFields, attrs } = this.#compileLayerRuntimeState(layer))
      } catch (error) {
        this.#notify.emitError("register-layer-failed", error, getErrorMessage(error, "Failed to register keymap layer"))
        return NOOP
      }

      const order = this.#state.core.order++
      const bindingStates = this.#options.compiler.compileBindings(
        sourceBindings,
        this.#state.environment.tokens,
        target,
        order,
        compileFields,
      )

      if (bindingStates.bindings.length === 0 && !bindingStates.hasTokenBindings && commands.length === 0) {
        return NOOP
      }

      this.#options.diagnostics?.analyzeLayer({
        target,
        order,
        commandLookup,
        sourceBindings,
        bindingStates: bindingStates.bindings,
        hasTokenBindings: bindingStates.hasTokenBindings,
      })

      const registeredLayer: RegisteredLayer<TTarget, TEvent> = {
        order,
        target,
        targetMode,
        priority: layer.priority ?? 0,
        requires,
        matchers,
        compileFields,
        attrs,
        commands,
        commandLookup,
        sourceBindings,
        bindingStates: bindingStates.bindings,
        hasTokenBindings: bindingStates.hasTokenBindings,
      }

      this.#state.layers.layers.add(registeredLayer)
      if (registeredLayer.commands.length > 0) {
        this.#state.layers.layersWithCommands += 1
        addCommandNameRefs(this.#state.commands.registeredNames, registeredLayer.commands)
      }

      if (registeredLayer.requires.length > 0 || registeredLayer.matchers.length > 0) {
        this.#state.layers.layersWithConditions += 1
      }
      this.#attachReactiveMatchers(registeredLayer)
      for (const command of registeredLayer.commands) {
        this.#attachReactiveMatchers(command)
      }
      for (const binding of registeredLayer.bindingStates) {
        this.#attachReactiveMatchers(binding)
      }
      this.#indexLayer(registeredLayer)
      this.#activation.refreshActiveLayers()

      if (target) {
        const onTargetDestroy = () => {
          this.#unregisterLayer(registeredLayer)
        }

        registeredLayer.offTargetDestroy = this.#options.host.onTargetDestroy(target, onTargetDestroy)
      }

      if (registeredLayer.commands.length > 0) {
        this.#activation.ensureValidPendingSequence()
      }

      this.#notify.queueStateChange()

      return () => {
        this.#unregisterLayer(registeredLayer)
      }
    })
  }

  public applyTokenState(nextTokens: Map<string, ResolvedKeyToken>): void {
    this.#notify.runWithStateChangeBatch(() => {
      const nextCompilations = new Map<RegisteredLayer<TTarget, TEvent>, BindingCompilationResult<TTarget, TEvent>>()

      for (const layer of this.#state.layers.layers) {
        if (!layer.hasTokenBindings) {
          continue
        }

        nextCompilations.set(layer, this.#compileLayerBindings(layer, nextTokens))
      }

      this.#state.environment.tokens = nextTokens

      let shouldClearPending = false
      for (const [layer, compilation] of nextCompilations) {
        if (this.#applyBindingStates(layer, compilation)) {
          shouldClearPending = true
        }
      }

      if (shouldClearPending) {
        this.#activation.setPendingSequence(null)
      }

      if (nextCompilations.size > 0) {
        this.#notify.queueStateChange()
      }
    })
  }

  public recompileBindings(): void {
    this.#notify.runWithStateChangeBatch(() => {
      let recompiledLayers = 0
      let shouldClearPending = false

      for (const layer of this.#state.layers.layers) {
        if (layer.sourceBindings.length === 0) {
          continue
        }

        const compilation = this.#compileLayerBindings(layer, this.#state.environment.tokens)

        if (this.#applyBindingStates(layer, compilation)) {
          shouldClearPending = true
        }

        recompiledLayers += 1
      }

      if (shouldClearPending) {
        this.#activation.setPendingSequence(null)
      }

      if (recompiledLayers > 0) {
        this.#notify.queueStateChange()
      }
    })
  }

  public cleanup(): void {
    for (const layer of this.#state.layers.layers) {
      this.#detachReactiveMatchers(layer)
      for (const command of layer.commands) {
        this.#detachReactiveMatchers(command)
      }
      for (const binding of layer.bindingStates) {
        this.#detachReactiveMatchers(binding)
      }

      layer.offTargetDestroy?.()
      layer.offTargetDestroy = undefined
    }
  }

  #normalizeTargetMode(layer: Layer<TTarget, TEvent>): TargetMode | undefined {
    if (layer.targetMode) {
      if (!layer.target) {
        throw new Error(`Keymap targetMode "${layer.targetMode}" requires a target`)
      }

      return layer.targetMode
    }

    return layer.target ? "focus-within" : undefined
  }

  #applyLayerBindingsTransformers(
    bindings: Binding<TTarget, TEvent>[],
    layer: Layer<TTarget, TEvent>,
  ): Binding<TTarget, TEvent>[] {
    const transformers = this.#state.environment.layerBindingsTransformers.values()
    if (transformers.length === 0) {
      return bindings
    }

    let current = bindings

    for (const transformer of transformers) {
      const next = transformer(current, {
        layer,
        validateBindings: (bindings) => validateBindings(bindings),
      })
      if (!next) {
        continue
      }

      current = snapshotBindings(next)
    }

    return current
  }

  #applyCommandTransformers(
    commands: readonly Command<TTarget, TEvent>[],
    layer: Layer<TTarget, TEvent>,
  ): readonly Command<TTarget, TEvent>[] {
    const transformers = this.#state.environment.commandTransformers.values()
    if (commands.length === 0 || transformers.length === 0) {
      return commands
    }

    const transformedCommands: Command<TTarget, TEvent>[] = []

    for (const command of commands) {
      const transformedCommand = { ...command }
      const extraCommands: Command<TTarget, TEvent>[] = []
      let keepOriginal = true

      for (const transformer of transformers) {
        try {
          transformer(transformedCommand, {
            layer,
            add(nextCommand) {
              extraCommands.push({ ...nextCommand })
            },
            skipOriginal() {
              keepOriginal = false
            },
          })
        } catch (error) {
          this.#notify.emitError("command-transformer-error", error, "[Keymap] Error in command transformer:")
        }
      }

      if (keepOriginal) {
        transformedCommands.push(transformedCommand)
      }
      transformedCommands.push(...extraCommands)
    }

    return transformedCommands
  }

  #compileLayerRuntimeState(layer: Layer<TTarget, TEvent>): CompileLayerRuntimeStateResult {
    const mergedRequires: EventData = {}
    const matchers: RuntimeMatcher[] = []
    const compileFields: Record<string, unknown> = Object.create(null)
    const attrs: Attributes = {}

    for (const [fieldName, value] of Object.entries(layer)) {
      if (RESERVED_LAYER_FIELDS.has(fieldName)) {
        continue
      }

      if (value === undefined) {
        continue
      }

      compileFields[fieldName] = snapshotDataValue(value)

      const compiler = this.#state.environment.layerFields.get(fieldName)
      if (!compiler) {
        this.#options.warnUnknownField("layer", fieldName)
        continue
      }

      compiler(
        value,
        createFieldCompilerContext({
          fieldName,
          conditions: this.#conditions,
          requirements: mergedRequires,
          matchers,
          attrs,
        }),
      )
    }

    return {
      requires: Object.entries(mergedRequires),
      matchers,
      compileFields: Object.keys(compileFields).length > 0 ? Object.freeze(compileFields) : undefined,
      attrs:
        Object.keys(attrs).length > 0
          ? (snapshotDataValue(attrs, { freeze: true }) as Readonly<Attributes>)
          : undefined,
    }
  }

  #compileLayerBindings(
    layer: RegisteredLayer<TTarget, TEvent>,
    tokens: ReadonlyMap<string, ResolvedKeyToken>,
  ): BindingCompilationResult<TTarget, TEvent> {
    return this.#options.compiler.compileBindings(
      layer.sourceBindings,
      tokens,
      layer.target,
      layer.order,
      layer.compileFields,
    )
  }

  #applyBindingStates(
    layer: RegisteredLayer<TTarget, TEvent>,
    compilation: BindingCompilationResult<TTarget, TEvent>,
  ): boolean {
    this.#options.diagnostics?.analyzeLayer({
      target: layer.target,
      order: layer.order,
      commandLookup: layer.commandLookup,
      sourceBindings: layer.sourceBindings,
      bindingStates: compilation.bindings,
        hasTokenBindings: compilation.hasTokenBindings,
      })

    for (const binding of layer.bindingStates) {
      this.#detachReactiveMatchers(binding)
    }

    layer.bindingStates = compilation.bindings
    layer.hasTokenBindings = compilation.hasTokenBindings

    for (const binding of layer.bindingStates) {
      this.#attachReactiveMatchers(binding)
    }

    return this.#state.projection.pendingSequence?.captures.some((capture) => capture.layer === layer) ?? false
  }

  #indexLayer(layer: RegisteredLayer<TTarget, TEvent>): void {
    this.#state.layers.sortedLayers = sortLayers([...this.#state.layers.sortedLayers, layer])
  }

  #removeLayerFromIndex(layer: RegisteredLayer<TTarget, TEvent>): void {
    this.#state.layers.sortedLayers = this.#state.layers.sortedLayers.filter((candidate) => candidate !== layer)
  }

  #unregisterLayer(layer: RegisteredLayer<TTarget, TEvent>): void {
    this.#notify.runWithStateChangeBatch(() => {
      if (!this.#state.layers.layers.delete(layer)) {
        return
      }

      if (layer.requires.length > 0 || layer.matchers.length > 0) {
        this.#state.layers.layersWithConditions -= 1
      }

      if (layer.commands.length > 0) {
        this.#state.layers.layersWithCommands -= 1
        removeCommandNameRefs(this.#state.commands.registeredNames, layer.commands)
      }

      this.#detachReactiveMatchers(layer)
      for (const command of layer.commands) {
        this.#detachReactiveMatchers(command)
      }
      for (const binding of layer.bindingStates) {
        this.#detachReactiveMatchers(binding)
      }

      this.#removeLayerFromIndex(layer)
      this.#activation.refreshActiveLayers()
      layer.offTargetDestroy?.()
      layer.offTargetDestroy = undefined

      if (this.#state.projection.pendingSequence?.captures.some((capture) => capture.layer === layer)) {
        this.#activation.setPendingSequence(null)
      } else if (layer.commands.length > 0 && !this.#options.host.isDestroyed) {
        this.#activation.ensureValidPendingSequence()
      }

      this.#notify.queueStateChange()
    })
  }

  #attachReactiveMatchers(target: RuntimeMatchable): void {
    for (const matcher of target.matchers) {
      if (!matcher.subscribe) {
        continue
      }

      try {
        matcher.dispose = matcher.subscribe(() => {
          if (!this.#activation.hasPendingSequenceState()) {
            this.#notify.queueStateChange()
            return
          }

          this.#notify.runWithStateChangeBatch(() => {
            this.#activation.revalidatePendingSequenceIfNeeded()
            this.#notify.queueStateChange()
          })
        })
      } catch (error) {
        this.#notify.emitError(
          "reactive-matcher-subscribe-error",
          error,
          getErrorMessage(error, `Failed to subscribe to reactive matcher from ${matcher.source}`),
        )
      }
    }
  }

  #detachReactiveMatchers(target: RuntimeMatchable): void {
    for (const matcher of target.matchers) {
      if (!matcher.dispose) {
        continue
      }

      try {
        matcher.dispose()
      } catch (error) {
        this.#notify.emitError(
          "reactive-matcher-dispose-error",
          error,
          getErrorMessage(error, `Failed to dispose reactive matcher from ${matcher.source}`),
        )
      }

      matcher.dispose = undefined
    }
  }
}
