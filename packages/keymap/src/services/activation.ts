import type { Emitter } from "../lib/emitter.js"
import type {
  ActiveBinding,
  ActiveKey,
  ActiveKeyOptions,
  ActiveKeySelection,
  ActiveKeyState,
  BindingState,
  Hooks,
  KeyMatch,
  KeymapEvent,
  KeymapHost,
  PendingSequenceCapture,
  KeySequencePart,
  NormalizedKeyStroke,
  PendingSequenceState,
  RegisteredLayer,
} from "../types.js"
import {
  getActiveLayersForFocused,
  getFocusedTargetIfAvailable,
  isLayerActiveForFocused,
} from "./primitives/active-layers.js"
import type { CommandCatalogService } from "./command-catalog.js"
import { cloneKeyStroke, createKeySequencePart, stringifyKeyStroke } from "./keys.js"
import type { ConditionService } from "./conditions.js"
import type { NotificationService } from "./notify.js"
import type { ActiveCommandView, State } from "./state.js"

function getLiveHost<TTarget extends object, TEvent extends KeymapEvent>(
  host: KeymapHost<TTarget, TEvent>,
): KeymapHost<TTarget, TEvent> {
  if (host.isDestroyed) {
    throw new Error("Cannot use a keymap after its host was destroyed")
  }

  return host
}

function isSamePendingSequence<TTarget extends object, TEvent extends KeymapEvent>(
  current: PendingSequenceState<TTarget, TEvent> | null,
  next: PendingSequenceState<TTarget, TEvent> | null,
): boolean {
  if (current === next) {
    return true
  }

  if (!current || !next) {
    return false
  }

  if (current.captures.length !== next.captures.length) {
    return false
  }

  for (let index = 0; index < current.captures.length; index += 1) {
    const left = current.captures[index]
    const right = next.captures[index]
    if (
      !left ||
      !right ||
      left.layer !== right.layer ||
      left.binding !== right.binding ||
      left.index !== right.index ||
      left.parts.length !== right.parts.length
    ) {
      return false
    }

    for (let partIndex = 0; partIndex < left.parts.length; partIndex += 1) {
      if (left.parts[partIndex]?.match !== right.parts[partIndex]?.match) {
        return false
      }
    }

    const leftPatterns = left.patterns ?? []
    const rightPatterns = right.patterns ?? []
    if (leftPatterns.length !== rightPatterns.length) {
      return false
    }

    for (let patternIndex = 0; patternIndex < leftPatterns.length; patternIndex += 1) {
      const leftPattern = leftPatterns[patternIndex]
      const rightPattern = rightPatterns[patternIndex]
      if (!leftPattern || !rightPattern || leftPattern.name !== rightPattern.name) {
        return false
      }

      if (leftPattern.values.length !== rightPattern.values.length) {
        return false
      }

      for (let valueIndex = 0; valueIndex < leftPattern.values.length; valueIndex += 1) {
        if (!Object.is(leftPattern.values[valueIndex], rightPattern.values[valueIndex])) {
          return false
        }
      }
    }
  }

  return true
}

interface ActivationOptions<TTarget extends object, TEvent extends KeymapEvent> {
  onPendingSequenceChanged?: (
    previous: PendingSequenceState<TTarget, TEvent> | null,
    next: PendingSequenceState<TTarget, TEvent> | null,
  ) => void
}

interface ActiveKeyOption<TTarget extends object, TEvent extends KeymapEvent> {
  part: KeySequencePart
  binding: BindingState<TTarget, TEvent>
  index: number
  exact: boolean
  continues: boolean
}

export class ActivationService<TTarget extends object, TEvent extends KeymapEvent> {
  #state: State<TTarget, TEvent>
  #host: KeymapHost<TTarget, TEvent>
  #hooks: Emitter<Hooks<TTarget, TEvent>>
  #notify: NotificationService<TTarget, TEvent>
  #conditions: ConditionService<TTarget, TEvent>
  #catalog: CommandCatalogService<TTarget, TEvent>
  #options: ActivationOptions<TTarget, TEvent>

  constructor(
    state: State<TTarget, TEvent>,
    host: KeymapHost<TTarget, TEvent>,
    hooks: Emitter<Hooks<TTarget, TEvent>>,
    notify: NotificationService<TTarget, TEvent>,
    conditions: ConditionService<TTarget, TEvent>,
    catalog: CommandCatalogService<TTarget, TEvent>,
    options: ActivationOptions<TTarget, TEvent> = {},
  ) {
    this.#state = state
    this.#host = host
    this.#hooks = hooks
    this.#notify = notify
    this.#conditions = conditions
    this.#catalog = catalog
    this.#options = options
  }

  public getFocusedTarget(): TTarget | null {
    return getLiveHost(this.#host).getFocusedTarget()
  }

  public getFocusedTargetIfAvailable(): TTarget | null {
    return getFocusedTargetIfAvailable(this.#host)
  }

  public setPendingSequence(next: PendingSequenceState<TTarget, TEvent> | null): void {
    const previous = this.#state.projection.pendingSequence
    if (isSamePendingSequence(previous, next)) {
      return
    }

    this.#state.projection.pendingSequence = next
    this.#options.onPendingSequenceChanged?.(previous, next)
    this.#notifyPendingSequenceChange()
    this.#notify.queueStateChange()
  }

  public ensureValidPendingSequence(): PendingSequenceState<TTarget, TEvent> | undefined {
    const pending = this.#state.projection.pendingSequence
    if (!pending) {
      return undefined
    }

    const focused = this.getFocusedTarget()
    const activeView = this.#catalog.getActiveCommandView(focused)
    const captures = pending.captures.filter((capture) => {
      return (
        this.#state.layers.layers.has(capture.layer) &&
        this.isLayerActiveForFocused(capture.layer, focused) &&
        this.#conditions.layerMatchesRuntimeState(capture.layer) &&
        this.#bindingMatchesRuntimeState(capture.binding, focused, activeView) &&
        this.#captureHasContinuations(capture)
      )
    })

    if (captures.length === 0) {
      this.setPendingSequence(null)
      return undefined
    }

    if (captures.length !== pending.captures.length) {
      this.setPendingSequence({ captures })
    }

    return this.#state.projection.pendingSequence ?? undefined
  }

  public revalidatePendingSequenceIfNeeded(): void {
    if (this.#host.isDestroyed || !this.#state.projection.pendingSequence) {
      return
    }

    this.ensureValidPendingSequence()
  }

  public hasPendingSequenceState(): boolean {
    return !this.#host.isDestroyed && this.#state.projection.pendingSequence !== null
  }

  public getPendingSequence(): readonly KeySequencePart[] {
    const pending = this.ensureValidPendingSequence()
    return pending ? this.collectSequencePartsFromPending(pending) : []
  }

  public popPendingSequence(): boolean {
    const pending = this.ensureValidPendingSequence()
    if (!pending) {
      return false
    }

    const firstCapture = pending.captures[0]
    if (!firstCapture || firstCapture.parts.length <= 1) {
      this.setPendingSequence(null)
      return true
    }

    const nextCaptures: PendingSequenceCapture<TTarget, TEvent>[] = []

    for (const capture of pending.captures) {
      const nextCapture = this.#popCapture(capture)
      if (!nextCapture) {
        continue
      }

      nextCaptures.push(nextCapture)
    }

    if (nextCaptures.length === 0) {
      this.setPendingSequence(null)
      return true
    }

    this.setPendingSequence({ captures: nextCaptures })
    return true
  }

  public getActiveKeys(options?: ActiveKeyOptions): readonly ActiveKey<TTarget, TEvent>[] {
    const includeBindings = options?.includeBindings === true
    const includeMetadata = options?.includeMetadata === true

    const focused = this.getFocusedTarget()
    const activeView = this.#catalog.getActiveCommandView(focused)
    const pending = this.ensureValidPendingSequence()
    const activeLayers = pending ? [] : this.getActiveLayers(focused)

    return pending
      ? this.#collectActiveKeysFromPending(pending.captures, includeBindings, includeMetadata, focused, activeView)
      : this.#collectActiveKeysAtRoot(activeLayers, includeBindings, includeMetadata, focused, activeView)
  }

  public getActiveKeysForCaptures(
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    options?: ActiveKeyOptions,
  ): readonly ActiveKey<TTarget, TEvent>[] {
    const includeBindings = options?.includeBindings === true
    const includeMetadata = options?.includeMetadata === true
    const focused = this.getFocusedTarget()
    const activeView = this.#catalog.getActiveCommandView(focused)

    return this.#collectActiveKeysFromPending(captures, includeBindings, includeMetadata, focused, activeView)
  }

  public getActiveKeysForFocused(
    focused: TTarget | null,
    options?: ActiveKeyOptions,
  ): readonly ActiveKey<TTarget, TEvent>[] {
    const includeBindings = options?.includeBindings === true
    const includeMetadata = options?.includeMetadata === true
    const currentFocused = this.getFocusedTargetIfAvailable()
    const pending = focused === currentFocused ? this.ensureValidPendingSequence() : undefined
    const activeView = this.#catalog.getActiveCommandView(focused)

    if (pending) {
      return this.#collectActiveKeysFromPending(pending.captures, includeBindings, includeMetadata, focused, activeView)
    }

    return this.#collectActiveKeysAtRoot(
      this.getActiveLayers(focused),
      includeBindings,
      includeMetadata,
      focused,
      activeView,
    )
  }

  public getActiveLayers(focused: TTarget | null): RegisteredLayer<TTarget, TEvent>[] {
    return getActiveLayersForFocused(this.#state.layers, this.#host, focused) as RegisteredLayer<TTarget, TEvent>[]
  }

  public refreshActiveLayers(focused: TTarget | null = this.getFocusedTargetIfAvailable()): void {
    getActiveLayersForFocused(this.#state.layers, this.#host, focused)
  }

  public isLayerActiveForFocused(layer: RegisteredLayer<TTarget, TEvent>, focused: TTarget | null): boolean {
    return isLayerActiveForFocused(this.#host, layer, focused)
  }

  #popCapture(
    capture: PendingSequenceCapture<TTarget, TEvent>,
  ): PendingSequenceCapture<TTarget, TEvent> | undefined {
    const lastPart = capture.parts.at(-1)
    if (!lastPart || capture.parts.length <= 1) {
      return undefined
    }

    let index = capture.index - 1
    let patterns = capture.patterns
    if (lastPart.patternName) {
      const lastPattern = patterns?.at(-1)
      if (lastPattern?.name === lastPart.patternName) {
        if (lastPattern.values.length > 1) {
          index = capture.index
          patterns = [
            ...(patterns ?? []).slice(0, -1),
            {
              ...lastPattern,
              values: lastPattern.values.slice(0, -1),
              parts: lastPattern.parts.slice(0, -1),
            },
          ]
        } else {
          patterns = (patterns ?? []).slice(0, -1)
        }
      }
    }

    return {
      layer: capture.layer,
      binding: capture.binding,
      index,
      parts: capture.parts.slice(0, -1),
      patterns,
    }
  }

  #getPatternCaptureCount(capture: PendingSequenceCapture<TTarget, TEvent>): number {
    const part = capture.binding.sequence[capture.index]
    if (!part?.patternName) {
      return 0
    }

    const captured = capture.patterns?.at(-1)
    return captured?.name === part.patternName ? captured.values.length : 0
  }

  #capturePatternHasMinimum(capture: PendingSequenceCapture<TTarget, TEvent>): boolean {
    const part = capture.binding.sequence[capture.index]
    if (!part?.patternName) {
      return true
    }

    const pattern = this.#state.environment.sequencePatterns.get(part.patternName)
    return !pattern || this.#getPatternCaptureCount(capture) >= pattern.min
  }

  #captureHasContinuations(capture: PendingSequenceCapture<TTarget, TEvent>): boolean {
    const part = capture.binding.sequence[capture.index]
    if (part?.patternName) {
      const pattern = this.#state.environment.sequencePatterns.get(part.patternName)
      if (pattern && this.#getPatternCaptureCount(capture) < pattern.max) {
        return true
      }
    }

    return this.#capturePatternHasMinimum(capture) && capture.index + 1 < capture.binding.sequence.length
  }

  #getActiveKeyOptionsForBinding(binding: BindingState<TTarget, TEvent>): ActiveKeyOption<TTarget, TEvent>[] {
    const part = binding.sequence[0]
    if (!part) {
      return []
    }

    return [
      {
        part,
        binding,
        index: 0,
        exact: binding.sequence.length === 1,
        continues: binding.sequence.length > 1,
      },
    ]
  }

  #getActiveKeyOptionsForCapture(
    capture: PendingSequenceCapture<TTarget, TEvent>,
  ): ActiveKeyOption<TTarget, TEvent>[] {
    if (!this.#capturePatternHasMinimum(capture)) {
      return []
    }

    const index = capture.index + 1
    const part = capture.binding.sequence[index]
    if (!part) {
      return []
    }

    return [
      {
        part,
        binding: capture.binding,
        index,
        exact: index === capture.binding.sequence.length - 1,
        continues: index < capture.binding.sequence.length - 1,
      },
    ]
  }

  public collectSequencePartsFromPending(pending: PendingSequenceState<TTarget, TEvent>): KeySequencePart[] {
    const firstCapture = pending.captures[0]
    if (!firstCapture || firstCapture.parts.length === 0) {
      return []
    }

    const parts: KeySequencePart[] = []
    for (let index = 0; index < firstCapture.parts.length; index += 1) {
      const firstPart = firstCapture.parts[index]
      if (!firstPart) continue
      let display: string | undefined
      let tokenName: string | undefined
      let hasDisplayConflict = false
      let hasTokenConflict = false

      for (const capture of pending.captures) {
        const part = capture.parts[index]
        if (!part) {
          continue
        }

        if (display === undefined) {
          display = part.display
          tokenName = part.tokenName
          continue
        }

        if (!hasDisplayConflict && display !== part.display) {
          hasDisplayConflict = true
        }

        if (!hasTokenConflict && tokenName !== part.tokenName) {
          hasTokenConflict = true
        }
      }

      if (display === undefined || hasDisplayConflict) {
        display = stringifyKeyStroke(firstPart.stroke)
      }

      if (hasTokenConflict) {
        tokenName = undefined
      }

      parts.push(
        createKeySequencePart(firstPart.stroke, {
          display,
          match: firstPart.match,
          tokenName,
        }),
      )
    }

    return parts
  }

  public collectMatchingBindings(
    bindings: readonly BindingState<TTarget, TEvent>[],
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): BindingState<TTarget, TEvent>[] {
    const matches: BindingState<TTarget, TEvent>[] = []

    for (const binding of bindings) {
      if (this.#conditions.matchesConditions(binding) && this.#catalog.isBindingVisible(binding, focused, activeView)) {
        matches.push(binding)
      }
    }

    return matches
  }

  #bindingMatchesRuntimeState(
    binding: BindingState<TTarget, TEvent>,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): boolean {
    return this.#conditions.matchesConditions(binding) && this.#catalog.isBindingVisible(binding, focused, activeView)
  }

  #getPartPresentation(
    bindings: readonly BindingState<TTarget, TEvent>[],
    partIndex: number,
  ): { display: string; tokenName?: string } {
    let display: string | undefined
    let tokenName: string | undefined
    let hasDisplayConflict = false
    let hasTokenConflict = false

    for (const binding of bindings) {
      const part = binding.sequence[partIndex]
      if (!part) {
        continue
      }

      if (display === undefined) {
        display = part.display
        tokenName = part.tokenName
        continue
      }

      if (!hasDisplayConflict && display !== part.display) {
        hasDisplayConflict = true
      }

      if (!hasTokenConflict && tokenName !== part.tokenName) {
        hasTokenConflict = true
      }
    }

    if (display === undefined || hasDisplayConflict) {
      const stroke = bindings[0]?.sequence[partIndex]?.stroke
      display = stroke ? stringifyKeyStroke(stroke) : ""
    }

    if (hasTokenConflict) {
      tokenName = undefined
    }

    return {
      display,
      tokenName,
    }
  }

  #toActiveBinding(
    binding: BindingState<TTarget, TEvent>,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): ActiveBinding<TTarget, TEvent> {
    return {
      sequence: binding.sequence,
      command: binding.command,
      commandAttrs: this.#catalog.getBindingCommandAttrs(binding, focused, activeView),
      attrs: binding.attrs,
      event: binding.event,
      preventDefault: binding.preventDefault,
      fallthrough: binding.fallthrough,
    }
  }

  public collectActiveBindings(
    bindings: readonly BindingState<TTarget, TEvent>[],
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): ActiveBinding<TTarget, TEvent>[] {
    return bindings.map((binding) => this.#toActiveBinding(binding, focused, activeView))
  }

  #collectActiveKeysAtRoot(
    activeLayers: RegisteredLayer<TTarget, TEvent>[],
    includeBindings: boolean,
    includeMetadata: boolean,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): readonly ActiveKey<TTarget, TEvent>[] {
    const activeKeys = new Map<KeyMatch, ActiveKeyState<TTarget, TEvent>>()
    const stopped = new Set<KeyMatch>()
    const hasLayerConditions = this.#state.layers.layersWithConditions > 0

    for (const layer of activeLayers) {
      if (hasLayerConditions && !this.#conditions.hasNoConditions(layer) && !this.#conditions.matchesConditions(layer)) {
        continue
      }

      const options: ActiveKeyOption<TTarget, TEvent>[] = []
      for (const binding of layer.bindingStates) {
        if (binding.event !== "press" || !this.#bindingMatchesRuntimeState(binding, focused, activeView)) {
          continue
        }

        options.push(...this.#getActiveKeyOptionsForBinding(binding))
      }

      this.#collectActiveKeyOptions(options, activeKeys, stopped, includeBindings, focused, activeView)
    }

    return this.#materializeActiveKeys(activeKeys, includeBindings, includeMetadata, focused, activeView)
  }

  #collectActiveKeysFromPending(
    captures: readonly PendingSequenceCapture<TTarget, TEvent>[],
    includeBindings: boolean,
    includeMetadata: boolean,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): readonly ActiveKey<TTarget, TEvent>[] {
    const activeKeys = new Map<KeyMatch, ActiveKeyState<TTarget, TEvent>>()
    const stopped = new Set<KeyMatch>()
    const options: ActiveKeyOption<TTarget, TEvent>[] = []

    for (const capture of captures) {
      options.push(...this.#getActiveKeyOptionsForCapture(capture))
    }

    this.#collectActiveKeyOptions(options, activeKeys, stopped, includeBindings, focused, activeView)

    return this.#materializeActiveKeys(activeKeys, includeBindings, includeMetadata, focused, activeView)
  }

  #collectActiveKeyOptions(
    options: readonly ActiveKeyOption<TTarget, TEvent>[],
    activeKeys: Map<KeyMatch, ActiveKeyState<TTarget, TEvent>>,
    stopped: Set<KeyMatch>,
    includeBindings: boolean,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): void {
    const seen = new Set<KeyMatch>()
    for (const option of options) {
      if (seen.has(option.part.match)) {
        continue
      }

      seen.add(option.part.match)
      this.#collectActiveKeyOption(option, options, activeKeys, stopped, includeBindings, focused, activeView)
    }
  }

  #collectActiveKeyOption(
    option: ActiveKeyOption<TTarget, TEvent>,
    siblingOptions: readonly ActiveKeyOption<TTarget, TEvent>[],
    activeKeys: Map<KeyMatch, ActiveKeyState<TTarget, TEvent>>,
    stopped: Set<KeyMatch>,
    includeBindings: boolean,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): void {
    const bindingKey = option.part.match
    if (stopped.has(bindingKey)) {
      return
    }

    const selection = this.#selectActiveKeyOption(option, siblingOptions, includeBindings, focused, activeView)
    if (!selection) {
      return
    }

    const existing = activeKeys.get(bindingKey)
    if (!existing) {
      activeKeys.set(bindingKey, this.#createActiveKeyState(option.part.stroke, selection, includeBindings))
    } else {
      this.#updateActiveKeyState(existing, selection, includeBindings)
    }

    if (selection.stop) {
      stopped.add(bindingKey)
    }
  }

  #materializeActiveKeys(
    activeKeys: ReadonlyMap<KeyMatch, ActiveKeyState<TTarget, TEvent>>,
    includeBindings: boolean,
    includeMetadata: boolean,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): readonly ActiveKey<TTarget, TEvent>[] {
    const materialized: ActiveKey<TTarget, TEvent>[] = []
    for (const state of activeKeys.values()) {
      const activeKey = this.#materializeActiveKey(state, includeBindings, includeMetadata, focused, activeView)
      if (activeKey) {
        materialized.push(activeKey)
      }
    }

    return materialized
  }

  #selectActiveKeyOption(
    option: ActiveKeyOption<TTarget, TEvent>,
    siblingOptions: readonly ActiveKeyOption<TTarget, TEvent>[],
    includeBindings: boolean,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): ActiveKeySelection<TTarget, TEvent> | undefined {
    const matchingOptions = siblingOptions.filter((candidate) => candidate.part.match === option.part.match)
    const exactBindings = matchingOptions.filter((candidate) => candidate.exact).map((candidate) => candidate.binding)
    const selected = this.#selectActiveBindings(exactBindings, focused, activeView)
    const continues = matchingOptions.some((candidate) => candidate.continues)

    if (!continues && !selected) {
      return undefined
    }

    const presentation = this.#getOptionPresentation(matchingOptions)

    return {
      display: presentation.display,
      tokenName: presentation.tokenName,
      continues,
      firstBinding: selected?.bindings[0],
      commandBinding: selected?.commandBinding,
      bindings: includeBindings && selected ? [...selected.bindings] : undefined,
      stop: continues || selected?.stop === true,
    }
  }

  #getOptionPresentation(
    options: readonly ActiveKeyOption<TTarget, TEvent>[],
  ): { display: string; tokenName?: string } {
    let display: string | undefined
    let tokenName: string | undefined
    let hasDisplayConflict = false
    let hasTokenConflict = false

    for (const option of options) {
      const part = option.part
      if (display === undefined) {
        display = part.display
        tokenName = part.tokenName
        continue
      }

      if (!hasDisplayConflict && display !== part.display) {
        hasDisplayConflict = true
      }

      if (!hasTokenConflict && tokenName !== part.tokenName) {
        hasTokenConflict = true
      }
    }

    const firstPart = options[0]?.part
    if (display === undefined || hasDisplayConflict) {
      display = firstPart ? stringifyKeyStroke(firstPart.stroke) : ""
    }

    if (hasTokenConflict) {
      tokenName = undefined
    }

    return { display, tokenName }
  }

  #selectActiveBindings(
    bindings: readonly BindingState<TTarget, TEvent>[],
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ):
    | {
        bindings: readonly BindingState<TTarget, TEvent>[]
        commandBinding?: BindingState<TTarget, TEvent>
        stop: boolean
      }
    | undefined {
    const selected: BindingState<TTarget, TEvent>[] = []
    let commandBinding: BindingState<TTarget, TEvent> | undefined

    for (const binding of bindings) {
      if (!this.#conditions.matchesConditions(binding) || !this.#catalog.isBindingVisible(binding, focused, activeView)) {
        continue
      }

      selected.push(binding)
      if (binding.command === undefined) {
        continue
      }

      commandBinding ??= binding
      if (!binding.fallthrough) {
        return { bindings: selected, commandBinding, stop: true }
      }
    }

    if (selected.length === 0) {
      return undefined
    }

    return { bindings: selected, commandBinding, stop: false }
  }

  #createActiveKeyState(
    stroke: NormalizedKeyStroke,
    selection: ActiveKeySelection<TTarget, TEvent>,
    includeBindings: boolean,
  ): ActiveKeyState<TTarget, TEvent> {
    return {
      stroke,
      display: selection.display,
      tokenName: selection.tokenName,
      continues: selection.continues,
      firstBinding: selection.firstBinding,
      commandBinding: selection.commandBinding,
      bindings: includeBindings && selection.bindings ? [...selection.bindings] : undefined,
    }
  }

  #updateActiveKeyState(
    state: ActiveKeyState<TTarget, TEvent>,
    selection: ActiveKeySelection<TTarget, TEvent>,
    includeBindings: boolean,
  ): void {
    if (!state.firstBinding && selection.firstBinding) {
      state.firstBinding = selection.firstBinding
    }

    if (!state.commandBinding && selection.commandBinding) {
      state.commandBinding = selection.commandBinding
    }

    if (selection.continues) {
      state.continues = true
    }

    if (!includeBindings || !selection.bindings || selection.bindings.length === 0) {
      return
    }

    if (!state.bindings) {
      state.bindings = [...selection.bindings]
      return
    }

    state.bindings.push(...selection.bindings)
  }

  #materializeActiveKey(
    state: ActiveKeyState<TTarget, TEvent>,
    includeBindings: boolean,
    includeMetadata: boolean,
    focused: TTarget | null,
    activeView: ActiveCommandView<TTarget, TEvent>,
  ): ActiveKey<TTarget, TEvent> | undefined {
    if (!state.commandBinding && !state.continues) {
      return undefined
    }

    const activeKey: ActiveKey<TTarget, TEvent> = {
      stroke: cloneKeyStroke(state.stroke),
      display: state.display,
      continues: state.continues,
    }

    if (state.tokenName) {
      activeKey.tokenName = state.tokenName
    }

    if (state.commandBinding) {
      activeKey.command = state.commandBinding.command
    }

    if (includeBindings && state.bindings && state.bindings.length > 0) {
      activeKey.bindings =
        state.bindings.length === 1
          ? [this.#toActiveBinding(state.bindings[0]!, focused, activeView)]
          : this.collectActiveBindings(state.bindings, focused, activeView)
    }

    if (includeMetadata) {
      if (state.firstBinding?.attrs) {
        activeKey.bindingAttrs = state.firstBinding.attrs
      }

      const commandAttrs = state.commandBinding
        ? this.#catalog.getBindingCommandAttrs(state.commandBinding, focused, activeView)
        : undefined
      if (commandAttrs) {
        activeKey.commandAttrs = commandAttrs
      }
    }

    return activeKey
  }

  #notifyPendingSequenceChange(): void {
    if (!this.#hooks.has("pendingSequence")) {
      return
    }

    this.#hooks.emit(
      "pendingSequence",
      this.#state.projection.pendingSequence
        ? this.collectSequencePartsFromPending(this.#state.projection.pendingSequence)
        : [],
    )
  }
}
