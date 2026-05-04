import { createGraphSnapshot } from "../services/graph-snapshot.js"
import type { ActivationService } from "../services/activation.js"
import type { CommandCatalogService } from "../services/command-catalog.js"
import type { ConditionService } from "../services/conditions.js"
import type { State } from "../services/state.js"
import type { GraphSnapshot, GraphSnapshotOptions, KeymapEvent, KeymapHost } from "../types.js"

export interface GraphFeature<TTarget extends object, TEvent extends KeymapEvent> {
  getGraphSnapshot(options?: GraphSnapshotOptions<TTarget>): GraphSnapshot<TTarget, TEvent>
}

export interface GraphFeatureContext<TTarget extends object, TEvent extends KeymapEvent> {
  state: State<TTarget, TEvent>
  host: KeymapHost<TTarget, TEvent>
  conditions: ConditionService<TTarget, TEvent>
  catalog: CommandCatalogService<TTarget, TEvent>
  activation: ActivationService<TTarget, TEvent>
}

export function createGraphFeature<TTarget extends object, TEvent extends KeymapEvent>(
  context: GraphFeatureContext<TTarget, TEvent>,
): GraphFeature<TTarget, TEvent> {
  return {
    getGraphSnapshot(options) {
      return createGraphSnapshot({
        state: context.state,
        host: context.host,
        conditions: context.conditions,
        catalog: context.catalog,
        activation: context.activation,
        snapshotOptions: options,
      })
    },
  }
}
