import type {
  ActiveKey,
  BindingExpander,
  BindingFieldCompiler,
  LayerBindingsTransformer,
  BindingParser,
  BindingTransformer,
  CommandFieldCompiler,
  CommandResolver,
  EventData,
  KeyDisambiguationResolver,
  EventMatchResolver,
  Hooks,
  KeyInputContext,
  KeySequencePart,
  KeymapEvent,
  LayerAnalyzer,
  LayerFieldCompiler,
  PendingSequenceState,
  RawInputContext,
  RegisteredCommand,
  RegisteredLayer,
  ResolvedBindingCommand,
  RuntimeMatchable,
} from "../types.js"
import { OrderedRegistry, PriorityRegistry } from "../lib/registry.js"

const EMPTY_DATA: Readonly<EventData> = Object.freeze({})

export interface CoreState {
  order: number
}

export interface EnvironmentState<TTarget extends object, TEvent extends KeymapEvent> {
  tokens: Map<string, import("../types.js").ResolvedKeyToken>
  layerFields: Map<string, LayerFieldCompiler>
  layerBindingsTransformers: OrderedRegistry<LayerBindingsTransformer<TTarget, TEvent>>
  bindingExpanders: OrderedRegistry<BindingExpander>
  bindingParsers: OrderedRegistry<BindingParser>
  bindingTransformers: OrderedRegistry<BindingTransformer<TTarget, TEvent>>
  bindingFields: Map<string, BindingFieldCompiler>
  commandFields: Map<string, CommandFieldCompiler>
}

export interface DispatchState<TTarget extends object, TEvent extends KeymapEvent> {
  eventMatchResolvers: OrderedRegistry<EventMatchResolver<TEvent>>
  disambiguationResolvers: OrderedRegistry<KeyDisambiguationResolver<TTarget, TEvent>>
  keyHooks: PriorityRegistry<(ctx: KeyInputContext<TEvent>) => void, { priority: number; release: boolean }>
  rawHooks: PriorityRegistry<(ctx: RawInputContext) => void, { priority: number }>
}

export interface LayersState<TTarget extends object, TEvent extends KeymapEvent> {
  layers: Set<RegisteredLayer<TTarget, TEvent>>
  sortedLayers: RegisteredLayer<TTarget, TEvent>[]
  activeLayersVersion: number
  activeLayersCacheVersion: number
  activeLayersCacheFocused: TTarget | null | undefined
  activeLayersCache: readonly RegisteredLayer<TTarget, TEvent>[]
  layersWithConditions: number
  layersWithCommands: number
  layerAnalyzers: OrderedRegistry<LayerAnalyzer<TTarget, TEvent>>
}

export interface LayerCommandEntry<TTarget extends object, TEvent extends KeymapEvent> {
  layer: RegisteredLayer<TTarget, TEvent>
  command: RegisteredCommand<TTarget, TEvent>
}

export interface ResolvedCommandEntry<TTarget extends object, TEvent extends KeymapEvent> {
  target?: TTarget
  resolved: ResolvedBindingCommand<TTarget, TEvent>
}

export interface CommandChainCacheState<TTarget extends object, TEvent extends KeymapEvent> {
  resolvedWithoutRecordChains: Map<string, readonly ResolvedCommandEntry<TTarget, TEvent>[]>
  resolvedWithRecordChains: Map<string, readonly ResolvedCommandEntry<TTarget, TEvent>[]>
  fallbackWithoutRecord: Map<string, ResolvedBindingCommand<TTarget, TEvent> | null>
  fallbackWithRecord: Map<string, ResolvedBindingCommand<TTarget, TEvent> | null>
  fallbackWithoutRecordErrors: Set<string>
  fallbackWithRecordErrors: Set<string>
}

export interface ActiveCommandView<TTarget extends object, TEvent extends KeymapEvent> extends CommandChainCacheState<
  TTarget,
  TEvent
> {
  cacheable: boolean
  entries: readonly LayerCommandEntry<TTarget, TEvent>[]
  reachable: readonly LayerCommandEntry<TTarget, TEvent>[]
  reachableByName: ReadonlyMap<string, LayerCommandEntry<TTarget, TEvent>>
  chainsByName: ReadonlyMap<string, readonly LayerCommandEntry<TTarget, TEvent>[]>
}

export interface RegisteredCommandView<
  TTarget extends object,
  TEvent extends KeymapEvent,
> extends CommandChainCacheState<TTarget, TEvent> {
  entries: readonly LayerCommandEntry<TTarget, TEvent>[]
  chainsByName: ReadonlyMap<string, readonly LayerCommandEntry<TTarget, TEvent>[]>
}

export interface CommandsState<TTarget extends object, TEvent extends KeymapEvent> {
  commandMetadataVersion: number
  registeredNames: Map<string, number>
  commandResolvers: OrderedRegistry<CommandResolver<TTarget, TEvent>>
  activeCommandViewVersion: number
  activeCommandView?: ActiveCommandView<TTarget, TEvent>
  registeredCommandViewVersion: number
  registeredCommandView?: RegisteredCommandView<TTarget, TEvent>
  registeredCommandEntriesCacheVersion: number
  registeredCommandEntriesCache: readonly LayerCommandEntry<TTarget, TEvent>[]
}

export interface ProjectionState<TTarget extends object, TEvent extends KeymapEvent> {
  pendingSequence: PendingSequenceState<TTarget, TEvent> | null
  pendingSequenceCacheVersion: number
  pendingSequenceCache: readonly KeySequencePart[]
  activeKeysPlainCacheVersion: number
  activeKeysPlainCache: readonly ActiveKey<TTarget, TEvent>[]
  activeKeysBindingsCacheVersion: number
  activeKeysBindingsCache: readonly ActiveKey<TTarget, TEvent>[]
  activeKeysMetadataCacheVersion: number
  activeKeysMetadataCache: readonly ActiveKey<TTarget, TEvent>[]
  activeKeysBindingsAndMetadataCacheVersion: number
  activeKeysBindingsAndMetadataCache: readonly ActiveKey<TTarget, TEvent>[]
}

export interface ConditionsState {
  runtimeKeyDependents: Map<string, Set<RuntimeMatchable>>
}

export interface RuntimeState {
  data: EventData
  dataVersion: number
  readonlyDataVersion: number
  readonlyData: Readonly<EventData>
}

export interface NotifyState {
  derivedStateVersion: number
  stateChangeDepth: number
  stateChangePending: boolean
  flushingStateChange: boolean
  usedWarningKeys: Set<string>
}

export interface State<TTarget extends object, TEvent extends KeymapEvent> {
  core: CoreState
  environment: EnvironmentState<TTarget, TEvent>
  dispatch: DispatchState<TTarget, TEvent>
  layers: LayersState<TTarget, TEvent>
  commands: CommandsState<TTarget, TEvent>
  projection: ProjectionState<TTarget, TEvent>
  conditions: ConditionsState
  runtime: RuntimeState
  notify: NotifyState
}

export function createKeymapState<TTarget extends object, TEvent extends KeymapEvent>(): State<TTarget, TEvent> {
  return {
    core: {
      order: 0,
    },
    environment: {
      tokens: new Map<string, import("../types.js").ResolvedKeyToken>(),
      layerFields: new Map<string, LayerFieldCompiler>(),
      layerBindingsTransformers: new OrderedRegistry<LayerBindingsTransformer<TTarget, TEvent>>(),
      bindingExpanders: new OrderedRegistry<BindingExpander>(),
      bindingParsers: new OrderedRegistry<BindingParser>(),
      bindingTransformers: new OrderedRegistry<BindingTransformer<TTarget, TEvent>>(),
      bindingFields: new Map<string, BindingFieldCompiler>(),
      commandFields: new Map<string, CommandFieldCompiler>(),
    },
    dispatch: {
      eventMatchResolvers: new OrderedRegistry<EventMatchResolver<TEvent>>(),
      disambiguationResolvers: new OrderedRegistry<KeyDisambiguationResolver<TTarget, TEvent>>(),
      keyHooks: new PriorityRegistry<(ctx: KeyInputContext<TEvent>) => void, { priority: number; release: boolean }>(),
      rawHooks: new PriorityRegistry<(ctx: RawInputContext) => void, { priority: number }>(),
    },
    layers: {
      layers: new Set<RegisteredLayer<TTarget, TEvent>>(),
      sortedLayers: [],
      activeLayersVersion: 0,
      activeLayersCacheVersion: -1,
      activeLayersCacheFocused: undefined,
      activeLayersCache: [],
      layersWithConditions: 0,
      layersWithCommands: 0,
      layerAnalyzers: new OrderedRegistry<LayerAnalyzer<TTarget, TEvent>>(),
    },
    commands: {
      commandMetadataVersion: 0,
      registeredNames: new Map<string, number>(),
      commandResolvers: new OrderedRegistry<CommandResolver<TTarget, TEvent>>(),
      activeCommandViewVersion: -1,
      activeCommandView: undefined,
      registeredCommandViewVersion: -1,
      registeredCommandView: undefined,
      registeredCommandEntriesCacheVersion: -1,
      registeredCommandEntriesCache: [],
    },
    projection: {
      pendingSequence: null,
      pendingSequenceCacheVersion: -1,
      pendingSequenceCache: [],
      activeKeysPlainCacheVersion: -1,
      activeKeysPlainCache: [],
      activeKeysBindingsCacheVersion: -1,
      activeKeysBindingsCache: [],
      activeKeysMetadataCacheVersion: -1,
      activeKeysMetadataCache: [],
      activeKeysBindingsAndMetadataCacheVersion: -1,
      activeKeysBindingsAndMetadataCache: [],
    },
    conditions: {
      runtimeKeyDependents: new Map<string, Set<RuntimeMatchable>>(),
    },
    runtime: {
      data: {},
      dataVersion: 0,
      readonlyDataVersion: -1,
      readonlyData: EMPTY_DATA,
    },
    notify: {
      derivedStateVersion: 0,
      stateChangeDepth: 0,
      stateChangePending: false,
      flushingStateChange: false,
      usedWarningKeys: new Set<string>(),
    },
  }
}
