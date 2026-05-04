import type { CommandCatalogService } from "../services/command-catalog.js"
import type { AnalyzeLayerOptions, LayerDiagnostics } from "../services/layers.js"
import type { NotificationService } from "../services/notify.js"
import { cloneKeySequence } from "../services/keys.js"
import { snapshotParsedBinding } from "../services/primitives/bindings.js"
import { OrderedRegistry } from "../lib/registry.js"
import type {
  BindingState,
  KeymapEvent,
  LayerAnalyzer,
  LayerAnalysisContext,
  LayerBindingAnalysis,
} from "../types.js"

export interface LayerDiagnosticsFeature<TTarget extends object, TEvent extends KeymapEvent>
  extends LayerDiagnostics<TTarget, TEvent> {
  prependLayerAnalyzer(analyzer: LayerAnalyzer<TTarget, TEvent>): () => void
  appendLayerAnalyzer(analyzer: LayerAnalyzer<TTarget, TEvent>): () => void
  clearLayerAnalyzers(): void
}

export interface LayerDiagnosticsFeatureContext<TTarget extends object, TEvent extends KeymapEvent> {
  notify: NotificationService<TTarget, TEvent>
  commands: CommandCatalogService<TTarget, TEvent>
}

function buildLayerBindingAnalyses<TTarget extends object, TEvent extends KeymapEvent>(
  bindingStates: readonly BindingState<TTarget, TEvent>[],
): LayerBindingAnalysis<TTarget, TEvent>[] {
  return bindingStates.map((binding) => {
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
      hasCommandAtSequence: bindingStates.some((candidate) => {
        return candidate.event === "press" && candidate.command !== undefined && sameSequence(candidate, binding)
      }),
      hasContinuations: bindingStates.some((candidate) => {
        return candidate.event === "press" && isPrefix(binding, candidate)
      }),
    }
  })
}

function sameSequence<TTarget extends object, TEvent extends KeymapEvent>(
  left: BindingState<TTarget, TEvent>,
  right: BindingState<TTarget, TEvent>,
): boolean {
  if (left.sequence.length !== right.sequence.length) {
    return false
  }

  return left.sequence.every((part, index) => part.match === right.sequence[index]?.match)
}

function isPrefix<TTarget extends object, TEvent extends KeymapEvent>(
  left: BindingState<TTarget, TEvent>,
  right: BindingState<TTarget, TEvent>,
): boolean {
  if (left.sequence.length >= right.sequence.length) {
    return false
  }

  return left.sequence.every((part, index) => part.match === right.sequence[index]?.match)
}

export function createLayerDiagnosticsFeature<TTarget extends object, TEvent extends KeymapEvent>(
  context: LayerDiagnosticsFeatureContext<TTarget, TEvent>,
): LayerDiagnosticsFeature<TTarget, TEvent> {
  const { notify, commands } = context
  const analyzers = new OrderedRegistry<LayerAnalyzer<TTarget, TEvent>>()

  return {
    prependLayerAnalyzer(analyzer) {
      return analyzers.prepend(analyzer)
    },
    appendLayerAnalyzer(analyzer) {
      return analyzers.append(analyzer)
    },
    clearLayerAnalyzers() {
      analyzers.clear()
    },
    analyzeLayer(options: AnalyzeLayerOptions<TTarget, TEvent>) {
      const registeredAnalyzers = analyzers.values()
      if (registeredAnalyzers.length === 0) {
        return
      }

      const bindings = buildLayerBindingAnalyses(options.bindingStates)
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

      for (const analyzer of registeredAnalyzers) {
        try {
          analyzer(ctx)
        } catch (error) {
          notify.emitError("layer-analyzer-error", error, "[Keymap] Error in layer analyzer:")
        }
      }
    },
  }
}
