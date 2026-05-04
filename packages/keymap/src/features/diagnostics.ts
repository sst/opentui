import type { CommandCatalogService } from "../services/command-catalog.js"
import type { AnalyzeLayerOptions, LayerDiagnostics } from "../services/layers.js"
import type { NotificationService } from "../services/notify.js"
import type { State } from "../services/state.js"
import { cloneKeySequence } from "../services/keys.js"
import { snapshotParsedBinding } from "../services/primitives/bindings.js"
import type {
  BindingState,
  KeymapEvent,
  KeySequencePart,
  LayerAnalyzer,
  LayerAnalysisContext,
  LayerBindingAnalysis,
  SequenceNode,
} from "../types.js"

export interface LayerDiagnosticsFeature<TTarget extends object, TEvent extends KeymapEvent>
  extends LayerDiagnostics<TTarget, TEvent> {
  prependLayerAnalyzer(analyzer: LayerAnalyzer<TTarget, TEvent>): () => void
  appendLayerAnalyzer(analyzer: LayerAnalyzer<TTarget, TEvent>): () => void
  clearLayerAnalyzers(): void
}

export interface LayerDiagnosticsFeatureContext<TTarget extends object, TEvent extends KeymapEvent> {
  state: State<TTarget, TEvent>
  notify: NotificationService<TTarget, TEvent>
  commands: CommandCatalogService<TTarget, TEvent>
}

function getSequenceNode<TTarget extends object, TEvent extends KeymapEvent>(
  root: SequenceNode<TTarget, TEvent>,
  sequence: readonly KeySequencePart[],
): SequenceNode<TTarget, TEvent> | undefined {
  let node: SequenceNode<TTarget, TEvent> | undefined = root

  for (const part of sequence) {
    node = part.patternName
      ? node.patternChildren.find((candidate) => candidate.pattern?.name === part.patternName)
      : node.children.get(part.match)
    if (!node) {
      return undefined
    }
  }

  return node
}

function buildLayerBindingAnalyses<TTarget extends object, TEvent extends KeymapEvent>(
  root: SequenceNode<TTarget, TEvent>,
  bindingStates: readonly BindingState<TTarget, TEvent>[],
): LayerBindingAnalysis<TTarget, TEvent>[] {
  return bindingStates.map((binding) => {
    const node = binding.event === "press" ? getSequenceNode(root, binding.sequence) : undefined

    return {
      sequence: cloneKeySequence(binding.sequence),
      command: binding.command,
      attrs: binding.attrs,
      event: binding.event,
      preventDefault: binding.preventDefault,
      fallthrough: binding.fallthrough,
      parsedBinding: snapshotParsedBinding(binding.parsedBinding),
      sourceTarget: binding.sourceTarget,
      sourceLayerOrder: binding.sourceLayerOrder,
      bindingIndex: binding.bindingIndex,
      hasCommandAtSequence: node ? node.bindings.some((candidate) => candidate.command !== undefined) : false,
      hasContinuations: node ? node.children.size > 0 || node.patternChildren.length > 0 : false,
    }
  })
}

export function createLayerDiagnosticsFeature<TTarget extends object, TEvent extends KeymapEvent>(
  context: LayerDiagnosticsFeatureContext<TTarget, TEvent>,
): LayerDiagnosticsFeature<TTarget, TEvent> {
  const { state, notify, commands } = context

  return {
    prependLayerAnalyzer(analyzer) {
      return state.layers.layerAnalyzers.prepend(analyzer)
    },
    appendLayerAnalyzer(analyzer) {
      return state.layers.layerAnalyzers.append(analyzer)
    },
    clearLayerAnalyzers() {
      state.layers.layerAnalyzers.clear()
    },
    analyzeLayer(options: AnalyzeLayerOptions<TTarget, TEvent>) {
      const analyzers = state.layers.layerAnalyzers.values()
      if (analyzers.length === 0) {
        return
      }

      const bindings = buildLayerBindingAnalyses(options.root, options.bindingStates)
      const ctx: LayerAnalysisContext<TTarget, TEvent> = {
        target: options.target,
        order: options.order,
        sourceBindings: options.sourceBindings,
        bindings,
        hasTokenBindings: options.hasTokenBindings,
        checkCommandResolution(command) {
          return commands.getCommandResolutionStatus(command, options.commandLookup)
        },
        warn(code, warning, message) {
          notify.emitWarning(code, warning, message)
        },
        warnOnce(key, code, warning, message) {
          notify.warnOnce(key, code, warning, message)
        },
        error(code, error, message) {
          notify.emitError(code, error, message)
        },
      }

      for (const analyzer of analyzers) {
        try {
          analyzer(ctx)
        } catch (error) {
          notify.emitError("layer-analyzer-error", error, "[Keymap] Error in layer analyzer:")
        }
      }
    },
  }
}
