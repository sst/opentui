import { RESERVED_COMMAND_FIELDS } from "../schema.js"
import type {
  ActiveBinding,
  Attributes,
  Command,
  CommandEntry,
  CommandBindingsQuery,
  CommandFieldCompiler,
  CommandResolutionStatus,
  CommandQuery,
  CommandQueryValue,
  CommandResolver,
  CommandResolverContext,
  BindingState,
  EventData,
  KeymapEvent,
  KeymapHost,
  CommandState,
  RuntimeMatcher,
} from "../types.js"
import { normalizeCommandName } from "./primitives/command-normalization.js"
import {
  getActiveLayersForFocused,
  getFocusedTargetIfAvailable,
  isLayerActiveForFocused,
} from "./primitives/active-layers.js"
import type { ConditionService } from "./conditions.js"
import { createFieldCompilerContext } from "./primitives/field-invariants.js"
import type { NotificationService } from "./notify.js"
import type {
  ActiveCommandView,
  CommandChainCacheState,
  LayerCommandEntry,
  CommandView,
  ResolvedCommandEntry,
  State,
} from "./state.js"
import { getErrorMessage } from "./values.js"

const DEFAULT_COMMAND_SEARCH_FIELDS = ["name"] as const

const EMPTY_COMMAND_FIELDS: Readonly<Record<string, unknown>> = Object.freeze({})

interface NormalizeCommandsOptions<TTarget extends object, TEvent extends KeymapEvent> {
  commands: readonly Command<TTarget, TEvent>[]
  commandFields: ReadonlyMap<string, CommandFieldCompiler>
  conditions: ConditionService<TTarget, TEvent>
  onError(code: string, error: unknown, message: string): void
}

interface QueryLayerCommandEntriesOptions<TTarget extends object, TEvent extends KeymapEvent> {
  entries: Iterable<LayerCommandEntry<TTarget, TEvent>>
  query?: CommandQuery<TTarget, TEvent>
  getCommand(command: CommandState<TTarget, TEvent>): Command<TTarget, TEvent>
  onFilterError(error: unknown): void
}

interface CommandQueryMatchOptions<TTarget extends object, TEvent extends KeymapEvent> {
  getCommand(command: CommandState<TTarget, TEvent>): Command<TTarget, TEvent>
  onFilterError(error: unknown): void
}

interface CommandCatalogOptions {
  onCommandResolversChanged(): void
}

interface ResolvedCommandLookup<TTarget extends object, TEvent extends KeymapEvent> {
  resolved?: ResolvedCommandEntry<TTarget, TEvent>
  hadError: boolean
}

interface CommandExecutionFields {
  input: string
  payload?: unknown
}

interface CommandResolverAttempt<TTarget extends object, TEvent extends KeymapEvent> {
  context: CommandResolverContext<TTarget, TEvent>
  getExecutionFields(): CommandExecutionFields
}

function createCommandChainCacheState<TTarget extends object, TEvent extends KeymapEvent>(): CommandChainCacheState<
  TTarget,
  TEvent
> {
  return {
    resolvedChains: new Map(),
    fallback: new Map(),
    fallbackErrors: new Set(),
  }
}

export class CommandCatalogService<TTarget extends object, TEvent extends KeymapEvent> {
  constructor(
    private readonly state: State<TTarget, TEvent>,
    private readonly host: KeymapHost<TTarget, TEvent>,
    private readonly notify: NotificationService<TTarget, TEvent>,
    private readonly conditions: ConditionService<TTarget, TEvent>,
    private readonly options: CommandCatalogOptions,
  ) {}

  public normalizeCommands(
    commands: readonly Command<TTarget, TEvent>[],
  ): CommandState<TTarget, TEvent>[] {
    return normalizeCommands({
      commands,
      commandFields: this.state.environment.commandFields,
      conditions: this.conditions,
      onError: (code, error, message) => {
        this.notify.emitError(code, error, message)
      },
    })
  }

  public prependCommandResolver(resolver: CommandResolver<TTarget, TEvent>): () => void {
    return this.mutateCommandResolvers(() => this.state.commands.commandResolvers.prepend(resolver), resolver)
  }

  public appendCommandResolver(resolver: CommandResolver<TTarget, TEvent>): () => void {
    return this.mutateCommandResolvers(() => this.state.commands.commandResolvers.append(resolver), resolver)
  }

  public clearCommandResolvers(): void {
    if (!this.state.commands.commandResolvers.has()) {
      return
    }

    this.notify.runWithStateChangeBatch(() => {
      this.state.commands.commandResolvers.clear()
      this.state.commands.commandMetadataVersion += 1
      this.options.onCommandResolversChanged()
      this.notify.queueStateChange()
    })
  }

  public getCommands(query?: CommandQuery<TTarget, TEvent>): readonly Command<TTarget, TEvent>[] {
    return this.getFilteredCommandEntries(query).map((entry) => getCommand(entry.commandState))
  }

  public getCommandEntries(query?: CommandQuery<TTarget, TEvent>): readonly CommandEntry<TTarget, TEvent>[] {
    const context = this.getCommandQueryContext(query)
    const filteredEntries = this.getFilteredCommandEntries(query, context)
    if (filteredEntries.length === 0) {
      return []
    }

    const grouped = filteredEntries.map((entry) => ({
      entry,
      command: getCommand(entry.commandState),
      commandAttrs: entry.commandState.attrs,
      bindings: [] as ActiveBinding<TTarget, TEvent>[],
    }))
    const indexesByName = new Map<string, number[]>()

    for (const [index, item] of grouped.entries()) {
      const existing = indexesByName.get(item.command.name)
      if (existing) {
        existing.push(index)
      } else {
        indexesByName.set(item.command.name, [index])
      }
    }

    if (indexesByName.size > 0) {
      this.collectCommandEntryBindings(grouped, indexesByName, context)
    }

    return grouped.map((item) => ({
      command: item.command,
      bindings: item.bindings,
    }))
  }

  public getCommandBindings(
    query: CommandBindingsQuery<TTarget>,
  ): ReadonlyMap<string, readonly ActiveBinding<TTarget, TEvent>[]> {
    const bindingsByCommand = new Map<string, ActiveBinding<TTarget, TEvent>[]>()
    for (const command of query.commands) {
      if (!bindingsByCommand.has(command)) {
        bindingsByCommand.set(command, [])
      }
    }

    if (bindingsByCommand.size === 0) {
      return bindingsByCommand
    }

    this.collectCommandBindings(bindingsByCommand, this.getCommandQueryContext(query))
    return bindingsByCommand
  }

  public getResolvedCommandChain(
    command: string,
    focused: TTarget | null,
  ): { entries?: readonly ResolvedCommandEntry<TTarget, TEvent>[]; hadError: boolean } {
    const view = this.getActiveCommandView(focused)
    const entries = this.getResolvedCommandChainFromView(
      view,
      command,
      focused,
      "active",
      view.chainsByName.get(command),
    )
    const hadError = view.fallbackErrors.has(command)

    return { entries, hadError }
  }

  public getRegisteredResolvedEntries(command: string): readonly ResolvedCommandEntry<TTarget, TEvent>[] | undefined {
    const view = this.getCommandView()
    const cache = view.resolvedChains
    const cached = cache.get(command)
    if (cached) {
      return cached.length > 0 ? cached : undefined
    }

    const chain = view.chainsByName.get(command)
    if (!chain || chain.length === 0) {
      cache.set(command, [])
      return undefined
    }

    const resolved: ResolvedCommandEntry<TTarget, TEvent>[] = []
    for (const entry of chain) {
      resolved.push({
        target: entry.layer.target,
        command: entry.commandState.command,
        attrs: entry.commandState.attrs,
      })
    }

    cache.set(command, resolved)
    return resolved
  }

  public getActiveRegisteredResolvedEntries(
    command: string,
    focused: TTarget | null,
  ): readonly ResolvedCommandEntry<TTarget, TEvent>[] | undefined {
    const view = this.getActiveCommandView(focused)
    const chain = view.chainsByName.get(command)
    if (!chain || chain.length === 0) {
      return undefined
    }

    const resolved: ResolvedCommandEntry<TTarget, TEvent>[] = []
    for (const entry of chain) {
      resolved.push({
        target: entry.layer.target,
        command: entry.commandState.command,
        attrs: entry.commandState.attrs,
      })
    }

    return resolved
  }

  public resolveRegisteredResolverFallback(
    command: string,
    execution?: CommandExecutionFields,
  ): ResolvedCommandLookup<TTarget, TEvent> {
    return this.resolveCommandWithResolvers(command, null, { mode: "registered", execution })
  }

  public resolveActiveResolverFallback(
    command: string,
    focused: TTarget | null,
    execution?: CommandExecutionFields,
  ): ResolvedCommandLookup<TTarget, TEvent> {
    return this.resolveCommandWithResolvers(command, focused, { mode: "active", execution })
  }

  public getCommandAttrs(command: string, focused: TTarget | null): Readonly<Attributes> | undefined {
    const top = this.getTopResolvedCommand(command, focused)
    return top?.attrs
  }

  public getTopCommand(command: string, focused: TTarget | null): Command<TTarget, TEvent> | undefined {
    const top = this.getTopResolvedCommand(command, focused)
    return top?.command
  }

  public getCommandByName(command: string): Command<TTarget, TEvent> | undefined {
    const top = this.getCommandEntry(command)
    return top?.commandState.command
  }

  public getDispatchUnavailableCommandState(
    command: string,
    focused: TTarget | null,
    includeCommand: boolean,
  ): { reason: "inactive" | "disabled"; command?: Command<TTarget, TEvent> } | undefined {
    const view = this.getCommandView()
    const chain = view.chainsByName.get(command)
    if (!chain || chain.length === 0) {
      return undefined
    }

    let inactiveEntry: LayerCommandEntry<TTarget, TEvent> | undefined
    let disabledEntry: LayerCommandEntry<TTarget, TEvent> | undefined

    for (const entry of chain) {
      if (!isLayerActiveForFocused(this.host, entry.layer, focused)) {
        inactiveEntry ??= entry
        continue
      }

      if (!this.conditions.layerMatchesRuntimeState(entry.layer) || !this.conditions.matchesConditions(entry.commandState)) {
        disabledEntry ??= entry
      }
    }

    const unavailableEntry = disabledEntry ?? inactiveEntry
    if (!unavailableEntry) {
      return undefined
    }

    return {
      reason: disabledEntry ? "disabled" : "inactive",
      command: includeCommand ? unavailableEntry.commandState.command : undefined,
    }
  }

  public getActiveCommandView(focused: TTarget | null): ActiveCommandView<TTarget, TEvent> {
    const currentFocused = getFocusedTargetIfAvailable(this.host)
    const derivedStateVersion = this.state.notify.derivedStateVersion

    if (
      focused === currentFocused &&
      this.state.commands.activeCommandViewVersion === derivedStateVersion &&
      this.state.commands.activeCommandView?.cacheable
    ) {
      return this.state.commands.activeCommandView
    }

    const entries: LayerCommandEntry<TTarget, TEvent>[] = []
    const reachable: LayerCommandEntry<TTarget, TEvent>[] = []
    const reachableByName = new Map<string, LayerCommandEntry<TTarget, TEvent>>()
    const chainsByName = new Map<string, LayerCommandEntry<TTarget, TEvent>[]>()
    let cacheable = true

    if (this.state.layers.layersWithCommands > 0) {
      for (const layer of getActiveLayersForFocused(this.state.layers, this.host, focused)) {
        if (layer.commands.length === 0 || !this.conditions.layerMatchesRuntimeState(layer)) {
          continue
        }

        if (layer.hasUnkeyedMatchers) {
          cacheable = false
        }

        for (const commandState of layer.commands) {
          const command = commandState.command
          if (commandState.hasUnkeyedMatchers) {
            cacheable = false
          }

          if (!this.conditions.matchesConditions(commandState)) {
            continue
          }

          const entry: LayerCommandEntry<TTarget, TEvent> = { layer, commandState }
          entries.push(entry)

          const existing = chainsByName.get(command.name)
          if (existing) {
            existing.push(entry)
          } else {
            chainsByName.set(command.name, [entry])
          }

          if (!reachableByName.has(command.name)) {
            reachableByName.set(command.name, entry)
            reachable.push(entry)
          }
        }
      }
    }

    const view: ActiveCommandView<TTarget, TEvent> = {
      cacheable,
      entries,
      reachable,
      reachableByName,
      chainsByName,
      ...createCommandChainCacheState(),
    }

    if (focused === currentFocused && view.cacheable) {
      this.state.commands.activeCommandViewVersion = derivedStateVersion
      this.state.commands.activeCommandView = view
    }

    return view
  }

  public getCommandView(): CommandView<TTarget, TEvent> {
    const cacheVersion = this.state.commands.commandMetadataVersion
    if (
      this.state.commands.registeredCommandViewVersion === cacheVersion &&
      this.state.commands.registeredCommandView
    ) {
      return this.state.commands.registeredCommandView
    }

    const entries: LayerCommandEntry<TTarget, TEvent>[] = []
    const chainsByName = new Map<string, LayerCommandEntry<TTarget, TEvent>[]>()

    for (const layer of this.state.layers.sortedLayers) {
      if (layer.commands.length === 0) {
        continue
      }

      for (const commandState of layer.commands) {
        const command = commandState.command
        const entry: LayerCommandEntry<TTarget, TEvent> = { layer, commandState }
        entries.push(entry)

        const existing = chainsByName.get(command.name)
        if (existing) {
          existing.push(entry)
        } else {
          chainsByName.set(command.name, [entry])
        }
      }
    }

    const view: CommandView<TTarget, TEvent> = {
      entries,
      chainsByName,
      ...createCommandChainCacheState(),
    }

    this.state.commands.registeredCommandViewVersion = cacheVersion
    this.state.commands.registeredCommandView = view
    return view
  }

  public isBindingVisible(
    binding: BindingState<TTarget, TEvent>,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): boolean {
    if (binding.command === undefined || binding.run) {
      return true
    }

    if (typeof binding.command !== "string") {
      return false
    }

    if (activeView.reachableByName.has(binding.command)) {
      return true
    }

    return this.getFallbackResolvedCommand(activeView, binding.command, focused, "active") !== undefined
  }

  public getBindingCommandAttrs(
    binding: BindingState<TTarget, TEvent>,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): Readonly<Attributes> | undefined {
    if (typeof binding.command !== "string") {
      return undefined
    }

    const active = activeView.reachableByName.get(binding.command)
    if (active) {
      return active.commandState.attrs
    }

    const fallback = this.getFallbackResolvedCommand(activeView, binding.command, focused, "active")
    return fallback?.attrs
  }

  public getCommandResolutionStatus(
    command: string,
    layerCommands?: ReadonlyMap<string, CommandState<TTarget, TEvent>>,
  ): CommandResolutionStatus {
    if (layerCommands?.has(command) || this.state.commands.registeredNames.has(command)) {
      return "resolved"
    }

    const lookup = this.resolveCommandWithResolvers(command, getFocusedTargetIfAvailable(this.host))
    if (lookup.resolved || lookup.hadError) {
      return lookup.resolved ? "resolved" : "error"
    }

    return "unresolved"
  }

  private mutateCommandResolvers(register: () => () => void, resolver: CommandResolver<TTarget, TEvent>): () => void {
    return this.notify.runWithStateChangeBatch(() => {
      const off = register()
      this.state.commands.commandMetadataVersion += 1
      this.options.onCommandResolversChanged()
      this.notify.queueStateChange()

      return () => {
        this.notify.runWithStateChangeBatch(() => {
          off()
          if (this.state.commands.commandResolvers.values().includes(resolver)) {
            return
          }

          this.state.commands.commandMetadataVersion += 1
          this.options.onCommandResolversChanged()
          this.notify.queueStateChange()
        })
      }
    })
  }

  private getTopResolvedCommand(command: string, focused: TTarget | null): ResolvedCommandEntry<TTarget, TEvent> | undefined {
    const activeView = this.getActiveCommandView(focused)
    const active = activeView.reachableByName.get(command)
    if (active) {
      return {
        target: active.layer.target,
        command: active.commandState.command,
        attrs: active.commandState.attrs,
      }
    }

    return this.getFallbackResolvedCommand(activeView, command, focused, "active")
  }

  private getCommandEntry(command: string): LayerCommandEntry<TTarget, TEvent> | undefined {
    const view = this.getCommandView()
    return view.chainsByName.get(command)?.[0]
  }

  private getFallbackResolvedCommand(
    view: CommandChainCacheState<TTarget, TEvent>,
    command: string,
    focused: TTarget | null,
    mode: "active" | "registered",
  ): ResolvedCommandEntry<TTarget, TEvent> | undefined {
    const cache = view.fallback
    const errorCache = view.fallbackErrors
    if (cache.has(command)) {
      const cached = cache.get(command)
      return cached ?? undefined
    }

    const lookup = this.resolveCommandWithResolvers(command, focused, { mode })
    cache.set(command, lookup.resolved ?? null)
    if (lookup.hadError) {
      errorCache.add(command)
    }

    if (!lookup.resolved) {
      return undefined
    }

    return lookup.resolved
  }

  private getResolvedCommandChainFromView(
    view: CommandChainCacheState<TTarget, TEvent>,
    command: string,
    focused: TTarget | null,
    mode: "active" | "registered",
    activeChain?: readonly LayerCommandEntry<TTarget, TEvent>[],
  ): readonly ResolvedCommandEntry<TTarget, TEvent>[] | undefined {
    const cache = view.resolvedChains
    const cached = cache.get(command)
    if (cached) {
      return cached.length > 0 ? cached : undefined
    }

    const resolved: ResolvedCommandEntry<TTarget, TEvent>[] = []
    const chain = activeChain
    if (chain) {
      for (const entry of chain) {
        resolved.push({
          target: entry.layer.target,
          command: entry.commandState.command,
          attrs: entry.commandState.attrs,
        })
      }
    }

    const fallback = this.getFallbackResolvedCommand(view, command, focused, mode)
    if (fallback) {
      resolved.push(fallback)
    }

    cache.set(command, resolved)
    return resolved.length > 0 ? resolved : undefined
  }

  private getRegisteredLayerCommandEntries(): readonly LayerCommandEntry<TTarget, TEvent>[] {
    const cacheVersion = this.state.commands.commandMetadataVersion
    if (this.state.commands.registeredCommandEntriesCacheVersion === cacheVersion) {
      return this.state.commands.registeredCommandEntriesCache
    }

    const layers = [...this.state.layers.layers]
    layers.sort((left, right) => left.order - right.order)

    const entries: LayerCommandEntry<TTarget, TEvent>[] = []
    for (const layer of layers) {
      for (const command of layer.commands) {
        entries.push({ layer, commandState: command })
      }
    }

    this.state.commands.registeredCommandEntriesCacheVersion = cacheVersion
    this.state.commands.registeredCommandEntriesCache = entries
    return entries
  }

  private getCommandQueryContext(query?: CommandQuery<TTarget, TEvent>): {
    visibility: "reachable" | "active" | "registered"
    focused: TTarget | null
    activeView?: ActiveCommandView<TTarget, TEvent>
  } {
    const visibility = query?.visibility ?? "reachable"
    const focused =
      query && Object.prototype.hasOwnProperty.call(query, "focused")
        ? (query.focused ?? null)
        : getFocusedTargetIfAvailable(this.host)

    if (visibility === "registered") {
      return { visibility, focused }
    }

    return {
      visibility,
      focused,
      activeView: this.getActiveCommandView(focused),
    }
  }

  private getFilteredCommandEntries(
    query?: CommandQuery<TTarget, TEvent>,
    context: {
      visibility: "reachable" | "active" | "registered"
      focused: TTarget | null
      activeView?: ActiveCommandView<TTarget, TEvent>
    } = this.getCommandQueryContext(query),
  ): LayerCommandEntry<TTarget, TEvent>[] {
    let entries: readonly LayerCommandEntry<TTarget, TEvent>[]
    if (context.visibility === "registered") {
      entries = this.getRegisteredLayerCommandEntries()
    } else if (context.visibility === "active") {
      entries = context.activeView?.entries ?? []
    } else {
      entries = context.activeView?.reachable ?? []
    }

    return queryLayerCommandEntries({
      entries,
      query,
      getCommand: (command) => getCommand(command),
      onFilterError: (error) => {
        this.notify.emitError("command-query-filter-error", error, "[Keymap] Error in command query filter:")
      },
    })
  }

  private collectCommandEntryBindings(
    grouped: Array<{
      entry: LayerCommandEntry<TTarget, TEvent>
      command: Command<TTarget, TEvent>
      commandAttrs: Readonly<Attributes> | undefined
      bindings: ActiveBinding<TTarget, TEvent>[]
    }>,
    indexesByName: ReadonlyMap<string, readonly number[]>,
    context: {
      visibility: "reachable" | "active" | "registered"
      focused: TTarget | null
      activeView?: ActiveCommandView<TTarget, TEvent>
    },
  ): void {
    if (context.visibility === "registered") {
      const layers = [...this.state.layers.layers]
      layers.sort((left, right) => left.order - right.order)

      for (const layer of layers) {
        for (const binding of layer.bindingStates) {
          this.collectBindingForCommandEntries(grouped, indexesByName, binding)
        }
      }
      return
    }

    const activeView = context.activeView
    if (!activeView) {
      return
    }

    for (const layer of getActiveLayersForFocused(this.state.layers, this.host, context.focused)) {
      if (layer.bindingStates.length === 0 || !this.conditions.layerMatchesRuntimeState(layer)) {
        continue
      }

      for (const binding of layer.bindingStates) {
        if (
          !this.conditions.matchesConditions(binding) ||
          !this.isBindingVisible(binding, context.focused, activeView)
        ) {
          continue
        }

        this.collectBindingForCommandEntries(grouped, indexesByName, binding)
      }
    }
  }

  private collectCommandBindings(
    bindingsByCommand: Map<string, ActiveBinding<TTarget, TEvent>[]>,
    context: {
      visibility: "reachable" | "active" | "registered"
      focused: TTarget | null
      activeView?: ActiveCommandView<TTarget, TEvent>
    },
  ): void {
    if (context.visibility === "registered") {
      // Layer Set iteration is registration order, which matches ascending layer order.
      for (const layer of this.state.layers.layers) {
        for (const binding of layer.bindingStates) {
          this.collectBindingForCommandBindings(bindingsByCommand, binding, context)
        }
      }
      return
    }

    const activeView = context.activeView
    if (!activeView) {
      return
    }

    for (const layer of getActiveLayersForFocused(this.state.layers, this.host, context.focused)) {
      if (layer.bindingStates.length === 0 || !this.conditions.layerMatchesRuntimeState(layer)) {
        continue
      }

      for (const binding of layer.bindingStates) {
        if (
          !this.conditions.matchesConditions(binding) ||
          !this.isBindingVisible(binding, context.focused, activeView)
        ) {
          continue
        }

        this.collectBindingForCommandBindings(bindingsByCommand, binding, context)
      }
    }
  }

  private collectBindingForCommandEntries(
    grouped: Array<{
      entry: LayerCommandEntry<TTarget, TEvent>
      command: Command<TTarget, TEvent>
      commandAttrs: Readonly<Attributes> | undefined
      bindings: ActiveBinding<TTarget, TEvent>[]
    }>,
    indexesByName: ReadonlyMap<string, readonly number[]>,
    binding: BindingState<TTarget, TEvent>,
  ): void {
    if (typeof binding.command !== "string") {
      return
    }

    const indexes = indexesByName.get(binding.command)
    if (!indexes || indexes.length === 0) {
      return
    }

    for (const index of indexes) {
      const item = grouped[index]
      if (!item) {
        continue
      }

      item.bindings.push(this.createActiveBinding(binding, item.commandAttrs))
    }
  }

  private collectBindingForCommandBindings(
    bindingsByCommand: Map<string, ActiveBinding<TTarget, TEvent>[]>,
    binding: BindingState<TTarget, TEvent>,
    context: {
      visibility: "reachable" | "active" | "registered"
      focused: TTarget | null
      activeView?: ActiveCommandView<TTarget, TEvent>
    },
  ): void {
    if (typeof binding.command !== "string") {
      return
    }

    const bindings = bindingsByCommand.get(binding.command)
    if (!bindings) {
      return
    }

    bindings.push(this.createActiveBinding(binding, this.getCommandBindingAttrs(binding, context)))
  }

  private createActiveBinding(
    binding: BindingState<TTarget, TEvent>,
    commandAttrs: Readonly<Attributes> | undefined,
  ): ActiveBinding<TTarget, TEvent> {
    return {
      sequence: binding.sequence,
      command: binding.command,
      commandAttrs,
      attrs: binding.attrs,
      event: binding.event,
      preventDefault: binding.preventDefault,
      fallthrough: binding.fallthrough,
    }
  }

  private getCommandBindingAttrs(
    binding: BindingState<TTarget, TEvent>,
    context: {
      visibility: "reachable" | "active" | "registered"
      focused: TTarget | null
      activeView?: ActiveCommandView<TTarget, TEvent>
    },
  ): Readonly<Attributes> | undefined {
    if (typeof binding.command !== "string") {
      return undefined
    }

    if (context.visibility === "registered") {
      return this.getCommandEntry(binding.command)?.commandState.attrs
    }

    const activeView = context.activeView
    if (!activeView) {
      return undefined
    }

    return this.getBindingCommandAttrs(binding, context.focused, activeView)
  }

  private resolveCommandWithResolvers(
    command: string,
    focused: TTarget | null,
    options?: { mode?: "active" | "registered"; execution?: CommandExecutionFields },
  ): ResolvedCommandLookup<TTarget, TEvent> {
    const mode = options?.mode ?? "active"
    const execution = options?.execution ?? { input: command }

    const lookup = resolveCommandWithResolvers(
      command,
      this.state.commands.commandResolvers.values(),
      () => this.createCommandResolverContext(focused, mode, execution),
      (error) => {
        this.notify.emitError("command-resolver-error", error, `[Keymap] Error in command resolver for "${command}":`)
      },
    )
    let resolved = lookup.resolved
    if (resolved) {
      const entry = this.getCommandEntryForMode(resolved.command.name, focused, mode)
      if (entry?.commandState.command === resolved.command && resolved.target === undefined) {
        resolved = { ...resolved, target: entry.layer.target }
        lookup.resolved = resolved
      }
    }

    if (resolved && !resolved.attrs) {
      const attrs = this.getCommandStateAttrs(resolved.command.name, focused, mode) ??
        getResolverCommandAttrs(resolved.command)
      if (attrs) {
        lookup.resolved = { ...resolved, attrs }
      }
    }

    return lookup
  }

  private getCommandStateAttrs(
    command: string,
    focused: TTarget | null,
    mode: "active" | "registered",
  ): Readonly<Attributes> | undefined {
    if (mode === "registered") {
      return this.getCommandEntry(command)?.commandState.attrs
    }

    return this.getActiveCommandView(focused).reachableByName.get(command)?.commandState.attrs
  }

  private getCommandEntryForMode(
    command: string,
    focused: TTarget | null,
    mode: "active" | "registered",
  ): LayerCommandEntry<TTarget, TEvent> | undefined {
    if (mode === "registered") {
      return this.getCommandEntry(command)
    }

    return this.getActiveCommandView(focused).reachableByName.get(command)
  }

  private createCommandResolverContext(
    focused: TTarget | null,
    mode: "active" | "registered",
    execution: CommandExecutionFields,
  ): CommandResolverAttempt<TTarget, TEvent> {
    let input = execution.input
    let payload = execution.payload

    return {
      context: {
        get input() {
          return input
        },
        get payload() {
          return payload
        },
        setInput(nextInput) {
          input = nextInput
        },
        setPayload(nextPayload) {
          payload = nextPayload
        },
        getCommand: (name: string) => {
          if (mode === "registered") {
            return this.getCommandByName(name)
          }

          return this.getTopCommand(name, focused)
        },
      },
      getExecutionFields() {
        return { input, payload }
      },
    }
  }
}

export function getCommand<TTarget extends object, TEvent extends KeymapEvent>(
  state: CommandState<TTarget, TEvent>,
): Command<TTarget, TEvent> {
  return state.command
}

function normalizeCommands<TTarget extends object, TEvent extends KeymapEvent>(
  options: NormalizeCommandsOptions<TTarget, TEvent>,
): CommandState<TTarget, TEvent>[] {
  const normalizedCommands: CommandState<TTarget, TEvent>[] = []
  const seen = new Set<string>()

  for (const command of options.commands) {
    try {
      const mergedRequires: EventData = {}
      const matchers: RuntimeMatcher[] = []
      const conditionKeys = new Set<string>()
      let hasUnkeyedMatchers = false
      const normalizedName = normalizeCommandName(command.name)
      const fields = getCommandFields(command)
      const attrs: Attributes = {}

      if (seen.has(normalizedName)) {
        options.onError(
          "duplicate-command",
          { command: normalizedName },
          `Duplicate keymap command "${normalizedName}" in the same layer`,
        )
        continue
      }

      command.name = normalizedName

      for (const [fieldName, value] of Object.entries(fields)) {
        if (value === undefined) {
          continue
        }

        const compiler = options.commandFields.get(fieldName)
        if (!compiler) {
          continue
        }

        compiler(
          value,
          createFieldCompilerContext({
            fieldName,
            conditions: options.conditions,
            requirements: mergedRequires,
            conditionKeys,
            matchers,
            attrs,
            onUnkeyedMatcher() {
              hasUnkeyedMatchers = true
            },
          }),
        )
      }

      const commandState: CommandState<TTarget, TEvent> = {
        command,
        fields,
        attrs: Object.keys(attrs).length === 0 ? undefined : attrs,
        requires: Object.entries(mergedRequires),
        matchers,
        conditionKeys: [...conditionKeys],
        hasUnkeyedMatchers,
        matchCacheDirty: true,
      }

      seen.add(commandState.command.name)
      normalizedCommands.push(commandState)

    } catch (error) {
      options.onError(
        "register-command-failed",
        error,
        getErrorMessage(error, `Failed to register keymap command "${String(command.name)}"`),
      )
      continue
    }
  }

  return normalizedCommands
}

function resolveCommandWithResolvers<TTarget extends object, TEvent extends KeymapEvent>(
  command: string,
  resolvers: readonly CommandResolver<TTarget, TEvent>[],
  createContext: () => CommandResolverAttempt<TTarget, TEvent>,
  onResolverError: (error: unknown) => void,
): ResolvedCommandLookup<TTarget, TEvent> {
  if (resolvers.length === 0) {
    return { hadError: false }
  }

  let hadError = false

  for (const resolver of resolvers) {
    let resolvedCommand: Command<TTarget, TEvent> | undefined
    const attempt = createContext()

    try {
      resolvedCommand = resolver(command, attempt.context)
    } catch (error) {
      hadError = true
      onResolverError(error)
      continue
    }

    if (resolvedCommand) {
      return { hadError, resolved: getResolverCommandEntry(resolvedCommand, attempt.getExecutionFields()) }
    }
  }

  return { hadError }
}

function isCommandMetadataRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getCommandFields<TTarget extends object, TEvent extends KeymapEvent>(
  command: Command<TTarget, TEvent>,
): Readonly<Record<string, unknown>> {
  const fields: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(command)) {
    if (!RESERVED_COMMAND_FIELDS.has(name) && value !== undefined) {
      fields[name] = value
    }
  }

  return Object.keys(fields).length === 0 ? EMPTY_COMMAND_FIELDS : fields
}

function getResolverCommandEntry<TTarget extends object, TEvent extends KeymapEvent>(
  command: Command<TTarget, TEvent>,
  execution: CommandExecutionFields,
): ResolvedCommandEntry<TTarget, TEvent> {
  return {
    command,
    input: execution.input,
    payload: execution.payload,
  }
}

function getResolverCommandAttrs<TTarget extends object, TEvent extends KeymapEvent>(
  command: Command<TTarget, TEvent>,
): Readonly<Attributes> | undefined {
  const fields = getCommandFields(command)
  return fields === EMPTY_COMMAND_FIELDS ? undefined : fields
}

function queryLayerCommandEntries<TTarget extends object, TEvent extends KeymapEvent>(
  options: QueryLayerCommandEntriesOptions<TTarget, TEvent>,
): LayerCommandEntry<TTarget, TEvent>[] {
  const namespace = options.query?.namespace
  const normalizedSearch = options.query?.search?.trim().toLowerCase() ?? ""
  let searchKeys = DEFAULT_COMMAND_SEARCH_FIELDS as readonly string[]
  if (options.query?.searchIn && options.query.searchIn.length > 0) {
    searchKeys = options.query.searchIn
  }

  const filter = options.query?.filter
  let filterEntries: readonly [string, CommandQueryValue<TTarget, TEvent>][] | undefined
  let filterPredicate: ((command: Command<TTarget, TEvent>) => boolean) | undefined
  let exactNameFilter: ReadonlySet<string> | undefined

  if (typeof filter === "function") {
    filterPredicate = filter
  } else if (filter) {
    const entries = Object.entries(filter)
    const remainingEntries: [string, CommandQueryValue<TTarget, TEvent>][] = []

    for (const [key, matcher] of entries) {
      if (key === "name") {
        if (typeof matcher === "string") {
          exactNameFilter = new Set([matcher])
          continue
        }

        if (Array.isArray(matcher)) {
          const names = new Set<string>()
          for (const value of matcher) {
            if (typeof value === "string") {
              names.add(value)
            }
          }
          exactNameFilter = names
          continue
        }
      }

      remainingEntries.push([key, matcher])
    }

    filterEntries = remainingEntries.length > 0 ? remainingEntries : undefined
  }

  const results: LayerCommandEntry<TTarget, TEvent>[] = []

  if (exactNameFilter) {
    for (const entry of options.entries) {
      const commandState = entry.commandState
      const command = commandState.command

      if (!commandMatchesNamespace(commandState, namespace)) {
        continue
      }

      if (!commandMatchesSearch(commandState, normalizedSearch, searchKeys)) {
        continue
      }

      if (!exactNameFilter.has(command.name)) {
        continue
      }

      if (!commandMatchesFilters(commandState, filterEntries, options)) {
        continue
      }

      results.push(entry)
    }

    return results
  }

  for (const entry of options.entries) {
    const commandState = entry.commandState

    if (!commandMatchesNamespace(commandState, namespace)) {
      continue
    }

    if (!commandMatchesSearch(commandState, normalizedSearch, searchKeys)) {
      continue
    }

    if (!commandMatchesFilters(commandState, filterEntries, options)) {
      continue
    }

    const command = options.getCommand(commandState)

    if (filterPredicate) {
      let matches = false

      try {
        matches = filterPredicate(command)
      } catch (error) {
        options.onFilterError(error)
        continue
      }

      if (!matches) {
        continue
      }
    }

    results.push(entry)
  }

  return results
}

function commandMatchesSearch<TTarget extends object, TEvent extends KeymapEvent>(
  commandState: CommandState<TTarget, TEvent>,
  search: string,
  searchKeys: readonly string[],
): boolean {
  if (!search) {
    return true
  }

  for (const key of searchKeys) {
    if (commandKeyMatchesSearch(commandState, key, search)) {
      return true
    }
  }

  return false
}

function commandMatchesNamespace<TTarget extends object, TEvent extends KeymapEvent>(
  commandState: CommandState<TTarget, TEvent>,
  namespace: string | readonly string[] | undefined,
): boolean {
  const fields = commandState.fields
  if (namespace === undefined) {
    return true
  }

  if (!Object.prototype.hasOwnProperty.call(fields, "namespace")) {
    return false
  }

  return commandValueMatchesFilter(fields.namespace, namespace)
}

function commandMatchesFilters<TTarget extends object, TEvent extends KeymapEvent>(
  commandState: CommandState<TTarget, TEvent>,
  filters: readonly [string, CommandQueryValue<TTarget, TEvent>][] | undefined,
  options: CommandQueryMatchOptions<TTarget, TEvent>,
): boolean {
  if (!filters) {
    return true
  }

  for (const [key, matcher] of filters) {
    if (!commandKeyMatchesQuery(commandState, key, matcher, options)) {
      return false
    }
  }

  return true
}

function commandKeyMatchesSearch<TTarget extends object, TEvent extends KeymapEvent>(
  commandState: CommandState<TTarget, TEvent>,
  key: string,
  search: string,
): boolean {
  const command = commandState.command
  const fields = commandState.fields
  const attrs = commandState.attrs

  if (key === "name" && commandValueMatchesSearch(command.name, search)) {
    return true
  }

  if (
    Object.prototype.hasOwnProperty.call(fields, key) &&
    commandValueMatchesSearch(fields[key], search)
  ) {
    return true
  }

  if (attrs && Object.prototype.hasOwnProperty.call(attrs, key)) {
    return commandValueMatchesSearch(attrs[key], search)
  }

  return false
}

function commandKeyMatchesQuery<TTarget extends object, TEvent extends KeymapEvent>(
  commandState: CommandState<TTarget, TEvent>,
  key: string,
  matcher: CommandQueryValue<TTarget, TEvent>,
  options: CommandQueryMatchOptions<TTarget, TEvent>,
): boolean {
  if (typeof matcher === "function") {
    const command = commandState.command
    const fields = commandState.fields
    const attrs = commandState.attrs
    let commandView: Command<TTarget, TEvent> | undefined
    const getCommandView = () => {
      if (!commandView) {
        commandView = options.getCommand(commandState)
      }

      return commandView
    }
    let foundValue = false

    if (key === "name") {
      foundValue = true
      try {
        if (matcher(command.name, getCommandView())) {
          return true
        }
      } catch (error) {
        options.onFilterError(error)
        return false
      }
    }

    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      foundValue = true

      try {
        if (matcher(fields[key], getCommandView())) {
          return true
        }
      } catch (error) {
        options.onFilterError(error)
        return false
      }
    }

    if (attrs && Object.prototype.hasOwnProperty.call(attrs, key)) {
      foundValue = true

      try {
        if (matcher(attrs[key], getCommandView())) {
          return true
        }
      } catch (error) {
        options.onFilterError(error)
        return false
      }
    }

    if (!foundValue) {
      try {
        return matcher(undefined, getCommandView())
      } catch (error) {
        options.onFilterError(error)
        return false
      }
    }

    return false
  }

  return commandKeyMatchesExact(commandState, key, matcher)
}

function commandKeyMatchesExact<TTarget extends object, TEvent extends KeymapEvent>(
  commandState: CommandState<TTarget, TEvent>,
  key: string,
  matcher: unknown | readonly unknown[],
): boolean {
  const command = commandState.command
  const fields = commandState.fields
  const attrs = commandState.attrs

  if (key === "name" && commandValueMatchesFilter(command.name, matcher)) {
    return true
  }

  if (
    Object.prototype.hasOwnProperty.call(fields, key) &&
    commandValueMatchesFilter(fields[key], matcher)
  ) {
    return true
  }

  if (attrs && Object.prototype.hasOwnProperty.call(attrs, key)) {
    return commandValueMatchesFilter(attrs[key], matcher)
  }

  return false
}

function commandValueMatchesFilter(value: unknown, matcher: unknown | readonly unknown[]): boolean {
  if (Array.isArray(matcher)) {
    for (const expected of matcher) {
      if (commandValueMatchesExact(value, expected)) {
        return true
      }
    }

    return false
  }

  return commandValueMatchesExact(value, matcher)
}

function commandValueMatchesExact(value: unknown, expected: unknown): boolean {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (commandValueMatchesExact(entry, expected)) {
        return true
      }
    }

    return false
  }

  return Object.is(value, expected)
}

function commandValueMatchesSearch(value: unknown, search: string): boolean {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (commandValueMatchesSearch(entry, search)) {
        return true
      }
    }

    return false
  }

  if (typeof value === "string") {
    return value.toLowerCase().includes(search)
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).toLowerCase().includes(search)
  }

  return false
}
