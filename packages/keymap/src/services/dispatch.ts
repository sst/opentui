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
  #eventMatchResolverContext: EventMatchResolverContext
  #pendingDisambiguation: PendingDisambiguation<TTarget, TEvent> | null = null
  #nextPendingDisambiguationId = 0
  #state: State<TTarget, TEvent>
  #notify: NotificationService<TTarget, TEvent>
  #runtime: RuntimeService<TTarget, TEvent>
  #activation: ActivationService<TTarget, TEvent>
  #conditions: ConditionService<TTarget, TEvent>
  #executor: CommandExecutorService<TTarget, TEvent>
  #compiler: CompilerService<TTarget, TEvent>
  #catalog: CommandCatalogService<TTarget, TEvent>
  #layers: LayerService<TTarget, TEvent>
  #hooks: Emitter<Hooks<TTarget, TEvent>>

  constructor(
    state: State<TTarget, TEvent>,
    notify: NotificationService<TTarget, TEvent>,
    runtime: RuntimeService<TTarget, TEvent>,
    activation: ActivationService<TTarget, TEvent>,
    conditions: ConditionService<TTarget, TEvent>,
    executor: CommandExecutorService<TTarget, TEvent>,
    compiler: CompilerService<TTarget, TEvent>,
    catalog: CommandCatalogService<TTarget, TEvent>,
    layers: LayerService<TTarget, TEvent>,
    hooks: Emitter<Hooks<TTarget, TEvent>>,
  ) {
    this.#state = state
    this.#notify = notify
    this.#runtime = runtime
    this.#activation = activation
    this.#conditions = conditions
    this.#executor = executor
    this.#compiler = compiler
    this.#catalog = catalog
    this.#layers = layers
    this.#hooks = hooks
    this.#eventMatchResolverContext = {
      resolveKey: (key) => {
        return this.#compiler.parseTokenKey(key).match
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
      return this.#state.dispatch.keyHooks.register(fn as (ctx: KeyInputContext<TEvent>) => void, {
        priority: keyOptions?.priority ?? 0,
        release: keyOptions?.release ?? false,
      })
    }

    if (name === "key:after") {
      const keyOptions = options as KeyInterceptOptions | undefined
      return this.#state.dispatch.keyAfterHooks.register(fn as (ctx: KeyAfterInputContext<TTarget, TEvent>) => void, {
        priority: keyOptions?.priority ?? 0,
        release: keyOptions?.release ?? false,
      })
    }

    const rawOptions = options as RawInterceptOptions | undefined
    return this.#state.dispatch.rawHooks.register(fn as (ctx: RawInputContext) => void, {
      priority: rawOptions?.priority ?? 0,
    })
  }

  public prependEventMatchResolver(resolver: EventMatchResolver<TEvent>): () => void {
    return this.#state.dispatch.eventMatchResolvers.prepend(resolver)
  }

  public appendEventMatchResolver(resolver: EventMatchResolver<TEvent>): () => void {
    return this.#state.dispatch.eventMatchResolvers.append(resolver)
  }

  public clearEventMatchResolvers(): void {
    this.#state.dispatch.eventMatchResolvers.clear()
  }

  public prependDisambiguationResolver(resolver: KeyDisambiguationResolver<TTarget, TEvent>): () => void {
    return this.#mutateDisambiguationResolvers(
      () => this.#state.dispatch.disambiguationResolvers.prepend(resolver),
      resolver,
    )
  }

  public appendDisambiguationResolver(resolver: KeyDisambiguationResolver<TTarget, TEvent>): () => void {
    return this.#mutateDisambiguationResolvers(
      () => this.#state.dispatch.disambiguationResolvers.append(resolver),
      resolver,
    )
  }

  public clearDisambiguationResolvers(): void {
    if (!this.#state.dispatch.disambiguationResolvers.has()) {
      return
    }

    this.#notify.runWithStateChangeBatch(() => {
      this.#state.dispatch.disambiguationResolvers.clear()
      this.#layers.recompileBindings()
    })
  }

  public handlePendingSequenceChange(
    _previous: PendingSequenceState<TTarget, TEvent> | null,
    _next: PendingSequenceState<TTarget, TEvent> | null,
  ): void {
    if (!this.#pendingDisambiguation) {
      return
    }

    this.#cancelPendingDisambiguation()
  }

  public handleRawSequence(sequence: string): boolean {
    const hooks = this.#state.dispatch.rawHooks.entries()
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
        this.#notify.emitError("raw-intercept-error", error, "[Keymap] Error in raw intercept listener:")
      }

      if (stopped) {
        return true
      }
    }

    return false
  }

  #createDispatchBinding(
    binding: BindingState<TTarget, TEvent>,
    focused: TTarget | null,
  ): DispatchBinding<TTarget, TEvent> {
    return {
      sequence: cloneKeySequence(binding.sequence),
      command: binding.command,
      commandAttrs: this.#catalog.getBindingCommandAttrs(binding, focused, this.#catalog.getActiveCommandView(focused)),
      attrs: binding.attrs,
      event: binding.event,
      preventDefault: binding.preventDefault,
      fallthrough: binding.fallthrough,
      sourceLayerOrder: binding.sourceLayerOrder,
      bindingIndex: binding.bindingIndex,
    }
  }

  #emitDispatchEvent(event: DispatchEvent<TTarget, TEvent>): void {
    if (!this.#hooks.has("dispatch")) {
      return
    }

    this.#hooks.emit("dispatch", event)
  }

  #emitBindingDispatch(
    phase: "binding-execute" | "binding-reject",
    layer: RegisteredLayer<TTarget, TEvent>,
    binding: BindingState<TTarget, TEvent>,
    focused: TTarget | null,
  ): void {
    if (!this.#hooks.has("dispatch")) {
      return
    }

    this.#emitDispatchEvent({
      phase,
      event: binding.event,
      focused,
      layer: {
        order: layer.order,
        priority: layer.priority,
        target: layer.target,
        targetMode: layer.targetMode,
      },
      binding: this.#createDispatchBinding(binding, focused),
      sequence: cloneKeySequence(binding.sequence),
      command: binding.command,
    })
  }

  #emitSequenceDispatch(
    phase: "sequence-start" | "sequence-advance" | "sequence-clear",
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    focused: TTarget | null,
  ): void {
    if (!this.#hooks.has("dispatch")) {
      return
    }

    const first = captures[0]
    const sequence = captures.length > 0 ? this.#activation.collectSequencePartsFromPending({ captures }) : []

    this.#emitDispatchEvent({
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

  #getKeyAfterHooks(release: boolean): readonly KeyAfterHook<TTarget, TEvent>[] | undefined {
    const hooks = this.#state.dispatch.keyAfterHooks.entries()
    for (const hook of hooks) {
      if (hook.release === release) {
        return hooks
      }
    }

    return undefined
  }

  #createKeyAfterState(
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
      sequence: this.#materializeOutcomeSequence(outcome),
    }
  }

  #materializeOutcomeSequence(outcome: KeyDispatchOutcome): readonly KeySequencePart[] {
    if (outcome.sequence) {
      return cloneKeySequence(outcome.sequence)
    }

    if (outcome.captures) {
      return this.#activation.collectSequencePartsFromPending({ captures: outcome.captures })
    }

    return []
  }

  #createSequenceOutcome(
    reason: "sequence-pending" | "sequence-miss" | "sequence-cleared",
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
  ): KeyDispatchOutcome {
    return {
      handled: reason !== "sequence-miss",
      reason,
      captures,
    }
  }

  #createBindingOutcome(binding: BindingState<TTarget, TEvent>, handled: boolean): KeyDispatchOutcome {
    return {
      handled,
      reason: handled ? "binding-handled" : "binding-rejected",
      sequence: binding.sequence,
    }
  }

  #preferDispatchOutcome(current: KeyDispatchOutcome, next: KeyDispatchOutcome): KeyDispatchOutcome {
    if (next.handled || current.reason === "no-match") {
      return next
    }

    return current
  }

  #emitKeyAfter(
    hooks: readonly KeyAfterHook<TTarget, TEvent>[],
    after: KeyAfterDispatchState<TTarget, TEvent>,
  ): void {
    const context = this.#createKeyAfterContext(after)
    const release = after.eventType === "release"

    for (const hook of hooks) {
      if (hook.release !== release) {
        continue
      }

      try {
        hook.listener(context)
      } catch (error) {
        this.#notify.emitError("key-after-intercept-error", error, "[Keymap] Error in key:after intercept listener:")
      }
    }
  }

  #createKeyAfterContext(after: KeyAfterDispatchState<TTarget, TEvent>): KeyAfterInputContext<TTarget, TEvent> {
    return {
      event: after.event,
      eventType: after.eventType,
      focused: after.focused,
      handled: after.handled,
      reason: after.reason,
      sequence: after.sequence,
      pendingSequence: this.#activation.getPendingSequence(),
      setData: (name, value) => {
        this.#runtime.setData(name, value)
      },
      getData: (name) => {
        return this.#runtime.getData(name)
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

  #noMatchOutcome(): KeyDispatchOutcome {
    return { handled: false, reason: "no-match" }
  }

  #consumeSequenceEvent(event: TEvent): void {
    event.preventDefault()
    event.stopPropagation()
  }

  #holdSequence(
    phase: "sequence-start" | "sequence-advance",
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    focused: TTarget | null,
    event: TEvent,
  ): KeyDispatchOutcome {
    this.#activation.setPendingSequence({ captures })
    const outcome = this.#createSequenceOutcome("sequence-pending", captures)
    this.#emitSequenceDispatch(phase, captures, focused)
    this.#consumeSequenceEvent(event)
    return outcome
  }

  #clearSequence(
    reason: "sequence-cleared",
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    focused: TTarget | null,
    event: TEvent,
  ): KeyDispatchOutcome {
    const outcome = this.#createSequenceOutcome(reason, captures)
    this.#emitSequenceDispatch("sequence-clear", captures, focused)
    this.#activation.setPendingSequence(null)
    this.#consumeSequenceEvent(event)
    return outcome
  }

  public handleKeyEvent(event: TEvent, release: boolean): void {
    if (!release) {
      this.#cancelPendingDisambiguation()
    }

    const afterHooks = this.#getKeyAfterHooks(release)
    const afterFocused = afterHooks ? this.#activation.getFocusedTarget() : null
    const hooks = this.#state.dispatch.keyHooks.entries()
    const context: KeyInputContext<TEvent> = {
      event,
      setData: (name, value) => {
        this.#runtime.setData(name, value)
      },
      getData: (name) => {
        return this.#runtime.getData(name)
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
        this.#notify.emitError("key-intercept-error", error, "[Keymap] Error in key intercept listener:")
      }

      if (event.propagationStopped) {
        if (afterHooks) {
          this.#emitKeyAfter(
            afterHooks,
            this.#createKeyAfterState(event, release, afterFocused, {
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
      const outcome = this.#dispatchReleaseLayers(event)
      if (afterHooks) {
        this.#emitKeyAfter(afterHooks, this.#createKeyAfterState(event, release, afterFocused, outcome))
      }
      return
    }

    const outcome = this.#dispatchLayers(event)
    if (afterHooks) {
      this.#emitKeyAfter(afterHooks, this.#createKeyAfterState(event, release, afterFocused, outcome))
    }
  }

  #mutateDisambiguationResolvers(
    register: () => () => void,
    resolver: KeyDisambiguationResolver<TTarget, TEvent>,
  ): () => void {
    return this.#notify.runWithStateChangeBatch(() => {
      const hadResolvers = this.#state.dispatch.disambiguationResolvers.has()
      const off = register()

      if (!hadResolvers && this.#state.dispatch.disambiguationResolvers.has()) {
        this.#layers.recompileBindings()
      }

      return () => {
        this.#notify.runWithStateChangeBatch(() => {
          const hadBeforeRemoval = this.#state.dispatch.disambiguationResolvers.has()
          off()

          if (this.#state.dispatch.disambiguationResolvers.values().includes(resolver)) {
            return
          }

          if (hadBeforeRemoval && !this.#state.dispatch.disambiguationResolvers.has()) {
            this.#layers.recompileBindings()
          }
        })
      }
    })
  }

  #dispatchReleaseLayers(event: TEvent): KeyDispatchOutcome {
    const focused = this.#activation.getFocusedTarget()
    const activeLayers = this.#activation.getActiveLayers(focused)
    const hasLayerConditions = this.#state.layers.layersWithConditions > 0
    const matchKeys = this.#resolveEventMatchKeys(event)
    let outcome = this.#noMatchOutcome()

    layerLoop: for (const layer of activeLayers) {
      if (layer.bindingStates.length === 0) {
        continue
      }

      if (hasLayerConditions && !this.#conditions.hasNoConditions(layer) && !this.#conditions.matchesConditions(layer)) {
        continue
      }

      for (const strokeKey of matchKeys) {
        const result = this.#runReleaseBindings(layer, strokeKey, event, focused)
        outcome = this.#preferDispatchOutcome(outcome, result.outcome)
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

  #dispatchLayers(event: TEvent): KeyDispatchOutcome {
    const focused = this.#activation.getFocusedTarget()
    const pending = this.#activation.ensureValidPendingSequence()
    const matchKeys = this.#resolveEventMatchKeys(event)

    if (pending) {
      return this.#dispatchPendingSequence(pending, matchKeys, event, focused)
    }

    const activeLayers = this.#activation.getActiveLayers(focused)
    return this.#dispatchFromRoot(activeLayers, matchKeys, event, focused)
  }

  #dispatchPendingSequence(
    pending: PendingSequenceState<TTarget, TEvent>,
    matchKeys: readonly KeyMatch[],
    event: TEvent,
    focused: TTarget | null,
  ): KeyDispatchOutcome {
    const activeView = this.#catalog.getActiveCommandView(focused)
    const advancedCaptures: PendingSequenceCapture<TTarget, TEvent>[] = []

    for (const capture of pending.captures) {
      const advanced = this.#advanceCapture(capture, matchKeys, event, activeView)
      if (!advanced) {
        continue
      }

      advancedCaptures.push(advanced)
    }

    const bestPriority = advancedCaptures.reduce(
      (best, capture) => Math.min(best, this.#getCapturePriority(capture, matchKeys)),
      Number.POSITIVE_INFINITY,
    )
    const prioritizedCaptures = advancedCaptures.filter((capture) => this.#getCapturePriority(capture, matchKeys) === bestPriority)

    if (prioritizedCaptures.length === 0 || !prioritizedCaptures.some((capture) => this.#captureIsReachable(capture, focused, activeView))) {
      const outcome = this.#createSequenceOutcome("sequence-miss", pending.captures)
      this.#emitSequenceDispatch("sequence-clear", pending.captures, focused)
      this.#activation.setPendingSequence(null)
      return outcome
    }

    return this.#dispatchPendingCapturesFromIndex(prioritizedCaptures, 0, false, event, focused)
  }

  #dispatchPendingCapturesFromIndex(
    advancedCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    startIndex: number,
    handledExact: boolean,
    event: TEvent,
    focused: TTarget | null,
  ): KeyDispatchOutcome {
    let hasHandledExact = handledExact
    let outcome = this.#noMatchOutcome()
    const processedExact = new Set<PendingSequenceCapture<TTarget, TEvent>>()

    for (let index = startIndex; index < advancedCaptures.length; index += 1) {
      const capture = advancedCaptures[index]
      if (!capture || processedExact.has(capture)) {
        continue
      }

      const continuationCapturesForPrefix = this.#collectContinuationCapturesForPrefix(advancedCaptures, index, capture)
      if (continuationCapturesForPrefix.length > 0) {
        if (hasHandledExact) {
          continue
        }

        const exactCaptures = this.#collectExactCapturesForPrefix(advancedCaptures, capture)
        const resolvedOutcome = this.#tryResolvePendingAmbiguity(
          advancedCaptures,
          index,
          continuationCapturesForPrefix,
          exactCaptures,
          event,
          focused,
          hasHandledExact,
        )
        if (resolvedOutcome) {
          return resolvedOutcome
        }

        return this.#holdSequence("sequence-advance", continuationCapturesForPrefix, focused, event)
      }

      if (!this.#isCaptureExact(capture)) {
        continue
      }

      const exactCaptures = this.#collectExactCapturesForPrefix(advancedCaptures, capture)
      for (const exact of exactCaptures) processedExact.add(exact)
      const result = this.#runCaptureBindings(capture.layer, exactCaptures, event, focused)
      outcome = this.#preferDispatchOutcome(outcome, result.outcome)
      if (!result.handled) {
        continue
      }

      hasHandledExact = true
      if (result.stop) {
        this.#emitSequenceDispatch("sequence-clear", advancedCaptures, focused)
        this.#activation.setPendingSequence(null)
        return outcome
      }
    }

    this.#emitSequenceDispatch("sequence-clear", advancedCaptures, focused)
    this.#activation.setPendingSequence(null)
    return outcome
  }

  #dispatchFromRoot(
    activeLayers: RegisteredLayer<TTarget, TEvent>[],
    matchKeys: readonly KeyMatch[],
    event: TEvent,
    focused: TTarget | null,
  ): KeyDispatchOutcome {
    return this.#dispatchFromRootAtIndex(activeLayers, 0, matchKeys, event, focused)
  }

  #dispatchFromRootAtIndex(
    activeLayers: RegisteredLayer<TTarget, TEvent>[],
    startIndex: number,
    matchKeys: readonly KeyMatch[],
    event: TEvent,
    focused: TTarget | null,
  ): KeyDispatchOutcome {
    const hasLayerConditions = this.#state.layers.layersWithConditions > 0
    const activeView = this.#catalog.getActiveCommandView(focused)
    let outcome = this.#noMatchOutcome()

    for (let index = startIndex; index < activeLayers.length; index += 1) {
      const layer = activeLayers[index]
      if (!layer) {
        continue
      }

      if (hasLayerConditions && !this.#conditions.hasNoConditions(layer) && !this.#conditions.matchesConditions(layer)) {
        continue
      }

      const captures = this.#collectRootCaptures(layer, matchKeys, event, focused, activeView)
      if (captures.length === 0) {
        continue
      }

      const layerContinuationCaptures = captures.filter((capture) => this.#captureHasContinuations(capture))
      if (layerContinuationCaptures.length > 0) {
        const exactCaptures = captures.filter((capture) => this.#isCaptureExact(capture))
        const continuationCaptures = this.#collectPendingCapturesFromRoot(activeLayers, index, matchKeys, event, focused)
        const resolvedOutcome = this.#tryResolveRootAmbiguity(
          activeLayers,
          index,
          matchKeys,
          continuationCaptures,
          exactCaptures,
          event,
          focused,
        )
        if (resolvedOutcome) {
          return resolvedOutcome
        }

        return this.#holdSequence("sequence-start", continuationCaptures, focused, event)
      }

      const exactCaptures = captures.filter((capture) => this.#isCaptureExact(capture))
      const result = this.#runCaptureBindings(layer, exactCaptures, event, focused)
      outcome = this.#preferDispatchOutcome(outcome, result.outcome)
      if (!result.handled) {
        continue
      }

      if (result.stop) {
        return outcome
      }
    }

    return outcome
  }

  #tryResolveRootAmbiguity(
    activeLayers: RegisteredLayer<TTarget, TEvent>[],
    layerIndex: number,
    matchKeys: readonly KeyMatch[],
    continuationCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    exactCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    event: TEvent,
    focused: TTarget | null,
  ): KeyDispatchOutcome | undefined {
    const applyExact = (): KeyDispatchOutcome => {
      this.#activation.setPendingSequence(null)
      const layer = exactCaptures[0]?.layer
      if (!layer) return this.#noMatchOutcome()
      const result = this.#runCaptureBindings(layer, exactCaptures, event, focused)
      if (!result.stop) {
        return this.#preferDispatchOutcome(
          result.outcome,
          this.#dispatchFromRootAtIndex(activeLayers, layerIndex + 1, matchKeys, event, focused),
        )
      }

      return result.outcome
    }

    return this.#tryResolveAmbiguity({
      event,
      focused,
      continuationCaptures,
      exactBindingsSource: exactCaptures.map((capture) => capture.binding),
      sequencePhase: "sequence-start",
      runExact: applyExact,
    })
  }

  #tryResolvePendingAmbiguity(
    advancedCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    captureIndex: number,
    continuationCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    exactCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    event: TEvent,
    focused: TTarget | null,
    handledExact: boolean,
  ): KeyDispatchOutcome | undefined {
    const applyExact = (): KeyDispatchOutcome => {
      this.#activation.setPendingSequence(null)
      const layer = exactCaptures[0]?.layer
      if (!layer) return this.#noMatchOutcome()
      const result = this.#runCaptureBindings(layer, exactCaptures, event, focused)
      if (result.stop) {
        return result.outcome
      }

      return this.#preferDispatchOutcome(
        result.outcome,
        this.#dispatchPendingCapturesFromIndex(
          advancedCaptures,
          captureIndex + 1,
          handledExact || result.handled,
          event,
          focused,
        ),
      )
    }

    return this.#tryResolveAmbiguity({
      event,
      focused,
      continuationCaptures,
      exactBindingsSource: exactCaptures.map((capture) => capture.binding),
      sequencePhase: "sequence-advance",
      runExact: applyExact,
    })
  }

  #tryResolveAmbiguity(options: {
    event: TEvent
    focused: TTarget | null
    continuationCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[]
    exactBindingsSource: readonly BindingState<TTarget, TEvent>[]
    sequencePhase: "sequence-start" | "sequence-advance"
    runExact: () => KeyDispatchOutcome
  }): KeyDispatchOutcome | undefined {
    const { event, focused, continuationCaptures, exactBindingsSource, sequencePhase, runExact } = options

    if (!this.#state.dispatch.disambiguationResolvers.has() || continuationCaptures.length === 0) {
      return undefined
    }

    const activeView = this.#catalog.getActiveCommandView(focused)
    const exactBindings = this.#activation.collectMatchingBindings(exactBindingsSource, focused, activeView)
    if (!exactBindings.some((binding) => binding.command !== undefined)) {
      return undefined
    }

    const continueSequence = (): KeyDispatchOutcome => {
      return this.#holdSequence(sequencePhase, continuationCaptures, focused, event)
    }

    const clear = (): KeyDispatchOutcome => {
      return this.#clearSequence("sequence-cleared", continuationCaptures, focused, event)
    }

    let sequence: ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]> | undefined
    const getSequence = (): ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]> => {
      sequence ??= this.#activation.collectSequencePartsFromPending({ captures: continuationCaptures })
      return sequence
    }

    const decision = this.#resolveDisambiguation({
      event,
      focused,
      getSequence,
      exactBindings,
      continuationCaptures,
      activeView,
    })

    if (!decision) {
      this.#warnUnresolvedAmbiguity(getSequence())
      return continueSequence()
    }

    return this.#applySyncDecision(
      decision,
      continuationCaptures,
      runExact,
      continueSequence,
      clear,
      focused,
      getSequence,
    )
  }

  #applySyncDecision(
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
    this.#scheduleDeferredDisambiguation(
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

  #resolveDisambiguation(options: {
    event: TEvent
    focused: TTarget | null
    getSequence: () => ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]>
    exactBindings: readonly BindingState<TTarget, TEvent>[]
    continuationCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[]
    activeView: ReturnType<CommandCatalogService<TTarget, TEvent>["getActiveCommandView"]>
  }): InternalDisambiguationDecision | undefined {
    const activation = this.#activation
    const runtime = this.#runtime
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

    for (const resolver of this.#state.dispatch.disambiguationResolvers.values()) {
      let result: KeyDisambiguationDecision | undefined

      try {
        result = resolver(ctx)
      } catch (error) {
        this.#notify.emitError("disambiguation-resolver-error", error, "[Keymap] Error in disambiguation resolver:")
        continue
      }

      if (result === undefined) {
        continue
      }

      if (isPromiseLike(result)) {
        this.#notify.emitError(
          "invalid-disambiguation-resolver-return",
          result,
          "[Keymap] Disambiguation resolvers must return synchronously; use ctx.defer(...) for async handling",
        )
        continue
      }

      if (!isSyncDecision(result)) {
        this.#notify.emitError(
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

  #scheduleDeferredDisambiguation(
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    handler: KeyDeferredDisambiguationHandler<TTarget, TEvent>,
    focused: TTarget | null,
    sequence: ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]>,
    apply: (decision: InternalDeferredDisambiguationDecision | void) => void,
  ): void {
    this.#cancelPendingDisambiguation()

    const controller = new AbortController()
    const pending: PendingDisambiguation<TTarget, TEvent> = {
      id: this.#nextPendingDisambiguationId++,
      controller,
      captures,
      apply,
    }
    this.#pendingDisambiguation = pending

    queueMicrotask(() => {
      this.#executeDeferredDisambiguation(pending, handler, focused, sequence)
    })
  }

  #executeDeferredDisambiguation(
    pending: PendingDisambiguation<TTarget, TEvent>,
    handler: KeyDeferredDisambiguationHandler<TTarget, TEvent>,
    focused: TTarget | null,
    sequence: ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]>,
  ): void {
    if (!this.#isPendingDisambiguationCurrent(pending)) {
      return
    }

    const ctx: KeyDeferredDisambiguationContext<TTarget, TEvent> = {
      signal: pending.controller.signal,
      sequence: cloneKeySequence(sequence),
      focused,
      sleep: (ms) => {
        return this.#sleepWithSignal(ms, pending.controller.signal)
      },
      runExact: () => createDeferredDecision("run-exact"),
      continueSequence: () => createDeferredDecision("continue-sequence"),
      clear: () => createDeferredDecision("clear"),
    }

    let result: KeyDeferredDisambiguationDecision | void | Promise<KeyDeferredDisambiguationDecision | void>
    try {
      result = handler(ctx)
    } catch (error) {
      if (this.#isPendingDisambiguationCurrent(pending)) {
        this.#notify.emitError(
          "deferred-disambiguation-error",
          error,
          "[Keymap] Error in deferred disambiguation handler:",
        )
        this.#finishPendingDisambiguation(pending)
      }
      return
    }

    if (isPromiseLike(result)) {
      result
        .then((resolved) => {
          this.#applyDeferredDisambiguationResult(pending, resolved)
        })
        .catch((error) => {
          if (!this.#isPendingDisambiguationCurrent(pending)) {
            return
          }

          this.#notify.emitError(
            "deferred-disambiguation-error",
            error,
            "[Keymap] Error in deferred disambiguation handler:",
          )
          this.#finishPendingDisambiguation(pending)
        })
      return
    }

    this.#applyDeferredDisambiguationResult(pending, result)
  }

  #applyDeferredDisambiguationResult(
    pending: PendingDisambiguation<TTarget, TEvent>,
    result: KeyDeferredDisambiguationDecision | void,
  ): void {
    if (!this.#isPendingDisambiguationCurrent(pending)) {
      return
    }

    if (result !== undefined && !isDeferredDecision(result)) {
      this.#notify.emitError(
        "invalid-deferred-disambiguation-decision",
        result,
        "[Keymap] Invalid deferred disambiguation decision returned by handler:",
      )
      this.#finishPendingDisambiguation(pending)
      return
    }

    this.#finishPendingDisambiguation(pending)
    pending.apply(result as InternalDeferredDisambiguationDecision | void)
  }

  #finishPendingDisambiguation(pending: PendingDisambiguation<TTarget, TEvent>): void {
    if (!this.#isPendingDisambiguationCurrent(pending)) {
      return
    }

    this.#pendingDisambiguation = null
  }

  #cancelPendingDisambiguation(): void {
    const pending = this.#pendingDisambiguation
    if (!pending) {
      return
    }

    this.#pendingDisambiguation = null
    pending.controller.abort()
  }

  #isPendingDisambiguationCurrent(pending: PendingDisambiguation<TTarget, TEvent>): boolean {
    return this.#pendingDisambiguation === pending
  }

  #sleepWithSignal(ms: number, signal: AbortSignal): Promise<boolean> {
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

  #warnUnresolvedAmbiguity(
    sequence: ReturnType<ActivationService<TTarget, TEvent>["collectSequencePartsFromPending"]>,
  ): void {
    const display = stringifyKeySequence(sequence, { preferDisplay: true })

    this.#notify.warnOnce(
      `unresolved-disambiguation:${display}`,
      "unresolved-disambiguation",
      { sequence: display },
      `[Keymap] Ambiguous exact/prefix sequence "${display}" fell back to prefix handling because no disambiguation resolver resolved it`,
    )
  }

  #collectPendingCapturesFromRoot(
    activeLayers: RegisteredLayer<TTarget, TEvent>[],
    startIndex: number,
    matchKeys: readonly KeyMatch[],
    event: TEvent,
    focused: TTarget | null,
  ): PendingSequenceCapture<TTarget, TEvent>[] {
    const captures: PendingSequenceCapture<TTarget, TEvent>[] = []
    const hasLayerConditions = this.#state.layers.layersWithConditions > 0
    const activeView = this.#catalog.getActiveCommandView(focused)

    for (let index = startIndex; index < activeLayers.length; index += 1) {
      const layer = activeLayers[index]
      if (!layer) {
        continue
      }

      if (hasLayerConditions && !this.#conditions.hasNoConditions(layer) && !this.#conditions.matchesConditions(layer)) {
        continue
      }

      for (const capture of this.#collectRootCaptures(layer, matchKeys, event, focused, activeView)) {
        if (this.#captureHasContinuations(capture)) {
          captures.push(capture)
        }
      }
    }

    return captures
  }

  #collectPendingCapturesFromAdvanced(
    advancedCaptures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    startIndex: number,
  ): PendingSequenceCapture<TTarget, TEvent>[] {
    return advancedCaptures.filter((candidate, candidateIndex) => {
      return candidateIndex >= startIndex && this.#captureHasContinuations(candidate)
    })
  }

  #collectContinuationCapturesForPrefix(
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    startIndex: number,
    prefix: PendingSequenceCapture<TTarget, TEvent>,
  ): PendingSequenceCapture<TTarget, TEvent>[] {
    return captures.filter((candidate, candidateIndex) => {
      return candidateIndex >= startIndex && this.#captureHasContinuations(candidate) && sameParts(candidate.parts, prefix.parts)
    })
  }

  #collectExactCapturesForPrefix(
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    prefix: PendingSequenceCapture<TTarget, TEvent>,
  ): PendingSequenceCapture<TTarget, TEvent>[] {
    return captures.filter((capture) => {
      return capture.layer === prefix.layer && this.#isCaptureExact(capture) && sameParts(capture.parts, prefix.parts)
    })
  }

  #resolveEventMatchKeys(event: TEvent): KeyMatch[] {
    const resolvers = this.#state.dispatch.eventMatchResolvers.values()

    if (resolvers.length === 0) {
      return []
    }

    if (resolvers.length === 1) {
      return resolveSingleEventMatchKeys(resolvers[0]!, event, this.#eventMatchResolverContext, this.#notify)
    }

    const keys: KeyMatch[] = []
    const seen = new Set<KeyMatch>()

    for (const resolver of resolvers) {
      let resolved: readonly KeyMatch[] | undefined

      try {
        resolved = resolver(event, this.#eventMatchResolverContext)
      } catch (error) {
        this.#notify.emitError("event-match-resolver-error", error, "[Keymap] Error in event match resolver:")
        continue
      }

      if (!resolved || resolved.length === 0) {
        continue
      }

      for (const candidate of resolved) {
        if (typeof candidate !== "string") {
          this.#notify.emitError(
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

  #runReleaseBindings(
    layer: RegisteredLayer<TTarget, TEvent>,
    strokeKey: KeyMatch,
    event: TEvent,
    focused: TTarget | null,
  ): { handled: boolean; stop: boolean; outcome: KeyDispatchOutcome } {
    let handled = false
    let outcome = this.#noMatchOutcome()

    for (const binding of layer.bindingStates) {
      if (binding.event !== "release") {
        continue
      }

      const firstPart = binding.sequence[0]
      if (!firstPart || firstPart.match !== strokeKey) {
        continue
      }

      if (!this.#conditions.matchesConditions(binding)) {
        continue
      }

      const bindingHandled = this.#executor.runBinding(layer, binding, event, focused)
      outcome = this.#preferDispatchOutcome(outcome, this.#createBindingOutcome(binding, bindingHandled))
      if (!bindingHandled) {
        this.#emitBindingDispatch("binding-reject", layer, binding, focused)
        continue
      }

      this.#emitBindingDispatch("binding-execute", layer, binding, focused)
      handled = true
      if (!binding.fallthrough) {
        return { handled: true, stop: true, outcome }
      }
    }

    return { handled, stop: false, outcome }
  }

  #getPatternCaptureCount(capture: PendingSequenceCapture<TTarget, TEvent>): number {
    const part = capture.binding.sequence[capture.index]
    if (!part?.patternName) {
      return 0
    }

    const patterns = capture.patterns
    const captured = patterns?.[patterns.length - 1]
    return captured?.name === part.patternName ? captured.values.length : 0
  }

  #patternHasMinimum(capture: PendingSequenceCapture<TTarget, TEvent>): boolean {
    const part = capture.binding.sequence[capture.index]
    if (!part?.patternName) {
      return true
    }

    const pattern = this.#state.environment.sequencePatterns.get(part.patternName)
    if (!pattern) {
      return false
    }

    return this.#getPatternCaptureCount(capture) >= pattern.min
  }

  #matchPattern(
    patternName: string,
    event: TEvent,
  ): SequencePatternMatch | undefined {
    const pattern = this.#state.environment.sequencePatterns.get(patternName)
    if (!pattern) {
      return undefined
    }

    try {
      return pattern.matcher(event)
    } catch (error) {
      this.#notify.emitError(
        "sequence-pattern-match-error",
        error,
        `[Keymap] Error matching sequence pattern "${pattern.name}":`,
      )
      return undefined
    }
  }

  #createPatternEventPart(
    event: TEvent,
    patternName: string,
    match: SequencePatternMatch,
  ): KeySequencePart {
    const pattern = this.#state.environment.sequencePatterns.get(patternName)
    const payloadKey = pattern?.payloadKey ?? patternName
    const part = createKeySequencePart(
      {
        name: event.name,
        ctrl: event.ctrl,
        shift: event.shift,
        meta: event.meta,
        super: event.super ?? false,
        hyper: event.hyper || undefined,
      },
      { display: match.display ?? String(match.value ?? event.name) },
    )

    return { ...part, patternName, payloadKey }
  }

  #appendPatternCapture(
    capture: PendingSequenceCapture<TTarget, TEvent>,
    index: number,
    event: TEvent,
    match: SequencePatternMatch,
  ): PendingSequenceCapture<TTarget, TEvent> {
    const templatePart = capture.binding.sequence[index]
    const patternName = templatePart?.patternName
    if (!patternName) {
      return { ...capture, index }
    }

    const part = this.#createPatternEventPart(event, patternName, match)
    const value = match.value ?? event.name
    const patterns = [...(capture.patterns ?? [])]
    const last = patterns.at(-1)

    if (last?.name === patternName) {
      patterns[patterns.length - 1] = {
        ...last,
        values: [...last.values, value],
        parts: [...last.parts, part],
      }
    } else {
      patterns.push({
        name: patternName,
        payloadKey: part.payloadKey ?? patternName,
        values: [value],
        parts: [part],
      })
    }

    return {
      layer: capture.layer,
      binding: capture.binding,
      index,
      parts: [...capture.parts, part],
      patterns,
    }
  }

  #collectRootCaptures(
    layer: RegisteredLayer<TTarget, TEvent>,
    matchKeys: readonly KeyMatch[],
    event: TEvent,
    focused: TTarget | null,
    activeView: ReturnType<CommandCatalogService<TTarget, TEvent>["getActiveCommandView"]>,
  ): PendingSequenceCapture<TTarget, TEvent>[] {
    const captures: PendingSequenceCapture<TTarget, TEvent>[] = []
    let bestPriority = Number.POSITIVE_INFINITY
    for (const binding of layer.bindingStates) {
      if (binding.event !== "press") {
        continue
      }

      const capture = this.#advanceBindingAtIndex(layer, binding, 0, [], undefined, matchKeys, event)
      if (capture) {
        const priority = this.#getCapturePriority(capture, matchKeys)
        if (priority < bestPriority) {
          bestPriority = priority
          captures.length = 0
        }

        if (priority === bestPriority) {
          captures.push(capture)
        }
      }
    }

    return captures.some((capture) => this.#captureIsReachable(capture, focused, activeView)) ? captures : []
  }

  #advanceCapture(
    capture: PendingSequenceCapture<TTarget, TEvent>,
    matchKeys: readonly KeyMatch[],
    event: TEvent,
    activeView: ReturnType<CommandCatalogService<TTarget, TEvent>["getActiveCommandView"]>,
  ): PendingSequenceCapture<TTarget, TEvent> | undefined {
    const currentPart = capture.binding.sequence[capture.index]
    if (currentPart?.patternName) {
      const pattern = this.#state.environment.sequencePatterns.get(currentPart.patternName)
      if (pattern && this.#getPatternCaptureCount(capture) < pattern.max) {
        const patternMatch = this.#matchPattern(pattern.name, event)
        if (patternMatch) {
          return this.#appendPatternCapture(capture, capture.index, event, patternMatch)
        }
      }

      if (!this.#patternHasMinimum(capture)) {
        return undefined
      }

      return this.#advanceBindingAtIndex(
        capture.layer,
        capture.binding,
        capture.index + 1,
        capture.parts,
        capture.patterns,
        matchKeys,
        event,
      )
    }

    return this.#advanceBindingAtIndex(
      capture.layer,
      capture.binding,
      capture.index + 1,
      capture.parts,
      capture.patterns,
      matchKeys,
      event,
    )
  }

  #advanceBindingAtIndex(
    layer: RegisteredLayer<TTarget, TEvent>,
    binding: BindingState<TTarget, TEvent>,
    index: number,
    parts: readonly KeySequencePart[],
    patterns: readonly PendingSequencePatternCapture[] | undefined,
    matchKeys: readonly KeyMatch[],
    event: TEvent,
  ): PendingSequenceCapture<TTarget, TEvent> | undefined {
    const part = binding.sequence[index]
    if (!part) {
      return undefined
    }

    if (part.patternName) {
      const patternMatch = this.#matchPattern(part.patternName, event)
      if (patternMatch) {
        return this.#appendPatternCapture({ layer, binding, index, parts, patterns }, index, event, patternMatch)
      }

      return undefined
    }

    if (!matchKeys.includes(part.match)) {
      return undefined
    }

    return {
      layer,
      binding,
      index,
      parts: [...parts, part],
      patterns,
    }
  }

  #createSequencePayload(capture?: PendingSequenceCapture<TTarget, TEvent>): unknown {
    if (!capture?.patterns || capture.patterns.length === 0) {
      return undefined
    }

    const payload: Record<string, unknown> = {}
    let hasPayload = false
    for (const captured of capture.patterns) {
      const pattern = this.#state.environment.sequencePatterns.get(captured.name)
      let value: unknown

      try {
        value = pattern?.finalize
          ? pattern.finalize(captured.values)
          : captured.values.length === 1
            ? captured.values[0]
            : [...captured.values]
      } catch (error) {
        this.#notify.emitError(
          "sequence-pattern-finalize-error",
          error,
          `[Keymap] Error finalizing sequence pattern "${captured.name}":`,
        )
        continue
      }

      const existing = payload[captured.payloadKey]
      if (existing === undefined) {
        payload[captured.payloadKey] = value
        hasPayload = true
      } else if (Array.isArray(existing)) {
        existing.push(value)
      } else {
        payload[captured.payloadKey] = [existing, value]
      }
    }

    return hasPayload ? payload : undefined
  }

  #isCaptureExact(capture: PendingSequenceCapture<TTarget, TEvent>): boolean {
    return capture.index === capture.binding.sequence.length - 1 && this.#patternHasMinimum(capture)
  }

  #captureHasContinuations(capture: PendingSequenceCapture<TTarget, TEvent>): boolean {
    const part = capture.binding.sequence[capture.index]
    if (part?.patternName) {
      const pattern = this.#state.environment.sequencePatterns.get(part.patternName)
      if (pattern && this.#getPatternCaptureCount(capture) < pattern.max) {
        return true
      }
    }

    return this.#patternHasMinimum(capture) && capture.index + 1 < capture.binding.sequence.length
  }

  #bindingMatchesRuntimeState(
    binding: BindingState<TTarget, TEvent>,
    focused: TTarget | null,
    activeView: ReturnType<CommandCatalogService<TTarget, TEvent>["getActiveCommandView"]>,
  ): boolean {
    return this.#conditions.matchesConditions(binding) && this.#catalog.isBindingVisible(binding, focused, activeView)
  }

  #captureIsReachable(
    capture: PendingSequenceCapture<TTarget, TEvent>,
    focused: TTarget | null,
    activeView: ReturnType<CommandCatalogService<TTarget, TEvent>["getActiveCommandView"]>,
  ): boolean {
    return this.#bindingMatchesRuntimeState(capture.binding, focused, activeView)
  }

  #getCapturePriority(capture: PendingSequenceCapture<TTarget, TEvent>, matchKeys: readonly KeyMatch[]): number {
    const part = capture.parts.at(-1)
    if (!part || part.patternName) {
      return matchKeys.length
    }

    const index = matchKeys.indexOf(part.match)
    return index === -1 ? matchKeys.length : index
  }

  #runCaptureBindings(
    layer: RegisteredLayer<TTarget, TEvent>,
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    event: TEvent,
    focused: TTarget | null,
  ): { handled: boolean; stop: boolean; outcome: KeyDispatchOutcome } {
    let handled = false
    let outcome = this.#noMatchOutcome()

    for (const capture of captures) {
      const binding = capture.binding
      if (!this.#conditions.matchesConditions(binding)) {
        continue
      }

      const bindingHandled = this.#executor.runBinding(layer, binding, event, focused, this.#createSequencePayload(capture))
      outcome = this.#preferDispatchOutcome(outcome, this.#createBindingOutcome(binding, bindingHandled))
      if (!bindingHandled) {
        this.#emitBindingDispatch("binding-reject", layer, binding, focused)
        continue
      }

      this.#emitBindingDispatch("binding-execute", layer, binding, focused)
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

function sameParts(left: readonly KeySequencePart[], right: readonly KeySequencePart[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.match !== right[index]?.match) {
      return false
    }
  }

  return true
}
