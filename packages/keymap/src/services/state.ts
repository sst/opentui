import type {
  Attributes,
  BindingExpander,
  BindingFieldCompiler,
  LayerBindingsTransformer,
  BindingParser,
  BindingTransformer,
  Command,
  CommandFieldCompiler,
  CommandTransformer,
  CommandResolver,
  EventData,
  KeyDisambiguationResolver,
  EventMatchResolver,
  Hooks,
  KeyAfterInputContext,
  KeyInputContext,
  KeymapEvent,
  LayerFieldCompiler,
  PendingSequenceState,
  RawInputContext,
  ResolvedSequencePattern,
  CommandState,
  RegisteredLayer,
} from "../types.js"
import {
  createOrderedRegistry,
  createPriorityRegistry,
  type OrderedRegistryApi,
  type PriorityRegistryApi,
} from "../lib/registry.js"

export interface LayerCommandEntry<TTarget extends object, TEvent extends KeymapEvent> {
  layer: RegisteredLayer<TTarget, TEvent>
  commandState: CommandState<TTarget, TEvent>
}

export interface ResolvedCommandEntry<TTarget extends object, TEvent extends KeymapEvent> {
  target?: TTarget
  command: Command<TTarget, TEvent>
  attrs?: Readonly<Attributes>
  input?: string
  payload?: unknown
}

export interface ActiveCommandView<TTarget extends object, TEvent extends KeymapEvent> {
  entries: readonly LayerCommandEntry<TTarget, TEvent>[]
  reachable: readonly LayerCommandEntry<TTarget, TEvent>[]
  reachableByName: ReadonlyMap<string, LayerCommandEntry<TTarget, TEvent>>
  chainsByName: ReadonlyMap<string, readonly LayerCommandEntry<TTarget, TEvent>[]>
}

export interface CommandView<TTarget extends object, TEvent extends KeymapEvent> {
  entries: readonly LayerCommandEntry<TTarget, TEvent>[]
  chainsByName: ReadonlyMap<string, readonly LayerCommandEntry<TTarget, TEvent>[]>
}

export interface State<TTarget extends object, TEvent extends KeymapEvent> {
  order: number
  tokens: Map<string, import("../types.js").ResolvedKeyToken>
  patterns: Map<string, ResolvedSequencePattern<TEvent>>
  layerFields: Map<string, LayerFieldCompiler>
  layerBindingsTransformers: OrderedRegistryApi<LayerBindingsTransformer<TTarget, TEvent>>
  bindingExpanders: OrderedRegistryApi<BindingExpander>
  bindingParsers: OrderedRegistryApi<BindingParser>
  bindingTransformers: OrderedRegistryApi<BindingTransformer<TTarget, TEvent>>
  bindingFields: Map<string, BindingFieldCompiler>
  commandTransformers: OrderedRegistryApi<CommandTransformer<TTarget, TEvent>>
  commandFields: Map<string, CommandFieldCompiler>
  eventMatchResolvers: OrderedRegistryApi<EventMatchResolver<TEvent>>
  disambiguationResolvers: OrderedRegistryApi<KeyDisambiguationResolver<TTarget, TEvent>>
  keyHooks: PriorityRegistryApi<(ctx: KeyInputContext<TEvent>) => void, { priority: number; release: boolean }>
  keyAfterHooks: PriorityRegistryApi<
    (ctx: KeyAfterInputContext<TTarget, TEvent>) => void,
    { priority: number; release: boolean }
  >
  rawHooks: PriorityRegistryApi<(ctx: RawInputContext) => void, { priority: number }>
  layers: Set<RegisteredLayer<TTarget, TEvent>>
  commandResolvers: OrderedRegistryApi<CommandResolver<TTarget, TEvent>>
  pending: PendingSequenceState<TTarget, TEvent> | null
  data: EventData
  stateChangeDepth: number
  stateChangePending: boolean
  flushingStateChange: boolean
  usedWarningKeys: Set<string>
}

export function createKeymapState<TTarget extends object, TEvent extends KeymapEvent>(): State<TTarget, TEvent> {
  return {
    order: 0,
    tokens: new Map<string, import("../types.js").ResolvedKeyToken>(),
    patterns: new Map<string, ResolvedSequencePattern<TEvent>>(),
    layerFields: new Map<string, LayerFieldCompiler>(),
    layerBindingsTransformers: createOrderedRegistry<LayerBindingsTransformer<TTarget, TEvent>>(),
    bindingExpanders: createOrderedRegistry<BindingExpander>(),
    bindingParsers: createOrderedRegistry<BindingParser>(),
    bindingTransformers: createOrderedRegistry<BindingTransformer<TTarget, TEvent>>(),
    bindingFields: new Map<string, BindingFieldCompiler>(),
    commandTransformers: createOrderedRegistry<CommandTransformer<TTarget, TEvent>>(),
    commandFields: new Map<string, CommandFieldCompiler>(),
    eventMatchResolvers: createOrderedRegistry<EventMatchResolver<TEvent>>(),
    disambiguationResolvers: createOrderedRegistry<KeyDisambiguationResolver<TTarget, TEvent>>(),
    keyHooks: createPriorityRegistry<(ctx: KeyInputContext<TEvent>) => void, { priority: number; release: boolean }>(),
    keyAfterHooks: createPriorityRegistry<
      (ctx: KeyAfterInputContext<TTarget, TEvent>) => void,
      { priority: number; release: boolean }
    >(),
    rawHooks: createPriorityRegistry<(ctx: RawInputContext) => void, { priority: number }>(),
    layers: new Set<RegisteredLayer<TTarget, TEvent>>(),
    commandResolvers: createOrderedRegistry<CommandResolver<TTarget, TEvent>>(),
    pending: null,
    data: {},
    stateChangeDepth: 0,
    stateChangePending: false,
    flushingStateChange: false,
    usedWarningKeys: new Set<string>(),
  }
}
