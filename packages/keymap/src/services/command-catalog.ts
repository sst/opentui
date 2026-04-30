import { RESERVED_COMMAND_FIELDS } from "../schema.js"
import type {
  ActiveBinding,
  Attributes,
  CommandEntry,
  CommandContext,
  CommandDefinition,
  CommandBindingsQuery,
  CommandFieldCompiler,
  CommandFieldContext,
  CommandResolutionStatus,
  CommandQuery,
  CommandQueryValue,
  CommandRecord,
  CommandResolver,
  CommandResolverContext,
  CommandResult,
  CompiledBinding,
  EventData,
  KeymapEvent,
  KeymapHost,
  RegisteredCommand,
  ResolvedBindingCommand,
  RuntimeMatcher,
} from "../types.js"
import { normalizeCommandName } from "./primitives/command-normalization.js"
import {
  getActiveLayersForFocused,
  getFocusedTargetIfAvailable,
  isLayerActiveForFocused,
} from "./primitives/active-layers.js"
import type { ConditionService } from "./conditions.js"
import { mergeAttribute, mergeRequirement } from "./primitives/field-invariants.js"
import type { NotificationService } from "./notify.js"
import type {
  ActiveCommandView,
  CommandChainCacheState,
  LayerCommandEntry,
  RegisteredCommandView,
  ResolvedCommandEntry,
  State,
} from "./state.js"
import { getErrorMessage, snapshotDataValue } from "./values.js"

const DEFAULT_COMMAND_SEARCH_FIELDS = ["name"] as const

const SNAPSHOT_COMMAND_METADATA_OPTIONS = Object.freeze({
  deep: true,
  preserveNonPlainObjects: true,
})

const SNAPSHOT_FROZEN_COMMAND_METADATA_OPTIONS = Object.freeze({
  deep: true,
  freeze: true,
  preserveNonPlainObjects: true,
})

const EMPTY_COMMAND_FIELDS: Readonly<Record<string, unknown>> = Object.freeze({})

interface NormalizeRegisteredCommandsOptions<TTarget extends object, TEvent extends KeymapEvent> {
  commands: readonly CommandDefinition<TTarget, TEvent>[]
  commandFields: ReadonlyMap<string, CommandFieldCompiler>
  conditions: ConditionService<TTarget, TEvent>
  onError(code: string, error: unknown, message: string): void
}

interface QueryLayerCommandEntriesOptions<TTarget extends object, TEvent extends KeymapEvent> {
  entries: Iterable<LayerCommandEntry<TTarget, TEvent>>
  query?: CommandQuery<TTarget>
  getCommandRecord(command: RegisteredCommand<TTarget, TEvent>): CommandRecord
  onFilterError(error: unknown): void
}

interface CommandQueryMatchOptions<TTarget extends object, TEvent extends KeymapEvent> {
  getCommandRecord(command: RegisteredCommand<TTarget, TEvent>): CommandRecord
  onFilterError(error: unknown): void
}

interface CommandCatalogOptions {
  onCommandResolversChanged(): void
}

interface ResolvedCommandLookup<TTarget extends object, TEvent extends KeymapEvent> {
  resolved?: ResolvedBindingCommand<TTarget, TEvent>
  hadError: boolean
}

function createCommandChainCacheState<TTarget extends object, TEvent extends KeymapEvent>(): CommandChainCacheState<
  TTarget,
  TEvent
> {
  return {
    resolvedWithoutRecordChains: new Map(),
    resolvedWithRecordChains: new Map(),
    fallbackWithoutRecord: new Map(),
    fallbackWithRecord: new Map(),
    fallbackWithoutRecordErrors: new Set(),
    fallbackWithRecordErrors: new Set(),
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
    commands: readonly CommandDefinition<TTarget, TEvent>[],
  ): RegisteredCommand<TTarget, TEvent>[] {
    return normalizeRegisteredCommands({
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

  public getCommands(query?: CommandQuery<TTarget>): readonly CommandRecord[] {
    return this.getFilteredCommandEntries(query).map((entry) => getRegisteredCommandRecord(entry.command))
  }

  public getCommandEntries(query?: CommandQuery<TTarget>): readonly CommandEntry<TTarget, TEvent>[] {
    const context = this.getCommandQueryContext(query)
    const filteredEntries = this.getFilteredCommandEntries(query, context)
    if (filteredEntries.length === 0) {
      return []
    }

    const grouped = filteredEntries.map((entry) => ({
      entry,
      command: getRegisteredCommandRecord(entry.command),
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
    includeRecord: boolean,
  ): { entries?: readonly ResolvedCommandEntry<TTarget, TEvent>[]; hadError: boolean } {
    const view = this.getActiveCommandView(focused)
    const entries = this.getResolvedCommandChainFromView(
      view,
      command,
      focused,
      includeRecord,
      "active",
      view.chainsByName.get(command),
    )
    const hadError = (includeRecord ? view.fallbackWithRecordErrors : view.fallbackWithoutRecordErrors).has(command)

    return { entries, hadError }
  }

  public getRegisteredResolvedEntries(
    command: string,
    includeRecord: boolean,
  ): readonly ResolvedCommandEntry<TTarget, TEvent>[] | undefined {
    const view = this.getRegisteredCommandView()
    const cache = includeRecord ? view.resolvedWithRecordChains : view.resolvedWithoutRecordChains
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
        resolved: resolveRegisteredCommand(entry.command, { includeRecord }),
      })
    }

    cache.set(command, resolved)
    return resolved
  }

  public getActiveRegisteredResolvedEntries(
    command: string,
    focused: TTarget | null,
    includeRecord: boolean,
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
        resolved: resolveRegisteredCommand(entry.command, { includeRecord }),
      })
    }

    return resolved
  }

  public resolveRegisteredResolverFallback(
    command: string,
    includeRecord: boolean,
  ): { resolved?: ResolvedBindingCommand<TTarget, TEvent>; hadError: boolean } {
    return this.resolveCommandWithResolvers(command, null, { includeRecord, mode: "registered" })
  }

  public resolveActiveResolverFallback(
    command: string,
    focused: TTarget | null,
    includeRecord: boolean,
  ): { resolved?: ResolvedBindingCommand<TTarget, TEvent>; hadError: boolean } {
    return this.resolveCommandWithResolvers(command, focused, { includeRecord, mode: "active" })
  }

  public getCommandAttrs(command: string, focused: TTarget | null): Readonly<Attributes> | undefined {
    const top = this.getTopResolvedCommand(command, focused, false)
    return top?.resolved.attrs
  }

  public getTopCommandRecord(command: string, focused: TTarget | null): CommandRecord | undefined {
    const top = this.getTopResolvedCommand(command, focused, true)
    return top?.resolved.record
  }

  public getTopRegisteredCommandRecord(command: string): CommandRecord | undefined {
    const top = this.getTopRegisteredCommand(command)
    return top ? getRegisteredCommandRecord(top.command) : undefined
  }

  public getDispatchUnavailableCommandState(
    command: string,
    focused: TTarget | null,
    includeRecord: boolean,
  ): { reason: "inactive" | "disabled"; command?: CommandRecord } | undefined {
    const view = this.getRegisteredCommandView()
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

      if (!this.conditions.layerMatchesRuntimeState(entry.layer) || !this.conditions.matchesConditions(entry.command)) {
        disabledEntry ??= entry
      }
    }

    const unavailableEntry = disabledEntry ?? inactiveEntry
    if (!unavailableEntry) {
      return undefined
    }

    return {
      reason: disabledEntry ? "disabled" : "inactive",
      command: includeRecord ? getRegisteredCommandRecord(unavailableEntry.command) : undefined,
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

        for (const command of layer.commands) {
          if (command.hasUnkeyedMatchers) {
            cacheable = false
          }

          if (!this.conditions.matchesConditions(command)) {
            continue
          }

          const entry: LayerCommandEntry<TTarget, TEvent> = { layer, command }
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

  public getRegisteredCommandView(): RegisteredCommandView<TTarget, TEvent> {
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

      for (const command of layer.commands) {
        const entry: LayerCommandEntry<TTarget, TEvent> = { layer, command }
        entries.push(entry)

        const existing = chainsByName.get(command.name)
        if (existing) {
          existing.push(entry)
        } else {
          chainsByName.set(command.name, [entry])
        }
      }
    }

    const view: RegisteredCommandView<TTarget, TEvent> = {
      entries,
      chainsByName,
      ...createCommandChainCacheState(),
    }

    this.state.commands.registeredCommandViewVersion = cacheVersion
    this.state.commands.registeredCommandView = view
    return view
  }

  public isBindingVisible(
    binding: CompiledBinding<TTarget, TEvent>,
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

    return this.getFallbackResolvedCommand(activeView, binding.command, focused, false, "active") !== undefined
  }

  public getBindingCommandAttrs(
    binding: CompiledBinding<TTarget, TEvent>,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): Readonly<Attributes> | undefined {
    if (typeof binding.command !== "string") {
      return undefined
    }

    const active = activeView.reachableByName.get(binding.command)
    if (active) {
      return active.command.attrs
    }

    const fallback = this.getFallbackResolvedCommand(activeView, binding.command, focused, false, "active")
    return fallback?.resolved.attrs
  }

  public getCommandResolutionStatus(
    command: string,
    layerCommands?: ReadonlyMap<string, RegisteredCommand<TTarget, TEvent>>,
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

  private getTopResolvedCommand(
    command: string,
    focused: TTarget | null,
    includeRecord: boolean,
  ): ResolvedCommandEntry<TTarget, TEvent> | undefined {
    const activeView = this.getActiveCommandView(focused)
    const active = activeView.reachableByName.get(command)
    if (active) {
      return {
        target: active.layer.target,
        resolved: resolveRegisteredCommand(active.command, { includeRecord }),
      }
    }

    return this.getFallbackResolvedCommand(activeView, command, focused, includeRecord, "active")
  }

  private getTopRegisteredCommand(command: string): LayerCommandEntry<TTarget, TEvent> | undefined {
    const view = this.getRegisteredCommandView()
    return view.chainsByName.get(command)?.[0]
  }

  private getFallbackResolvedCommand(
    view: CommandChainCacheState<TTarget, TEvent>,
    command: string,
    focused: TTarget | null,
    includeRecord: boolean,
    mode: "active" | "registered",
  ): ResolvedCommandEntry<TTarget, TEvent> | undefined {
    const cache = includeRecord ? view.fallbackWithRecord : view.fallbackWithoutRecord
    const errorCache = includeRecord ? view.fallbackWithRecordErrors : view.fallbackWithoutRecordErrors
    if (cache.has(command)) {
      const cached = cache.get(command)
      return cached ? { resolved: cached } : undefined
    }

    const lookup = this.resolveCommandWithResolvers(command, focused, { includeRecord, mode })
    cache.set(command, lookup.resolved ?? null)
    if (lookup.hadError) {
      errorCache.add(command)
    }

    if (!lookup.resolved) {
      return undefined
    }

    return { resolved: lookup.resolved }
  }

  private getResolvedCommandChainFromView(
    view: CommandChainCacheState<TTarget, TEvent>,
    command: string,
    focused: TTarget | null,
    includeRecord: boolean,
    mode: "active" | "registered",
    activeChain?: readonly LayerCommandEntry<TTarget, TEvent>[],
  ): readonly ResolvedCommandEntry<TTarget, TEvent>[] | undefined {
    const cache = includeRecord ? view.resolvedWithRecordChains : view.resolvedWithoutRecordChains
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
          resolved: resolveRegisteredCommand(entry.command, { includeRecord }),
        })
      }
    }

    const fallback = this.getFallbackResolvedCommand(view, command, focused, includeRecord, mode)
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
        entries.push({ layer, command })
      }
    }

    this.state.commands.registeredCommandEntriesCacheVersion = cacheVersion
    this.state.commands.registeredCommandEntriesCache = entries
    return entries
  }

  private getCommandQueryContext(query?: CommandQuery<TTarget>): {
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
    query?: CommandQuery<TTarget>,
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
      getCommandRecord: (command) => getRegisteredCommandRecord(command),
      onFilterError: (error) => {
        this.notify.emitError("command-query-filter-error", error, "[Keymap] Error in command query filter:")
      },
    })
  }

  private collectCommandEntryBindings(
    grouped: Array<{
      entry: LayerCommandEntry<TTarget, TEvent>
      command: CommandRecord
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
        for (const binding of layer.compiledBindings) {
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
      if (layer.compiledBindings.length === 0 || !this.conditions.layerMatchesRuntimeState(layer)) {
        continue
      }

      for (const binding of layer.compiledBindings) {
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
        for (const binding of layer.compiledBindings) {
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
      if (layer.compiledBindings.length === 0 || !this.conditions.layerMatchesRuntimeState(layer)) {
        continue
      }

      for (const binding of layer.compiledBindings) {
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
      command: CommandRecord
      bindings: ActiveBinding<TTarget, TEvent>[]
    }>,
    indexesByName: ReadonlyMap<string, readonly number[]>,
    binding: CompiledBinding<TTarget, TEvent>,
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

      item.bindings.push(this.createActiveBinding(binding, item.command.attrs))
    }
  }

  private collectBindingForCommandBindings(
    bindingsByCommand: Map<string, ActiveBinding<TTarget, TEvent>[]>,
    binding: CompiledBinding<TTarget, TEvent>,
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
    binding: CompiledBinding<TTarget, TEvent>,
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
    binding: CompiledBinding<TTarget, TEvent>,
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
      return this.getTopRegisteredCommand(binding.command)?.command.attrs
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
    options?: { includeRecord?: boolean; mode?: "active" | "registered" },
  ): ResolvedCommandLookup<TTarget, TEvent> {
    const includeRecord = options?.includeRecord === true
    const context = this.createCommandResolverContext(includeRecord, focused, options?.mode ?? "active")

    return resolveCommandWithResolvers(command, this.state.commands.commandResolvers.values(), context, (error) => {
      this.notify.emitError("command-resolver-error", error, `[Keymap] Error in command resolver for "${command}":`)
    })
  }

  private createCommandResolverContext(
    includeRecord: boolean,
    focused: TTarget | null,
    mode: "active" | "registered",
  ): CommandResolverContext {
    return {
      getCommandAttrs: (name: string) => {
        if (mode === "registered") {
          return this.getTopRegisteredCommand(name)?.command.attrs
        }

        return this.getCommandAttrs(name, focused)
      },
      getCommandRecord: (name: string) => {
        if (!includeRecord) {
          return undefined
        }

        if (mode === "registered") {
          return this.getTopRegisteredCommandRecord(name)
        }

        return this.getTopCommandRecord(name, focused)
      },
    }
  }
}

export function getRegisteredCommandRecord<TTarget extends object, TEvent extends KeymapEvent>(
  command: RegisteredCommand<TTarget, TEvent>,
): CommandRecord {
  if (command.record) {
    return command.record
  }

  let fields = EMPTY_COMMAND_FIELDS
  if (command.fields !== EMPTY_COMMAND_FIELDS && Object.keys(command.fields).length > 0) {
    fields = snapshotDataValue(command.fields, SNAPSHOT_FROZEN_COMMAND_METADATA_OPTIONS) as Readonly<
      Record<string, unknown>
    >
  }

  const record = command.attrs
    ? Object.freeze({
        name: command.name,
        fields,
        attrs: snapshotDataValue(command.attrs, SNAPSHOT_FROZEN_COMMAND_METADATA_OPTIONS) as Readonly<Attributes>,
      })
    : Object.freeze({
        name: command.name,
        fields,
      })

  command.record = record
  return record
}

export function resolveRegisteredCommand<TTarget extends object, TEvent extends KeymapEvent>(
  command: RegisteredCommand<TTarget, TEvent>,
  options?: { includeRecord?: boolean },
): ResolvedBindingCommand<TTarget, TEvent> {
  const includeRecord = options?.includeRecord === true
  if (includeRecord) {
    const existing = command.resolvedWithRecord
    if (existing) {
      return existing
    }

    const resolved: ResolvedBindingCommand<TTarget, TEvent> = {
      run: createRegisteredCommandRunner(command),
    }

    if (command.attrs) {
      resolved.attrs = command.attrs
    }

    resolved.record = getRegisteredCommandRecord(command)
    command.resolvedWithRecord = resolved
    return resolved
  }

  const existing = command.resolved
  if (existing) {
    return existing
  }

  const resolved: ResolvedBindingCommand<TTarget, TEvent> = {
    run: createRegisteredCommandRunner(command),
  }

  if (command.attrs) {
    resolved.attrs = command.attrs
  }

  command.resolved = resolved
  return resolved
}

function normalizeRegisteredCommands<TTarget extends object, TEvent extends KeymapEvent>(
  options: NormalizeRegisteredCommandsOptions<TTarget, TEvent>,
): RegisteredCommand<TTarget, TEvent>[] {
  const normalizedCommands: RegisteredCommand<TTarget, TEvent>[] = []
  const seen = new Set<string>()

  for (const command of options.commands) {
    let normalizedCommand: RegisteredCommand<TTarget, TEvent> | undefined

    try {
      const mergedAttrs: Attributes = {}
      const mergedFields: Record<string, unknown> = {}
      const mergedRequires: EventData = {}
      const matchers: RuntimeMatcher[] = []
      const conditionKeys = new Set<string>()
      let hasUnkeyedMatchers = false
      const normalizedName = normalizeCommandName(command.name)

      if (seen.has(normalizedName)) {
        options.onError(
          "duplicate-command",
          { command: normalizedName },
          `Duplicate keymap command "${normalizedName}" in the same layer`,
        )
        continue
      }

      for (const [fieldName, value] of Object.entries(command)) {
        if (RESERVED_COMMAND_FIELDS.has(fieldName) || value === undefined) {
          continue
        }

        mergedFields[fieldName] = snapshotDataValue(value, SNAPSHOT_COMMAND_METADATA_OPTIONS)

        const compiler = options.commandFields.get(fieldName)
        if (!compiler) {
          continue
        }

        compiler(
          value,
          createCommandFieldContext(
            mergedAttrs,
            mergedRequires,
            conditionKeys,
            matchers,
            options.conditions,
            fieldName,
            {
              onUnkeyedMatcher() {
                hasUnkeyedMatchers = true
              },
            },
          ),
        )
      }

      const attrs = Object.keys(mergedAttrs).length === 0 ? undefined : Object.freeze(mergedAttrs)
      const fields = Object.keys(mergedFields).length === 0 ? EMPTY_COMMAND_FIELDS : Object.freeze(mergedFields)

      normalizedCommand = {
        name: normalizedName,
        fields,
        run: command.run,
        requires: Object.entries(mergedRequires),
        matchers,
        conditionKeys: [...conditionKeys],
        hasUnkeyedMatchers,
        matchCacheDirty: true,
      }

      if (attrs) {
        normalizedCommand.attrs = attrs
      }
    } catch (error) {
      options.onError(
        "register-command-failed",
        error,
        getErrorMessage(error, `Failed to register keymap command "${String(command.name)}"`),
      )
      continue
    }

    seen.add(normalizedCommand.name)
    normalizedCommands.push(normalizedCommand)
  }

  return normalizedCommands
}

function createCommandFieldContext<TTarget extends object, TEvent extends KeymapEvent>(
  mergedAttrs: Attributes,
  mergedRequires: EventData,
  conditionKeys: Set<string>,
  matchers: RuntimeMatcher[],
  conditions: ConditionService<TTarget, TEvent>,
  fieldName: string,
  options: {
    onUnkeyedMatcher(): void
  },
): CommandFieldContext {
  return {
    require(name, requiredValue) {
      mergeRequirement(mergedRequires, name, requiredValue, `field ${fieldName}`)
      conditionKeys.add(name)
    },
    attr(name, attributeValue) {
      mergeAttribute(
        mergedAttrs,
        name,
        snapshotDataValue(attributeValue, SNAPSHOT_COMMAND_METADATA_OPTIONS),
        `field ${fieldName}`,
      )
    },
    activeWhen(matcher) {
      const runtimeMatcher = conditions.buildRuntimeMatcher(matcher, `field ${fieldName}`)
      if (!runtimeMatcher.cacheable) {
        options.onUnkeyedMatcher()
      }
      matchers.push(runtimeMatcher)
    },
  }
}

function createRegisteredCommandRunner<TTarget extends object, TEvent extends KeymapEvent>(
  command: RegisteredCommand<TTarget, TEvent>,
): (ctx: CommandContext<TTarget, TEvent>) => CommandResult {
  if (command.runner) {
    return command.runner
  }

  const runner = (ctx: CommandContext<TTarget, TEvent>) => {
    return command.run({
      ...ctx,
      command: getRegisteredCommandRecord(command),
    })
  }

  command.runner = runner
  return runner
}

function resolveCommandWithResolvers<TTarget extends object, TEvent extends KeymapEvent>(
  command: string,
  resolvers: readonly CommandResolver<TTarget, TEvent>[],
  context: CommandResolverContext,
  onResolverError: (error: unknown) => void,
): ResolvedCommandLookup<TTarget, TEvent> {
  if (resolvers.length === 0) {
    return { hadError: false }
  }

  let hadError = false

  for (const resolver of resolvers) {
    let resolved: ResolvedBindingCommand<TTarget, TEvent> | undefined

    try {
      resolved = resolver(command, context)
    } catch (error) {
      hadError = true
      onResolverError(error)
      continue
    }

    if (resolved) {
      return { hadError, resolved }
    }
  }

  return { hadError }
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
  let filterEntries: readonly [string, CommandQueryValue][] | undefined
  let filterPredicate: ((command: CommandRecord) => boolean) | undefined
  let exactNameFilter: ReadonlySet<string> | undefined

  if (typeof filter === "function") {
    filterPredicate = filter
  } else if (filter) {
    const entries = Object.entries(filter)
    const remainingEntries: [string, CommandQueryValue][] = []

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
      const command = entry.command

      if (!commandMatchesNamespace(command, namespace)) {
        continue
      }

      if (!commandMatchesSearch(command, normalizedSearch, searchKeys)) {
        continue
      }

      if (!exactNameFilter.has(command.name)) {
        continue
      }

      if (!commandMatchesFilters(command, filterEntries, options)) {
        continue
      }

      results.push(entry)
    }

    return results
  }

  for (const entry of options.entries) {
    const command = entry.command

    if (!commandMatchesNamespace(command, namespace)) {
      continue
    }

    if (!commandMatchesSearch(command, normalizedSearch, searchKeys)) {
      continue
    }

    if (!commandMatchesFilters(command, filterEntries, options)) {
      continue
    }

    const record = options.getCommandRecord(command)

    if (filterPredicate) {
      let matches = false

      try {
        matches = filterPredicate(record)
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
  command: RegisteredCommand<TTarget, TEvent>,
  search: string,
  searchKeys: readonly string[],
): boolean {
  if (!search) {
    return true
  }

  for (const key of searchKeys) {
    if (commandKeyMatchesSearch(command, key, search)) {
      return true
    }
  }

  return false
}

function commandMatchesNamespace<TTarget extends object, TEvent extends KeymapEvent>(
  command: RegisteredCommand<TTarget, TEvent>,
  namespace: string | readonly string[] | undefined,
): boolean {
  if (namespace === undefined) {
    return true
  }

  if (!Object.prototype.hasOwnProperty.call(command.fields, "namespace")) {
    return false
  }

  return commandValueMatchesFilter(command.fields.namespace, namespace)
}

function commandMatchesFilters<TTarget extends object, TEvent extends KeymapEvent>(
  command: RegisteredCommand<TTarget, TEvent>,
  filters: readonly [string, CommandQueryValue][] | undefined,
  options: CommandQueryMatchOptions<TTarget, TEvent>,
): boolean {
  if (!filters) {
    return true
  }

  for (const [key, matcher] of filters) {
    if (!commandKeyMatchesQuery(command, key, matcher, options)) {
      return false
    }
  }

  return true
}

function commandKeyMatchesSearch<TTarget extends object, TEvent extends KeymapEvent>(
  command: RegisteredCommand<TTarget, TEvent>,
  key: string,
  search: string,
): boolean {
  if (key === "name" && commandValueMatchesSearch(command.name, search)) {
    return true
  }

  if (
    Object.prototype.hasOwnProperty.call(command.fields, key) &&
    commandValueMatchesSearch(command.fields[key], search)
  ) {
    return true
  }

  if (command.attrs && Object.prototype.hasOwnProperty.call(command.attrs, key)) {
    return commandValueMatchesSearch(command.attrs[key], search)
  }

  return false
}

function commandKeyMatchesQuery<TTarget extends object, TEvent extends KeymapEvent>(
  command: RegisteredCommand<TTarget, TEvent>,
  key: string,
  matcher: CommandQueryValue,
  options: CommandQueryMatchOptions<TTarget, TEvent>,
): boolean {
  if (typeof matcher === "function") {
    let record: CommandRecord | undefined
    const getRecord = () => {
      if (!record) {
        record = options.getCommandRecord(command)
      }

      return record
    }
    let foundValue = false

    if (key === "name") {
      foundValue = true
      try {
        if (matcher(command.name, getRecord())) {
          return true
        }
      } catch (error) {
        options.onFilterError(error)
        return false
      }
    }

    if (Object.prototype.hasOwnProperty.call(command.fields, key)) {
      foundValue = true

      try {
        if (matcher(command.fields[key], getRecord())) {
          return true
        }
      } catch (error) {
        options.onFilterError(error)
        return false
      }
    }

    if (command.attrs && Object.prototype.hasOwnProperty.call(command.attrs, key)) {
      foundValue = true

      try {
        if (matcher(command.attrs[key], getRecord())) {
          return true
        }
      } catch (error) {
        options.onFilterError(error)
        return false
      }
    }

    if (!foundValue) {
      try {
        return matcher(undefined, getRecord())
      } catch (error) {
        options.onFilterError(error)
        return false
      }
    }

    return false
  }

  return commandKeyMatchesExact(command, key, matcher)
}

function commandKeyMatchesExact<TTarget extends object, TEvent extends KeymapEvent>(
  command: RegisteredCommand<TTarget, TEvent>,
  key: string,
  matcher: unknown | readonly unknown[],
): boolean {
  if (key === "name" && commandValueMatchesFilter(command.name, matcher)) {
    return true
  }

  if (
    Object.prototype.hasOwnProperty.call(command.fields, key) &&
    commandValueMatchesFilter(command.fields[key], matcher)
  ) {
    return true
  }

  if (command.attrs && Object.prototype.hasOwnProperty.call(command.attrs, key)) {
    return commandValueMatchesFilter(command.attrs[key], matcher)
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
