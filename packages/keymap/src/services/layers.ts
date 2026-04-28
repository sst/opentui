import type { CompilerService } from "./compiler.js"
import type { CommandCatalogService } from "./command-catalog.js"
import type { ConditionService } from "./conditions.js"
import type { ActivationService } from "./activation.js"
import type {
  BindingInput,
  CompiledBinding,
  CompiledBindingsResult,
  EventData,
  KeymapEvent,
  KeymapHost,
  KeySequencePart,
  Layer,
  LayerAnalyzer,
  LayerAnalysisContext,
  LayerBindingAnalysis,
  ResolvedKeyToken,
  RegisteredCommand,
  RegisteredLayer,
  RuntimeMatchable,
  RuntimeMatcher,
  SequenceNode,
  TargetMode,
} from "../types.js"
import { RESERVED_LAYER_FIELDS } from "../schema.js"
import type { State } from "./state.js"
import type { NotificationService } from "./notify.js"
import { snapshotBindingInputs, snapshotParsedBindingInput } from "./primitives/binding-inputs.js"
import { mergeRequirement } from "./primitives/field-invariants.js"
import { cloneKeySequence } from "./keys.js"
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
  commands: readonly RegisteredCommand<TTarget, TEvent>[],
): ReadonlyMap<string, RegisteredCommand<TTarget, TEvent>> | undefined {
  if (commands.length === 0) {
    return undefined
  }

  const lookup = new Map<string, RegisteredCommand<TTarget, TEvent>>()
  for (const command of commands) {
    lookup.set(command.name, command)
  }

  return lookup
}

function addRegisteredCommandNames<TTarget extends object, TEvent extends KeymapEvent>(
  target: Map<string, number>,
  commands: readonly RegisteredCommand<TTarget, TEvent>[],
): void {
  for (const command of commands) {
    target.set(command.name, (target.get(command.name) ?? 0) + 1)
  }
}

function removeRegisteredCommandNames<TTarget extends object, TEvent extends KeymapEvent>(
  target: Map<string, number>,
  commands: readonly RegisteredCommand<TTarget, TEvent>[],
): void {
  for (const command of commands) {
    const count = target.get(command.name)
    if (!count || count <= 1) {
      target.delete(command.name)
      continue
    }

    target.set(command.name, count - 1)
  }
}

interface CompileLayerRuntimeStateResult {
  requires: readonly [name: string, value: unknown][]
  matchers: readonly RuntimeMatcher[]
  conditionKeys: readonly string[]
  hasUnkeyedMatchers: boolean
  compileFields?: Readonly<Record<string, unknown>>
}

interface LayersOptions<TTarget extends object, TEvent extends KeymapEvent> {
  compiler: CompilerService<TTarget, TEvent>
  commands: CommandCatalogService<TTarget, TEvent>
  host: KeymapHost<TTarget, TEvent>
  warnUnknownField: (kind: "binding" | "layer", fieldName: string) => void
}

interface AnalyzeLayerOptions<TTarget extends object, TEvent extends KeymapEvent> {
  target?: TTarget
  order: number
  commandLookup?: ReadonlyMap<string, RegisteredCommand<TTarget, TEvent>>
  bindingInputs: readonly BindingInput<TTarget, TEvent>[]
  compiledBindings: readonly CompiledBinding<TTarget, TEvent>[]
  root: RegisteredLayer<TTarget, TEvent>["root"]
  hasTokenBindings: boolean
}

function getSequenceNode<TTarget extends object, TEvent extends KeymapEvent>(
  root: SequenceNode<TTarget, TEvent>,
  sequence: readonly KeySequencePart[],
): SequenceNode<TTarget, TEvent> | undefined {
  let node: SequenceNode<TTarget, TEvent> | undefined = root

  for (const part of sequence) {
    node = node.children.get(part.match)
    if (!node) {
      return undefined
    }
  }

  return node
}

function buildLayerBindingAnalyses<TTarget extends object, TEvent extends KeymapEvent>(
  root: SequenceNode<TTarget, TEvent>,
  compiledBindings: readonly CompiledBinding<TTarget, TEvent>[],
): LayerBindingAnalysis<TTarget, TEvent>[] {
  return compiledBindings.map((binding) => {
    const node = binding.event === "press" ? getSequenceNode(root, binding.sequence) : undefined

    return {
      sequence: cloneKeySequence(binding.sequence),
      command: binding.command,
      attrs: binding.attrs,
      event: binding.event,
      preventDefault: binding.preventDefault,
      fallthrough: binding.fallthrough,
      sourceBinding: snapshotParsedBindingInput(binding.sourceBinding),
      sourceTarget: binding.sourceTarget,
      sourceLayerOrder: binding.sourceLayerOrder,
      sourceBindingIndex: binding.sourceBindingIndex,
      hasCommandAtSequence: node ? node.bindings.some((candidate) => candidate.command !== undefined) : false,
      hasContinuations: node ? node.children.size > 0 : false,
    }
  })
}

export class LayerService<TTarget extends object, TEvent extends KeymapEvent> {
  constructor(
    private readonly state: State<TTarget, TEvent>,
    private readonly notify: NotificationService<TTarget, TEvent>,
    private readonly conditions: ConditionService<TTarget, TEvent>,
    private readonly activation: ActivationService<TTarget, TEvent>,
    private readonly options: LayersOptions<TTarget, TEvent>,
  ) {}

  public registerLayer(layer: Layer<TTarget, TEvent>): () => void {
    return this.notify.runWithStateChangeBatch(() => {
      const target = layer.target
      if (target && this.options.host.isTargetDestroyed(target)) {
        this.notify.emitError(
          "destroyed-layer-target",
          { target },
          "Cannot register a keymap layer for a destroyed keymap target",
        )
        return NOOP
      }

      let bindingInputs: BindingInput<TTarget, TEvent>[]
      let requires: readonly [name: string, value: unknown][]
      let matchers: readonly RuntimeMatcher[]
      let conditionKeys: readonly string[]
      let hasUnkeyedMatchers: boolean
      let compileFields: Readonly<Record<string, unknown>> | undefined
      let commands: readonly RegisteredCommand<TTarget, TEvent>[]
      let commandLookup: ReadonlyMap<string, RegisteredCommand<TTarget, TEvent>> | undefined
      let targetMode: TargetMode | undefined

      try {
        targetMode = this.normalizeTargetMode(layer)
        bindingInputs = snapshotBindingInputs(layer.bindings ?? [])
        commands =
          !layer.commands || layer.commands.length === 0 ? [] : this.options.commands.normalizeCommands(layer.commands)
        commandLookup = createCommandLookup(commands)
        ;({ requires, matchers, conditionKeys, hasUnkeyedMatchers, compileFields } =
          this.compileLayerRuntimeState(layer))
      } catch (error) {
        this.notify.emitError("register-layer-failed", error, getErrorMessage(error, "Failed to register keymap layer"))
        return NOOP
      }

      const order = this.state.core.order++
      const compiledBindings = this.options.compiler.compileBindings(
        bindingInputs,
        this.state.environment.tokens,
        target,
        order,
        compileFields,
      )

      if (compiledBindings.bindings.length === 0 && !compiledBindings.hasTokenBindings && commands.length === 0) {
        return NOOP
      }

      this.runLayerAnalyzers({
        target,
        order,
        commandLookup,
        bindingInputs,
        compiledBindings: compiledBindings.bindings,
        root: compiledBindings.root,
        hasTokenBindings: compiledBindings.hasTokenBindings,
      })

      const registeredLayer: RegisteredLayer<TTarget, TEvent> = {
        order,
        target,
        targetMode,
        priority: layer.priority ?? 0,
        requires,
        matchers,
        conditionKeys,
        hasUnkeyedMatchers,
        matchCacheDirty: true,
        compileFields,
        commands,
        commandLookup,
        bindingInputs,
        compiledBindings: compiledBindings.bindings,
        hasUnkeyedCommands: commands.some((command) => command.hasUnkeyedMatchers),
        hasUnkeyedBindings: compiledBindings.bindings.some((binding) => binding.hasUnkeyedMatchers),
        hasTokenBindings: compiledBindings.hasTokenBindings,
        root: compiledBindings.root,
      }

      this.state.layers.layers.add(registeredLayer)
      if (registeredLayer.commands.length > 0) {
        this.state.layers.layersWithCommands += 1
        this.state.commands.commandMetadataVersion += 1
        addRegisteredCommandNames(this.state.commands.registeredNames, registeredLayer.commands)
      }

      if (registeredLayer.requires.length > 0 || registeredLayer.matchers.length > 0) {
        this.state.layers.layersWithConditions += 1
      }
      this.connectRuntimeMatchable(registeredLayer)
      for (const command of registeredLayer.commands) {
        this.connectRuntimeMatchable(command)
      }
      for (const binding of registeredLayer.compiledBindings) {
        this.connectRuntimeMatchable(binding)
      }
      this.indexLayer(registeredLayer)
      this.activation.invalidateActiveLayers()
      this.activation.refreshActiveLayers()

      if (target) {
        const onTargetDestroy = () => {
          this.unregisterLayer(registeredLayer)
        }

        registeredLayer.offTargetDestroy = this.options.host.onTargetDestroy(target, onTargetDestroy)
      }

      if (registeredLayer.commands.length > 0) {
        this.activation.ensureValidPendingSequence()
      }

      this.notify.queueStateChange()

      return () => {
        this.unregisterLayer(registeredLayer)
      }
    })
  }

  public applyTokenState(nextTokens: Map<string, ResolvedKeyToken>): void {
    this.notify.runWithStateChangeBatch(() => {
      const nextCompilations = new Map<RegisteredLayer<TTarget, TEvent>, CompiledBindingsResult<TTarget, TEvent>>()

      for (const layer of this.state.layers.layers) {
        if (!layer.hasTokenBindings) {
          continue
        }

        nextCompilations.set(layer, this.compileLayerBindings(layer, nextTokens))
      }

      this.state.environment.tokens = nextTokens

      let shouldClearPending = false
      for (const [layer, compilation] of nextCompilations) {
        if (this.applyCompiledBindings(layer, compilation)) {
          shouldClearPending = true
        }
      }

      if (shouldClearPending) {
        this.activation.setPendingSequence(null)
      }

      if (nextCompilations.size > 0) {
        this.notify.queueStateChange()
      }
    })
  }

  public recompileBindings(): void {
    this.notify.runWithStateChangeBatch(() => {
      let recompiledLayers = 0
      let shouldClearPending = false

      for (const layer of this.state.layers.layers) {
        if (layer.bindingInputs.length === 0) {
          continue
        }

        const compilation = this.compileLayerBindings(layer, this.state.environment.tokens)

        if (this.applyCompiledBindings(layer, compilation)) {
          shouldClearPending = true
        }

        recompiledLayers += 1
      }

      if (shouldClearPending) {
        this.activation.setPendingSequence(null)
      }

      if (recompiledLayers > 0) {
        this.notify.queueStateChange()
      }
    })
  }

  public prependLayerAnalyzer(analyzer: LayerAnalyzer<TTarget, TEvent>): () => void {
    return this.state.layers.layerAnalyzers.prepend(analyzer)
  }

  public appendLayerAnalyzer(analyzer: LayerAnalyzer<TTarget, TEvent>): () => void {
    return this.state.layers.layerAnalyzers.append(analyzer)
  }

  public clearLayerAnalyzers(): void {
    this.state.layers.layerAnalyzers.clear()
  }

  public cleanup(): void {
    for (const layer of this.state.layers.layers) {
      this.disconnectRuntimeMatchable(layer)
      for (const command of layer.commands) {
        this.disconnectRuntimeMatchable(command)
      }
      for (const binding of layer.compiledBindings) {
        this.disconnectRuntimeMatchable(binding)
      }

      layer.offTargetDestroy?.()
      layer.offTargetDestroy = undefined
    }
  }

  private normalizeTargetMode(layer: Layer<TTarget, TEvent>): TargetMode | undefined {
    if (layer.targetMode) {
      if (!layer.target) {
        throw new Error(`Keymap targetMode "${layer.targetMode}" requires a target`)
      }

      return layer.targetMode
    }

    return layer.target ? "focus-within" : undefined
  }

  private runLayerAnalyzers(options: AnalyzeLayerOptions<TTarget, TEvent>): void {
    const analyzers = this.state.layers.layerAnalyzers.values()
    if (analyzers.length === 0) {
      return
    }

    const bindings = buildLayerBindingAnalyses(options.root, options.compiledBindings)

    const ctx: LayerAnalysisContext<TTarget, TEvent> = {
      target: options.target,
      order: options.order,
      bindingInputs: options.bindingInputs,
      bindings,
      hasTokenBindings: options.hasTokenBindings,
      checkCommandResolution: (command) => {
        return this.options.commands.getCommandResolutionStatus(command, options.commandLookup)
      },
      warn: (code, warning, message) => {
        this.notify.emitWarning(code, warning, message)
      },
      warnOnce: (key, code, warning, message) => {
        this.notify.warnOnce(key, code, warning, message)
      },
      error: (code, error, message) => {
        this.notify.emitError(code, error, message)
      },
    }

    for (const analyzer of analyzers) {
      try {
        analyzer(ctx)
      } catch (error) {
        this.notify.emitError("layer-analyzer-error", error, "[Keymap] Error in layer analyzer:")
      }
    }
  }

  private compileLayerRuntimeState(layer: Layer<TTarget, TEvent>): CompileLayerRuntimeStateResult {
    const mergedRequires: EventData = {}
    const matchers: RuntimeMatcher[] = []
    const compileFields: Record<string, unknown> = Object.create(null)
    const conditionKeys = new Set<string>()
    let hasUnkeyedMatchers = false

    for (const [fieldName, value] of Object.entries(layer)) {
      if (RESERVED_LAYER_FIELDS.has(fieldName)) {
        continue
      }

      if (value === undefined) {
        continue
      }

      compileFields[fieldName] = snapshotDataValue(value)

      const compiler = this.state.environment.layerFields.get(fieldName)
      if (!compiler) {
        this.options.warnUnknownField("layer", fieldName)
        continue
      }

      compiler(value, {
        require: (name, requiredValue) => {
          mergeRequirement(mergedRequires, name, requiredValue, `field ${fieldName}`)
          conditionKeys.add(name)
        },
        activeWhen: (matcher) => {
          const runtimeMatcher = this.conditions.buildRuntimeMatcher(matcher, `field ${fieldName}`)
          if (!runtimeMatcher.cacheable) {
            hasUnkeyedMatchers = true
          }
          matchers.push(runtimeMatcher)
        },
      })
    }

    return {
      requires: Object.entries(mergedRequires),
      matchers,
      conditionKeys: [...conditionKeys],
      hasUnkeyedMatchers,
      compileFields: Object.keys(compileFields).length > 0 ? Object.freeze(compileFields) : undefined,
    }
  }

  private compileLayerBindings(
    layer: RegisteredLayer<TTarget, TEvent>,
    tokens: ReadonlyMap<string, ResolvedKeyToken>,
  ): CompiledBindingsResult<TTarget, TEvent> {
    return this.options.compiler.compileBindings(
      layer.bindingInputs,
      tokens,
      layer.target,
      layer.order,
      layer.compileFields,
    )
  }

  private applyCompiledBindings(
    layer: RegisteredLayer<TTarget, TEvent>,
    compilation: CompiledBindingsResult<TTarget, TEvent>,
  ): boolean {
    this.runLayerAnalyzers({
      target: layer.target,
      order: layer.order,
      commandLookup: layer.commandLookup,
      bindingInputs: layer.bindingInputs,
      compiledBindings: compilation.bindings,
      root: compilation.root,
      hasTokenBindings: compilation.hasTokenBindings,
    })

    for (const binding of layer.compiledBindings) {
      this.disconnectRuntimeMatchable(binding)
    }

    layer.root = compilation.root
    layer.compiledBindings = compilation.bindings
    layer.hasUnkeyedBindings = compilation.bindings.some((binding) => binding.hasUnkeyedMatchers)
    layer.hasTokenBindings = compilation.hasTokenBindings

    for (const binding of layer.compiledBindings) {
      this.connectRuntimeMatchable(binding)
    }

    return this.state.projection.pendingSequence?.captures.some((capture) => capture.layer === layer) ?? false
  }

  private indexLayer(layer: RegisteredLayer<TTarget, TEvent>): void {
    this.state.layers.sortedLayers = sortLayers([...this.state.layers.sortedLayers, layer])
    this.state.layers.activeLayersVersion += 1
  }

  private removeLayerFromIndex(layer: RegisteredLayer<TTarget, TEvent>): void {
    this.state.layers.sortedLayers = this.state.layers.sortedLayers.filter((candidate) => candidate !== layer)
    this.state.layers.activeLayersVersion += 1
  }

  private unregisterLayer(layer: RegisteredLayer<TTarget, TEvent>): void {
    this.notify.runWithStateChangeBatch(() => {
      if (!this.state.layers.layers.delete(layer)) {
        return
      }

      if (layer.requires.length > 0 || layer.matchers.length > 0) {
        this.state.layers.layersWithConditions -= 1
      }

      if (layer.commands.length > 0) {
        this.state.layers.layersWithCommands -= 1
        this.state.commands.commandMetadataVersion += 1
        removeRegisteredCommandNames(this.state.commands.registeredNames, layer.commands)
      }

      this.disconnectRuntimeMatchable(layer)
      for (const command of layer.commands) {
        this.disconnectRuntimeMatchable(command)
      }
      for (const binding of layer.compiledBindings) {
        this.disconnectRuntimeMatchable(binding)
      }

      this.removeLayerFromIndex(layer)
      this.activation.invalidateActiveLayers()
      this.activation.refreshActiveLayers()
      layer.offTargetDestroy?.()
      layer.offTargetDestroy = undefined

      if (this.state.projection.pendingSequence?.captures.some((capture) => capture.layer === layer)) {
        this.activation.setPendingSequence(null)
      } else if (layer.commands.length > 0 && !this.options.host.isDestroyed) {
        this.activation.ensureValidPendingSequence()
      }

      this.notify.queueStateChange()
    })
  }

  private connectRuntimeMatchable(target: RuntimeMatchable): void {
    this.attachReactiveMatchers(target)
    this.conditions.indexRuntimeMatchable(target)
  }

  private disconnectRuntimeMatchable(target: RuntimeMatchable): void {
    this.detachReactiveMatchers(target)
    this.conditions.unindexRuntimeMatchable(target)
  }

  private attachReactiveMatchers(target: RuntimeMatchable): void {
    for (const matcher of target.matchers) {
      if (!matcher.subscribe) {
        continue
      }

      try {
        matcher.dispose = matcher.subscribe(() => {
          target.matchCacheDirty = true

          if (!this.activation.hasPendingSequenceState()) {
            this.notify.queueStateChange()
            return
          }

          this.notify.runWithStateChangeBatch(() => {
            this.activation.revalidatePendingSequenceIfNeeded()
            this.notify.queueStateChange()
          })
        })
      } catch (error) {
        this.notify.emitError(
          "reactive-matcher-subscribe-error",
          error,
          getErrorMessage(error, `Failed to subscribe to reactive matcher from ${matcher.source}`),
        )
      }
    }
  }

  private detachReactiveMatchers(target: RuntimeMatchable): void {
    for (const matcher of target.matchers) {
      if (!matcher.dispose) {
        continue
      }

      try {
        matcher.dispose()
      } catch (error) {
        this.notify.emitError(
          "reactive-matcher-dispose-error",
          error,
          getErrorMessage(error, `Failed to dispose reactive matcher from ${matcher.source}`),
        )
      }

      matcher.dispose = undefined
    }
  }
}
