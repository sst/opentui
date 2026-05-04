import type { ConditionService } from "./conditions.js"
import type { ActiveCommandView, CommandView, LayerCommandEntry, State } from "./state.js"
import type { CommandState, GraphInactiveReason, KeymapEvent, KeymapHost, RegisteredLayer } from "../types.js"
import {
  getActivationPath,
  getActiveLayersForFocused,
  getSortedLayers,
  isLayerActiveForFocused,
} from "./primitives/active-layers.js"

export interface RuntimeLayerView<TTarget extends object, TEvent extends KeymapEvent> {
  layer: RegisteredLayer<TTarget, TEvent>
  focusActive: boolean
  enabled: boolean
  active: boolean
  inactiveReasons: GraphInactiveReason[]
}

export interface RuntimeView<TTarget extends object, TEvent extends KeymapEvent> {
  sortedLayers: readonly RegisteredLayer<TTarget, TEvent>[]
  activeLayers: readonly RegisteredLayer<TTarget, TEvent>[]
  layerStates: ReadonlyMap<RegisteredLayer<TTarget, TEvent>, RuntimeLayerView<TTarget, TEvent>>
  activeCommands: ActiveCommandView<TTarget, TEvent>
  activeCommandStates: ReadonlySet<CommandState<TTarget, TEvent>>
  reachableCommandStates: ReadonlySet<CommandState<TTarget, TEvent>>
}

function pushCommandEntry<TTarget extends object, TEvent extends KeymapEvent>(
  target: Map<string, LayerCommandEntry<TTarget, TEvent>[]>,
  name: string,
  entry: LayerCommandEntry<TTarget, TEvent>,
): void {
  const existing = target.get(name)
  if (existing) existing.push(entry)
  else target.set(name, [entry])
}

export function getRegisteredCommandView<TTarget extends object, TEvent extends KeymapEvent>(
  state: State<TTarget, TEvent>,
): CommandView<TTarget, TEvent> {
  const entries: LayerCommandEntry<TTarget, TEvent>[] = []
  const chainsByName = new Map<string, LayerCommandEntry<TTarget, TEvent>[]>()

  for (const layer of getSortedLayers(state.layers)) {
    for (const commandState of layer.commands) {
      const entry: LayerCommandEntry<TTarget, TEvent> = { layer, commandState }
      entries.push(entry)
      pushCommandEntry(chainsByName, commandState.command.name, entry)
    }
  }

  return { entries, chainsByName }
}

function collectActiveCommands<TTarget extends object, TEvent extends KeymapEvent>(
  layers: readonly RegisteredLayer<TTarget, TEvent>[],
  conditions: ConditionService<TTarget, TEvent>,
  checkLayerConditions: boolean,
): ActiveCommandView<TTarget, TEvent> {
  const entries: LayerCommandEntry<TTarget, TEvent>[] = []
  const reachable: LayerCommandEntry<TTarget, TEvent>[] = []
  const reachableByName = new Map<string, LayerCommandEntry<TTarget, TEvent>>()
  const chainsByName = new Map<string, LayerCommandEntry<TTarget, TEvent>[]>()

  for (const layer of layers) {
    if (layer.commands.length === 0) continue
    if (checkLayerConditions && !conditions.matchesConditions(layer)) continue

    for (const commandState of layer.commands) {
      if (!conditions.matchesConditions(commandState)) continue

      const entry: LayerCommandEntry<TTarget, TEvent> = { layer, commandState }
      entries.push(entry)
      pushCommandEntry(chainsByName, commandState.command.name, entry)
      if (!reachableByName.has(commandState.command.name)) {
        reachableByName.set(commandState.command.name, entry)
        reachable.push(entry)
      }
    }
  }

  return { entries, reachable, reachableByName, chainsByName }
}

export function getRuntimeView<TTarget extends object, TEvent extends KeymapEvent>(
  state: State<TTarget, TEvent>,
  host: KeymapHost<TTarget, TEvent>,
  conditions: ConditionService<TTarget, TEvent>,
  focused: TTarget | null,
): RuntimeView<TTarget, TEvent> {
  const sortedLayers = getSortedLayers(state.layers)
  const activationPath = getActivationPath(host, focused)
  const layerStates = new Map<RegisteredLayer<TTarget, TEvent>, RuntimeLayerView<TTarget, TEvent>>()
  const activeLayers: RegisteredLayer<TTarget, TEvent>[] = []

  for (const layer of sortedLayers) {
    const targetDestroyed = layer.target ? host.isTargetDestroyed(layer.target) : false
    const focusActive = isLayerActiveForFocused(host, layer, focused, activationPath)
    const enabled = conditions.matchesConditions(layer)
    const inactiveReasons: GraphInactiveReason[] = []
    if (targetDestroyed) inactiveReasons.push("target-destroyed")
    if (!focusActive) inactiveReasons.push("focus")
    if (!enabled) inactiveReasons.push("layer-disabled")

    const layerView = {
      layer,
      focusActive,
      enabled,
      active: !targetDestroyed && focusActive && enabled,
      inactiveReasons,
    }
    layerStates.set(layer, layerView)
    if (focusActive && enabled) activeLayers.push(layer)
  }

  const activeCommands = collectActiveCommands(activeLayers, conditions, false)

  return {
    sortedLayers,
    activeLayers,
    layerStates,
    activeCommands,
    activeCommandStates: commandStateSet(activeCommands.entries),
    reachableCommandStates: commandStateSet(activeCommands.reachable),
  }
}

export function getActiveCommandView<TTarget extends object, TEvent extends KeymapEvent>(
  state: State<TTarget, TEvent>,
  host: KeymapHost<TTarget, TEvent>,
  conditions: ConditionService<TTarget, TEvent>,
  focused: TTarget | null,
): ActiveCommandView<TTarget, TEvent> {
  return collectActiveCommands(getActiveLayersForFocused(state.layers, host, focused), conditions, true)
}

export function commandStateSet<TTarget extends object, TEvent extends KeymapEvent>(
  entries: readonly LayerCommandEntry<TTarget, TEvent>[],
): Set<CommandState<TTarget, TEvent>> {
  return new Set(entries.map((entry) => entry.commandState))
}
