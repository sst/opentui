import type {
  ActiveBinding,
  ActiveKey,
  ActiveKeyOptions,
  BindingExpander,
  BindingParser,
  BindingFieldCompiler,
  LayerBindingsTransformer,
  BindingTransformer,
  Events,
  Hooks,
  CommandFieldCompiler,
  CommandBindingsQuery,
  CommandEntry,
  CommandQuery,
  CommandRecord,
  KeymapEvent,
  KeymapHost,
  LayerAnalyzer,
  Listener,
  RunCommandOptions,
  RunCommandResult,
  CommandResolver,
  KeyInterceptOptions,
  KeyInputContext,
  Layer,
  LayerFieldCompiler,
  KeyDisambiguationResolver,
  RawInterceptOptions,
  RawInputContext,
  EventMatchResolver,
  KeyMatch,
  KeyStringifyInput,
  KeyToken,
  KeyLike,
  KeySequencePart,
  StringifyOptions,
} from "./types.js"
import { ActivationService } from "./services/activation.js"
import { CommandCatalogService } from "./services/command-catalog.js"
import { CommandExecutorService } from "./services/command-executor.js"
import { CompilerService } from "./services/compiler.js"
import { ConditionService } from "./services/conditions.js"
import { DispatchService } from "./services/dispatch.js"
import { EnvironmentService } from "./services/environment.js"
import { LayerService } from "./services/layers.js"
import { Emitter, type EmitterListener } from "./lib/emitter.js"
import { NotificationService } from "./services/notify.js"
import { resolveKeyMatch } from "./services/keys.js"
import { RuntimeService } from "./services/runtime.js"
import { createKeymapState } from "./services/state.js"

type DiagnosticEvents<TTarget extends object, TEvent extends KeymapEvent> = Pick<
  Events<TTarget, TEvent>,
  "warning" | "error"
>

function getKeyMatchKey(input: KeyStringifyInput): KeyMatch {
  return resolveKeyMatch(input)
}

export class Keymap<TTarget extends object, TEvent extends KeymapEvent = KeymapEvent> {
  private readonly state = createKeymapState<TTarget, TEvent>()
  private cleanedUp = false
  private readonly resources = new Map<symbol, { count: number; dispose: () => void }>()
  private readonly cleanupListeners: Array<() => void> = []
  // Reuse `Emitter`, but keep its `onError` hook as a no-op so throwing error
  // listeners cannot re-enter `emitError` and loop forever.
  private events = new Emitter<DiagnosticEvents<TTarget, TEvent>>(() => {})
  private hooks: Emitter<Hooks<TTarget, TEvent>>
  private readonly notify: NotificationService<TTarget, TEvent>
  private readonly activation: ActivationService<TTarget, TEvent>
  private readonly runtime: RuntimeService<TTarget, TEvent>
  private readonly conditions: ConditionService<TTarget, TEvent>
  private readonly catalog: CommandCatalogService<TTarget, TEvent>
  private readonly executor: CommandExecutorService<TTarget, TEvent>
  private readonly compiler: CompilerService<TTarget, TEvent>
  private readonly dispatch: DispatchService<TTarget, TEvent>
  private readonly layers: LayerService<TTarget, TEvent>
  private readonly environment: EnvironmentService<TTarget, TEvent>

  private readonly keypressListener: (event: TEvent) => void
  private readonly keyreleaseListener: (event: TEvent) => void
  private readonly rawListener: (sequence: string) => boolean
  private readonly focusedTargetListener: (focused: TTarget | null) => void

  constructor(private readonly host: KeymapHost<TTarget, TEvent>) {
    if (host.isDestroyed) {
      throw new Error("Cannot create a keymap for a destroyed host")
    }

    this.hooks = new Emitter<Hooks<TTarget, TEvent>>((name, error) => {
      this.notify.reportListenerError(name, error)
    })
    this.notify = new NotificationService(this.state, this.events, this.hooks)
    this.conditions = new ConditionService(this.state, this.notify)
    this.catalog = new CommandCatalogService(this.state, this.host, this.notify, this.conditions, {
      onCommandResolversChanged: () => {
        this.activation.ensureValidPendingSequence()
      },
    })
    this.activation = new ActivationService(
      this.state,
      this.host,
      this.hooks,
      this.notify,
      this.conditions,
      this.catalog,
      {
        onPendingSequenceChanged: (previous, next) => {
          this.dispatch?.handlePendingSequenceChange(previous, next)
        },
      },
    )
    this.runtime = new RuntimeService(this.state, this.notify, this.conditions, this.activation)
    this.executor = new CommandExecutorService(this.notify, this.runtime, this.activation, this.catalog, {
      keymap: this,
      createCommandEvent: () => this.host.createCommandEvent(),
    })
    this.compiler = new CompilerService(this.state, this.notify, this.conditions, {
      warnUnknownField: (kind, fieldName) => {
        this.warnUnknownField(kind, fieldName)
      },
      warnUnknownToken: (token, sequence) => {
        this.warnUnknownToken(token, sequence)
      },
    })
    this.layers = new LayerService(this.state, this.notify, this.conditions, this.activation, {
      compiler: this.compiler,
      commands: this.catalog,
      host: this.host,
      warnUnknownField: (kind, fieldName) => {
        this.warnUnknownField(kind, fieldName)
      },
    })
    this.environment = new EnvironmentService(this.state, this.notify, this.compiler, this.layers)
    this.dispatch = new DispatchService(
      this.state,
      this.notify,
      this.runtime,
      this.activation,
      this.conditions,
      this.executor,
      this.compiler,
      this.catalog,
      this.layers,
    )
    this.keypressListener = (event) => {
      this.dispatch.handleKeyEvent(event, false)
    }
    this.keyreleaseListener = (event) => {
      this.dispatch.handleKeyEvent(event, true)
    }
    this.rawListener = (sequence) => {
      return this.dispatch.handleRawSequence(sequence)
    }
    this.focusedTargetListener = (focused) => {
      this.handleFocusedTargetChange(focused)
    }

    this.cleanupListeners.push(this.host.onKeyPress(this.keypressListener))
    this.cleanupListeners.push(this.host.onKeyRelease(this.keyreleaseListener))
    if (this.host.onRawInput) {
      this.cleanupListeners.push(this.host.onRawInput(this.rawListener))
    }
    this.cleanupListeners.push(this.host.onFocusChange(this.focusedTargetListener))
    if (this.host.onDestroy) {
      this.cleanupListeners.push(
        this.host.onDestroy(() => {
          this.cleanup()
        }),
      )
    }
  }

  private cleanup(): void {
    if (this.cleanedUp) {
      return
    }

    this.cleanedUp = true

    this.activation.setPendingSequence(null)

    for (const resource of this.resources.values()) {
      resource.dispose()
    }
    this.resources.clear()

    this.layers.cleanup()

    for (const cleanupListener of this.cleanupListeners.splice(0)) {
      cleanupListener()
    }
  }

  public setData(name: string, value: unknown): void {
    this.runtime.setData(name, value)
  }

  public getData(name: string): unknown {
    return this.runtime.getData(name)
  }

  public hasPendingSequence(): boolean {
    return this.activation.ensureValidPendingSequence() !== undefined
  }

  public getPendingSequence(): readonly KeySequencePart[] {
    return this.activation.getPendingSequence()
  }

  public createKeyMatcher(key: KeyLike): (input: KeyStringifyInput | null | undefined) => boolean {
    const match = this.compiler.parseTokenKey(key).match

    return (input) => {
      if (!input) {
        return false
      }

      return getKeyMatchKey(input) === match
    }
  }

  public parseKeySequence(key: KeyLike): readonly KeySequencePart[] {
    return this.compiler.parseKeySequence(key)
  }

  public formatKey(key: KeyLike, options?: StringifyOptions): string {
    return this.compiler.formatKey(key, options)
  }

  public clearPendingSequence(): void {
    this.activation.setPendingSequence(null)
  }

  public popPendingSequence(): boolean {
    return this.activation.popPendingSequence()
  }

  public getActiveKeys(options?: ActiveKeyOptions): readonly ActiveKey<TTarget, TEvent>[] {
    return this.activation.getActiveKeys(options)
  }

  public getCommands(query?: CommandQuery<TTarget>): readonly CommandRecord[] {
    return this.catalog.getCommands(query)
  }

  public getCommandEntries(query?: CommandQuery<TTarget>): readonly CommandEntry<TTarget, TEvent>[] {
    return this.catalog.getCommandEntries(query)
  }

  public getCommandBindings(
    query: CommandBindingsQuery<TTarget>,
  ): ReadonlyMap<string, readonly ActiveBinding<TTarget, TEvent>[]> {
    return this.catalog.getCommandBindings(query)
  }

  public acquireResource(key: symbol, setup: () => () => void): () => void {
    if (this.cleanedUp || this.host.isDestroyed) {
      throw new Error("Cannot use a keymap after its host was destroyed")
    }

    const existing = this.resources.get(key)
    if (existing) {
      existing.count += 1
      return () => {
        this.releaseResource(key, existing)
      }
    }

    const dispose = setup()
    const resource = { count: 1, dispose }
    this.resources.set(key, resource)

    return () => {
      this.releaseResource(key, resource)
    }
  }

  public runCommand(cmd: string, options?: RunCommandOptions<TTarget, TEvent>): RunCommandResult {
    return this.executor.runCommand(cmd, options)
  }

  public dispatchCommand(cmd: string, options?: RunCommandOptions<TTarget, TEvent>): RunCommandResult {
    return this.executor.dispatchCommand(cmd, options)
  }

  public on(name: "state", fn: Listener<Events<TTarget, TEvent>["state"]>): () => void

  public on(name: "pendingSequence", fn: Listener<Events<TTarget, TEvent>["pendingSequence"]>): () => void

  public on(name: "warning", fn: Listener<Events<TTarget, TEvent>["warning"]>): () => void

  public on(name: "error", fn: Listener<Events<TTarget, TEvent>["error"]>): () => void

  public on(
    name: keyof Events<TTarget, TEvent>,
    fn: (() => void) | ((value: Events<TTarget, TEvent>[keyof Events<TTarget, TEvent>]) => void),
  ): () => void {
    if (name === "warning") {
      return this.events.hook(name, fn as EmitterListener<Events<TTarget, TEvent>["warning"]>)
    }

    if (name === "error") {
      return this.events.hook(name, fn as EmitterListener<Events<TTarget, TEvent>["error"]>)
    }

    return this.hooks.hook(name, fn as Listener<Hooks<TTarget, TEvent>[typeof name]>)
  }

  public intercept(name: "key", fn: (ctx: KeyInputContext<TEvent>) => void, options?: KeyInterceptOptions): () => void

  public intercept(name: "raw", fn: (ctx: RawInputContext) => void, options?: RawInterceptOptions): () => void

  public intercept(
    name: "key" | "raw",
    fn: ((ctx: KeyInputContext<TEvent>) => void) | ((ctx: RawInputContext) => void),
    options?: KeyInterceptOptions | RawInterceptOptions,
  ): () => void {
    if (name === "key") {
      return this.dispatch.intercept(name, fn as (ctx: KeyInputContext<TEvent>) => void, options as KeyInterceptOptions)
    }

    return this.dispatch.intercept(name, fn as (ctx: RawInputContext) => void, options as RawInterceptOptions)
  }

  public registerLayer(layer: Layer<TTarget, TEvent>): () => void {
    return this.layers.registerLayer(layer)
  }

  public registerLayerFields(fields: Record<string, LayerFieldCompiler>): () => void {
    return this.environment.registerLayerFields(fields)
  }

  public prependLayerBindingsTransformer(transformer: LayerBindingsTransformer<TTarget, TEvent>): () => void {
    return this.environment.prependLayerBindingsTransformer(transformer)
  }

  public appendLayerBindingsTransformer(transformer: LayerBindingsTransformer<TTarget, TEvent>): () => void {
    return this.environment.appendLayerBindingsTransformer(transformer)
  }

  public clearLayerBindingsTransformers(): void {
    this.environment.clearLayerBindingsTransformers()
  }

  public prependBindingTransformer(transformer: BindingTransformer<TTarget, TEvent>): () => void {
    return this.environment.prependBindingTransformer(transformer)
  }

  public appendBindingTransformer(transformer: BindingTransformer<TTarget, TEvent>): () => void {
    return this.environment.appendBindingTransformer(transformer)
  }

  public clearBindingTransformers(): void {
    this.environment.clearBindingTransformers()
  }

  public prependBindingParser(parser: BindingParser): () => void {
    return this.environment.prependBindingParser(parser)
  }

  public appendBindingParser(parser: BindingParser): () => void {
    return this.environment.appendBindingParser(parser)
  }

  public clearBindingParsers(): void {
    this.environment.clearBindingParsers()
  }

  public registerToken(token: KeyToken): () => void {
    return this.environment.registerToken(token)
  }

  public prependBindingExpander(expander: BindingExpander): () => void {
    return this.environment.prependBindingExpander(expander)
  }

  public appendBindingExpander(expander: BindingExpander): () => void {
    return this.environment.appendBindingExpander(expander)
  }

  public clearBindingExpanders(): void {
    this.environment.clearBindingExpanders()
  }

  public registerBindingFields(fields: Record<string, BindingFieldCompiler>): () => void {
    return this.environment.registerBindingFields(fields)
  }

  public registerCommandFields(fields: Record<string, CommandFieldCompiler>): () => void {
    return this.environment.registerCommandFields(fields)
  }

  public prependCommandResolver(resolver: CommandResolver<TTarget, TEvent>): () => void {
    return this.catalog.prependCommandResolver(resolver)
  }

  public appendCommandResolver(resolver: CommandResolver<TTarget, TEvent>): () => void {
    return this.catalog.appendCommandResolver(resolver)
  }

  public clearCommandResolvers(): void {
    this.catalog.clearCommandResolvers()
  }

  public prependLayerAnalyzer(analyzer: LayerAnalyzer<TTarget, TEvent>): () => void {
    return this.layers.prependLayerAnalyzer(analyzer)
  }

  public appendLayerAnalyzer(analyzer: LayerAnalyzer<TTarget, TEvent>): () => void {
    return this.layers.appendLayerAnalyzer(analyzer)
  }

  public clearLayerAnalyzers(): void {
    this.layers.clearLayerAnalyzers()
  }

  public prependEventMatchResolver(resolver: EventMatchResolver<TEvent>): () => void {
    return this.dispatch.prependEventMatchResolver(resolver)
  }

  public appendEventMatchResolver(resolver: EventMatchResolver<TEvent>): () => void {
    return this.dispatch.appendEventMatchResolver(resolver)
  }

  public clearEventMatchResolvers(): void {
    this.dispatch.clearEventMatchResolvers()
  }

  public prependDisambiguationResolver(resolver: KeyDisambiguationResolver<TTarget, TEvent>): () => void {
    return this.dispatch.prependDisambiguationResolver(resolver)
  }

  public appendDisambiguationResolver(resolver: KeyDisambiguationResolver<TTarget, TEvent>): () => void {
    return this.dispatch.appendDisambiguationResolver(resolver)
  }

  public clearDisambiguationResolvers(): void {
    this.dispatch.clearDisambiguationResolvers()
  }

  private handleFocusedTargetChange(_focused: TTarget | null): void {
    this.notify.runWithStateChangeBatch(() => {
      // Any focus change breaks a pending sequence. Prefix dispatch is captured
      // against the state that started it, and changing focus can change the
      // active bindings and their precedence.
      this.activation.setPendingSequence(null)
      this.activation.invalidateActiveLayers()
      this.activation.refreshActiveLayers(_focused)
      this.notify.queueStateChange()
    })
  }

  private warnUnknownField(kind: "binding" | "layer", fieldName: string): void {
    this.notify.warnOnce(
      `${kind}:${fieldName}`,
      `unknown-${kind}-field`,
      { field: fieldName, kind },
      `[Keymap] Unknown ${kind} field "${fieldName}" was ignored`,
    )
  }

  private warnUnknownToken(token: string, sequence: string): void {
    this.notify.warnOnce(
      `token:${token}`,
      "unknown-token",
      { token, sequence },
      `[Keymap] Unknown token "${token}" in key sequence "${sequence}" was ignored`,
    )
  }

  private releaseResource(key: symbol, resource: { count: number; dispose: () => void }): void {
    const current = this.resources.get(key)
    if (current !== resource) {
      return
    }

    resource.count -= 1
    if (resource.count > 0) {
      return
    }

    resource.dispose()
    this.resources.delete(key)
  }
}
