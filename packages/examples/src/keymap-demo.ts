import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
  TextAttributes,
  TextareaRenderable,
  StyledText,
  createCliRenderer,
  bold,
  fg,
  type CliRenderer,
  type KeyEvent,
  type Renderable,
  type TextChunk,
} from "@opentui/core"
import { type ActiveKey, type CommandRecord, type Keymap } from "@opentui/keymap"
import * as addons from "@opentui/keymap/addons/opentui"
import { formatKeySequence } from "@opentui/keymap/extras"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const P = {
  bg: "#0f172a",
  surface: "#1e293b",
  surfaceFocus: "#24324d",
  border: "#334155",
  text: "#e2e8f0",
  textDim: "#94a3b8",
  textMuted: "#64748b",
  title: "#f1f5f9",
  alpha: "#38bdf8",
  beta: "#34d399",
  accent: "#a78bfa",
  leader: "#fb923c",
  key: "#fbbf24",
  command: "#67e8f9",
  separator: "#475569",
} as const

const LEADER_TOKEN = "<leader>"
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
let statusLastText: TextRenderable | null = null
let helpBox: BoxRenderable | null = null
let helpText: TextRenderable | null = null
let whichKeyHeaderText: TextRenderable | null = null
let whichKeyScrollBox: ScrollBoxRenderable | null = null
let whichKeyEntriesText: TextRenderable | null = null
let logBox: BoxRenderable | null = null
let logText: TextRenderable | null = null
let keymap: Keymap | null = null

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

function getExPromptCommandFieldText(command: CommandRecord, fieldName: string): string | undefined {
  return getMetadataText(command.fields[fieldName])
}

function getExPromptCommandNargs(command: CommandRecord): ExArgCount | undefined {
  const value = command.fields.nargs
  if (value === "0" || value === "1" || value === "?" || value === "*" || value === "+") {
    return value
  }

  return undefined
}

function getExPromptCommands(): readonly CommandRecord[] {
  return keymap?.getCommands({ namespace: "excommands" }) ?? []
}

function buildExPromptSuggestions(commands: readonly CommandRecord[]): ExPromptSuggestion[] {
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
          name: "beta-down",
          title: "Beta -5",
          desc: "Beta -5",
          category: "Beta",
          run() {
            betaCount -= 5
            setStatus(renderer, `Beta decreased to ${betaCount}`)
          },
        },
      ],
    }),
  )

  disposers.push(
    addons.registerExCommands(keymapInstance, [
      {
        name: "reset",
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
        aliases: ["w"],
        nargs: "1",
        title: "Write file",
        desc: "Write file",
        category: "File",
        usage: ":write <file>",
        run({ args }) {
          setStatus(renderer, `Wrote ${args[0]}`)
        },
      },
    ]),
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
        { key: "left", cmd: "move-left", desc: "Cursor left" },
        { key: "right", cmd: "move-right", desc: "Cursor right" },
        { key: "up", cmd: "move-up", desc: "Cursor up" },
        { key: "down", cmd: "move-down", desc: "Cursor down" },
        { key: "backspace", cmd: "backspace", desc: "Delete backward" },
        { key: "delete", cmd: "delete", desc: "Delete forward" },
        { key: "return", cmd: "newline", desc: "New line" },
        { key: "ctrl+a", cmd: "line-home", desc: "Line start" },
        { key: "ctrl+e", cmd: "line-end", desc: "Line end" },
        { key: "d", group: "Delete" },
        { key: "dd", cmd: "delete-line", desc: "Delete line" },
        { key: "g", cmd: "line-home", desc: "Line start", group: "Go" },
        { key: "gg", cmd: "buffer-home", desc: "Buffer start", group: "Go" },
        { key: "shift+g", cmd: "buffer-end", desc: "Buffer end", group: "Go" },
      ],
    }),
  )

  disposers.push(
    keymapInstance.on("state", () => {
      renderStatus(renderer)
    }),
  )

  if (alphaPanel) {
    disposers.push(
      keymapInstance.registerLayer({
        target: alphaPanel,
        bindings: [
          { key: "j", cmd: "alpha-down", desc: "Alpha -1" },
          { key: "k", cmd: "alpha-up", desc: "Alpha +1" },
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

  const title = new TextRenderable(renderer, {
    id: "keymap-demo-title",
    content: "Keymap Demo",
    fg: P.title,
    attributes: TextAttributes.BOLD,
    height: 1,
  })
  root.add(title)

  const subtitle = new TextRenderable(renderer, {
    id: "keymap-demo-subtitle",
    content: "Original Alpha/Beta panels, three switchable textareas, and a centered : prompt.",
    fg: P.textMuted,
    height: 1,
  })
  root.add(subtitle)

  const panelsRow = new BoxRenderable(renderer, {
    id: "keymap-demo-panels",
    flexDirection: "row",
    gap: 1,
    height: 4,
  })
  root.add(panelsRow)

  alphaPanel = new BoxRenderable(renderer, {
    id: "keymap-demo-alpha",
    border: true,
    borderStyle: "rounded",
    focusable: true,
    focusedBorderColor: P.alpha,
    borderColor: P.border,
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
    borderStyle: "rounded",
    focusable: true,
    focusedBorderColor: P.beta,
    borderColor: P.border,
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
    gap: 1,
    height: 5,
  })
  root.add(editorsRow)

  for (const [index, spec] of editorSpecs.entries()) {
    const frame = new BoxRenderable(renderer, {
      id: `keymap-demo-editor-frame-${spec.id}`,
      border: true,
      borderStyle: "rounded",
      borderColor: P.border,
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
      selectionBg: "#264F78",
      selectionFg: "#FFFFFF",
      wrapMode: "word",
    })
    frame.add(editor)

    editorFrames.push(frame)
    editors.push(editor)
  }

  const footer = new BoxRenderable(renderer, {
    id: "keymap-demo-footer",
    border: true,
    borderStyle: "rounded",
    borderColor: P.border,
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

  logBox = new BoxRenderable(renderer, {
    id: "keymap-demo-log",
    flexDirection: "column",
    marginTop: 1,
  })
  detailsColumn.add(logBox)

  logText = new TextRenderable(renderer, {
    id: "keymap-demo-log-text",
    content: "",
    fg: P.text,
  })
  logBox.add(logText)

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
    borderStyle: "rounded",
    borderColor: P.accent,
    backgroundColor: P.bg,
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
    backgroundColor: P.bg,
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
  renderAll(renderer)
  alphaPanel.focus()
  setStatus(renderer, "Focused Alpha panel")
}

export function destroy(_renderer: CliRenderer): void {
  leaderArmed = false

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
  statusLastText = null
  helpBox = null
  helpText = null
  whichKeyHeaderText = null
  whichKeyScrollBox = null
  whichKeyEntriesText = null
  logBox = null
  logText = null
  commandPromptVisible = false
  commandPromptValue = ":"
  commandPromptSelection = 0
  commandPromptRestoreTarget = null
  lastAction = "Click a panel or press Tab to start."
  logLines = []
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
  renderer.start()
}
