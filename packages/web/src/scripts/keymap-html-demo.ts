import {
  createDefaultHtmlKeymap,
  createHtmlKeymapEvent,
  stringifyKeyStroke,
  type ActiveKey,
  type KeySequencePart,
} from "@opentui/keymap/html"
import * as addons from "@opentui/keymap/addons"

const app = document.getElementById("app") as HTMLElement | null
const keymapRoot = document.body
const alphaPanel = document.getElementById("alpha-panel") as HTMLElement | null
const betaPanel = document.getElementById("beta-panel") as HTMLElement | null
const notesCard = document.getElementById("notes-card") as HTMLElement | null
const draftCard = document.getElementById("draft-card") as HTMLElement | null
const notesField = document.getElementById("notes-field") as HTMLTextAreaElement | null
const draftField = document.getElementById("draft-field") as HTMLTextAreaElement | null
const promptOverlay = document.getElementById("prompt-overlay") as HTMLElement | null
const promptShell = document.getElementById("prompt-shell") as HTMLElement | null
const commandInput = document.getElementById("command-input") as HTMLInputElement | null
const commandHelp = document.getElementById("command-help") as HTMLElement | null
const commandSuggestions = document.getElementById("command-suggestions") as HTMLElement | null
const leaderState = document.getElementById("leader-state") as HTMLElement | null
const pendingSequence = document.getElementById("pending-sequence") as HTMLElement | null
const focusedTarget = document.getElementById("focused-target") as HTMLElement | null
const alphaCount = document.getElementById("alpha-count") as HTMLElement | null
const betaCount = document.getElementById("beta-count") as HTMLElement | null
const activeKeysCard = document.getElementById("active-keys-card") as HTMLElement | null
const activeKeys = document.getElementById("active-keys") as HTMLElement | null
const logCard = document.getElementById("log-card") as HTMLElement | null
const logLines = document.getElementById("log-lines") as HTMLElement | null
const helpCard = document.getElementById("help-card") as HTMLElement | null
const helpCopy = document.getElementById("help-copy") as HTMLElement | null

if (
  !app ||
  !alphaPanel ||
  !betaPanel ||
  !notesCard ||
  !draftCard ||
  !notesField ||
  !draftField ||
  !promptOverlay ||
  !promptShell ||
  !commandInput ||
  !commandHelp ||
  !commandSuggestions ||
  !leaderState ||
  !pendingSequence ||
  !focusedTarget ||
  !alphaCount ||
  !betaCount ||
  !activeKeysCard ||
  !activeKeys ||
  !logCard ||
  !logLines ||
  !helpCard ||
  !helpCopy
) {
  throw new Error("HTML keymap example is missing required DOM nodes")
}

const keymap = createDefaultHtmlKeymap(keymapRoot)
const focusableTargets = [alphaPanel, betaPanel, notesField, draftField, activeKeysCard, logCard]

let alphaValue = 0
let betaValue = 0
let helpVisible = true
let promptVisible = false
let leaderArmed = false
let promptRestoreTarget: HTMLElement | null = null
let selectedSuggestion = 0
let lastAction = "Focus a panel or textarea to begin."
let logEntries: Array<{ at: string; message: string }> = []

const DEBUG_NAMESPACE = "[html-keymap-demo]"
const LEADER_TOKEN = "<leader>"
const LEADER_TRIGGER_LABEL = stringifyKeyStroke({ name: "space" })

function formatDemoKeyPart(part: Pick<KeySequencePart, "stroke" | "tokenName">): string {
  if (part.tokenName === LEADER_TOKEN) {
    return LEADER_TRIGGER_LABEL
  }

  return stringifyKeyStroke(part)
}

function formatDemoKeySequence(parts: readonly Pick<KeySequencePart, "stroke" | "tokenName">[]): string {
  return parts.map((part) => formatDemoKeyPart(part)).join(" ")
}

function summarizeActiveKeys(keys: readonly ActiveKey[]): string[] {
  return keys.map((entry) => {
    const summary = entry.continues ? "prefix" : typeof entry.command === "string" ? entry.command : "fn"
    return `${formatDemoKeyPart(entry)}:${summary}`
  })
}

function debug(label: string, details?: Record<string, unknown>): void {
  if (details) {
    console.groupCollapsed(`${DEBUG_NAMESPACE} ${label}`)
    console.table(details)
    console.groupEnd()
    return
  }

  console.log(`${DEBUG_NAMESPACE} ${label}`)
}

function debugKeyEvent(phase: "keydown" | "keyup", event: KeyboardEvent): void {
  const normalized = createHtmlKeymapEvent(event)
  debug(`${phase} ${event.key}`, {
    rawKey: event.key,
    code: event.code,
    target: event.target instanceof HTMLElement ? event.target.id || event.target.tagName.toLowerCase() : "unknown",
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
    repeat: event.repeat,
    cancelable: event.cancelable,
    defaultPrevented: event.defaultPrevented,
    normalizedName: normalized.name,
    normalizedCtrl: normalized.ctrl,
    normalizedShift: normalized.shift,
    normalizedMeta: normalized.meta,
    normalizedSuper: normalized.super,
    focused: getCurrentFocusedTarget()?.id ?? "none",
    activeKeys: summarizeActiveKeys(keymap.getActiveKeys({ includeMetadata: true })).join(", ") || "none",
    pending: formatDemoKeySequence(keymap.getPendingSequence()) || "none",
    promptVisible,
  })
}

interface ExSuggestion {
  label: string
  insert: string
  usage: string
  desc: string
  expectsArgs: boolean
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

function getCommandNargs(record: ReturnType<typeof keymap.getCommands>[number]): string | undefined {
  const value = record.fields.nargs
  if (value === "0" || value === "1" || value === "?" || value === "*" || value === "+") {
    return value
  }

  return undefined
}

function buildCommandSuggestions(): ExSuggestion[] {
  const records = keymap.getCommands({ namespace: "excommands" })
  return records.map((record) => {
    const label = normalizeExPromptName(record.name)
    const usage = getText(record.fields.usage) ?? label
    const desc = getText(record.attrs?.desc) ?? getText(record.fields.desc) ?? ""

    return {
      label,
      insert: label,
      usage,
      desc,
      expectsArgs: getCommandNargs(record) !== "0",
    }
  })
}

function appendLog(message: string): void {
  lastAction = message
  logEntries = [{ at: new Date().toLocaleTimeString(), message }, ...logEntries].slice(0, 40)
  console.log(`${DEBUG_NAMESPACE} action`, message)
  renderLog()
}

function getCurrentFocusedTarget(): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) {
    return null
  }

  if (active === app || app.contains(active)) {
    return active
  }

  return null
}

function focusOffset(delta: number): void {
  const current = getCurrentFocusedTarget()
  const currentIndex = focusableTargets.findIndex((target) => target === current)
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + focusableTargets.length) % focusableTargets.length
  debug("focus offset", {
    delta,
    current: current?.id ?? "none",
    next: focusableTargets[nextIndex]?.id ?? "none",
  })
  focusableTargets[nextIndex]?.focus()
}

function getScrollablePane(target: HTMLElement | null): HTMLElement | null {
  if (target === activeKeysCard) {
    return activeKeys
  }

  if (target === logCard) {
    return logLines
  }

  return null
}

function scrollFocusedPane(delta: number): boolean {
  const pane = getScrollablePane(getCurrentFocusedTarget())
  if (!pane) {
    return false
  }

  const lineHeight = Number.parseFloat(getComputedStyle(pane).lineHeight)
  const fallbackStep = 48
  const step = Number.isFinite(lineHeight) ? Math.max(24, lineHeight * 3) : fallbackStep
  pane.scrollBy({ top: delta * step, behavior: "auto" })
  return true
}

function scrollFocusedPanePage(delta: number): boolean {
  const pane = getScrollablePane(getCurrentFocusedTarget())
  if (!pane) {
    return false
  }

  pane.scrollBy({ top: delta * Math.max(48, pane.clientHeight * 0.85), behavior: "auto" })
  return true
}

function scrollFocusedPaneEdge(position: "top" | "bottom"): boolean {
  const pane = getScrollablePane(getCurrentFocusedTarget())
  if (!pane) {
    return false
  }

  pane.scrollTo({ top: position === "top" ? 0 : pane.scrollHeight, behavior: "auto" })
  return true
}

function setPromptVisible(visible: boolean): void {
  promptVisible = visible
  app.classList.toggle("prompt-open", visible)
  promptOverlay.classList.toggle("is-hidden", !visible)
}

function getText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  return trimmed
}

function getCommandSuggestions(): ExSuggestion[] {
  const normalized = normalizeExPromptName(commandInput.value)
  const spaceIndex = normalized.indexOf(" ")
  const query = spaceIndex === -1 ? normalized : normalized.slice(0, spaceIndex)
  const suggestions = buildCommandSuggestions()

  if (query === ":") {
    return suggestions.slice(0, 6)
  }

  return suggestions.filter((suggestion) => suggestion.label.startsWith(query)).slice(0, 6)
}

function applySuggestion(delta: number): void {
  const suggestions = getCommandSuggestions()
  if (suggestions.length === 0) {
    return
  }

  selectedSuggestion = (selectedSuggestion + delta + suggestions.length) % suggestions.length
  renderPrompt()
}

function completeSuggestion(direction?: 1 | -1): void {
  const suggestions = getCommandSuggestions()
  if (suggestions.length === 0) {
    return
  }

  const nextSelection = direction
    ? (selectedSuggestion + direction + suggestions.length) % suggestions.length
    : Math.min(selectedSuggestion, suggestions.length - 1)
  const suggestion = suggestions[nextSelection]
  if (!suggestion) {
    return
  }

  const normalized = normalizeExPromptName(commandInput.value)
  const spaceIndex = normalized.indexOf(" ")
  const rest = spaceIndex === -1 ? "" : normalized.slice(spaceIndex + 1).trimStart()
  const nextValue = rest
    ? `${suggestion.insert} ${rest}`
    : suggestion.expectsArgs
      ? `${suggestion.insert} `
      : suggestion.insert

  commandInput.value = nextValue
  selectedSuggestion = nextSelection
  commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length)
  renderPrompt()
}

function openPrompt(): void {
  if (promptVisible) {
    debug("prompt already open", {
      focused: getCurrentFocusedTarget()?.id ?? "none",
    })
    commandInput.focus()
    return
  }

  promptRestoreTarget = getCurrentFocusedTarget()
  selectedSuggestion = 0
  commandInput.value = ":"
  setPromptVisible(true)
  commandInput.focus()
  commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length)
  appendLog("Opened ex prompt")
  debug("prompt opened", {
    restoreTarget: promptRestoreTarget?.id ?? "none",
    focused: getCurrentFocusedTarget()?.id ?? "none",
  })
  renderPrompt()
  renderAll()
}

function closePrompt(): void {
  if (!promptVisible) {
    return
  }

  setPromptVisible(false)
  selectedSuggestion = 0
  commandInput.value = ":"

  if (promptRestoreTarget && document.contains(promptRestoreTarget)) {
    promptRestoreTarget.focus()
  }

  promptRestoreTarget = null
  appendLog("Closed ex prompt")
  debug("prompt closed", {
    focused: getCurrentFocusedTarget()?.id ?? "none",
  })
  renderPrompt()
  renderAll()
}

function runPromptCommand(): void {
  const parsed = parseExPromptInput(commandInput.value)
  if (!parsed) {
    closePrompt()
    return
  }

  debug("run prompt command", {
    command: parsed.raw,
    focused:
      (promptRestoreTarget && document.contains(promptRestoreTarget) ? promptRestoreTarget : getCurrentFocusedTarget())
        ?.id ?? "none",
  })

  const focused =
    promptRestoreTarget && document.contains(promptRestoreTarget) ? promptRestoreTarget : getCurrentFocusedTarget()
  const result = keymap.dispatchCommand(parsed.raw, { focused })
  if (result.ok) {
    appendLog(`Ran ${parsed.raw}`)
    closePrompt()
    return
  }

  appendLog(`Command failed: ${parsed.raw} (${result.reason})`)
  renderPrompt()
}

function saveSnapshot(label: string): void {
  appendLog(
    `${label}: alpha=${alphaValue}, beta=${betaValue}, notes=${notesField.value.length} chars, draft=${draftField.value.length} chars`,
  )
}

function resetDemo(): void {
  alphaValue = 0
  betaValue = 0
  renderCounters()
  appendLog("Reset counters")
  renderAll()
}

function toggleHelp(): void {
  helpVisible = !helpVisible
  helpCard.classList.toggle("is-hidden", !helpVisible)
  appendLog(helpVisible ? "Help opened" : "Help hidden")
}

function incrementAlpha(delta: number): void {
  alphaValue += delta
  renderCounters()
  appendLog(`Alpha ${delta > 0 ? "incremented" : "decremented"} to ${alphaValue}`)
}

function incrementBeta(delta: number): void {
  betaValue += delta
  renderCounters()
  appendLog(`Beta ${delta > 0 ? "incremented" : "decremented"} to ${betaValue}`)
}

function captureTextarea(name: string, field: HTMLTextAreaElement): void {
  appendLog(`${name}: ${field.value.split(/\n+/)[0] ?? ""}`)
}

function renderCounters(): void {
  alphaCount.textContent = String(alphaValue)
  betaCount.textContent = String(betaValue)
}

function renderStatus(): void {
  leaderState.textContent = leaderArmed ? "Armed" : "Idle"

  const pending = keymap.getPendingSequence()
  pendingSequence.textContent = pending.length === 0 ? "None" : formatDemoKeySequence(pending)

  const focused = getCurrentFocusedTarget()
  focusedTarget.textContent = focused?.id ?? "None"
}

function getActiveKeyDescription(activeKey: ActiveKey): string {
  const fromBinding = getText(activeKey.bindingAttrs?.desc)
  if (fromBinding) {
    return fromBinding
  }

  const fromCommandDesc = getText(activeKey.commandAttrs?.desc)
  if (fromCommandDesc) {
    return fromCommandDesc
  }

  const fromCommandTitle = getText(activeKey.commandAttrs?.title)
  if (fromCommandTitle) {
    return fromCommandTitle
  }

  if (activeKey.continues) {
    const group = getText(activeKey.bindingAttrs?.group)
    if (group) {
      return `Continue ${group.toLowerCase()} bindings`
    }

    return "Continue sequence"
  }

  if (typeof activeKey.command === "string") {
    return activeKey.command
  }

  return "Action"
}

function renderActiveKeys(): void {
  const entries = keymap.getActiveKeys({ includeMetadata: true })
  if (entries.length === 0) {
    activeKeys.innerHTML = '<div class="active-key-row">No active bindings for the current focus state.</div>'
    return
  }

  activeKeys.innerHTML = entries
    .map((entry) => {
      return `
        <div class="active-key-row">
          <div class="active-key-header">
            <strong><kbd>${formatDemoKeyPart(entry)}</kbd></strong>
            <span>${entry.continues ? "Prefix" : "Command"}</span>
          </div>
          <div class="active-key-desc">${getActiveKeyDescription(entry)}</div>
        </div>
      `
    })
    .join("")
}

function renderLog(): void {
  logLines.innerHTML = logEntries
    .map((entry) => {
      return `<div class="log-line"><time>${entry.at}</time><div>${entry.message}</div></div>`
    })
    .join("")
}

function renderPrompt(): void {
  if (!promptVisible) {
    commandHelp.textContent = "Prompt hidden. Press : to open it."
    commandSuggestions.innerHTML = ""
    return
  }

  const suggestions = getCommandSuggestions()
  const selected = suggestions[selectedSuggestion] ?? suggestions[0]
  if (selected && suggestions[0] && !suggestions[selectedSuggestion]) {
    selectedSuggestion = 0
  }

  commandHelp.textContent = selected
    ? `${selected.usage}${selected.desc ? ` - ${selected.desc}` : ""}`
    : "No matching ex command"
  commandSuggestions.innerHTML = suggestions
    .map((suggestion, index) => {
      const selectedClass = index === selectedSuggestion ? " suggestion is-selected" : " suggestion"
      return `
        <div class="${selectedClass.trim()}">
          <div class="suggestion-header">
            <strong>${suggestion.label}</strong>
            <span class="suggestion-usage">${suggestion.usage}</span>
          </div>
          <div class="suggestion-desc">${suggestion.desc || "No description"}</div>
        </div>
      `
    })
    .join("")
}

function renderHelp(): void {
  helpCard.classList.toggle("is-hidden", !helpVisible)
  helpCopy.innerHTML = [
    "<div><kbd>Tab</kbd> and <kbd>Shift+Tab</kbd> cycle focus between panels, textareas, and sidebar panes.</div>",
    `<div><kbd>${LEADER_TRIGGER_LABEL}</kbd> arms a leader sequence for <kbd>${LEADER_TRIGGER_LABEL} s</kbd>, <kbd>${LEADER_TRIGGER_LABEL} h</kbd>, and <kbd>${LEADER_TRIGGER_LABEL} r</kbd>.</div>`,
    "<div><kbd>:</kbd> opens the ex prompt as a modal overlay. Try <kbd>:help</kbd>, <kbd>:reset</kbd>, <kbd>:write alpha</kbd>, or <kbd>:focus draft</kbd>.</div>",
    "<div>The Alpha and Beta panels each install their own focus-within layers with <kbd>j</kbd>, <kbd>k</kbd>, and <kbd>Enter</kbd>.</div>",
    "<div>The Notes and Draft textareas use plain browser editing plus keymap bindings for <kbd>Ctrl+Enter</kbd>.</div>",
    "<div>The Active Keys and Recent Actions panes can be focused and scrolled with <kbd>j</kbd>, <kbd>k</kbd>, <kbd>Ctrl+d</kbd>, <kbd>Ctrl+u</kbd>, <kbd>g</kbd>, <kbd>gg</kbd>, and <kbd>Shift+g</kbd>.</div>",
  ].join("")
}

function renderAll(): void {
  renderCounters()
  renderStatus()
  renderActiveKeys()
  renderPrompt()
  renderHelp()
}

function debugStateSnapshot(source: string): void {
  debug(`state ${source}`, {
    focused: getCurrentFocusedTarget()?.id ?? "none",
    promptVisible,
    leaderArmed,
    pending: formatDemoKeySequence(keymap.getPendingSequence()) || "none",
    activeKeys: summarizeActiveKeys(keymap.getActiveKeys({ includeMetadata: true })).join(", ") || "none",
  })
}

disposers()

function disposers(): void {
  addons.registerExCommands(keymap, [
    {
      name: ":help",
      desc: "Toggle the help card",
      run() {
        debug("command :help")
        toggleHelp()
      },
    },
    {
      name: ":reset",
      desc: "Reset the counters",
      run() {
        debug("command :reset")
        resetDemo()
      },
    },
    {
      name: ":write",
      aliases: ["w"],
      nargs: "?",
      desc: "Log a snapshot for the current demo state",
      usage: ":write [label]",
      run({ args }) {
        debug("command :write", {
          args: args.join(" "),
        })
        saveSnapshot(args[0] ?? "write")
      },
    },
    {
      name: ":focus",
      nargs: "1",
      desc: "Focus alpha, beta, notes, draft, keys, or log",
      usage: ":focus <alpha|beta|notes|draft|keys|log>",
      run({ args }) {
        debug("command :focus", {
          args: args.join(" "),
        })
        const targetName = args[0]?.toLowerCase()
        const targets = new Map<string, HTMLElement>([
          ["alpha", alphaPanel],
          ["beta", betaPanel],
          ["notes", notesField],
          ["draft", draftField],
          ["keys", activeKeysCard],
          ["log", logCard],
        ])
        const target = targetName ? targets.get(targetName) : undefined
        if (!target) {
          appendLog(`Unknown focus target: ${targetName ?? ""}`)
          return false
        }

        target.focus()
        appendLog(`Focused ${target.id}`)
      },
    },
  ])
  addons.registerTimedLeader(keymap, {
    trigger: " ",
    timeoutMs: 1600,
    onArm() {
      leaderArmed = true
      renderStatus()
    },
    onDisarm() {
      leaderArmed = false
      renderStatus()
    },
  })
  addons.registerNeovimDisambiguation(keymap)
  addons.registerEscapeClearsPendingSequence(keymap)
  addons.registerBackspacePopsPendingSequence(keymap)

  keymap.registerLayer({
    commands: [
      {
        name: "focus-next",
        title: "Focus Next",
        desc: "Move to the next focus target",
        run() {
          focusOffset(1)
        },
      },
      {
        name: "focus-prev",
        title: "Focus Previous",
        desc: "Move to the previous focus target",
        run() {
          focusOffset(-1)
        },
      },
      {
        name: "toggle-help",
        title: "Toggle Help",
        desc: "Show or hide the help card",
        run() {
          toggleHelp()
        },
      },
      {
        name: "prompt-open",
        title: "Open Ex Prompt",
        desc: "Open the ex command prompt",
        run() {
          openPrompt()
        },
      },
      {
        name: "prompt-close",
        title: "Close Ex Prompt",
        desc: "Close the ex command prompt",
        run() {
          closePrompt()
        },
      },
      {
        name: "prompt-submit",
        title: "Run Ex Command",
        desc: "Run the current ex command",
        run() {
          runPromptCommand()
        },
      },
      {
        name: "prompt-next",
        title: "Next Suggestion",
        desc: "Move to the next ex suggestion",
        run() {
          applySuggestion(1)
        },
      },
      {
        name: "prompt-prev",
        title: "Previous Suggestion",
        desc: "Move to the previous ex suggestion",
        run() {
          applySuggestion(-1)
        },
      },
      {
        name: "prompt-complete",
        title: "Complete Suggestion",
        desc: "Insert the selected ex suggestion",
        run() {
          completeSuggestion()
        },
      },
      {
        name: "prompt-complete-prev",
        title: "Previous Completion",
        desc: "Insert the previous ex suggestion",
        run() {
          completeSuggestion(-1)
        },
      },
      {
        name: "save-session",
        title: "Save Session",
        desc: "Log a synthetic write snapshot",
        run() {
          saveSnapshot("leader")
        },
      },
      {
        name: "alpha-up",
        title: "Alpha Up",
        desc: "Increment the Alpha counter",
        run() {
          incrementAlpha(1)
        },
      },
      {
        name: "alpha-down",
        title: "Alpha Down",
        desc: "Decrement the Alpha counter",
        run() {
          incrementAlpha(-1)
        },
      },
      {
        name: "beta-up",
        title: "Beta Up",
        desc: "Increment the Beta counter",
        run() {
          incrementBeta(1)
        },
      },
      {
        name: "beta-down",
        title: "Beta Down",
        desc: "Decrement the Beta counter",
        run() {
          incrementBeta(-1)
        },
      },
      {
        name: "panel-write",
        title: "Panel Write",
        desc: "Log a panel write action",
        run(ctx) {
          appendLog(`Panel write from ${ctx.focused?.id ?? "unknown"}`)
        },
      },
      {
        name: "capture-notes",
        title: "Capture Notes",
        desc: "Log the Notes textarea snapshot",
        run() {
          captureTextarea("notes", notesField)
        },
      },
      {
        name: "capture-draft",
        title: "Capture Draft",
        desc: "Log the Draft textarea snapshot",
        run() {
          captureTextarea("draft", draftField)
        },
      },
      {
        name: "scroll-pane-down",
        title: "Scroll Pane Down",
        desc: "Scroll the focused sidebar pane down",
        run() {
          return scrollFocusedPane(1)
        },
      },
      {
        name: "scroll-pane-up",
        title: "Scroll Pane Up",
        desc: "Scroll the focused sidebar pane up",
        run() {
          return scrollFocusedPane(-1)
        },
      },
      {
        name: "scroll-pane-page-down",
        title: "Scroll Pane Page Down",
        desc: "Page the focused sidebar pane downward",
        run() {
          return scrollFocusedPanePage(1)
        },
      },
      {
        name: "scroll-pane-page-up",
        title: "Scroll Pane Page Up",
        desc: "Page the focused sidebar pane upward",
        run() {
          return scrollFocusedPanePage(-1)
        },
      },
      {
        name: "scroll-pane-top",
        title: "Scroll Pane Top",
        desc: "Jump the focused sidebar pane to the top",
        run() {
          return scrollFocusedPaneEdge("top")
        },
      },
      {
        name: "scroll-pane-bottom",
        title: "Scroll Pane Bottom",
        desc: "Jump the focused sidebar pane to the bottom",
        run() {
          return scrollFocusedPaneEdge("bottom")
        },
      },
    ],
  })

  keymap.registerLayer({
    enabled: () => !promptVisible,
    bindings: [
      { key: "tab", cmd: "focus-next", desc: "Next focus target" },
      { key: "shift+tab", cmd: "focus-prev", desc: "Previous focus target" },
      { key: "?", cmd: "toggle-help", desc: "Toggle help" },
      { key: ":", cmd: "prompt-open", desc: "Open ex prompt" },
      { key: "<leader>s", cmd: "save-session", desc: "Log a write snapshot" },
      { key: "<leader>h", cmd: "toggle-help", desc: "Toggle help" },
      { key: "<leader>r", cmd: ":reset", desc: "Reset counters" },
      { key: "<leader>f", cmd: ":focus notes", desc: "Focus the notes editor" },
    ],
  })

  keymap.registerLayer({
    target: alphaPanel,
    targetMode: "focus-within",
    bindings: [
      { key: "j", cmd: "alpha-down", desc: "Alpha -1" },
      { key: "k", cmd: "alpha-up", desc: "Alpha +1" },
      { key: "return", cmd: "panel-write", desc: "Write alpha snapshot" },
    ],
  })

  keymap.registerLayer({
    target: betaPanel,
    targetMode: "focus-within",
    bindings: [
      { key: "j", cmd: "beta-down", desc: "Beta -1" },
      { key: "k", cmd: "beta-up", desc: "Beta +1" },
      { key: "return", cmd: "panel-write", desc: "Write beta snapshot" },
    ],
  })

  keymap.registerLayer({
    target: notesCard,
    targetMode: "focus-within",
    bindings: [{ key: "ctrl+return", cmd: "capture-notes", desc: "Capture notes snapshot" }],
  })

  keymap.registerLayer({
    target: draftCard,
    targetMode: "focus-within",
    bindings: [{ key: "ctrl+return", cmd: "capture-draft", desc: "Capture draft snapshot" }],
  })

  keymap.registerLayer({
    target: activeKeysCard,
    targetMode: "focus-within",
    bindings: [
      { key: "j", cmd: "scroll-pane-down", desc: "Scroll active keys down" },
      { key: "k", cmd: "scroll-pane-up", desc: "Scroll active keys up" },
      { key: "ctrl+d", cmd: "scroll-pane-page-down", desc: "Page active keys down" },
      { key: "ctrl+u", cmd: "scroll-pane-page-up", desc: "Page active keys up" },
      { key: "g", cmd: "scroll-pane-page-up", desc: "Page active keys up", group: "Go" },
      { key: "gg", cmd: "scroll-pane-top", desc: "Jump to the top", group: "Go" },
      { key: "shift+g", cmd: "scroll-pane-bottom", desc: "Jump to the bottom" },
    ],
  })

  keymap.registerLayer({
    target: logCard,
    targetMode: "focus-within",
    bindings: [
      { key: "j", cmd: "scroll-pane-down", desc: "Scroll recent actions down" },
      { key: "k", cmd: "scroll-pane-up", desc: "Scroll recent actions up" },
      { key: "ctrl+d", cmd: "scroll-pane-page-down", desc: "Page recent actions down" },
      { key: "ctrl+u", cmd: "scroll-pane-page-up", desc: "Page recent actions up" },
      { key: "g", cmd: "scroll-pane-page-up", desc: "Page recent actions up", group: "Go" },
      { key: "gg", cmd: "scroll-pane-top", desc: "Jump to the top", group: "Go" },
      { key: "shift+g", cmd: "scroll-pane-bottom", desc: "Jump to the bottom" },
    ],
  })

  keymap.registerLayer({
    target: promptShell,
    targetMode: "focus-within",
    enabled: () => promptVisible,
    bindings: [
      { key: "escape", cmd: "prompt-close", desc: "Close prompt" },
      { key: "return", cmd: "prompt-submit", desc: "Run ex command" },
      { key: "tab", cmd: "prompt-complete", desc: "Complete suggestion" },
      { key: "shift+tab", cmd: "prompt-complete-prev", desc: "Previous completion" },
      { key: "up", cmd: "prompt-prev", desc: "Previous suggestion" },
      { key: "down", cmd: "prompt-next", desc: "Next suggestion" },
    ],
  })

  keymap.on("state", () => {
    debugStateSnapshot("event")
    renderAll()
  })
  keymap.on("warning", (event) => {
    debug("warning", {
      code: event.code,
      message: event.message,
    })
    appendLog(`Warning: ${event.message}`)
  })
  keymap.on("error", (event) => {
    debug("error", {
      code: event.code,
      message: event.message,
    })
    appendLog(`Error: ${event.message}`)
  })
}

commandInput.addEventListener("input", () => {
  selectedSuggestion = 0
  debug("prompt input", {
    value: commandInput.value,
    suggestions:
      getCommandSuggestions()
        .map((suggestion) => suggestion.label)
        .join(", ") || "none",
  })
  renderPrompt()
})

app.addEventListener("keydown", (event) => {
  debugKeyEvent("keydown", event)
})

app.addEventListener("keyup", (event) => {
  debugKeyEvent("keyup", event)
})

app.addEventListener("focusin", () => {
  debug("focusin", {
    focused: getCurrentFocusedTarget()?.id ?? "none",
  })
})

app.addEventListener("focusout", () => {
  queueMicrotask(() => {
    debug("focusout", {
      focused: getCurrentFocusedTarget()?.id ?? "none",
    })
  })
})

promptOverlay.addEventListener("mousedown", (event) => {
  if (event.target !== promptOverlay) {
    return
  }

  debug("prompt backdrop click")
  closePrompt()
})

renderCounters()
renderHelp()
appendLog(lastAction)
renderAll()
alphaPanel.focus()
debugStateSnapshot("initial")
