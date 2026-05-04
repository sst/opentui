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
import { OrderedRegistry, PriorityRegistry } from "../lib/registry.js"

export interface CoreState {
  order: number
}

export interface EnvironmentState<TTarget extends object, TEvent extends KeymapEvent> {
  tokens: Map<string, import("../types.js").ResolvedKeyToken>
  sequencePatterns: Map<string, ResolvedSequencePattern<TEvent>>
  layerFields: Map<string, LayerFieldCompiler>
  layerBindingsTransformers: OrderedRegistry<LayerBindingsTransformer<TTarget, TEvent>>
  bindingExpanders: OrderedRegistry<BindingExpander>
  bindingParsers: OrderedRegistry<BindingParser>
  bindingTransformers: OrderedRegistry<BindingTransformer<TTarget, TEvent>>
  bindingFields: Map<string, BindingFieldCompiler>
  commandTransformers: OrderedRegistry<CommandTransformer<TTarget, TEvent>>
  commandFields: Map<string, CommandFieldCompiler>
}

export interface DispatchState<TTarget extends object, TEvent extends KeymapEvent> {
  eventMatchResolvers: OrderedRegistry<EventMatchResolver<TEvent>>
  disambiguationResolvers: OrderedRegistry<KeyDisambiguationResolver<TTarget, TEvent>>
  keyHooks: PriorityRegistry<(ctx: KeyInputContext<TEvent>) => void, { priority: number; release: boolean }>
  keyAfterHooks: PriorityRegistry<
    (ctx: KeyAfterInputContext<TTarget, TEvent>) => void,
    { priority: number; release: boolean }
  >
  rawHooks: PriorityRegistry<(ctx: RawInputContext) => void, { priority: number }>
}

export interface LayersState<TTarget extends object, TEvent extends KeymapEvent> {
  layers: Set<RegisteredLayer<TTarget, TEvent>>
  sortedLayers: RegisteredLayer<TTarget, TEvent>[]
  layersWithConditions: number
  layersWithCommands: number
}

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

export interface CommandsState<TTarget extends object, TEvent extends KeymapEvent> {
  registeredNames: Map<string, number>
  commandResolvers: OrderedRegistry<CommandResolver<TTarget, TEvent>>
}

export interface ProjectionState<TTarget extends object, TEvent extends KeymapEvent> {
  pendingSequence: PendingSequenceState<TTarget, TEvent> | null
}

export interface RuntimeState {
  data: EventData
}

export interface NotifyState {
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
      sequencePatterns: new Map<string, ResolvedSequencePattern<TEvent>>(),
      layerFields: new Map<string, LayerFieldCompiler>(),
      layerBindingsTransformers: new OrderedRegistry<LayerBindingsTransformer<TTarget, TEvent>>(),
      bindingExpanders: new OrderedRegistry<BindingExpander>(),
      bindingParsers: new OrderedRegistry<BindingParser>(),
      bindingTransformers: new OrderedRegistry<BindingTransformer<TTarget, TEvent>>(),
      bindingFields: new Map<string, BindingFieldCompiler>(),
      commandTransformers: new OrderedRegistry<CommandTransformer<TTarget, TEvent>>(),
      commandFields: new Map<string, CommandFieldCompiler>(),
    },
    dispatch: {
      eventMatchResolvers: new OrderedRegistry<EventMatchResolver<TEvent>>(),
      disambiguationResolvers: new OrderedRegistry<KeyDisambiguationResolver<TTarget, TEvent>>(),
      keyHooks: new PriorityRegistry<(ctx: KeyInputContext<TEvent>) => void, { priority: number; release: boolean }>(),
      keyAfterHooks: new PriorityRegistry<
        (ctx: KeyAfterInputContext<TTarget, TEvent>) => void,
        { priority: number; release: boolean }
      >(),
      rawHooks: new PriorityRegistry<(ctx: RawInputContext) => void, { priority: number }>(),
    },
    layers: {
      layers: new Set<RegisteredLayer<TTarget, TEvent>>(),
      sortedLayers: [],
      layersWithConditions: 0,
      layersWithCommands: 0,
    },
    commands: {
      registeredNames: new Map<string, number>(),
      commandResolvers: new OrderedRegistry<CommandResolver<TTarget, TEvent>>(),
    },
    projection: {
      pendingSequence: null,
    },
    runtime: {
      data: {},
    },
    notify: {
      stateChangeDepth: 0,
      stateChangePending: false,
      flushingStateChange: false,
      usedWarningKeys: new Set<string>(),
    },
  }
}
