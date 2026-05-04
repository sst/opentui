import type { CompilerService } from "./compiler.js"
import type { Emitter } from "../lib/emitter.js"
import type { ActivationService } from "./activation.js"
import type { CommandExecutorService } from "./command-executor.js"
import type { CommandCatalogService } from "./command-catalog.js"
import type { ConditionService } from "./conditions.js"
import type { LayerService } from "./layers.js"
import type { NotificationService } from "./notify.js"
import type { RuntimeService } from "./runtime.js"
import type { State } from "./state.js"
import { cloneKeySequence, cloneKeyStroke, createKeySequencePart, stringifyKeySequence } from "./keys.js"
import { isPromiseLike } from "./values.js"
import {
  KEY_DEFERRED_DISAMBIGUATION_DECISION,
  KEY_DISAMBIGUATION_DECISION,
  type ActiveBinding,
  type ActiveKey,
  type EventMatchResolverContext,
  type EventMatchResolver,
  type KeyDeferredDisambiguationContext,
  type KeyDeferredDisambiguationDecision,
  type KeyDeferredDisambiguationHandler,
  type KeyDisambiguationContext,
  type KeyDisambiguationDecision,
  type KeyDisambiguationResolver,
  type KeyMatch,
  type KeyInterceptOptions,
  type KeyAfterInputContext,
  type KeyAfterReason,
  type KeyInputContext,
  type KeymapEvent,
  type PendingSequenceCapture,
  type PendingSequenceState,
  type RawInterceptOptions,
  type RawInputContext,
  type BindingState,
  type Hooks,
  type DispatchBinding,
  type DispatchEvent,
  type KeySequencePart,
  type PendingSequencePatternCapture,
  type RegisteredLayer,
  type SequencePatternMatch,
  type SequenceNode,
} from "../types.js"
import type { PriorityRegistration } from "../lib/registry.js"

type SyncDecisionAction = "run-exact" | "continue-sequence" | "clear" | "defer"
type DeferredDecisionAction = "run-exact" | "continue-sequence" | "clear"

interface InternalDisambiguationDecision extends KeyDisambiguationDecision {
  readonly action: SyncDecisionAction
  readonly handler?: KeyDeferredDisambiguationHandler<any, any>
}

interface InternalDeferredDisambiguationDecision extends KeyDeferredDisambiguationDecision {
  readonly action: DeferredDecisionAction
}

interface PendingDisambiguation<TTarget extends object, TEvent extends KeymapEvent> {
  id: number
  controller: AbortController
  captures: readonly PendingSequenceCapture<TTarget, TEvent>[]
  apply: (decision: InternalDeferredDisambiguationDecision | void) => void
}

interface KeyDispatchOutcome {
  handled: boolean
  reason: KeyAfterReason
  sequence?: readonly KeySequencePart[]
  captures?: readonly PendingSequenceCapture<any, any>[]
}

interface KeyAfterDispatchState<TTarget extends object, TEvent extends KeymapEvent> extends KeyDispatchOutcome {
  event: TEvent
  eventType: "press" | "release"
  focused: TTarget | null
  sequence: readonly KeySequencePart[]
}

interface AdvancedCapture<TTarget extends object, TEvent extends KeymapEvent> {
  capture: PendingSequenceCapture<TTarget, TEvent>
  consumed: boolean
}

type KeyAfterHook<TTarget extends object, TEvent extends KeymapEvent> = PriorityRegistration<
  (ctx: KeyAfterInputContext<TTarget, TEvent>) => void,
  { priority: number; release: boolean }
>

function createSyncDecision(
  action: SyncDecisionAction,
  handler?: KeyDeferredDisambiguationHandler<any, any>,
): InternalDisambiguationDecision {
  return {
    [KEY_DISAMBIGUATION_DECISION]: true,
    action,
    handler,
  }
}

function createDeferredDecision(action: DeferredDecisionAction): InternalDeferredDisambiguationDecision {
  return {
    [KEY_DEFERRED_DISAMBIGUATION_DECISION]: true,
    action,
  }
}

function isSyncDecision(value: unknown): value is InternalDisambiguationDecision {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { [KEY_DISAMBIGUATION_DECISION]?: unknown })[KEY_DISAMBIGUATION_DECISION] === true
  )
}

function isDeferredDecision(value: unknown): value is InternalDeferredDisambiguationDecision {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { [KEY_DEFERRED_DISAMBIGUATION_DECISION]?: unknown })[KEY_DEFERRED_DISAMBIGUATION_DECISION] === true
  )
}

export class DispatchService<TTarget extends object, TEvent extends KeymapEvent> {
  private readonly eventMatchResolverContext: EventMatchResolverContext
  private pendingDisambiguation: PendingDisambiguation<TTarget, TEvent> | null = null
  private nextPendingDisambiguationId = 0

  constructor(
    private readonly state: State<TTarget, TEvent>,
    private readonly notify: NotificationService<TTarget, TEvent>,
    private readonly runtime: RuntimeService<TTarget, TEvent>,
    private readonly activation: ActivationService<TTarget, TEvent>,
    private readonly conditions: ConditionService<TTarget, TEvent>,
    private readonly executor: CommandExecutorService<TTarget, TEvent>,
    private readonly compiler: CompilerService<TTarget, TEvent>,
    private readonly catalog: CommandCatalogService<TTarget, TEvent>,
    private readonly layers: LayerService<TTarget, TEvent>,
    private readonly hooks: Emitter<Hooks<TTarget, TEvent>>,
  ) {
    this.eventMatchResolverContext = {
      resolveKey: (key) => {
        return this.compiler.parseTokenKey(key).match
      },
    }
  }

  public intercept(name: "key", fn: (ctx: KeyInputContext<TEvent>) => void, options?: KeyInterceptOptions): () => void

  public intercept(
    name: "key:after",
    fn: (ctx: KeyAfterInputContext<TTarget, TEvent>) => void,
    options?: KeyInterceptOptions,
  ): () => void

  public intercept(name: "raw", fn: (ctx: RawInputContext) => void, options?: RawInterceptOptions): () => void

  public intercept(
    name: "key" | "key:after" | "raw",
    fn:
      | ((ctx: KeyInputContext<TEvent>) => void)
      | ((ctx: KeyAfterInputContext<TTarget, TEvent>) => void)
      | ((ctx: RawInputContext) => void),
    options?: KeyInterceptOptions | RawInterceptOptions,
  ): () => void {
    if (name === "key") {
      const keyOptions = options as KeyInterceptOptions | undefined
      return this.state.dispatch.keyHooks.register(fn as (ctx: KeyInputContext<TEvent>) => void, {
        priority: keyOptions?.priority ?? 0,
        release: keyOptions?.release ?? false,
      })
    }

    if (name === "key:after") {
      const keyOptions = options as KeyInterceptOptions | undefined
      return this.state.dispatch.keyAfterHooks.register(fn as (ctx: KeyAfterInputContext<TTarget, TEvent>) => void, {
        priority: keyOptions?.priority ?? 0,
        release: keyOptions?.release ?? false,
      })
    }

    const rawOptions = options as RawInterceptOptions | undefined
    return this.state.dispatch.rawHooks.register(fn as (ctx: RawInputContext) => void, {
      priority: rawOptions?.priority ?? 0,
    })
  }

  public prependEventMatchResolver(resolver: EventMatchResolver<TEvent>): () => void {
    return this.state.dispatch.eventMatchResolvers.prepend(resolver)
  }

  public appendEventMatchResolver(resolver: EventMatchResolver<TEvent>): () => void {
    return this.state.dispatch.eventMatchResolvers.append(resolver)
  }

  public clearEventMatchResolvers(): void {
    this.state.dispatch.eventMatchResolvers.clear()
  }

  public prependDisambiguationResolver(resolver: KeyDisambiguationResolver<TTarget, TEvent>): () => void {
    return this.mutateDisambiguationResolvers(
      () => this.state.dispatch.disambiguationResolvers.prepend(resolver),
      resolver,
    )
  }

  public appendDisambiguationResolver(resolver: KeyDisambiguationResolver<TTarget, TEvent>): () => void {
    return this.mutateDisambiguationResolvers(
      () => this.state.dispatch.disambiguationResolvers.append(resolver),
      resolver,
    )
  }

  public clearDisambiguationResolvers(): void {
    if (!this.state.dispatch.disambiguationResolvers.has()) {
      return
    }

    this.notify.runWithStateChangeBatch(() => {
      this.state.dispatch.disambiguationResolvers.clear()
      this.layers.recompileBindings()
    })
  }

  public handlePendingSequenceChange(
    _previous: PendingSequenceState<TTarget, TEvent> | null,
    _next: PendingSequenceState<TTarget, TEvent> | null,
  ): void {
    if (!this.pendingDisambiguation) {
      return
    }

    this.cancelPendingDisambiguation()
  }

  public handleRawSequence(sequence: string): boolean {
    const hooks = this.state.dispatch.rawHooks.entries()
    if (hooks.length === 0) {
      return false
    }

    let stopped = false
    const context: RawInputContext = {
      sequence,
      stop() {
        stopped = true
      },
    }

    for (const hook of hooks) {
      try {
        hook.listener(context)
      } catch (error) {
        this.notify.emitError("raw-intercept-error", error, "[Keymap] Error in raw intercept listener:")
      }

      if (stopped) {
        return true
      }
    }

    return false
  }

  private createDispatchBinding(
    binding: BindingState<TTarget, TEvent>,
    focused: TTarget | null,
  ): DispatchBinding<TTarget, TEvent> {
    return {
      sequence: cloneKeySequence(binding.sequence),
      command: binding.command,
      commandAttrs: this.catalog.getBindingCommandAttrs(binding, focused, this.catalog.getActiveCommandView(focused)),
      attrs: binding.attrs,
      event: binding.event,
      preventDefault: binding.preventDefault,
      fallthrough: binding.fallthrough,
      sourceLayerOrder: binding.sourceLayerOrder,
      bindingIndex: binding.bindingIndex,
    }
  }

  private emitDispatchEvent(event: DispatchEvent<TTarget, TEvent>): void {
    if (!this.hooks.has("dispatch")) {
      return
    }

    this.hooks.emit("dispatch", event)
  }

  private emitBindingDispatch(
    phase: "binding-execute" | "binding-reject",
    layer: RegisteredLayer<TTarget, TEvent>,
    binding: BindingState<TTarget, TEvent>,
    focused: TTarget | null,
  ): void {
    if (!this.hooks.has("dispatch")) {
      return
    }

    this.emitDispatchEvent({
      phase,
      event: binding.event,
      focused,
      layer: {
        order: layer.order,
        priority: layer.priority,
        target: layer.target,
        targetMode: layer.targetMode,
      },
      binding: this.createDispatchBinding(binding, focused),
      sequence: cloneKeySequence(binding.sequence),
      command: binding.command,
    })
  }

  private emitSequenceDispatch(
    phase: "sequence-start" | "sequence-advance" | "sequence-clear",
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    focused: TTarget | null,
  ): void {
    if (!this.hooks.has("dispatch")) {
      return
    }

    const first = captures[0]
    const sequence = captures.length > 0 ? this.activation.collectSequencePartsFromPending({ captures }) : []

    this.emitDispatchEvent({
      phase,
      event: "press",
      focused,
      layer: first
        ? {
            order: first.layer.order,
            priority: first.layer.priority,
            target: first.layer.target,
            targetMode: first.layer.targetMode,
          }
        : undefined,
      sequence,
    })
  }

  private getKeyAfterHooks(release: boolean): readonly KeyAfterHook<TTarget, TEvent>[] | undefined {
    const hooks = this.state.dispatch.keyAfterHooks.entries()
    for (const hook of hooks) {
      if (hook.release === release) {
        return hooks
      }
    }

    return undefined
  }

  private createKeyAfterState(
    event: TEvent,
    release: boolean,
    focused: TTarget | null,
    outcome: KeyDispatchOutcome,
  ): KeyAfterDispatchState<TTarget, TEvent> {
    return {
      event,
      eventType: release ? "release" : "press",
      focused,
      handled: outcome.handled,
      reason: outcome.reason,
      sequence: this.materializeOutcomeSequence(outcome),
    }
  }

  private materializeOutcomeSequence(outcome: KeyDispatchOutcome): readonly KeySequencePart[] {
    if (outcome.sequence) {
      return cloneKeySequence(outcome.sequence)
    }

    if (outcome.captures) {
      return this.activation.collectSequencePartsFromPending({ captures: outcome.captures })
    }

    return []
  }

  private createSequenceOutcome(
    reason: "sequence-pending" | "sequence-miss" | "sequence-cleared",
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
  ): KeyDispatchOutcome {
    return {
      handled: reason !== "sequence-miss",
      reason,
      captures,
    }
  }

  private createBindingOutcome(binding: BindingState<TTarget, TEvent>, handled: boolean): KeyDispatchOutcome {
    return {
      handled,
      reason: handled ? "binding-handled" : "binding-rejected",
      sequence: binding.sequence,
    }
  }

  private preferDispatchOutcome(current: KeyDispatchOutcome, next: KeyDispatchOutcome): KeyDispatchOutcome {
    if (next.handled || current.reason === "no-match") {
      return next
    }

    return current
  }

  private emitKeyAfter(
    hooks: readonly KeyAfterHook<TTarget, TEvent>[],
    after: KeyAfterDispatchState<TTarget, TEvent>,
  ): void {
    const context = this.createKeyAfterContext(after)
    const release = after.eventType === "release"

    for (const hook of hooks) {
      if (hook.release !== release) {
        continue
      }

      try {
        hook.listener(context)
      } catch (error) {
        this.notify.emitError("key-after-intercept-error", error, "[Keymap] Error in key:after intercept listener:")
      }
    }
  }

  private createKeyAfterContext(after: KeyAfterDispatchState<TTarget, TEvent>): KeyAfterInputContext<TTarget, TEvent> {
    return {
      event: after.event,
      eventType: after.eventType,
      focused: after.focused,
      handled: after.handled,
      reason: after.reason,
      sequence: after.sequence,
      pendingSequence: this.activation.getPendingSequence(),
      setData: (name, value) => {
        this.runtime.setData(name, value)
      },
      getData: (name) => {
        return this.runtime.getData(name)
      },
      consume: (options) => {
        const shouldPreventDefault = options?.preventDefault ?? true
        const shouldStopPropagation = options?.stopPropagation ?? true

        if (shouldPreventDefault) {
          after.event.preventDefault()
        }

        if (shouldStopPropagation) {
          after.event.stopPropagation()
        }
      },
    }
  }

  private noMatchOutcome(): KeyDispatchOutcome {
    return { handled: false, reason: "no-match" }
  }

  public handleKeyEvent(event: TEvent, release: boolean): void {
    if (!release) {
      this.cancelPendingDisambiguation()
    }

    const afterHooks = this.getKeyAfterHooks(release)
    const afterFocused = afterHooks ? this.activation.getFocusedTarget() : null
    const hooks = this.state.dispatch.keyHooks.entries()
    const context: KeyInputContext<TEvent> = {
      event,
      setData: (name, value) => {
        this.runtime.setData(name, value)
      },
      getData: (name) => {
        return this.runtime.getData(name)
      },
      consume: (options) => {
        const shouldPreventDefault = options?.preventDefault ?? true
        const shouldStopPropagation = options?.stopPropagation ?? true

        if (shouldPreventDefault) {
          event.preventDefault()
        }

        if (shouldStopPropagation) {
          event.stopPropagation()
        }
      },
    }

    for (const hook of hooks) {
      if (hook.release !== release) {
        continue
      }

      try {
        hook.listener(context)
      } catch (error) {
        this.notify.emitError("key-intercept-error", error, "[Keymap] Error in key intercept listener:")
      }

      if (event.propagationStopped) {
        if (afterHooks) {
          this.emitKeyAfter(
            afterHooks,
            this.createKeyAfterState(event, release, afterFocused, {
              handled: true,
              reason: "intercept-consumed",
              sequence: [],
            }),
          )
        }
        return
      }
    }

    if (release) {
      const outcome = this.dispatchReleaseLayers(event)
      if (afterHooks) {
        this.emitKeyAfter(afterHooks, this.createKeyAfterState(event, release, afterFocused, outcome))
      }
      return
    }

    const outcome = this.dispatchLayers(event)
    if (afterHooks) {
      this.emitKeyAfter(afterHooks, this.createKeyAfterState(event, release, afterFocused, outcome))
    }
  }

  private mutateDisambiguationResolvers(
    register: () => () => void,
    resolver: KeyDisambiguationResolver<TTarget, TEvent>,
  ): () => void {
    return this.notify.runWithStateChangeBatch(() => {
      const hadResolvers = this.state.dispatch.disambiguationResolvers.has()
      const off = register()

      if (!hadResolvers && this.state.dispatch.disambiguationResolvers.has()) {
        this.layers.recompileBindings()
      }

      return () => {
        this.notify.runWithStateChangeBatch(() => {
          const hadBeforeRemoval = this.state.dispatch.disambiguationResolvers.has()
          off()

          if (this.state.dispatch.disambiguationResolvers.values().includes(resolver)) {
            return
          }

          if (hadBeforeRemoval && !this.state.dispatch.disambiguationResolvers.has()) {
            this.layers.recompileBindings()
          }
        })
      }
    })
  }

  private dispatchReleaseLayers(event: TEvent): KeyDispatchOutcome {
    const focused = this.activation.getFocusedTarget()
    const activeLayers = this.activation.getActiveLayers(focused)
    const hasLayerConditions = this.state.layers.layersWithConditions > 0
    const matchKeys = this.resolveEventMatchKeys(event)
    let outcome = this.noMatchOutcome()

    layerLoop: for (const layer of activeLayers) {
      if (layer.bindingStates.length === 0) {
        continue
      }

      if (hasLayerConditions && !this.conditions.hasNoConditions(layer) && !this.conditions.matchesConditions(layer)) {
        continue
      }

      for (const strokeKey of matchKeys) {
        const result = this.runReleaseBindings(layer, strokeKey, event, focused)
        outcome = this.preferDispatchOutcome(outcome, result.outcome)
        if (!result.handled) {
          continue
        }

        if (result.stop) {
          return outcome
        }

        continue layerLoop
      }
    }

    return outcome
  }

  private dispatchLayers(event: TEvent): KeyDispatchOutcome {
    const focused = this.activation.getFocusedTarget()
    const pending = this.activation.ensureValidPendingSequence()
    const matchKeys = this.resolveEventMatchKeys(event)

    if (pending) {
      return this.dispatchPendingSequence(pending, matchKeys, event, focused)
    }

    const activeLayers = this.activation.getActiveLayers(focused)
    return this.dispatchFromRoot(activeLayers, matchKeys, event, focused)
  }

  private dispatchPendingSequence(
    pending: PendingSequenceState<TTarget, TEvent>,
    matchKeys: readonly KeyMatch[],
    event: TEvent,
    focused: TTarget | null,
  ): KeyDispatchOutcome {
    const advancedCaptures: PendingSequenceCapture<TTarget, TEvent>[] = []

    for (const capture of pending.captures) {
      const advanced = this.advanceCapture(capture, matchKeys, event, focused)
      if (!advanced) {
        continue
      }

      advancedCaptures.push(advanced.capture)
    }

    if (advancedCaptures.length === 0) {
      const outcome = this.createSequenceOutcome("sequence-miss", pending.captures)
      this.emitSequenceDispatch("sequence-clear", pending.captures, focused)
      this.activation.setPendingSequence(null)
      return outcome
    }

    return this.dispatchPendingCapturesFromIndex(advancedCaptures, 0, false, event, focused)
  }

  private dispatchPendingCapturesFromIndex(
    advancedCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    startIndex: number,
    handledExact: boolean,
    event: TEvent,
    focused: TTarget | null,
  ): KeyDispatchOutcome {
    let hasHandledExact = handledExact
    let outcome = this.noMatchOutcome()

    for (let index = startIndex; index < advancedCaptures.length; index += 1) {
      const capture = advancedCaptures[index]
      if (!capture) {
        continue
      }

      if (this.nodeHasContinuations(capture.node, capture)) {
        if (hasHandledExact) {
          continue
        }

        const continuationCaptures = this.collectPendingCapturesFromAdvanced(advancedCaptures, index)
        const resolvedOutcome = this.tryResolvePendingAmbiguity(
          advancedCaptures,
          index,
          continuationCaptures,
          capture,
          event,
          focused,
          hasHandledExact,
        )
        if (resolvedOutcome) {
          return resolvedOutcome
        }

        this.activation.setPendingSequence({ captures: continuationCaptures })
        outcome = this.createSequenceOutcome("sequence-pending", continuationCaptures)
        this.emitSequenceDispatch("sequence-advance", continuationCaptures, focused)
        event.preventDefault()
        event.stopPropagation()
        return outcome
      }

      const result = this.runBindings(
        capture.layer,
        capture.node.bindings,
        event,
        focused,
        this.createSequencePayload(capture),
      )
      outcome = this.preferDispatchOutcome(outcome, result.outcome)
      if (!result.handled) {
        continue
      }

      hasHandledExact = true
      if (result.stop) {
        this.emitSequenceDispatch("sequence-clear", advancedCaptures, focused)
        this.activation.setPendingSequence(null)
        return outcome
      }
    }

    this.emitSequenceDispatch("sequence-clear", advancedCaptures, focused)
    this.activation.setPendingSequence(null)
    return outcome
  }

  private dispatchFromRoot(
    activeLayers: RegisteredLayer<TTarget, TEvent>[],
    matchKeys: readonly KeyMatch[],
    event: TEvent,
    focused: TTarget | null,
  ): KeyDispatchOutcome {
    return this.dispatchFromRootAtIndex(activeLayers, 0, matchKeys, event, focused)
  }

  private dispatchFromRootAtIndex(
    activeLayers: RegisteredLayer<TTarget, TEvent>[],
    startIndex: number,
    matchKeys: readonly KeyMatch[],
    event: TEvent,
    focused: TTarget | null,
  ): KeyDispatchOutcome {
    const hasLayerConditions = this.state.layers.layersWithConditions > 0
    let outcome = this.noMatchOutcome()

    for (let index = startIndex; index < activeLayers.length; index += 1) {
      const layer = activeLayers[index]
      if (!layer) {
        continue
      }

      if (layer.root.children.size === 0 && layer.root.patternChildren.length === 0) {
        continue
      }

      if (hasLayerConditions && !this.conditions.hasNoConditions(layer) && !this.conditions.matchesConditions(layer)) {
        continue
      }

      const nextCapture = this.advanceCapture({ layer, node: layer.root }, matchKeys, event, focused)
      if (!nextCapture) {
        continue
      }

      const nextNode = nextCapture.capture.node

      if (this.nodeHasContinuations(nextNode, nextCapture.capture)) {
        const continuationCaptures = this.collectPendingCapturesFromRoot(activeLayers, index, matchKeys, event, focused)
        const resolvedOutcome = this.tryResolveRootAmbiguity(
          activeLayers,
          index,
          matchKeys,
          continuationCaptures,
          layer,
          nextNode,
          event,
          focused,
        )
        if (resolvedOutcome) {
          return resolvedOutcome
        }

        this.activation.setPendingSequence({ captures: continuationCaptures })
        outcome = this.createSequenceOutcome("sequence-pending", continuationCaptures)
        this.emitSequenceDispatch("sequence-start", continuationCaptures, focused)
        event.preventDefault()
        event.stopPropagation()
        return outcome
      }

      const result = this.runBindings(layer, nextNode.bindings, event, focused, this.createSequencePayload(nextCapture.capture))
      outcome = this.preferDispatchOutcome(outcome, result.outcome)
      if (!result.handled) {
        continue
      }

      if (result.stop) {
        return outcome
      }
    }

    return outcome
  }

  private tryResolveRootAmbiguity(
    activeLayers: RegisteredLayer<TTarget, TEvent>[],
    layerIndex: number,
    matchKeys: readonly KeyMatch[],
    continuationCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    layer: RegisteredLayer<TTarget, TEvent>,
    node: SequenceNode<TTarget, TEvent>,
    event: TEvent,
    focused: TTarget | null,
  ): KeyDispatchOutcome | undefined {
    const applyExact = (): KeyDispatchOutcome => {
      this.activation.setPendingSequence(null)
      const exactCapture = continuationCaptures.find((candidate) => candidate.layer === layer && candidate.node === node)
      const result = this.runBindings(layer, node.bindings, event, focused, this.createSequencePayload(exactCapture))
      if (!result.stop) {
        return this.preferDispatchOutcome(
          result.outcome,
          this.dispatchFromRootAtIndex(activeLayers, layerIndex + 1, matchKeys, event, focused),
        )
      }

      return result.outcome
    }

    return this.tryResolveAmbiguity({
      event,
      focused,
      continuationCaptures,
      exactBindingsSource: node.bindings,
      sequencePhase: "sequence-start",
      runExact: applyExact,
    })
  }

  private tryResolvePendingAmbiguity(
    advancedCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    captureIndex: number,
    continuationCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    capture: PendingSequenceCapture<TTarget, TEvent>,
    event: TEvent,
    focused: TTarget | null,
    handledExact: boolean,
  ): KeyDispatchOutcome | undefined {
    const applyExact = (): KeyDispatchOutcome => {
      this.activation.setPendingSequence(null)
      const result = this.runBindings(
        capture.layer,
        capture.node.bindings,
        event,
        focused,
        this.createSequencePayload(capture),
      )
      if (result.stop) {
        return result.outcome
      }

      return this.preferDispatchOutcome(
        result.outcome,
        this.dispatchPendingCapturesFromIndex(
          advancedCaptures,
          captureIndex + 1,
          handledExact || result.handled,
          event,
          focused,
        ),
      )
    }

    return this.tryResolveAmbiguity({
      event,
      focused,
      continuationCaptures,
      exactBindingsSource: capture.node.bindings,
      sequencePhase: "sequence-advance",
      runExact: applyExact,
    })
  }

  private tryResolveAmbiguity(options: {
    event: TEvent
    focused: TTarget | null
    continuationCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[]
    exactBindingsSource: readonly BindingState<TTarget, TEvent>[]
    sequencePhase: "sequence-start" | "sequence-advance"
    runExact: () => KeyDispatchOutcome
  }): KeyDispatchOutcome | undefined {
    const { event, focused, continuationCaptures, exactBindingsSource, sequencePhase, runExact } = options

    if (!this.state.dispatch.disambiguationResolvers.has() || continuationCaptures.length === 0) {
      return undefined
    }

    const activeView = this.catalog.getActiveCommandView(focused)
    const exactBindings = this.activation.collectMatchingBindings(exactBindingsSource, focused, activeView)
    if (!exactBindings.some((binding) => binding.command !== undefined)) {
      return undefined
    }

    const continueSequence = (): KeyDispatchOutcome => {
      this.activation.setPendingSequence({ captures: continuationCaptures })
      const outcome = this.createSequenceOutcome("sequence-pending", continuationCaptures)
      this.emitSequenceDispatch(sequencePhase, continuationCaptures, focused)
      event.preventDefault()
      event.stopPropagation()
      return outcome
    }

    const clear = (): KeyDispatchOutcome => {
      const outcome = this.createSequenceOutcome("sequence-cleared", continuationCaptures)
      this.emitSequenceDispatch("sequence-clear", continuationCaptures, focused)
      this.activation.setPendingSequence(null)
      event.preventDefault()
      event.stopPropagation()
      return outcome
    }

    let sequence: ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]> | undefined
    const getSequence = (): ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]> => {
      sequence ??= this.activation.collectSequencePartsFromPending({ captures: continuationCaptures })
      return sequence
    }

    const decision = this.resolveDisambiguation({
      event,
      focused,
      getSequence,
      exactBindings,
      continuationCaptures,
      activeView,
    })

    if (!decision) {
      this.warnUnresolvedAmbiguity(getSequence())
      return continueSequence()
    }

    return this.applySyncDecision(
      decision,
      continuationCaptures,
      runExact,
      continueSequence,
      clear,
      focused,
      getSequence,
    )
  }

  private applySyncDecision(
    decision: InternalDisambiguationDecision,
    continuationCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    runExact: () => KeyDispatchOutcome,
    continueSequence: () => KeyDispatchOutcome,
    clear: () => KeyDispatchOutcome,
    focused: TTarget | null,
    getSequence: () => ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]>,
  ): KeyDispatchOutcome {
    if (decision.action === "run-exact") {
      return runExact()
    }

    if (decision.action === "continue-sequence") {
      return continueSequence()
    }

    if (decision.action === "clear") {
      return clear()
    }

    const outcome = continueSequence()
    this.scheduleDeferredDisambiguation(
      continuationCaptures,
      decision.handler!,
      focused,
      getSequence(),
      (nextDecision) => {
        if (!nextDecision) {
          return
        }

        if (nextDecision.action === "run-exact") {
          runExact()
          return
        }

        if (nextDecision.action === "continue-sequence") {
          continueSequence()
          return
        }

        clear()
      },
    )
    return outcome
  }

  private resolveDisambiguation(options: {
    event: TEvent
    focused: TTarget | null
    getSequence: () => ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]>
    exactBindings: readonly BindingState<TTarget, TEvent>[]
    continuationCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[]
    activeView: ReturnType<CommandCatalogService<TTarget, TEvent>["getActiveCommandView"]>
  }): InternalDisambiguationDecision | undefined {
    const activation = this.activation
    const runtime = this.runtime
    let sequence: ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]> | undefined
    let exact: readonly ActiveBinding<TTarget, TEvent>[] | undefined
    let continuations: readonly ActiveKey<TTarget, TEvent>[] | undefined
    let strokePart: KeyDisambiguationContext<TTarget, TEvent>["stroke"] | undefined

    const ctx: KeyDisambiguationContext<TTarget, TEvent> = {
      event: options.event as Readonly<Omit<TEvent, "preventDefault" | "stopPropagation">>,
      focused: options.focused,
      get sequence() {
        sequence ??= cloneKeySequence(options.getSequence())
        return sequence
      },
      get stroke() {
        const stroke = options.getSequence().at(-1)
        if (!stroke) {
          throw new Error("Disambiguation context expected a non-empty sequence")
        }

        strokePart ??= {
          ...stroke,
          stroke: cloneKeyStroke(stroke.stroke),
        }

        return strokePart
      },
      get exact() {
        exact ??= activation
          .collectActiveBindings(options.exactBindings, options.focused, options.activeView)
          .map((binding) => ({
            ...binding,
            sequence: cloneKeySequence(binding.sequence),
          }))

        return exact
      },
      get continuations() {
        continuations ??= activation.getActiveKeysForCaptures(options.continuationCaptures, {
          includeBindings: true,
          includeMetadata: true,
        })

        return continuations
      },
      getData: (name) => {
        return runtime.getData(name)
      },
      setData: (name, value) => {
        runtime.setData(name, value)
      },
      runExact: () => createSyncDecision("run-exact"),
      continueSequence: () => createSyncDecision("continue-sequence"),
      clear: () => createSyncDecision("clear"),
      defer: (run) => createSyncDecision("defer", run),
    }

    for (const resolver of this.state.dispatch.disambiguationResolvers.values()) {
      let result: KeyDisambiguationDecision | undefined

      try {
        result = resolver(ctx)
      } catch (error) {
        this.notify.emitError("disambiguation-resolver-error", error, "[Keymap] Error in disambiguation resolver:")
        continue
      }

      if (result === undefined) {
        continue
      }

      if (isPromiseLike(result)) {
        this.notify.emitError(
          "invalid-disambiguation-resolver-return",
          result,
          "[Keymap] Disambiguation resolvers must return synchronously; use ctx.defer(...) for async handling",
        )
        continue
      }

      if (!isSyncDecision(result)) {
        this.notify.emitError(
          "invalid-disambiguation-decision",
          result,
          "[Keymap] Invalid disambiguation decision returned by resolver:",
        )
        continue
      }

      return result
    }

    return undefined
  }

  private scheduleDeferredDisambiguation(
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    handler: KeyDeferredDisambiguationHandler<TTarget, TEvent>,
    focused: TTarget | null,
    sequence: ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]>,
    apply: (decision: InternalDeferredDisambiguationDecision | void) => void,
  ): void {
    this.cancelPendingDisambiguation()

    const controller = new AbortController()
    const pending: PendingDisambiguation<TTarget, TEvent> = {
      id: this.nextPendingDisambiguationId++,
      controller,
      captures,
      apply,
    }
    this.pendingDisambiguation = pending

    queueMicrotask(() => {
      this.executeDeferredDisambiguation(pending, handler, focused, sequence)
    })
  }

  private executeDeferredDisambiguation(
    pending: PendingDisambiguation<TTarget, TEvent>,
    handler: KeyDeferredDisambiguationHandler<TTarget, TEvent>,
    focused: TTarget | null,
    sequence: ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]>,
  ): void {
    if (!this.isPendingDisambiguationCurrent(pending)) {
      return
    }

    const ctx: KeyDeferredDisambiguationContext<TTarget, TEvent> = {
      signal: pending.controller.signal,
      sequence: cloneKeySequence(sequence),
      focused,
      sleep: (ms) => {
        return this.sleepWithSignal(ms, pending.controller.signal)
      },
      runExact: () => createDeferredDecision("run-exact"),
      continueSequence: () => createDeferredDecision("continue-sequence"),
      clear: () => createDeferredDecision("clear"),
    }

    let result: KeyDeferredDisambiguationDecision | void | Promise<KeyDeferredDisambiguationDecision | void>
    try {
      result = handler(ctx)
    } catch (error) {
      if (this.isPendingDisambiguationCurrent(pending)) {
        this.notify.emitError(
          "deferred-disambiguation-error",
          error,
          "[Keymap] Error in deferred disambiguation handler:",
        )
        this.finishPendingDisambiguation(pending)
      }
      return
    }

    if (isPromiseLike(result)) {
      result
        .then((resolved) => {
          this.applyDeferredDisambiguationResult(pending, resolved)
        })
        .catch((error) => {
          if (!this.isPendingDisambiguationCurrent(pending)) {
            return
          }

          this.notify.emitError(
            "deferred-disambiguation-error",
            error,
            "[Keymap] Error in deferred disambiguation handler:",
          )
          this.finishPendingDisambiguation(pending)
        })
      return
    }

    this.applyDeferredDisambiguationResult(pending, result)
  }

  private applyDeferredDisambiguationResult(
    pending: PendingDisambiguation<TTarget, TEvent>,
    result: KeyDeferredDisambiguationDecision | void,
  ): void {
    if (!this.isPendingDisambiguationCurrent(pending)) {
      return
    }

    if (result !== undefined && !isDeferredDecision(result)) {
      this.notify.emitError(
        "invalid-deferred-disambiguation-decision",
        result,
        "[Keymap] Invalid deferred disambiguation decision returned by handler:",
      )
      this.finishPendingDisambiguation(pending)
      return
    }

    this.finishPendingDisambiguation(pending)
    pending.apply(result as InternalDeferredDisambiguationDecision | void)
  }

  private finishPendingDisambiguation(pending: PendingDisambiguation<TTarget, TEvent>): void {
    if (!this.isPendingDisambiguationCurrent(pending)) {
      return
    }

    this.pendingDisambiguation = null
  }

  private cancelPendingDisambiguation(): void {
    const pending = this.pendingDisambiguation
    if (!pending) {
      return
    }

    this.pendingDisambiguation = null
    pending.controller.abort()
  }

  private isPendingDisambiguationCurrent(pending: PendingDisambiguation<TTarget, TEvent>): boolean {
    return this.pendingDisambiguation === pending
  }

  private sleepWithSignal(ms: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) {
      return Promise.resolve(false)
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(
        () => {
          signal.removeEventListener("abort", onAbort)
          resolve(true)
        },
        Math.max(0, ms),
      )

      const onAbort = () => {
        clearTimeout(timeout)
        signal.removeEventListener("abort", onAbort)
        resolve(false)
      }

      signal.addEventListener("abort", onAbort, { once: true })
    })
  }

  private warnUnresolvedAmbiguity(
    sequence: ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]>,
  ): void {
    const display = stringifyKeySequence(sequence, { preferDisplay: true })

    this.notify.warnOnce(
      `unresolved-disambiguation:${display}`,
      "unresolved-disambiguation",
      { sequence: display },
      `[Keymap] Ambiguous exact/prefix sequence "${display}" fell back to prefix handling because no disambiguation resolver resolved it`,
    )
  }

  private collectPendingCapturesFromRoot(
    activeLayers: RegisteredLayer<TTarget, TEvent>[],
    startIndex: number,
    matchKeys: readonly KeyMatch[],
    event: TEvent,
    focused: TTarget | null,
  ): PendingSequenceCapture<TTarget, TEvent>[] {
    const captures: PendingSequenceCapture<TTarget, TEvent>[] = []
    const hasLayerConditions = this.state.layers.layersWithConditions > 0

    for (let index = startIndex; index < activeLayers.length; index += 1) {
      const layer = activeLayers[index]
      if (!layer || (layer.root.children.size === 0 && layer.root.patternChildren.length === 0)) {
        continue
      }

      if (hasLayerConditions && !this.conditions.hasNoConditions(layer) && !this.conditions.matchesConditions(layer)) {
        continue
      }

      const advanced = this.advanceCapture({ layer, node: layer.root }, matchKeys, event, focused)
      if (!advanced || !this.nodeHasContinuations(advanced.capture.node, advanced.capture)) {
        continue
      }

      captures.push(advanced.capture)
    }

    return captures
  }

  private collectPendingCapturesFromAdvanced(
    advancedCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    startIndex: number,
  ): PendingSequenceCapture<TTarget, TEvent>[] {
    return advancedCaptures.filter((candidate, candidateIndex) => {
      return candidateIndex >= startIndex && this.nodeHasContinuations(candidate.node, candidate)
    })
  }

  private resolveEventMatchKeys(event: TEvent): KeyMatch[] {
    const resolvers = this.state.dispatch.eventMatchResolvers.values()

    if (resolvers.length === 0) {
      return []
    }

    if (resolvers.length === 1) {
      return resolveSingleEventMatchKeys(resolvers[0]!, event, this.eventMatchResolverContext, this.notify)
    }

    const keys: KeyMatch[] = []
    const seen = new Set<KeyMatch>()

    for (const resolver of resolvers) {
      let resolved: readonly KeyMatch[] | undefined

      try {
        resolved = resolver(event, this.eventMatchResolverContext)
      } catch (error) {
        this.notify.emitError("event-match-resolver-error", error, "[Keymap] Error in event match resolver:")
        continue
      }

      if (!resolved || resolved.length === 0) {
        continue
      }

      for (const candidate of resolved) {
        if (typeof candidate !== "string") {
          this.notify.emitError(
            "invalid-event-match-resolver-candidate",
            candidate,
            "[Keymap] Invalid event match resolver candidate:",
          )
          continue
        }

        if (seen.has(candidate)) {
          continue
        }

        seen.add(candidate)
        keys.push(candidate)
      }
    }

    return keys
  }

  private runReleaseBindings(
    layer: RegisteredLayer<TTarget, TEvent>,
    strokeKey: KeyMatch,
    event: TEvent,
    focused: TTarget | null,
  ): { handled: boolean; stop: boolean; outcome: KeyDispatchOutcome } {
    let handled = false
    let outcome = this.noMatchOutcome()

    for (const binding of layer.bindingStates) {
      if (binding.event !== "release") {
        continue
      }

      const firstPart = binding.sequence[0]
      if (!firstPart || firstPart.match !== strokeKey) {
        continue
      }

      if (!this.conditions.matchesConditions(binding)) {
        continue
      }

      const bindingHandled = this.executor.runBinding(layer, binding, event, focused)
      outcome = this.preferDispatchOutcome(outcome, this.createBindingOutcome(binding, bindingHandled))
      if (!bindingHandled) {
        this.emitBindingDispatch("binding-reject", layer, binding, focused)
        continue
      }

      this.emitBindingDispatch("binding-execute", layer, binding, focused)
      handled = true
      if (!binding.fallthrough) {
        return { handled: true, stop: true, outcome }
      }
    }

    return { handled, stop: false, outcome }
  }

  private nodeHasContinuations(
    node: SequenceNode<TTarget, TEvent>,
    capture?: PendingSequenceCapture<TTarget, TEvent>,
  ): boolean {
    if (node.children.size > 0 || node.patternChildren.length > 0) {
      return true
    }

    return !!node.pattern && !!capture && this.getPatternCaptureCount(capture) < node.pattern.max
  }

  private getPatternCaptureCount(capture: PendingSequenceCapture<TTarget, TEvent>): number {
    const pattern = capture.node.pattern
    if (!pattern) {
      return 0
    }

    for (let index = (capture.patterns?.length ?? 0) - 1; index >= 0; index -= 1) {
      const captured = capture.patterns?.[index]
      if (captured?.name === pattern.name) {
        return captured.values.length
      }
    }

    return 0
  }

  private patternHasMinimum(capture: PendingSequenceCapture<TTarget, TEvent>): boolean {
    const pattern = capture.node.pattern
    if (!pattern) {
      return true
    }

    return this.getPatternCaptureCount(capture) >= pattern.min
  }

  private matchPattern(
    pattern: NonNullable<SequenceNode<TTarget, TEvent>["pattern"]>,
    event: TEvent,
  ): SequencePatternMatch | undefined {
    try {
      return pattern.matcher(event)
    } catch (error) {
      this.notify.emitError("sequence-pattern-match-error", error, `[Keymap] Error matching sequence pattern "${pattern.name}":`)
      return undefined
    }
  }

  private createPatternEventPart(
    event: TEvent,
    pattern: NonNullable<SequenceNode<TTarget, TEvent>["pattern"]>,
    match: SequencePatternMatch,
  ): KeySequencePart {
    const part = createKeySequencePart(
      {
        name: event.name,
        ctrl: event.ctrl,
        shift: event.shift,
        meta: event.meta,
        super: event.super ?? false,
        hyper: event.hyper || undefined,
      },
      { display: match.display ?? String(match.value ?? event.name), tokenName: pattern.name },
    )

    return { ...part, patternName: pattern.name, payloadKey: pattern.payloadKey }
  }

  private appendPatternCapture(
    capture: PendingSequenceCapture<TTarget, TEvent>,
    node: SequenceNode<TTarget, TEvent>,
    event: TEvent,
    match: SequencePatternMatch,
  ): PendingSequenceCapture<TTarget, TEvent> {
    const pattern = node.pattern
    if (!pattern) {
      return { ...capture, node }
    }

    const part = this.createPatternEventPart(event, pattern, match)
    const value = Object.prototype.hasOwnProperty.call(match, "value") ? match.value : event.name
    const patterns = [...(capture.patterns ?? [])]
    const last = patterns.at(-1)

    if (last?.name === pattern.name) {
      patterns[patterns.length - 1] = {
        ...last,
        values: [...last.values, value],
        parts: [...last.parts, part],
      }
    } else {
      patterns.push({
        name: pattern.name,
        payloadKey: pattern.payloadKey,
        values: [value],
        parts: [part],
      })
    }

    return {
      layer: capture.layer,
      node,
      patterns,
    }
  }

  private advanceCapture(
    capture: PendingSequenceCapture<TTarget, TEvent>,
    matchKeys: readonly KeyMatch[],
    event: TEvent,
    focused: TTarget | null,
  ): AdvancedCapture<TTarget, TEvent> | undefined {
    const currentPattern = capture.node.pattern
    if (currentPattern && this.getPatternCaptureCount(capture) < currentPattern.max) {
      const patternMatch = this.matchPattern(currentPattern, event)
      if (patternMatch) {
        return {
          capture: this.appendPatternCapture(capture, capture.node, event, patternMatch),
          consumed: true,
        }
      }
    }

    if (!this.patternHasMinimum(capture)) {
      return undefined
    }

    const staticChild = this.getReachableChild(capture.node, matchKeys, focused)
    if (staticChild) {
      return {
        capture: {
          layer: capture.layer,
          node: staticChild,
          patterns: capture.patterns,
        },
        consumed: true,
      }
    }

    for (const child of capture.node.patternChildren) {
      const pattern = child.pattern
      if (!pattern || !this.activation.nodeHasReachableBindings(child, focused)) {
        continue
      }

      const patternMatch = this.matchPattern(pattern, event)
      if (!patternMatch) {
        continue
      }

      return {
        capture: this.appendPatternCapture(capture, child, event, patternMatch),
        consumed: true,
      }
    }

    return undefined
  }

  private createSequencePayload(capture?: PendingSequenceCapture<TTarget, TEvent>): unknown {
    if (!capture?.patterns || capture.patterns.length === 0) {
      return undefined
    }

    const payload: Record<string, unknown> = {}
    for (const captured of capture.patterns) {
      const pattern = this.state.environment.sequencePatterns.get(captured.name)
      let value: unknown

      try {
        value = pattern?.finalize ? pattern.finalize(captured.values) : captured.values.length === 1 ? captured.values[0] : [...captured.values]
      } catch (error) {
        this.notify.emitError(
          "sequence-pattern-finalize-error",
          error,
          `[Keymap] Error finalizing sequence pattern "${captured.name}":`,
        )
        continue
      }

      const existing = payload[captured.payloadKey]
      if (existing === undefined) {
        payload[captured.payloadKey] = value
      } else if (Array.isArray(existing)) {
        existing.push(value)
      } else {
        payload[captured.payloadKey] = [existing, value]
      }
    }

    return Object.keys(payload).length > 0 ? payload : undefined
  }

  private getReachableChild(
    node: SequenceNode<TTarget, TEvent>,
    matchKeys: readonly KeyMatch[],
    focused: TTarget | null,
  ): SequenceNode<TTarget, TEvent> | undefined {
    for (const strokeKey of matchKeys) {
      const child = node.children.get(strokeKey)
      if (!child || !this.activation.nodeHasReachableBindings(child, focused)) {
        continue
      }

      return child
    }

    return undefined
  }

  private runBindings(
    layer: RegisteredLayer<TTarget, TEvent>,
    bindings: BindingState<TTarget, TEvent>[],
    event: TEvent,
    focused: TTarget | null,
    payload?: unknown,
  ): { handled: boolean; stop: boolean; outcome: KeyDispatchOutcome } {
    let handled = false
    let outcome = this.noMatchOutcome()

    for (const binding of bindings) {
      if (!this.conditions.matchesConditions(binding)) {
        continue
      }

      const bindingHandled = this.executor.runBinding(layer, binding, event, focused, payload)
      outcome = this.preferDispatchOutcome(outcome, this.createBindingOutcome(binding, bindingHandled))
      if (!bindingHandled) {
        this.emitBindingDispatch("binding-reject", layer, binding, focused)
        continue
      }

      this.emitBindingDispatch("binding-execute", layer, binding, focused)
      handled = true
      if (!binding.fallthrough) {
        return { handled: true, stop: true, outcome }
      }
    }

    return { handled, stop: false, outcome }
  }
}

function resolveSingleEventMatchKeys<TTarget extends object, TEvent extends KeymapEvent>(
  resolver: EventMatchResolver<TEvent>,
  event: TEvent,
  ctx: EventMatchResolverContext,
  notify: NotificationService<TTarget, TEvent>,
): KeyMatch[] {
  let resolved: readonly KeyMatch[] | undefined
  try {
    resolved = resolver(event, ctx)
  } catch (error) {
    notify.emitError("event-match-resolver-error", error, "[Keymap] Error in event match resolver:")
    return []
  }

  if (!resolved || resolved.length === 0) {
    return []
  }

  if (resolved.length === 1) {
    const [candidate] = resolved
    if (typeof candidate !== "string") {
      notify.emitError(
        "invalid-event-match-resolver-candidate",
        candidate,
        "[Keymap] Invalid event match resolver candidate:",
      )
      return []
    }

    return [candidate]
  }

  const keys: KeyMatch[] = []
  const seen = new Set<KeyMatch>()
  for (const candidate of resolved) {
    if (typeof candidate !== "string") {
      notify.emitError(
        "invalid-event-match-resolver-candidate",
        candidate,
        "[Keymap] Invalid event match resolver candidate:",
      )
      continue
    }

    if (seen.has(candidate)) {
      continue
    }

    seen.add(candidate)
    keys.push(candidate)
  }

  return keys
}
