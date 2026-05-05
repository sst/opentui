import {
  BoxRenderable,
  CliRenderEvents,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
  TextareaRenderable,
  StyledText,
  createCliRenderer,
  bold,
  bg,
  fg,
  type CliRenderer,
  type KeyEvent,
  type Renderable,
  type TextChunk,
} from "@opentui/core"
import { type ActiveKey, type Command, type DispatchEvent, type Keymap } from "@opentui/keymap"
import * as addons from "@opentui/keymap/addons/opentui"
import { formatKeySequence } from "@opentui/keymap/extras"
import { getGraphSnapshot, type GraphBinding, type GraphSnapshot } from "@opentui/keymap/extras/graph"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const P = {
  bg: "#1a1b26",
  surface: "#16161e",
  surfaceFocus: "#292e42",
  panel: "#1f2335",
  border: "#2f334d",
  borderStrong: "#3b4261",
  text: "#c0caf5",
  textDim: "#a9b1d6",
  textMuted: "#565f89",
  title: "#c0caf5",
  alpha: "#7dcfff",
  beta: "#9ece6a",
  accent: "#bb9af7",
  leader: "#e0af68",
  key: "#7dcfff",
  command: "#9ece6a",
  separator: "#3b4261",
} as const

const LEADER_TOKEN = "<leader>"
const COUNT_PATTERN = "count"
const KEY_FORMAT_OPTIONS = {
  tokenDisplay: {
    [LEADER_TOKEN]: "ctrl+x",
  },
} as const
const LEADER_TRIGGER_LABEL = KEY_FORMAT_OPTIONS.tokenDisplay[LEADER_TOKEN]

interface EditorSpec {
  id: string
  label: string
  color: string
  initialValue?: string
  placeholder?: string
}

const editorSpecs: readonly EditorSpec[] = [
  {
    id: "notes",
    label: "Notes",
    color: P.alpha,
    initialValue: "Notes editor\nTab/Shift+Tab switches focus.",
  },
  {
    id: "draft",
    label: "Draft",
    color: P.beta,
    initialValue: "Draft editor\nPress dd here to delete the current line.",
  },
  {
    id: "scratch",
    label: "Scratch",
    color: P.accent,
    placeholder: "Scratch editor. Unmapped text still inserts directly.",
  },
] as const

type ExArgCount = "0" | "1" | "?" | "*" | "+"

interface ExPromptSuggestion {
  label: string
  insert: string
  usage: string
  desc: string
  expectsArgs: boolean
}

const EX_PROMPT_WIDTH = 54
const EX_PROMPT_MAX_VISIBLE_SUGGESTIONS = 4
const EX_PROMPT_CHROME_ROWS = 5
const EX_PROMPT_MAX_HEIGHT = EX_PROMPT_CHROME_ROWS + EX_PROMPT_MAX_VISIBLE_SUGGESTIONS
const GRAPH_MIN_PANEL_ROWS = 9
const GRAPH_HEADER_ROWS = 4
const GRAPH_PULSE_DURATION_MS = 650
const GRAPH_REJECT_PULSE_DURATION_MS = 900
const GRAPH_LAYER_WIDTH = 12
const GRAPH_BINDING_WIDTH = 16
const GRAPH_COMMAND_WIDTH = 24
const GRAPH_MAX_ACTIVE_LAYER_CHIPS = 4

type OpenTuiGraphSnapshot = GraphSnapshot<Renderable, KeyEvent>
type OpenTuiGraphBinding = GraphBinding<Renderable, KeyEvent>
type OpenTuiDispatchEvent = DispatchEvent<Renderable, KeyEvent>

interface SequencePartLike {
  match: string
  tokenName?: string
  patternName?: string
}

interface TerminalGraphPulse {
  phase: OpenTuiDispatchEvent["phase"]
  layerOrder?: number
  bindingIndex?: number
  command?: string
  sequence: readonly SequencePartLike[]
  durationMs: number
  remainingMs: number
}

let root: BoxRenderable | null = null
let alphaPanel: BoxRenderable | null = null
let betaPanel: BoxRenderable | null = null
let alphaText: TextRenderable | null = null
let betaText: TextRenderable | null = null
let editorFrames: BoxRenderable[] = []
let editors: TextareaRenderable[] = []
let commandPromptShell: BoxRenderable | null = null
let commandPromptBox: BoxRenderable | null = null
let commandPromptSuggestionsBox: BoxRenderable | null = null
let commandPromptInput: InputRenderable | null = null
let commandPromptHintText: TextRenderable | null = null
let commandPromptUsageText: TextRenderable | null = null
let commandPromptSuggestionsText: TextRenderable | null = null
let statusFocusedText: TextRenderable | null = null
let statusInfoText: TextRenderable | null = null
let statusLeaderText: TextRenderable | null = null
let statusPendingText: TextRenderable | null = null
let statusLastText: TextRenderable | null = null
let helpBox: BoxRenderable | null = null
let helpText: TextRenderable | null = null
let whichKeyHeaderText: TextRenderable | null = null
let whichKeyScrollBox: ScrollBoxRenderable | null = null
let whichKeyEntriesText: TextRenderable | null = null
let graphText: TextRenderable | null = null
let logBox: BoxRenderable | null = null
let logText: TextRenderable | null = null
let keymap: Keymap<Renderable, KeyEvent> | null = null

let alphaCount = 0
let betaCount = 0
let helpVisible = true
let leaderArmed = false
let commandPromptVisible = false
let commandPromptValue = ":"
let commandPromptSelection = 0
let commandPromptRestoreTarget: Renderable | null = null
let lastAction = "Click a panel or press Tab to start."
let logLines: string[] = []
let graphPulses: TerminalGraphPulse[] = []
let graphFrameCallback: ((deltaTime: number) => Promise<void>) | null = null
let graphAnimationLive = false
let graphRefreshPending = false
let graphLastRenderedHeight = -1
let graphLastRenderedWidth = -1
let disposers: Array<() => void> = []

function styledLine(chunks: TextChunk[]): TextChunk[] {
  return chunks
}

function joinLines(lines: TextChunk[][]): StyledText {
  const allChunks: TextChunk[] = []

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      allChunks.push({ __isChunk: true, text: "\n" })
    }

    for (const chunk of lines[i]) {
      allChunks.push(chunk)
    }
  }

  return new StyledText(allChunks)
}

function getMetadataText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed || undefined
}

function getCountPayload(payload: unknown): number {
  if (!payload || typeof payload !== "object") {
    return 1
  }

  const count = (payload as { count?: unknown }).count
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : 1
}

function getActiveKeyLabel(activeKey: ActiveKey): string {
  if (activeKey.continues) {
    const group = getMetadataText(activeKey.bindingAttrs?.group)
    if (group) {
      return `+${group}`
    }
  }

  return (
    getMetadataText(activeKey.bindingAttrs?.desc) ??
    getMetadataText(activeKey.commandAttrs?.desc) ??
    getMetadataText(activeKey.commandAttrs?.title) ??
    (typeof activeKey.command === "string" ? activeKey.command : undefined) ??
    ""
  )
}

function trimCell(value: string, width: number): string {
  if (value.length <= width) {
    return value.padEnd(width)
  }

  if (width <= 1) {
    return value.slice(0, width)
  }

  return `${value.slice(0, width - 1)}.`
}

function cell(value: string, width: number, color: string, highlight = false): TextChunk {
  const chunk = fg(color)(trimCell(value, width))
  return highlight ? bold(chunk) : chunk
}

function activeCell(value: string, width: number, foreground: string, background: string): TextChunk {
  return bold(bg(background)(fg(foreground)(trimCell(value, width))))
}

function pulseCell(value: string, width: number, baseColor: string, pulseColor: string, pulse: number): TextChunk {
  if (pulse > 0.66) {
    return activeCell(value, width, P.bg, pulseColor)
  }

  if (pulse > 0.33) {
    return bold(fg(pulseColor)(trimCell(value, width)))
  }

  if (pulse > 0) {
    return fg(pulseColor)(trimCell(value, width))
  }

  return cell(value, width, baseColor)
}

function sequencePartMatchesPattern(patternName: string, part: SequencePartLike | undefined): boolean {
  return part?.patternName === patternName
}

function sequenceMatchesPrefix(sequence: readonly SequencePartLike[], prefix: readonly SequencePartLike[]): boolean {
  if (prefix.length === 0) {
    return false
  }

  let sequenceIndex = 0
  let prefixIndex = 0
  while (prefixIndex < prefix.length && sequenceIndex < sequence.length) {
    const sequencePart = sequence[sequenceIndex]
    const prefixPart = prefix[prefixIndex]
    const patternName = sequencePart?.patternName

    if (patternName) {
      let consumed = 0
      while (prefixIndex < prefix.length && sequencePartMatchesPattern(patternName, prefix[prefixIndex])) {
        consumed += 1
        prefixIndex += 1
      }

      if (consumed === 0) {
        return false
      }

      sequenceIndex += 1
      continue
    }

    if (sequencePart?.match !== prefixPart?.match) {
      return false
    }

    sequenceIndex += 1
    prefixIndex += 1
  }

  return prefixIndex === prefix.length
}

function sequenceMatchesExact(left: readonly SequencePartLike[], right: readonly SequencePartLike[]): boolean {
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

function getPulseValue(pulse: TerminalGraphPulse): number {
  if (pulse.remainingMs <= 0 || pulse.durationMs <= 0) {
    return 0
  }

  return Math.max(0, Math.min(1, pulse.remainingMs / pulse.durationMs))
}

function getLayerPulse(layerOrder: number): number {
  let pulseValue = 0
  for (const pulse of graphPulses) {
    if (pulse.layerOrder !== layerOrder) {
      continue
    }

    pulseValue = Math.max(pulseValue, getPulseValue(pulse))
  }

  return pulseValue
}

function getBindingPulse(binding: OpenTuiGraphBinding): number {
  let pulseValue = 0
  for (const pulse of graphPulses) {
    if (pulse.bindingIndex !== undefined) {
      if (pulse.layerOrder !== binding.sourceLayerOrder) {
        continue
      }

      if (pulse.bindingIndex !== binding.bindingIndex) {
        continue
      }
    } else if (!sequenceMatchesPrefix(binding.sequence, pulse.sequence)) {
      continue
    }

    pulseValue = Math.max(pulseValue, getPulseValue(pulse))
  }

  return pulseValue
}

function getCommandPulse(command: OpenTuiGraphSnapshot["commands"][number]): number {
  let pulseValue = 0
  for (const pulse of graphPulses) {
    if (pulse.command !== command.name) {
      continue
    }

    pulseValue = Math.max(pulseValue, getPulseValue(pulse))
  }

  return pulseValue
}

function getPendingSequencePulse(): number {
  let pulseValue = 0
  for (const pulse of graphPulses) {
    if (pulse.bindingIndex !== undefined) {
      continue
    }

    pulseValue = Math.max(pulseValue, getPulseValue(pulse))
  }

  return pulseValue
}

function pruneGraphPulses(): void {
  graphPulses = graphPulses.filter((pulse) => pulse.remainingMs > 0)
}

function getPulsePhase(binding: OpenTuiGraphBinding): OpenTuiDispatchEvent["phase"] | undefined {
  for (const pulse of graphPulses) {
    if (pulse.bindingIndex !== undefined) {
      if (pulse.layerOrder !== binding.sourceLayerOrder) {
        continue
      }

      if (pulse.bindingIndex !== binding.bindingIndex) {
        continue
      }

      return pulse.phase
    }

    if (sequenceMatchesPrefix(binding.sequence, pulse.sequence)) {
      return pulse.phase
    }
  }

  return undefined
}

function getPulseMarker(pulse: number, phase: OpenTuiDispatchEvent["phase"] | undefined): string {
  if (phase === "binding-reject") {
    return "!"
  }

  if (phase === "binding-execute") {
    return ">"
  }

  if (pulse > 0.66) {
    return "*"
  }

  if (pulse > 0.33) {
    return "+"
  }

  if (pulse > 0) {
    return "."
  }

  return " "
}

function getPendingBindingIds(snapshot: OpenTuiGraphSnapshot): Set<string> {
  const ids = new Set<string>()
  for (const node of snapshot.sequenceNodes) {
    if (!node.pending && !node.pendingPath) {
      continue
    }

    for (const id of node.reachableBindingIds) {
      ids.add(id)
    }
  }

  return ids
}

function isBindingPending(binding: OpenTuiGraphBinding, snapshot: OpenTuiGraphSnapshot): boolean {
  return getPendingBindingIds(snapshot).has(binding.id)
}

function formatGraphBindingKey(binding: OpenTuiGraphBinding): string {
  return formatKeySequence(binding.sequence, KEY_FORMAT_OPTIONS) || "bind"
}

function getGraphCommandLabel(commandName: string): string {
  return commandName.replace(/^:/, "")
}

function getGraphBindingCommandLabel(binding: OpenTuiGraphBinding, snapshot: OpenTuiGraphSnapshot): string {
  const resolved = binding.commandIds
    .map((id) => snapshot.commands.find((command) => command.id === id)?.name)
    .filter((name): name is string => !!name)

  if (resolved.length > 0) {
    return resolved.map(getGraphCommandLabel).join("|")
  }

  if (typeof binding.command === "string") {
    return getGraphCommandLabel(binding.command)
  }

  if (typeof binding.command === "function") {
    return "inline fn"
  }

  return "prefix"
}

function getGraphTargetLabel(target: Renderable | undefined): string {
  if (!target) {
    return "global"
  }

  if (target === alphaPanel) {
    return "alpha"
  }

  if (target === betaPanel) {
    return "beta"
  }

  if (target === commandPromptInput || target === commandPromptShell) {
    return "prompt"
  }

  const editorIndex = editors.findIndex((editor) => editor === target)
  if (editorIndex !== -1) {
    return editorSpecs[editorIndex]!.label.toLowerCase()
  }

  return target.id.replace(/^keymap-demo-/, "")
}

function getGraphLayerLabel(layer: OpenTuiGraphSnapshot["layers"][number]): string {
  return `${getGraphTargetLabel(layer.target)}:${layer.order}`
}

function getGraphLayerRail(
  snapshot: OpenTuiGraphSnapshot,
  visibleBindings: readonly OpenTuiGraphBinding[],
): TextChunk[] {
  const visibleLayerIds = new Set(visibleBindings.map((binding) => binding.layerId))
  const visibleLayers = snapshot.layers.filter((layer) => layer.active && visibleLayerIds.has(layer.id))
  if (visibleLayers.length === 0) {
    return [fg(P.textMuted)("(none)")]
  }

  const chunks: TextChunk[] = []
  const visibleLayerChips = visibleLayers.slice(0, GRAPH_MAX_ACTIVE_LAYER_CHIPS)
  for (const [index, layer] of visibleLayerChips.entries()) {
    if (index > 0) {
      chunks.push(fg(P.separator)(" "))
    }

    const pulse = getLayerPulse(layer.order)
    const label = trimCell(getGraphLayerLabel(layer), 10).trim()
    const colored = fg(pulse > 0 ? P.leader : P.command)(label)
    chunks.push(pulse > 0 ? bold(colored) : colored)
  }

  if (visibleLayers.length > visibleLayerChips.length) {
    chunks.push(fg(P.separator)(" "), fg(P.textMuted)(`+${visibleLayers.length - visibleLayerChips.length}`))
  }

  return chunks
}

function getGraphPanelRows(): number {
  return Math.max(GRAPH_MIN_PANEL_ROWS, graphText?.height ?? GRAPH_MIN_PANEL_ROWS)
}

function getVisibleGraphBindings(snapshot: OpenTuiGraphSnapshot, limit: number): OpenTuiGraphBinding[] {
  const pendingBindingIds = getPendingBindingIds(snapshot)

  return [...snapshot.bindings]
    .filter((binding) => {
      return binding.active || binding.reachable || pendingBindingIds.has(binding.id) || getBindingPulse(binding) > 0
    })
    .sort((left, right) => {
      const leftPending = pendingBindingIds.has(left.id)
      const rightPending = pendingBindingIds.has(right.id)
      if (leftPending !== rightPending) return leftPending ? -1 : 1
      if (left.reachable !== right.reachable) return left.reachable ? -1 : 1
      if (left.active !== right.active) return left.active ? -1 : 1

      if (left.sourceLayerOrder !== right.sourceLayerOrder) return right.sourceLayerOrder - left.sourceLayerOrder
      return left.bindingIndex - right.bindingIndex
    })
    .slice(0, limit)
}

function buildGraphBindingLine(binding: OpenTuiGraphBinding, snapshot: OpenTuiGraphSnapshot): TextChunk[] {
  const layer = snapshot.layers.find((candidate) => candidate.id === binding.layerId)
  const command = binding.commandIds
    .map((id) => snapshot.commands.find((candidate) => candidate.id === id))
    .find((candidate): candidate is OpenTuiGraphSnapshot["commands"][number] => !!candidate)
  const bindingPulse = getBindingPulse(binding)
  const commandPulse = command ? getCommandPulse(command) : 0
  const pending = isBindingPending(binding, snapshot)
  const rowCommandPulse = bindingPulse > 0 ? commandPulse : 0
  const pathPulse = Math.max(bindingPulse, rowCommandPulse)
  const phase = bindingPulse > 0 ? getPulsePhase(binding) : undefined
  const marker = pending && pathPulse === 0 ? "~" : getPulseMarker(pathPulse, phase)
  const markerColor = phase === "binding-reject" ? P.textMuted : pathPulse > 0 || pending ? P.leader : P.separator
  const layerColor = layer?.active ? P.command : P.textMuted
  const bindingColor = pending ? P.leader : binding.reachable ? P.key : binding.active ? P.textDim : P.textMuted
  const commandColor = command?.reachable ? P.command : binding.commandResolved ? P.textDim : P.textMuted
  const edgeColor = pathPulse > 0 || pending ? P.leader : binding.reachable ? P.separator : P.textMuted
  const bindingHighlightPulse = Math.max(bindingPulse, pending ? Math.max(getPendingSequencePulse(), 0.45) : 0)

  return styledLine([
    fg(markerColor)(marker),
    fg(P.separator)(" "),
    cell(layer ? getGraphLayerLabel(layer) : "layer", GRAPH_LAYER_WIDTH, layerColor, bindingPulse > 0),
    fg(edgeColor)(" -> "),
    pulseCell(formatGraphBindingKey(binding), GRAPH_BINDING_WIDTH, bindingColor, P.leader, bindingHighlightPulse),
    fg(edgeColor)(" -> "),
    pulseCell(
      getGraphBindingCommandLabel(binding, snapshot),
      GRAPH_COMMAND_WIDTH,
      commandColor,
      P.command,
      rowCommandPulse,
    ),
  ])
}

function buildGraphContent(): StyledText {
  if (!keymap) {
    return joinLines([styledLine([fg(P.textMuted)("(graph unavailable)")])])
  }

  pruneGraphPulses()
  const snapshot = getGraphSnapshot(keymap)
  const rowCount = getGraphPanelRows()
  const pending =
    snapshot.pendingSequence.length === 0 ? "<root>" : formatKeySequence(snapshot.pendingSequence, KEY_FORMAT_OPTIONS)
  const activeLayerCount = snapshot.layers.filter((layer) => layer.active).length
  const reachableBindingCount = snapshot.bindings.filter((binding) => binding.reachable).length
  const bindings = getVisibleGraphBindings(snapshot, Math.max(1, rowCount - GRAPH_HEADER_ROWS))
  const rows: TextChunk[][] = [
    styledLine([
      bold(fg(P.accent)("Keymap Graph")),
      fg(P.textMuted)(`  layers ${activeLayerCount}/${snapshot.layers.length}`),
      fg(P.separator)("  |  "),
      fg(P.textMuted)(`bindings ${reachableBindingCount}/${snapshot.bindings.length}`),
    ]),
    styledLine([fg(P.textDim)("pending "), bold(fg(P.leader)(pending))]),
    styledLine([fg(P.textDim)("shown   "), ...getGraphLayerRail(snapshot, bindings)]),
    styledLine([
      fg(P.textMuted)("  "),
      cell("layer", GRAPH_LAYER_WIDTH, P.textMuted),
      fg(P.textMuted)("    "),
      cell("binding", GRAPH_BINDING_WIDTH, P.textMuted),
      fg(P.textMuted)("    "),
      cell("command", GRAPH_COMMAND_WIDTH, P.textMuted),
    ]),
  ]

  if (bindings.length === 0) {
    rows.push(styledLine([fg(P.textMuted)("  (no active bindings)")]))
  } else {
    for (const binding of bindings) {
      rows.push(buildGraphBindingLine(binding, snapshot))
    }
  }

  while (rows.length < rowCount) {
    rows.push(styledLine([fg(P.textMuted)("")]))
  }

  return joinLines(rows.slice(0, rowCount))
}

function renderGraph(): void {
  if (!graphText) {
    return
  }

  graphLastRenderedHeight = graphText.height
  graphLastRenderedWidth = graphText.width
  graphText.content = buildGraphContent()
}

function hasGraphSizeChanged(): boolean {
  if (!graphText) {
    return false
  }

  return graphText.height !== graphLastRenderedHeight || graphText.width !== graphLastRenderedWidth
}

function stopGraphAnimation(renderer: CliRenderer): void {
  if (!graphAnimationLive) {
    return
  }

  renderer.dropLive()
  graphAnimationLive = false
}

function startGraphAnimation(renderer: CliRenderer): void {
  if (graphAnimationLive) {
    return
  }

  renderer.requestLive()
  graphAnimationLive = true
}

function scheduleGraphRefresh(renderer: CliRenderer): void {
  graphRefreshPending = true
  startGraphAnimation(renderer)
}

function setupGraphAnimation(renderer: CliRenderer): void {
  if (graphFrameCallback) {
    return
  }

  graphFrameCallback = async (deltaTime) => {
    const sizeChanged = hasGraphSizeChanged()
    if (graphPulses.length === 0 && !graphRefreshPending && !sizeChanged) {
      stopGraphAnimation(renderer)
      return
    }

    if (graphPulses.length > 0) {
      for (const pulse of graphPulses) {
        pulse.remainingMs -= deltaTime
      }
      pruneGraphPulses()
    }

    const keepRefreshPending =
      graphRefreshPending && (!keymap || !graphText || graphText.height <= 0 || graphText.width <= 0)
    graphRefreshPending = keepRefreshPending
    renderGraph()

    if (keepRefreshPending) {
      return
    }

    if (graphPulses.length === 0) {
      stopGraphAnimation(renderer)
    }
  }
  renderer.setFrameCallback(graphFrameCallback)
}

function cleanupGraphAnimation(renderer: CliRenderer): void {
  if (graphFrameCallback) {
    renderer.removeFrameCallback(graphFrameCallback)
    graphFrameCallback = null
  }

  graphRefreshPending = false
  stopGraphAnimation(renderer)
}

function addGraphPulse(renderer: CliRenderer, event: OpenTuiDispatchEvent): void {
  const command = typeof event.command === "string" ? event.command : undefined
  const durationMs = event.phase === "binding-reject" ? GRAPH_REJECT_PULSE_DURATION_MS : GRAPH_PULSE_DURATION_MS
  graphPulses = [
    ...graphPulses.filter((pulse) => pulse.remainingMs > 0),
    {
      phase: event.phase,
      layerOrder: event.layer?.order,
      bindingIndex: event.binding?.bindingIndex,
      command,
      sequence: event.sequence.map((part) => ({
        match: part.match,
        tokenName: part.tokenName,
        patternName: part.patternName,
      })),
      durationMs,
      remainingMs: durationMs,
    },
  ]
  renderGraph()
  startGraphAnimation(renderer)
}

function normalizeExPromptName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    return ":"
  }

  return trimmed.startsWith(":") ? trimmed : `:${trimmed}`
}

function parseExPromptInput(input: string): { raw: string; name: string; args: string[] } | null {
  const normalized = normalizeExPromptName(input)
  if (normalized === ":") {
    return null
  }

  const parts = normalized.split(/\s+/)
  const [name, ...args] = parts
  if (!name) {
    return null
  }

  return {
    raw: normalized,
    name,
    args,
  }
}

function getExPromptCommandFieldText(command: Command<Renderable, KeyEvent>, fieldName: string): string | undefined {
  return getMetadataText(command[fieldName])
}

function getExPromptCommandNargs(command: Command<Renderable, KeyEvent>): ExArgCount | undefined {
  const value = command["nargs"]
  if (value === "0" || value === "1" || value === "?" || value === "*" || value === "+") {
    return value
  }

  return undefined
}

function getExPromptCommands(): readonly Command<Renderable, KeyEvent>[] {
  return keymap?.getCommands({ namespace: "excommands" }) ?? []
}

function buildExPromptSuggestions(commands: readonly Command<Renderable, KeyEvent>[]): ExPromptSuggestion[] {
  const suggestions: ExPromptSuggestion[] = []

  for (const command of commands) {
    const label = normalizeExPromptName(command.name)
    suggestions.push({
      label,
      insert: label,
      usage: getExPromptCommandFieldText(command, "usage") ?? label,
      desc: getExPromptCommandFieldText(command, "desc") ?? "",
      expectsArgs: getExPromptCommandNargs(command) !== "0",
    })
  }

  return suggestions
}

function getExPromptSuggestions(): ExPromptSuggestion[] {
  const query = (() => {
    const normalized = normalizeExPromptName(commandPromptValue)
    const spaceIndex = normalized.indexOf(" ")
    return spaceIndex === -1 ? normalized : normalized.slice(0, spaceIndex)
  })()

  const suggestions = buildExPromptSuggestions(getExPromptCommands())
  if (query === ":") {
    return suggestions.slice(0, EX_PROMPT_MAX_VISIBLE_SUGGESTIONS)
  }

  return suggestions
    .filter((suggestion) => suggestion.label.startsWith(query))
    .slice(0, EX_PROMPT_MAX_VISIBLE_SUGGESTIONS)
}

function getCommandPromptSuggestionRows(): number {
  return Math.max(getExPromptSuggestions().length, 1)
}

function getSelectedExPromptSuggestion(): ExPromptSuggestion | null {
  const suggestions = getExPromptSuggestions()
  if (suggestions.length === 0) {
    return null
  }

  const selectedIndex = Math.min(commandPromptSelection, suggestions.length - 1)
  return suggestions[selectedIndex] ?? null
}

function setCommandPromptValue(value: string): void {
  commandPromptValue = value
  commandPromptSelection = 0

  if (commandPromptInput && commandPromptInput.value !== value) {
    commandPromptInput.value = value
  }

  if (commandPromptInput) {
    commandPromptInput.cursorOffset = value.length
  }
}

function addLog(message: string): void {
  if (logLines[0] === message) {
    return
  }

  logLines = [message, ...logLines].slice(0, 8)
}

function getFocusedEditorIndex(renderer: CliRenderer): number {
  return editors.findIndex((editor) => editor === renderer.currentFocusedEditor)
}

function getFocusedLabel(renderer: CliRenderer): string {
  if (renderer.currentFocusedRenderable === commandPromptInput) {
    return "Ex command prompt"
  }

  if (renderer.currentFocusedRenderable === alphaPanel) {
    return "Alpha panel"
  }

  if (renderer.currentFocusedRenderable === betaPanel) {
    return "Beta panel"
  }

  const editorIndex = getFocusedEditorIndex(renderer)
  if (editorIndex !== -1) {
    return `${editorSpecs[editorIndex]!.label} editor`
  }

  return "None"
}

function getFocusedColor(renderer: CliRenderer): string {
  if (renderer.currentFocusedRenderable === commandPromptInput) {
    return P.leader
  }

  if (renderer.currentFocusedRenderable === alphaPanel) {
    return P.alpha
  }

  if (renderer.currentFocusedRenderable === betaPanel) {
    return P.beta
  }

  const editorIndex = getFocusedEditorIndex(renderer)
  if (editorIndex !== -1) {
    return editorSpecs[editorIndex]!.color
  }

  return P.textMuted
}

function setStatus(renderer: CliRenderer, message: string): void {
  lastAction = message
  addLog(message)
  renderAll(renderer)
}

function restoreCommandPromptFocus(target: Renderable | null): void {
  if (target && !target.isDestroyed) {
    target.focus()
    return
  }

  if (alphaPanel && !alphaPanel.isDestroyed) {
    alphaPanel.focus()
  }
}

function hideCommandPrompt(): void {
  commandPromptVisible = false
  commandPromptValue = ":"
  commandPromptSelection = 0
}

function closeCommandPrompt(renderer: CliRenderer, message: string): void {
  const restoreTarget = commandPromptRestoreTarget
  hideCommandPrompt()
  commandPromptRestoreTarget = null
  restoreCommandPromptFocus(restoreTarget)
  setStatus(renderer, message)
}

function dismissCommandPromptForFocusChange(renderer: CliRenderer, focused: Renderable | null): void {
  if (!commandPromptVisible || focused === commandPromptInput) {
    return
  }

  hideCommandPrompt()
  commandPromptRestoreTarget = null
  setStatus(renderer, "Closed ex prompt")
}

function applyCommandPromptSuggestion(renderer: CliRenderer, direction?: 1 | -1): void {
  const suggestions = getExPromptSuggestions()
  if (suggestions.length === 0) {
    return
  }

  if (direction) {
    commandPromptSelection = (commandPromptSelection + direction + suggestions.length) % suggestions.length
  }

  const suggestion = getSelectedExPromptSuggestion()
  if (!suggestion) {
    return
  }

  const normalized = normalizeExPromptName(commandPromptValue)
  const spaceIndex = normalized.indexOf(" ")
  const rest = spaceIndex === -1 ? "" : normalized.slice(spaceIndex + 1).trimStart()
  const nextValue = rest
    ? `${suggestion.insert} ${rest}`
    : suggestion.expectsArgs
      ? `${suggestion.insert} `
      : suggestion.insert

  setCommandPromptValue(nextValue)
  renderAll(renderer)
}

function moveCommandPromptSelection(renderer: CliRenderer, direction: 1 | -1): void {
  const suggestions = getExPromptSuggestions()
  if (suggestions.length === 0) {
    return
  }

  commandPromptSelection = (commandPromptSelection + direction + suggestions.length) % suggestions.length
  renderAll(renderer)
}

function executeCommandPrompt(renderer: CliRenderer): void {
  const parsed = parseExPromptInput(commandPromptValue)
  if (!parsed) {
    closeCommandPrompt(renderer, "Closed ex prompt")
    return
  }

  const restoreTarget = commandPromptRestoreTarget
  const focused = restoreTarget && !restoreTarget.isDestroyed ? restoreTarget : renderer.currentFocusedRenderable
  const result = keymap?.dispatchCommand(parsed.raw, { focused: focused ?? null, includeCommand: true })

  if (!result || !result.ok) {
    if (!result || result.reason === "not-found") {
      setStatus(renderer, `Unknown ex command ${parsed.name}`)
      return
    }

    if (result.reason === "invalid-args") {
      setStatus(
        renderer,
        `Usage: ${result.command ? (getExPromptCommandFieldText(result.command, "usage") ?? parsed.name) : parsed.name}`,
      )
      return
    }

    if (result.reason === "error") {
      setStatus(renderer, `Error running ${parsed.name}`)
      return
    }

    setStatus(renderer, `Command ${parsed.name} was rejected`)
    return
  }

  hideCommandPrompt()
  commandPromptRestoreTarget = null
  restoreCommandPromptFocus(restoreTarget)
  renderAll(renderer)
}

function openCommandPrompt(renderer: CliRenderer): void {
  if (commandPromptVisible) {
    return
  }

  commandPromptVisible = true
  commandPromptRestoreTarget = renderer.currentFocusedRenderable
  setCommandPromptValue(":")
  commandPromptInput?.focus()
  setStatus(renderer, "Opened ex prompt")
}

function getFocusableTargets(): Array<BoxRenderable | TextareaRenderable> {
  return [alphaPanel, betaPanel, ...editors].filter(
    (target): target is BoxRenderable | TextareaRenderable => target !== null,
  )
}

function getFocusableLabel(target: BoxRenderable | TextareaRenderable): string {
  if (target === alphaPanel) {
    return "Alpha panel"
  }

  if (target === betaPanel) {
    return "Beta panel"
  }

  const editorIndex = editors.findIndex((editor) => editor === target)
  if (editorIndex !== -1) {
    return `${editorSpecs[editorIndex]!.label} editor`
  }

  return "target"
}

function moveFocus(renderer: CliRenderer, direction: 1 | -1): void {
  const targets = getFocusableTargets()
  if (targets.length === 0) {
    return
  }

  const currentIndex = targets.findIndex((target) => target === renderer.currentFocusedRenderable)
  const startIndex = currentIndex === -1 ? 0 : currentIndex
  const nextIndex = (startIndex + direction + targets.length) % targets.length
  const target = targets[nextIndex]
  if (!target) {
    return
  }

  target.focus()
  setStatus(renderer, `Focused ${getFocusableLabel(target)}`)
}

function syncEditorFrames(renderer: CliRenderer): void {
  const focusedEditor = renderer.currentFocusedEditor

  for (const [index, frame] of editorFrames.entries()) {
    const spec = editorSpecs[index]
    const editor = editors[index]
    if (!frame || !spec || !editor) {
      continue
    }

    const isFocused = focusedEditor === editor
    frame.borderColor = isFocused ? spec.color : P.border
    frame.title = ` ${index + 1}. ${spec.label}${isFocused ? " *" : ""} `
  }
}

function buildPanelContent(label: string, count: number, step: number, color: string): StyledText {
  return joinLines([
    styledLine([fg(P.textDim)("Count: "), bold(fg(color)(String(count)))]),
    styledLine([
      bold(fg(P.key)("j")),
      fg(P.textDim)(` +${step}  `),
      bold(fg(P.key)("k")),
      fg(P.textDim)(` -${step}`),
      fg(P.separator)("  |  "),
      bold(fg(P.key)("enter")),
      fg(P.textDim)(` save ${label.toLowerCase()}`),
    ]),
  ])
}

function buildHelpContent(): StyledText {
  return joinLines([
    styledLine([
      bold(fg(P.key)("tab")),
      fg(P.textMuted)(" / "),
      bold(fg(P.key)("shift+tab")),
      fg(P.textDim)(": switch panels and editors"),
    ]),
    styledLine([
      fg(P.textDim)("Panels use local j/k/enter. "),
      bold(fg(P.key)(":")),
      fg(P.textDim)(" opens the ex prompt."),
    ]),
    styledLine([
      fg(P.textDim)("Editors use "),
      bold(fg(P.key)("g")),
      fg(P.textDim)(", "),
      bold(fg(P.key)("gg")),
      fg(P.textDim)(", and "),
      bold(fg(P.key)("shift+g")),
      fg(P.textDim)(" for line, buffer, and end navigation."),
    ]),
  ])
}

function buildCommandPromptUsage(): StyledText {
  const selected = getSelectedExPromptSuggestion()
  if (!selected) {
    return joinLines([styledLine([fg(P.textMuted)("No matching ex commands")])])
  }

  return joinLines([
    styledLine([
      fg(P.textDim)("Usage: "),
      bold(fg(P.accent)(selected.usage)),
      fg(P.separator)("  |  "),
      fg(P.textMuted)(selected.desc),
    ]),
  ])
}

function buildCommandPromptSuggestions(): StyledText {
  const suggestions = getExPromptSuggestions()
  if (suggestions.length === 0) {
    return joinLines([styledLine([fg(P.textMuted)("(no suggestions)")])])
  }

  return joinLines(
    suggestions.map((suggestion, index) => {
      const isSelected = index === Math.min(commandPromptSelection, suggestions.length - 1)
      return styledLine([
        fg(isSelected ? P.leader : P.textDim)(isSelected ? "> " : "  "),
        bold(fg(isSelected ? P.title : P.command)(suggestion.label)),
        fg(P.separator)("  "),
        fg(P.textMuted)(suggestion.desc),
      ])
    }),
  )
}

function renderCommandPrompt(): void {
  if (commandPromptShell) {
    commandPromptShell.visible = commandPromptVisible
  }

  if (commandPromptBox) {
    commandPromptBox.visible = commandPromptVisible
    commandPromptBox.height = EX_PROMPT_CHROME_ROWS
  }

  if (commandPromptSuggestionsBox) {
    commandPromptSuggestionsBox.visible = commandPromptVisible
    commandPromptSuggestionsBox.height = getCommandPromptSuggestionRows()
  }

  if (commandPromptHintText) {
    commandPromptHintText.content = joinLines([
      styledLine([
        fg(P.textMuted)("tab complete"),
        fg(P.separator)(" | "),
        fg(P.textMuted)("up/down"),
        fg(P.separator)(" | "),
        fg(P.textMuted)("enter"),
        fg(P.separator)(" | "),
        fg(P.textMuted)("esc"),
      ]),
    ])
  }

  if (commandPromptUsageText) {
    commandPromptUsageText.content = buildCommandPromptUsage()
  }

  if (commandPromptSuggestionsText) {
    commandPromptSuggestionsText.content = buildCommandPromptSuggestions()
    commandPromptSuggestionsText.height = getCommandPromptSuggestionRows()
  }
}

function buildWhichKeyEntries(): StyledText {
  if (!keymap) {
    return joinLines([styledLine([fg(P.textMuted)("(unavailable)")])])
  }

  const activeKeys = [...keymap.getActiveKeys({ includeMetadata: true })].sort((left, right) => {
    return formatKeySequence([left], KEY_FORMAT_OPTIONS).localeCompare(formatKeySequence([right], KEY_FORMAT_OPTIONS))
  })

  if (activeKeys.length === 0) {
    return joinLines([styledLine([fg(P.textMuted)("(no active keys)")])])
  }

  const lines: TextChunk[][] = []
  for (const activeKey of activeKeys) {
    lines.push(
      styledLine([
        bold(fg(P.key)(formatKeySequence([activeKey], KEY_FORMAT_OPTIONS))),
        fg(P.textMuted)(" -> "),
        fg(P.command)(getActiveKeyLabel(activeKey)),
      ]),
    )
  }

  return joinLines(lines)
}

function buildLogContent(): StyledText {
  const lines: TextChunk[][] = [styledLine([bold(fg(P.textDim)("Log"))])]

  if (logLines.length === 0) {
    lines.push(styledLine([fg(P.textMuted)("(no events yet)")]))
    return joinLines(lines)
  }

  for (const entry of logLines) {
    lines.push(styledLine([fg(P.textMuted)(entry)]))
  }

  return joinLines(lines)
}

function renderPanels(): void {
  if (alphaText) {
    alphaText.content = buildPanelContent("Alpha", alphaCount, 1, P.alpha)
  }

  if (betaText) {
    betaText.content = buildPanelContent("Beta", betaCount, 5, P.beta)
  }
}

function renderStatus(renderer: CliRenderer): void {
  syncEditorFrames(renderer)

  const focusedLabel = getFocusedLabel(renderer)
  const focusedColor = getFocusedColor(renderer)
  const focusedEditor = renderer.currentFocusedEditor
  const pendingSequence = keymap?.getPendingSequence() ?? []
  const pendingLabel = pendingSequence.length === 0 ? "None" : formatKeySequence(pendingSequence, KEY_FORMAT_OPTIONS)

  if (statusFocusedText) {
    statusFocusedText.content = joinLines([
      styledLine([fg(P.textDim)("Focused: "), bold(fg(focusedColor)(focusedLabel))]),
    ])
  }

  if (statusInfoText) {
    statusInfoText.content = focusedEditor
      ? joinLines([
          styledLine([
            fg(P.textDim)("Cursor: "),
            fg(P.text)(`${focusedEditor.logicalCursor.row + 1}:${focusedEditor.logicalCursor.col + 1}`),
            fg(P.separator)("  |  "),
            fg(P.textDim)("Lines: "),
            fg(P.text)(String(focusedEditor.lineCount)),
            fg(P.separator)("  |  "),
            fg(P.textDim)("Chars: "),
            fg(P.text)(String(focusedEditor.plainText.length)),
            fg(P.separator)("  |  "),
            fg(P.textDim)("Keys: "),
            fg(P.command)(focusedEditor.traits.suspend === true ? "keymap" : "local"),
          ]),
        ])
      : joinLines([
          styledLine([
            fg(P.textDim)("Alpha: "),
            fg(P.text)(String(alphaCount)),
            fg(P.separator)("  |  "),
            fg(P.textDim)("Beta: "),
            fg(P.text)(String(betaCount)),
          ]),
        ])
  }

  if (statusLeaderText) {
    statusLeaderText.content = joinLines([
      styledLine([
        fg(P.textDim)("Leader: "),
        leaderArmed ? bold(fg(P.leader)(`armed (${LEADER_TRIGGER_LABEL})`)) : fg(P.textMuted)("idle"),
      ]),
    ])
  }

  if (statusPendingText) {
    statusPendingText.content = joinLines([styledLine([fg(P.textDim)("Pending: "), fg(P.leader)(pendingLabel)])])
  }

  if (statusLastText) {
    statusLastText.content = joinLines([styledLine([fg(P.textDim)("Last: "), fg(P.text)(lastAction)])])
  }

  if (helpBox) {
    helpBox.visible = helpVisible
  }

  if (helpText) {
    helpText.content = buildHelpContent()
  }

  if (whichKeyHeaderText && keymap) {
    const prefix = formatKeySequence(keymap.getPendingSequence(), KEY_FORMAT_OPTIONS) || "<root>"
    whichKeyHeaderText.content = joinLines([
      styledLine([bold(fg(P.accent)("Which Key")), fg(P.textDim)(`  ${prefix}`)]),
    ])
  }

  if (whichKeyEntriesText) {
    whichKeyEntriesText.content = buildWhichKeyEntries()
  }

  renderGraph()

  if (logText) {
    logText.content = buildLogContent()
  }

  renderCommandPrompt()
}

function renderAll(renderer: CliRenderer): void {
  renderPanels()
  renderStatus(renderer)
}

function registerCommandLayers(renderer: CliRenderer, keymapInstance: Keymap<Renderable, KeyEvent>): void {
  keymap = keymapInstance
  disposers.push(addons.registerExCommands(keymapInstance))

  const onFocusedRenderable = (focused: Renderable | null) => {
    dismissCommandPromptForFocusChange(renderer, focused)
  }
  renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, onFocusedRenderable)
  disposers.push(() => {
    renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, onFocusedRenderable)
  })

  disposers.push(
    keymapInstance.registerLayer({
      commands: [
        {
          name: "focus-next",
          title: "Next target",
          desc: "Next target",
          category: "Navigation",
          run() {
            moveFocus(renderer, 1)
          },
        },
        {
          name: "focus-prev",
          title: "Previous target",
          desc: "Previous target",
          category: "Navigation",
          run() {
            moveFocus(renderer, -1)
          },
        },
        {
          name: "toggle-help",
          title: "Toggle help",
          desc: "Toggle help",
          category: "View",
          run() {
            helpVisible = !helpVisible
            setStatus(renderer, helpVisible ? "Help shown" : "Help hidden")
          },
        },
        {
          name: "open-ex-prompt",
          title: "Open ex prompt",
          desc: "Open ex prompt",
          category: "Ex",
          run() {
            openCommandPrompt(renderer)
          },
        },
        {
          name: "alpha-up",
          title: "Alpha +1",
          desc: "Alpha +1",
          category: "Alpha",
          run() {
            alphaCount += 1
            setStatus(renderer, `Alpha increased to ${alphaCount}`)
          },
        },
        {
          name: "alpha-up-count",
          title: "Alpha +count",
          desc: "Alpha +count",
          category: "Alpha",
          run({ payload }) {
            const amount = getCountPayload(payload)
            alphaCount += amount
            setStatus(renderer, `Alpha increased by ${amount} to ${alphaCount}`)
          },
        },
        {
          name: "alpha-down",
          title: "Alpha -1",
          desc: "Alpha -1",
          category: "Alpha",
          run() {
            alphaCount -= 1
            setStatus(renderer, `Alpha decreased to ${alphaCount}`)
          },
        },
        {
          name: "alpha-down-count",
          title: "Alpha -count",
          desc: "Alpha -count",
          category: "Alpha",
          run({ payload }) {
            const amount = getCountPayload(payload)
            alphaCount -= amount
            setStatus(renderer, `Alpha decreased by ${amount} to ${alphaCount}`)
          },
        },
        {
          name: "beta-up",
          title: "Beta +5",
          desc: "Beta +5",
          category: "Beta",
          run() {
            betaCount += 5
            setStatus(renderer, `Beta increased to ${betaCount}`)
          },
        },
        {
          name: "beta-up-count",
          title: "Beta +count",
          desc: "Beta +count",
          category: "Beta",
          run({ payload }) {
            const amount = getCountPayload(payload) * 5
            betaCount += amount
            setStatus(renderer, `Beta increased by ${amount} to ${betaCount}`)
          },
        },
        {
          name: "beta-down",
          title: "Beta -5",
          desc: "Beta -5",
          category: "Beta",
          run() {
            betaCount -= 5
            setStatus(renderer, `Beta decreased to ${betaCount}`)
          },
        },
        {
          name: "beta-down-count",
          title: "Beta -count",
          desc: "Beta -count",
          category: "Beta",
          run({ payload }) {
            const amount = getCountPayload(payload) * 5
            betaCount -= amount
            setStatus(renderer, `Beta decreased by ${amount} to ${betaCount}`)
          },
        },
        {
          name: "reset",
          namespace: "excommands",
          aliases: ["r"],
          nargs: "0",
          title: "Reset counters",
          desc: "Reset counters",
          category: "Session",
          usage: ":reset",
          run() {
            alphaCount = 0
            betaCount = 0
            setStatus(renderer, "Counters reset through :reset")
          },
        },
        {
          name: "write",
          namespace: "excommands",
          aliases: ["w"],
          nargs: "1",
          title: "Write file",
          desc: "Write file",
          category: "File",
          usage: ":write <file>",
          run({ payload }) {
            setStatus(renderer, `Wrote ${payload.args[0]}`)
          },
        },
      ],
    }),
  )

  disposers.push(
    addons.registerTimedLeader(keymapInstance, {
      trigger: { name: "x", ctrl: true },
      onArm() {
        leaderArmed = true
        setStatus(renderer, "Leader armed: press s or h")
      },
      onDisarm() {
        leaderArmed = false
        renderStatus(renderer)
      },
    }),
  )
  disposers.push(addons.registerNeovimDisambiguation(keymapInstance))
  disposers.push(addons.registerEscapeClearsPendingSequence(keymapInstance))
  disposers.push(addons.registerBackspacePopsPendingSequence(keymapInstance))
  disposers.push(
    keymapInstance.registerSequencePattern({
      name: COUNT_PATTERN,
      match(event) {
        if (!/^\d$/.test(event.name)) {
          return undefined
        }

        return { value: event.name, display: event.name }
      },
      finalize(values) {
        return Number(values.join(""))
      },
    }),
  )

  disposers.push(
    keymapInstance.registerLayer({
      enabled: () => !commandPromptVisible,
      bindings: [
        { key: "tab", cmd: "focus-next", desc: "Next target" },
        { key: "shift+tab", cmd: "focus-prev", desc: "Previous target" },
        { key: "?", cmd: "toggle-help", desc: "Toggle help" },
        { key: "ctrl+r", cmd: ":reset", desc: "Reset counters" },
        { key: "<leader>", group: "Leader" },
        { key: "<leader>s", cmd: ":w session.log", desc: "Write session log", group: "Leader" },
        { key: "<leader>h", cmd: "toggle-help", desc: "Toggle help", group: "Leader" },
      ],
    }),
  )

  disposers.push(
    keymapInstance.registerLayer({
      enabled: () => !commandPromptVisible,
      bindings: [{ key: ":", cmd: "open-ex-prompt", desc: "Open ex prompt" }],
    }),
  )

  if (commandPromptInput) {
    disposers.push(
      keymapInstance.registerLayer({
        target: commandPromptInput,
        enabled: () => commandPromptVisible,
        commands: [
          {
            name: "ex-prompt-close",
            run() {
              closeCommandPrompt(renderer, "Closed ex prompt")
            },
          },
          {
            name: "ex-prompt-prev",
            run() {
              moveCommandPromptSelection(renderer, -1)
            },
          },
          {
            name: "ex-prompt-next",
            run() {
              moveCommandPromptSelection(renderer, 1)
            },
          },
          {
            name: "ex-prompt-complete",
            run() {
              applyCommandPromptSuggestion(renderer)
            },
          },
          {
            name: "ex-prompt-complete-prev",
            run() {
              applyCommandPromptSuggestion(renderer, -1)
            },
          },
          {
            name: "ex-prompt-submit",
            run() {
              executeCommandPrompt(renderer)
            },
          },
        ],
        bindings: [
          { key: "escape", cmd: "ex-prompt-close", desc: "Close ex prompt" },
          { key: "up", cmd: "ex-prompt-prev", desc: "Previous suggestion" },
          { key: "down", cmd: "ex-prompt-next", desc: "Next suggestion" },
          { key: "tab", cmd: "ex-prompt-complete", desc: "Complete suggestion" },
          { key: "shift+tab", cmd: "ex-prompt-complete-prev", desc: "Previous completion" },
          { key: "return", cmd: "ex-prompt-submit", desc: "Run ex command" },
        ],
      }),
    )
  }

  disposers.push(
    addons.registerManagedTextareaLayer(keymapInstance, renderer, {
      enabled: () => !commandPromptVisible && renderer.currentFocusedEditor !== null,
      bindings: [
        { key: "left", cmd: "input.move.left", desc: "Cursor left" },
        { key: "right", cmd: "input.move.right", desc: "Cursor right" },
        { key: "up", cmd: "input.move.up", desc: "Cursor up" },
        { key: "down", cmd: "input.move.down", desc: "Cursor down" },
        { key: "backspace", cmd: "input.backspace", desc: "Delete backward" },
        { key: "delete", cmd: "input.delete", desc: "Delete forward" },
        { key: "return", cmd: "input.newline", desc: "New line" },
        { key: "ctrl+a", cmd: "input.line.home", desc: "Line start" },
        { key: "ctrl+e", cmd: "input.line.end", desc: "Line end" },
        { key: "d", group: "Delete" },
        { key: "dd", cmd: "input.delete.line", desc: "Delete line" },
        { key: "g", cmd: "input.line.home", desc: "Line start", group: "Go" },
        { key: "gg", cmd: "input.buffer.home", desc: "Buffer start", group: "Go" },
        { key: "shift+g", cmd: "input.buffer.end", desc: "Buffer end", group: "Go" },
      ],
    }),
  )

  disposers.push(
    keymapInstance.on("state", () => {
      renderStatus(renderer)
    }),
  )

  disposers.push(
    keymapInstance.on("dispatch", (event) => {
      addGraphPulse(renderer, event)
    }),
  )

  if (alphaPanel) {
    disposers.push(
      keymapInstance.registerLayer({
        target: alphaPanel,
        bindings: [
          { key: "j", cmd: "alpha-down", desc: "Alpha -1" },
          { key: "k", cmd: "alpha-up", desc: "Alpha +1" },
          { key: "{count}j", cmd: "alpha-down-count", desc: "Alpha -count" },
          { key: "{count}k", cmd: "alpha-up-count", desc: "Alpha +count" },
          { key: "return", cmd: ":w alpha-panel.txt", desc: "Write alpha panel" },
        ],
      }),
    )
  }

  if (betaPanel) {
    disposers.push(
      keymapInstance.registerLayer({
        target: betaPanel,
        bindings: [
          { key: "j", cmd: "beta-down", desc: "Beta -5" },
          { key: "k", cmd: "beta-up", desc: "Beta +5" },
          { key: "{count}j", cmd: "beta-down-count", desc: "Beta -count" },
          { key: "{count}k", cmd: "beta-up-count", desc: "Beta +count" },
          { key: "return", cmd: ":w beta-panel.txt", desc: "Write beta panel" },
        ],
      }),
    )
  }
}

export function run(renderer: CliRenderer): void {
  renderer.setBackgroundColor(P.bg)

  alphaCount = 0
  betaCount = 0
  helpVisible = true
  leaderArmed = false
  commandPromptVisible = false
  commandPromptValue = ":"
  commandPromptSelection = 0
  commandPromptRestoreTarget = null
  lastAction = "Click a panel or press Tab to start."
  logLines = []
  cleanupGraphAnimation(renderer)
  graphPulses = []
  graphLastRenderedHeight = -1
  graphLastRenderedWidth = -1
  editorFrames = []
  editors = []

  root = new BoxRenderable(renderer, {
    id: "keymap-demo-root",
    flexDirection: "column",
    flexGrow: 1,
    padding: 1,
    backgroundColor: P.bg,
  })
  renderer.root.add(root)

  const panelsRow = new BoxRenderable(renderer, {
    id: "keymap-demo-panels",
    flexDirection: "row",
    height: 4,
  })
  root.add(panelsRow)

  alphaPanel = new BoxRenderable(renderer, {
    id: "keymap-demo-alpha",
    border: true,
    borderStyle: "single",
    focusable: true,
    focusedBorderColor: P.alpha,
    borderColor: P.border,
    backgroundColor: P.panel,
    paddingX: 1,
    flexDirection: "column",
    flexGrow: 1,
    title: " Alpha ",
    titleAlignment: "left",
  })
  panelsRow.add(alphaPanel)

  alphaText = new TextRenderable(renderer, {
    id: "keymap-demo-alpha-text",
    content: "",
    fg: P.text,
  })
  alphaPanel.add(alphaText)

  betaPanel = new BoxRenderable(renderer, {
    id: "keymap-demo-beta",
    border: true,
    borderStyle: "single",
    focusable: true,
    focusedBorderColor: P.beta,
    borderColor: P.border,
    backgroundColor: P.panel,
    paddingX: 1,
    flexDirection: "column",
    flexGrow: 1,
    title: " Beta ",
    titleAlignment: "left",
  })
  panelsRow.add(betaPanel)

  betaText = new TextRenderable(renderer, {
    id: "keymap-demo-beta-text",
    content: "",
    fg: P.text,
  })
  betaPanel.add(betaText)

  const editorsRow = new BoxRenderable(renderer, {
    id: "keymap-demo-editors",
    flexDirection: "row",
    height: 5,
  })
  root.add(editorsRow)

  for (const [index, spec] of editorSpecs.entries()) {
    const frame = new BoxRenderable(renderer, {
      id: `keymap-demo-editor-frame-${spec.id}`,
      border: true,
      borderStyle: "single",
      borderColor: P.border,
      backgroundColor: P.panel,
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
      title: ` ${index + 1}. ${spec.label} `,
      titleAlignment: "left",
    })
    editorsRow.add(frame)

    const editor = new TextareaRenderable(renderer, {
      id: `keymap-demo-editor-${index + 1}`,
      width: "100%",
      height: "100%",
      initialValue: spec.initialValue,
      placeholder: spec.placeholder ?? null,
      backgroundColor: P.surface,
      focusedBackgroundColor: P.surfaceFocus,
      textColor: P.text,
      focusedTextColor: P.title,
      placeholderColor: P.textMuted,
      selectionBg: P.surfaceFocus,
      selectionFg: P.text,
      wrapMode: "word",
    })
    frame.add(editor)

    editorFrames.push(frame)
    editors.push(editor)
  }

  const footer = new BoxRenderable(renderer, {
    id: "keymap-demo-footer",
    border: true,
    borderStyle: "single",
    borderColor: P.border,
    backgroundColor: P.panel,
    paddingX: 1,
    gap: 2,
    flexDirection: "row",
    flexGrow: 1,
    minHeight: 4,
  })
  root.add(footer)

  const detailsColumn = new BoxRenderable(renderer, {
    id: "keymap-demo-details-column",
    flexGrow: 1,
    minWidth: 0,
    flexDirection: "column",
  })
  footer.add(detailsColumn)

  statusFocusedText = new TextRenderable(renderer, {
    id: "keymap-demo-status-focused",
    content: "",
    fg: P.text,
    height: 1,
  })
  detailsColumn.add(statusFocusedText)

  statusInfoText = new TextRenderable(renderer, {
    id: "keymap-demo-status-info",
    content: "",
    fg: P.text,
    height: 1,
  })
  detailsColumn.add(statusInfoText)

  statusLeaderText = new TextRenderable(renderer, {
    id: "keymap-demo-status-leader",
    content: "",
    fg: P.text,
    height: 1,
  })
  detailsColumn.add(statusLeaderText)

  statusPendingText = new TextRenderable(renderer, {
    id: "keymap-demo-status-pending",
    content: "",
    fg: P.text,
    height: 1,
  })
  detailsColumn.add(statusPendingText)

  statusLastText = new TextRenderable(renderer, {
    id: "keymap-demo-status-last",
    content: "",
    fg: P.text,
    height: 1,
  })
  detailsColumn.add(statusLastText)

  helpBox = new BoxRenderable(renderer, {
    id: "keymap-demo-help",
    flexDirection: "column",
    marginTop: 1,
  })
  detailsColumn.add(helpBox)

  helpText = new TextRenderable(renderer, {
    id: "keymap-demo-help-text",
    content: buildHelpContent(),
    fg: P.text,
    height: 3,
  })
  helpBox.add(helpText)

  const graphBox = new BoxRenderable(renderer, {
    id: "keymap-demo-graph",
    border: true,
    borderStyle: "single",
    borderColor: P.borderStrong,
    backgroundColor: P.surface,
    paddingX: 1,
    flexGrow: 1,
    flexShrink: 1,
    minHeight: GRAPH_MIN_PANEL_ROWS + 2,
    flexDirection: "column",
    marginTop: 1,
    title: " Runtime Graph ",
    titleAlignment: "left",
  })
  detailsColumn.add(graphBox)

  graphText = new TextRenderable(renderer, {
    id: "keymap-demo-graph-text",
    content: "",
    fg: P.text,
    flexGrow: 1,
    flexShrink: 1,
    minHeight: GRAPH_MIN_PANEL_ROWS,
    width: "100%",
    onSizeChange() {
      scheduleGraphRefresh(renderer)
    },
  })
  graphBox.add(graphText)

  setupGraphAnimation(renderer)
  scheduleGraphRefresh(renderer)

  const whichKeyColumn = new BoxRenderable(renderer, {
    id: "keymap-demo-which-key-column",
    width: "40%",
    minWidth: 30,
    maxWidth: 48,
    flexShrink: 0,
    flexDirection: "column",
  })
  footer.add(whichKeyColumn)

  whichKeyHeaderText = new TextRenderable(renderer, {
    id: "keymap-demo-wk-header-text",
    content: "",
    fg: P.text,
    height: 1,
  })
  whichKeyColumn.add(whichKeyHeaderText)

  whichKeyScrollBox = new ScrollBoxRenderable(renderer, {
    id: "keymap-demo-wk-scrollbox",
    flexGrow: 1,
    flexShrink: 1,
    contentOptions: {
      paddingRight: 1,
    },
  })
  whichKeyScrollBox.verticalScrollbarOptions = { visible: true }
  whichKeyScrollBox.horizontalScrollbarOptions = { visible: false }
  whichKeyColumn.add(whichKeyScrollBox)

  whichKeyEntriesText = new TextRenderable(renderer, {
    id: "keymap-demo-wk-entries-text",
    content: "",
    fg: P.text,
    width: "100%",
    wrapMode: "word",
  })
  whichKeyScrollBox.add(whichKeyEntriesText)

  commandPromptShell = new BoxRenderable(renderer, {
    id: "keymap-demo-ex-prompt-shell",
    position: "absolute",
    left: "50%",
    top: "50%",
    width: EX_PROMPT_WIDTH,
    marginLeft: -(EX_PROMPT_WIDTH / 2),
    marginTop: -Math.ceil(EX_PROMPT_MAX_HEIGHT / 2),
    flexDirection: "column",
    zIndex: 40,
    visible: false,
  })
  root.add(commandPromptShell)

  commandPromptBox = new BoxRenderable(renderer, {
    id: "keymap-demo-ex-prompt",
    width: EX_PROMPT_WIDTH,
    height: EX_PROMPT_CHROME_ROWS,
    border: true,
    borderStyle: "single",
    borderColor: P.accent,
    backgroundColor: P.surface,
    paddingX: 1,
    paddingY: 0,
    flexDirection: "column",
    title: " Ex Command ",
    titleAlignment: "center",
  })
  commandPromptShell.add(commandPromptBox)

  commandPromptHintText = new TextRenderable(renderer, {
    id: "keymap-demo-ex-prompt-hint",
    content: "",
    fg: P.textMuted,
    height: 1,
  })
  commandPromptBox.add(commandPromptHintText)

  commandPromptInput = new InputRenderable(renderer, {
    id: "keymap-demo-ex-input",
    width: "100%",
    value: ":",
    placeholder: ":write session.log",
    backgroundColor: P.surface,
    focusedBackgroundColor: P.surfaceFocus,
    textColor: P.title,
    focusedTextColor: P.title,
    placeholderColor: P.textMuted,
  })
  commandPromptBox.add(commandPromptInput)

  commandPromptUsageText = new TextRenderable(renderer, {
    id: "keymap-demo-ex-prompt-usage",
    content: "",
    fg: P.text,
    height: 1,
  })
  commandPromptBox.add(commandPromptUsageText)

  commandPromptSuggestionsBox = new BoxRenderable(renderer, {
    id: "keymap-demo-ex-prompt-list",
    width: EX_PROMPT_WIDTH,
    height: getCommandPromptSuggestionRows(),
    backgroundColor: P.surface,
    paddingX: 1,
    paddingY: 0,
    flexDirection: "column",
  })
  commandPromptShell.add(commandPromptSuggestionsBox)

  commandPromptSuggestionsText = new TextRenderable(renderer, {
    id: "keymap-demo-ex-prompt-suggestions",
    content: "",
    fg: P.text,
    height: getCommandPromptSuggestionRows(),
  })
  commandPromptSuggestionsBox.add(commandPromptSuggestionsText)

  commandPromptInput.on(InputRenderableEvents.INPUT, (value: string) => {
    commandPromptValue = value
    commandPromptSelection = 0
    renderAll(renderer)
  })

  const keymapInstance = createDefaultOpenTuiKeymap(renderer)

  registerCommandLayers(renderer, keymapInstance)
  addLog("Tab switches focus across panels and editors.")
  addLog(`${LEADER_TRIGGER_LABEL} arms the leader extension.`)
  addLog("Editors use g/gg/shift+g for Vim-style navigation.")
  addLog(": opens the centered ex prompt.")
  addLog("Runtime Graph shows active layers, reachable bindings, and dispatch pulses.")
  renderAll(renderer)
  alphaPanel.focus()
  setStatus(renderer, "Focused Alpha panel")
}

export function destroy(renderer: CliRenderer): void {
  leaderArmed = false
  cleanupGraphAnimation(renderer)

  while (disposers.length > 0) {
    const dispose = disposers.pop()
    dispose?.()
  }

  root?.destroyRecursively()

  keymap = null
  root = null
  alphaPanel = null
  betaPanel = null
  alphaText = null
  betaText = null
  editorFrames = []
  editors = []
  commandPromptShell = null
  commandPromptBox = null
  commandPromptSuggestionsBox = null
  commandPromptInput = null
  commandPromptHintText = null
  commandPromptUsageText = null
  commandPromptSuggestionsText = null
  statusFocusedText = null
  statusInfoText = null
  statusLeaderText = null
  statusPendingText = null
  statusLastText = null
  helpBox = null
  helpText = null
  whichKeyHeaderText = null
  whichKeyScrollBox = null
  whichKeyEntriesText = null
  graphText = null
  logBox = null
  logText = null
  commandPromptVisible = false
  commandPromptValue = ":"
  commandPromptSelection = 0
  commandPromptRestoreTarget = null
  lastAction = "Click a panel or press Tab to start."
  logLines = []
  graphPulses = []
  graphLastRenderedHeight = -1
  graphLastRenderedWidth = -1
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
  renderer.start()
}
