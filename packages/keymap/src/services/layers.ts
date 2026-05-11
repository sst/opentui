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
import { buildSequenceTree } from "./sequence-index.js"
import { getErrorMessage, snapshotDataValue } from "./values.js"

const NOOP = (): void => {}

function compareLayers<TTarget extends object, TEvent extends KeymapEvent>(
  left: RegisteredLayer<TTarget, TEvent>,
  right: RegisteredLayer<TTarget, TEvent>,
): number {
  const priorityDiff = right.priority - left.priority
  return priorityDiff || right.order - left.order
}

function layerBlocksActiveKeyCache<TTarget extends object, TEvent extends KeymapEvent>(
  layer: RegisteredLayer<TTarget, TEvent>,
): boolean {
  if (layer.matchers.length > 0) return true
  for (const command of layer.commands) if (command.matchers.length > 0) return true
  for (const binding of layer.bindings) if (binding.matchers.length > 0) return true
  return false
}

function layerBlocksActiveCommandViewCache<TTarget extends object, TEvent extends KeymapEvent>(
  layer: RegisteredLayer<TTarget, TEvent>,
): boolean {
  if (layer.commands.length === 0) return false
  if (layer.matchers.length > 0) return true
  for (const command of layer.commands) if (command.matchers.length > 0) return true
  return false
}

interface CompileLayerRuntimeStateResult {
  requires: readonly [name: string, value: unknown][]
  matchers: readonly RuntimeMatcher[]
  fields?: Readonly<Record<string, unknown>>
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
  commands: readonly CommandState<TTarget, TEvent>[]
  sourceBindings: readonly Binding<TTarget, TEvent>[]
  bindings: readonly BindingState<TTarget, TEvent>[]
  hasTokenBindings: boolean
}

export interface LayerDiagnostics<TTarget extends object, TEvent extends KeymapEvent> {
  analyzeLayer(options: AnalyzeLayerOptions<TTarget, TEvent>): void
}

export interface LayerService<TTarget extends object, TEvent extends KeymapEvent> {
  registerLayer(layer: Layer<TTarget, TEvent>): () => void
  applyTokenState(nextTokens: Map<string, ResolvedKeyToken>): void
  recompileBindings(): void
  cleanup(): void
}

export function createLayerService<TTarget extends object, TEvent extends KeymapEvent>(
  state: State<TTarget, TEvent>,
  notify: NotificationService<TTarget, TEvent>,
  conditions: ConditionService<TTarget, TEvent>,
  activation: ActivationService<TTarget, TEvent>,
  options: LayersOptions<TTarget, TEvent>,
): LayerService<TTarget, TEvent> {
  const registerLayer = (layer: Layer<TTarget, TEvent>): (() => void) => {
    return notify.runWithStateChangeBatch(() => {
      const target = layer.target
      if (target && options.host.isTargetDestroyed(target)) {
        notify.emitError(
          "destroyed-layer-target",
          { target },
          "Cannot register a keymap layer for a destroyed keymap target",
        )
        return NOOP
      }

      let sourceBindings: Binding<TTarget, TEvent>[]
      let requires: readonly [name: string, value: unknown][]
      let matchers: readonly RuntimeMatcher[]
      let fields: Readonly<Record<string, unknown>> | undefined
      let attrs: Readonly<Attributes> | undefined
      let commands: readonly CommandState<TTarget, TEvent>[]
      let targetMode: TargetMode | undefined

      try {
        targetMode = normalizeTargetMode(layer)
        sourceBindings = applyLayerBindingsTransformers(snapshotBindings(layer.bindings ?? []), layer)
        const sourceCommands = applyCommandTransformers(layer.commands ?? [], layer)
        commands = sourceCommands.length === 0 ? [] : options.commands.normalizeCommands(sourceCommands)
        ;({ requires, matchers, fields, attrs } = compileLayerRuntimeState(layer))
      } catch (error) {
        notify.emitError("register-layer-failed", error, getErrorMessage(error, "Failed to register keymap layer"))
        return NOOP
      }

      const order = state.order++
      const bindingStates = options.compiler.compileBindings(sourceBindings, state.tokens, target, order, fields)

      if (bindingStates.bindings.length === 0 && !bindingStates.hasTokenBindings && commands.length === 0) {
        return NOOP
      }

      options.diagnostics?.analyzeLayer({
        target,
        order,
        commands,
        sourceBindings,
        bindings: bindingStates.bindings,
        hasTokenBindings: bindingStates.hasTokenBindings,
      })

      const registeredLayer: RegisteredLayer<TTarget, TEvent> = {
        order,
        target,
        targetMode,
        priority: layer.priority ?? 0,
        requires,
        matchers,
        fields,
        attrs,
        commands,
        sourceBindings,
        bindings: bindingStates.bindings,
        root: buildSequenceTree(bindingStates.bindings, state.patterns),
        hasTokenBindings: bindingStates.hasTokenBindings,
        activeKeyCacheBlocked: false,
        activeCommandViewCacheBlocked: false,
      }

      updateCacheBlockers(registeredLayer)

      state.layers.add(registeredLayer)
      state.sortedLayers = [...state.sortedLayers, registeredLayer].sort(compareLayers)
      attachReactiveMatchers(registeredLayer)
      for (const command of registeredLayer.commands) {
        attachReactiveMatchers(command)
      }
      for (const binding of registeredLayer.bindings) {
        attachReactiveMatchers(binding)
      }

      if (target) {
        const onTargetDestroy = () => {
          unregisterLayer(registeredLayer)
        }

        registeredLayer.offTargetDestroy = options.host.onTargetDestroy(target, onTargetDestroy)
      }

      if (registeredLayer.commands.length > 0) {
        activation.ensureValidPendingSequence()
      }

      notify.queueStateChange()

      return () => {
        unregisterLayer(registeredLayer)
      }
    })
  }

  const applyTokenState = (nextTokens: Map<string, ResolvedKeyToken>): void => {
    notify.runWithStateChangeBatch(() => {
      const nextCompilations = new Map<RegisteredLayer<TTarget, TEvent>, BindingCompilationResult<TTarget, TEvent>>()

      for (const layer of state.layers) {
        if (!layer.hasTokenBindings) {
          continue
        }

        nextCompilations.set(layer, compileLayerBindings(layer, nextTokens))
      }

      state.tokens = nextTokens

      let shouldClearPending = false
      for (const [layer, compilation] of nextCompilations) {
        if (applyBindingStates(layer, compilation)) {
          shouldClearPending = true
        }
      }

      if (shouldClearPending) {
        activation.setPendingSequence(null)
      }

      if (nextCompilations.size > 0) {
        notify.queueStateChange()
      }
    })
  }

  const recompileBindings = (): void => {
    notify.runWithStateChangeBatch(() => {
      let recompiledLayers = 0
      let shouldClearPending = false

      for (const layer of state.layers) {
        if (layer.sourceBindings.length === 0) {
          continue
        }

        const compilation = compileLayerBindings(layer, state.tokens)

        if (applyBindingStates(layer, compilation)) {
          shouldClearPending = true
        }

        recompiledLayers += 1
      }

      if (shouldClearPending) {
        activation.setPendingSequence(null)
      }

      if (recompiledLayers > 0) {
        notify.queueStateChange()
      }
    })
  }

  const cleanup = (): void => {
    for (const layer of state.layers) {
      detachReactiveMatchers(layer)
      for (const command of layer.commands) {
        detachReactiveMatchers(command)
      }
      for (const binding of layer.bindings) {
        detachReactiveMatchers(binding)
      }

      layer.offTargetDestroy?.()
      layer.offTargetDestroy = undefined
    }
  }

  const normalizeTargetMode = (layer: Layer<TTarget, TEvent>): TargetMode | undefined => {
    if (layer.targetMode) {
      if (!layer.target) {
        throw new Error(`Keymap targetMode "${layer.targetMode}" requires a target`)
      }

      return layer.targetMode
    }

    return layer.target ? "focus-within" : undefined
  }

  const applyLayerBindingsTransformers = (
    bindings: Binding<TTarget, TEvent>[],
    layer: Layer<TTarget, TEvent>,
  ): Binding<TTarget, TEvent>[] => {
    const transformers = state.layerBindingsTransformers.values()
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

  const applyCommandTransformers = (
    commands: readonly Command<TTarget, TEvent>[],
    layer: Layer<TTarget, TEvent>,
  ): readonly Command<TTarget, TEvent>[] => {
    const transformers = state.commandTransformers.values()
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
          notify.emitError("command-transformer-error", error, "[Keymap] Error in command transformer:")
        }
      }

      if (keepOriginal) {
        transformedCommands.push(transformedCommand)
      }
      transformedCommands.push(...extraCommands)
    }

    return transformedCommands
  }

  const compileLayerRuntimeState = (layer: Layer<TTarget, TEvent>): CompileLayerRuntimeStateResult => {
    const mergedRequires: EventData = {}
    const matchers: RuntimeMatcher[] = []
    const fields: Record<string, unknown> = Object.create(null)
    const attrs: Attributes = {}

    for (const [fieldName, value] of Object.entries(layer)) {
      if (RESERVED_LAYER_FIELDS.has(fieldName)) {
        continue
      }

      if (value === undefined) {
        continue
      }

      fields[fieldName] = snapshotDataValue(value)

      const compiler = state.layerFields.get(fieldName)
      if (!compiler) {
        options.warnUnknownField("layer", fieldName)
        continue
      }

      compiler(
        value,
        createFieldCompilerContext({
          fieldName,
          conditions: conditions,
          requirements: mergedRequires,
          matchers,
          attrs,
        }),
      )
    }

    return {
      requires: Object.entries(mergedRequires),
      matchers,
      fields: Object.keys(fields).length > 0 ? Object.freeze(fields) : undefined,
      attrs:
        Object.keys(attrs).length > 0
          ? (snapshotDataValue(attrs, { freeze: true }) as Readonly<Attributes>)
          : undefined,
    }
  }

  const compileLayerBindings = (
    layer: RegisteredLayer<TTarget, TEvent>,
    tokens: ReadonlyMap<string, ResolvedKeyToken>,
  ): BindingCompilationResult<TTarget, TEvent> => {
    return options.compiler.compileBindings(layer.sourceBindings, tokens, layer.target, layer.order, layer.fields)
  }

  const applyBindingStates = (
    layer: RegisteredLayer<TTarget, TEvent>,
    compilation: BindingCompilationResult<TTarget, TEvent>,
  ): boolean => {
    options.diagnostics?.analyzeLayer({
      target: layer.target,
      order: layer.order,
      commands: layer.commands,
      sourceBindings: layer.sourceBindings,
      bindings: compilation.bindings,
      hasTokenBindings: compilation.hasTokenBindings,
    })

    untrackCacheBlockers(layer)
    for (const binding of layer.bindings) {
      detachReactiveMatchers(binding)
    }

    layer.bindings = compilation.bindings
    layer.root = buildSequenceTree(compilation.bindings, state.patterns)
    layer.hasTokenBindings = compilation.hasTokenBindings
    updateCacheBlockers(layer)

    for (const binding of layer.bindings) {
      attachReactiveMatchers(binding)
    }

    return state.pending?.captures.some((capture) => capture.layer === layer) ?? false
  }

  const unregisterLayer = (layer: RegisteredLayer<TTarget, TEvent>): void => {
    notify.runWithStateChangeBatch(() => {
      if (!state.layers.delete(layer)) {
        return
      }

      state.sortedLayers = state.sortedLayers.filter((candidate) => candidate !== layer)
      untrackCacheBlockers(layer)

      detachReactiveMatchers(layer)
      for (const command of layer.commands) {
        detachReactiveMatchers(command)
      }
      for (const binding of layer.bindings) {
        detachReactiveMatchers(binding)
      }

      layer.offTargetDestroy?.()
      layer.offTargetDestroy = undefined

      if (state.pending?.captures.some((capture) => capture.layer === layer)) {
        activation.setPendingSequence(null)
      } else if (layer.commands.length > 0 && !options.host.isDestroyed) {
        activation.ensureValidPendingSequence()
      }

      notify.queueStateChange()
    })
  }

  const attachReactiveMatchers = (target: RuntimeMatchable): void => {
    for (const matcher of target.matchers) {
      if (!matcher.subscribe) {
        continue
      }

      try {
        matcher.dispose = matcher.subscribe(() => {
          if (!activation.hasPendingSequenceState()) {
            notify.queueStateChange()
            return
          }

          notify.runWithStateChangeBatch(() => {
            activation.revalidatePendingSequenceIfNeeded()
            notify.queueStateChange()
          })
        })
      } catch (error) {
        notify.emitError(
          "reactive-matcher-subscribe-error",
          error,
          getErrorMessage(error, `Failed to subscribe to reactive matcher from ${matcher.source}`),
        )
      }
    }
  }

  const updateCacheBlockers = (layer: RegisteredLayer<TTarget, TEvent>): void => {
    const activeKeyBlocked = layerBlocksActiveKeyCache(layer)
    const activeCommandViewBlocked = layerBlocksActiveCommandViewCache(layer)

    layer.activeKeyCacheBlocked = activeKeyBlocked
    layer.activeCommandViewCacheBlocked = activeCommandViewBlocked
    if (activeKeyBlocked) state.activeKeyCacheBlockers += 1
    if (activeCommandViewBlocked) state.activeCommandViewCacheBlockers += 1
  }

  const untrackCacheBlockers = (layer: RegisteredLayer<TTarget, TEvent>): void => {
    if (layer.activeKeyCacheBlocked) {
      state.activeKeyCacheBlockers -= 1
      layer.activeKeyCacheBlocked = false
    }

    if (layer.activeCommandViewCacheBlocked) {
      state.activeCommandViewCacheBlockers -= 1
      layer.activeCommandViewCacheBlocked = false
    }
  }

  const detachReactiveMatchers = (target: RuntimeMatchable): void => {
    for (const matcher of target.matchers) {
      if (!matcher.dispose) {
        continue
      }

      try {
        matcher.dispose()
      } catch (error) {
        notify.emitError(
          "reactive-matcher-dispose-error",
          error,
          getErrorMessage(error, `Failed to dispose reactive matcher from ${matcher.source}`),
        )
      }

      matcher.dispose = undefined
    }
  }

  return { registerLayer, applyTokenState, recompileBindings, cleanup }
}
