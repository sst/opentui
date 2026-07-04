#!/usr/bin/env bun

import {
  bg,
  bold,
  BoxRenderable,
  CliRenderEvents,
  type CliRenderer,
  type ClipboardClearResult,
  type ClipboardSelection,
  type ClipboardService,
  type ClipboardWriteDestination,
  type ClipboardWriteResult,
  createCliRenderer,
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  decodePasteBytes,
  fg,
  type KeyEvent,
  type PasteEvent,
  type Renderable,
  ScrollBoxRenderable,
  type Selection,
  stripAnsiSequences,
  t,
  TextareaRenderable,
  TextRenderable,
} from "@opentui/core"
import type { Binding, HostPlatform, KeyLike, Keymap } from "@opentui/keymap"
import * as keymapAddons from "@opentui/keymap/addons/opentui"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const P = {
  bg: "#070b12",
  panel: "#0d1422",
  panelRaised: "#121d31",
  border: "#2f405f",
  borderHot: "#68e1fd",
  text: "#e6edf7",
  muted: "#8391a7",
  dim: "#53627a",
  cyan: "#68e1fd",
  green: "#a7f3d0",
  amber: "#facc15",
  rose: "#fb7185",
  violet: "#c4b5fd",
  blue: "#93c5fd",
} as const

type Tone = "muted" | "info" | "ok" | "warn" | "bad"

const TONE_COLOR: Record<Tone, string> = {
  muted: P.muted,
  info: P.blue,
  ok: P.green,
  warn: P.amber,
  bad: P.rose,
}

const TONE_ICON: Record<Tone, string> = {
  muted: "-",
  info: ">",
  ok: "ok",
  warn: "~",
  bad: "x",
}

const MAX_LOG_ROWS = 80
const SELECTION_BG = "#264f78"
const SELECTION_FG = "#ffffff"
const READ_MAX_BYTES = 2 * 1024 * 1024

interface Status {
  tone: Tone
  text: string
}

interface Fixture {
  name: string
  short: string
  purpose: string
  payload: string
}

interface Shortcut {
  key: KeyLike
  label: string
}

interface PlatformProfile {
  platform: HostPlatform
  title: string
  copy: readonly Shortcut[]
  cut: readonly Shortcut[]
  pasteClipboard: readonly Shortcut[]
  pastePrimary: readonly Shortcut[]
  selectAll: readonly Shortcut[]
  selectionTarget: ClipboardSelection
  exit: string
  notes: readonly string[]
}

const FIXTURES: readonly Fixture[] = [
  {
    name: "Plain Unicode",
    short: "Unicode",
    purpose: "Normal text, multiline UTF-8, and emoji.",
    payload: "OpenTUI clipboard round-trip\nUnicode: 世界 cafe 🚀\nLine endings: LF\nEnd",
  },
  {
    name: "Line Endings",
    short: "CR/LF",
    purpose: "Clipboard bytes can contain CRLF or lone CR; editors usually normalize.",
    payload: "OpenTUI newline fixture\r\nCRLF line\rLone CR line\nLF line",
  },
  {
    name: "ANSI Guard",
    short: "ANSI",
    purpose: "Paste events preserve bytes; editor insertion strips terminal escapes.",
    payload: "OpenTUI ANSI fixture: \x1b[31mred\x1b[0m plain",
  },
  {
    name: "Large Text",
    short: "16 KiB",
    purpose: "Large text exercises terminal OSC 52 and native provider paths.",
    payload: `OpenTUI large clipboard payload\n${"0123456789abcdef".repeat(1024)}`,
  },
]

const MAC_PROFILE: PlatformProfile = {
  platform: "macos",
  title: "macOS",
  copy: [{ key: "super+c", label: "Cmd+C" }],
  cut: [{ key: "super+x", label: "Cmd+X" }],
  pasteClipboard: [{ key: "super+v", label: "Cmd+V" }],
  pastePrimary: [],
  selectAll: [{ key: "super+a", label: "Cmd+A" }],
  selectionTarget: "clipboard",
  exit: "Ctrl+C exits; Cmd+C is copy when the terminal forwards Super keys.",
  notes: [
    "Most macOS terminals handle Cmd+C/Cmd+V before the app; when they do, paste arrives as a PasteEvent.",
    "Kitty keyboard capable terminals can forward Super, letting the app bind Cmd shortcuts directly.",
  ],
}

const WINDOWS_PROFILE: PlatformProfile = {
  platform: "windows",
  title: "Windows",
  copy: [
    { key: "ctrl+c", label: "Ctrl+C" },
    { key: "ctrl+insert", label: "Ctrl+Insert" },
  ],
  cut: [
    { key: "ctrl+x", label: "Ctrl+X" },
    { key: "shift+delete", label: "Shift+Delete" },
  ],
  pasteClipboard: [
    { key: "ctrl+v", label: "Ctrl+V" },
    { key: "shift+insert", label: "Shift+Insert" },
  ],
  pastePrimary: [],
  selectAll: [{ key: "ctrl+a", label: "Ctrl+A" }],
  selectionTarget: "clipboard",
  exit: "Ctrl+Q exits so Ctrl+C can remain copy.",
  notes: [
    "Ctrl+C/Ctrl+V/Ctrl+X/Ctrl+A are the expected text-field shortcuts.",
    "Ctrl+Insert, Shift+Insert, and Shift+Delete cover the legacy console/editing convention.",
  ],
}

const LINUX_PROFILE: PlatformProfile = {
  platform: "linux",
  title: "Linux / X11 / Wayland",
  copy: [
    { key: "ctrl+shift+c", label: "Ctrl+Shift+C" },
    { key: "ctrl+insert", label: "Ctrl+Insert" },
  ],
  cut: [{ key: "ctrl+shift+x", label: "Ctrl+Shift+X" }],
  pasteClipboard: [{ key: "ctrl+shift+v", label: "Ctrl+Shift+V" }],
  pastePrimary: [{ key: "shift+insert", label: "Shift+Insert" }],
  selectAll: [{ key: "ctrl+a", label: "Ctrl+A" }],
  selectionTarget: "primary",
  exit: "Ctrl+C exits; clipboard copy uses Ctrl+Shift+C.",
  notes: [
    "Clipboard and PRIMARY are separate. Mouse selection owns PRIMARY; explicit copy writes CLIPBOARD.",
    "Middle click is normally terminal-handled PRIMARY paste. Shift+Insert is mapped here to PRIMARY when it reaches the app.",
  ],
}

const UNKNOWN_PROFILE: PlatformProfile = {
  platform: "unknown",
  title: "Unknown host",
  copy: [
    { key: "ctrl+shift+c", label: "Ctrl+Shift+C" },
    { key: "ctrl+insert", label: "Ctrl+Insert" },
  ],
  cut: [{ key: "ctrl+shift+x", label: "Ctrl+Shift+X" }],
  pasteClipboard: [
    { key: "ctrl+shift+v", label: "Ctrl+Shift+V" },
    { key: "shift+insert", label: "Shift+Insert" },
  ],
  pastePrimary: [],
  selectAll: [{ key: "ctrl+a", label: "Ctrl+A" }],
  selectionTarget: "clipboard",
  exit: "Ctrl+C exits; Ctrl+Q is also available.",
  notes: ["Uses conservative terminal bindings until the host reports a known platform."],
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

let root: BoxRenderable | null = null
let platformText: TextRenderable | null = null
let sampleText: TextRenderable | null = null
let editor: TextareaRenderable | null = null
let stateText: TextRenderable | null = null
let logList: ScrollBoxRenderable | null = null
let logRows: TextRenderable[] = []
let logRowId = 0
let keymap: Keymap<Renderable, KeyEvent> | null = null
let disposers: Array<() => void> = []
let pasteHandler: ((event: PasteEvent) => void) | null = null
let capabilityHandler: (() => void) | null = null
let selectionHandler: ((selection: Selection) => void) | null = null
let clipboardService: ClipboardService | null = null
let selectedFixture = 0
let lastLoggedCapability = ""
let copyStatus: Status = { tone: "muted", text: "select text, then copy" }
let pasteStatus: Status = { tone: "muted", text: "waiting for PasteEvent or platform paste" }
let cutStatus: Status = { tone: "muted", text: "not attempted" }
let selectionStatus: Status = { tone: "muted", text: "mouse selection has not published" }
let readStatus: Status = { tone: "muted", text: "not attempted" }
let clearStatus: Status = { tone: "muted", text: "not attempted" }
let serviceStatus: Status = { tone: "muted", text: "initializing" }

function fixture(): Fixture {
  return FIXTURES[selectedFixture]!
}

function platformProfile(): PlatformProfile {
  switch (process.platform) {
    case "darwin":
      return MAC_PROFILE
    case "win32":
      return WINDOWS_PROFILE
    case "linux":
      return LINUX_PROFILE
    default:
      return UNKNOWN_PROFILE
  }
}

function shortcutLabels(shortcuts: readonly Shortcut[]): string {
  return shortcuts.length === 0 ? "-" : shortcuts.map((shortcut) => shortcut.label).join(" / ")
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function escapedPreview(value: string, maxLength = 64): string {
  const escaped = JSON.stringify(value)
  return escaped.length <= maxLength ? escaped : `${escaped.slice(0, maxLength - 3)}...`
}

function byteLength(value: string): number {
  return encoder.encode(value).length
}

function hexPrefix(bytes: Uint8Array, count = 12): string {
  const slice = bytes.slice(0, count)
  const hex = Array.from(slice, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return bytes.length > count ? `${hex}...` : hex
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function timestamp(): string {
  const now = new Date()
  const hh = `${now.getHours()}`.padStart(2, "0")
  const mm = `${now.getMinutes()}`.padStart(2, "0")
  const ss = `${now.getSeconds()}`.padStart(2, "0")
  const ms = `${now.getMilliseconds()}`.padStart(3, "0")
  return `${hh}:${mm}:${ss}.${ms}`
}

function capabilityStatus(renderer: CliRenderer): Status {
  const capabilities = renderer.capabilities
  if (!capabilities) return { tone: "muted", text: "detecting" }
  const hint = capabilities.osc52 ? "yes" : "no"
  switch (capabilities.osc52_support) {
    case "supported":
      return { tone: "ok", text: `OSC 52 supported (legacy hint: ${hint})` }
    case "unsupported":
      return { tone: "bad", text: `OSC 52 unsupported (legacy hint: ${hint})` }
    default:
      return { tone: "warn", text: `OSC 52 unknown; emits optimistically (legacy hint: ${hint})` }
  }
}

function metadataLabel(event: PasteEvent): string {
  if (!event.metadata) return "meta absent"
  return `meta kind=${event.metadata.kind ?? "unset"} mime=${event.metadata.mimeType ?? "unset"}`
}

function statusChunk(status: Status) {
  return fg(TONE_COLOR[status.tone])(`${TONE_ICON[status.tone]} ${status.text}`)
}

function label(text: string) {
  return fg(P.dim)(text.padEnd(13))
}

function addLog(renderer: CliRenderer, tone: Tone, message: string, detail?: string): void {
  if (!logList) return

  const row = new TextRenderable(renderer, {
    id: `clipboard-log-${logRowId++}`,
    content: t`${fg(P.dim)(timestamp())} ${fg(TONE_COLOR[tone])(`${TONE_ICON[tone]} ${message}`)}`,
    flexGrow: 0,
    flexShrink: 0,
    selectionBg: SELECTION_BG,
    selectionFg: SELECTION_FG,
  })
  logList.add(row)
  logRows.push(row)

  if (detail) {
    const detailRow = new TextRenderable(renderer, {
      id: `clipboard-log-${logRowId++}`,
      content: t`${fg(P.dim)(`             ${detail}`)}`,
      flexGrow: 0,
      flexShrink: 0,
      selectionBg: SELECTION_BG,
      selectionFg: SELECTION_FG,
    })
    logList.add(detailRow)
    logRows.push(detailRow)
  }

  while (logRows.length > MAX_LOG_ROWS) {
    const oldRow = logRows.shift()
    oldRow?.destroyRecursively()
  }
}

function writeSucceeded(result: ClipboardWriteResult): boolean {
  return result.host.status === "written" || result.terminal.status === "attempted"
}

function clearSucceeded(result: ClipboardClearResult): boolean {
  return result.host.status === "cleared" || result.terminal.status === "attempted"
}

function writeResultLabel(result: ClipboardWriteResult): string {
  return `host ${result.host.status} / terminal ${result.terminal.status} (${result.terminal.capability})`
}

function clearResultLabel(result: ClipboardClearResult): string {
  return `host ${result.host.status} / terminal ${result.terminal.status} (${result.terminal.capability})`
}

function updatePlatformPanel(renderer: CliRenderer): void {
  if (!platformText) return

  const profile = platformProfile()
  const primaryText =
    profile.pastePrimary.length > 0
      ? shortcutLabels(profile.pastePrimary)
      : "mouse/middle-click is terminal-owned on this platform"
  const primaryColor = profile.pastePrimary.length > 0 ? P.violet : P.muted
  const capability = capabilityStatus(renderer)

  platformText.content = t`${bold(fg(P.cyan)(profile.title))} ${fg(P.muted)("platform contract")}
${label("Copy")} ${fg(P.violet)(shortcutLabels(profile.copy))}
${label("Cut")} ${fg(P.violet)(shortcutLabels(profile.cut))}
${label("Paste")} ${fg(P.violet)(shortcutLabels(profile.pasteClipboard))}
${label("Primary paste")} ${fg(primaryColor)(primaryText)}
${label("Select all")} ${fg(P.violet)(shortcutLabels(profile.selectAll))}
${label("Quit")} ${fg(P.muted)(profile.exit)}
${label("Terminal")} ${statusChunk(capability)}
${fg(P.dim)("Map")} ${fg(P.muted)("macOS Cmd+C/V/X/A | Windows Ctrl+C/V/X/A | Linux Ctrl+Shift+C/V + PRIMARY")}`
}

function updateSamplePanel(): void {
  if (!sampleText) return

  const current = fixture()
  const tabs = FIXTURES.map((entry, index) => {
    const chunk = ` F${index + 1} ${entry.short} `
    return index === selectedFixture ? bg(P.cyan)(fg(P.bg)(bold(chunk))) : fg(P.muted)(chunk)
  })

  sampleText.content = t`${tabs[0]!} ${tabs[1]!} ${tabs[2]!} ${tabs[3]!}
${bold(fg(P.text)(current.name))} ${fg(P.muted)(`- ${byteLength(current.payload)} UTF-8 bytes`)}
${label("Purpose")} ${fg(P.text)(current.purpose)}
${label("Preview")} ${fg(P.violet)(escapedPreview(current.payload, 96))}
${fg(P.dim)("Mouse-select any visible text to publish platform selection; F5 loads this sample into the editor.")}`
}

function updateStatePanel(renderer: CliRenderer): void {
  if (!stateText) return

  const profile = platformProfile()
  const selectionLine =
    profile.selectionTarget === "primary" ? "mouse selection publishes PRIMARY" : "mouse selection publishes CLIPBOARD"
  stateText.content = t`${label("Service")} ${statusChunk(serviceStatus)}
${label("Selection")} ${fg(P.violet)(selectionLine)}
${label("Copy")} ${statusChunk(copyStatus)}
${label("Cut/Paste")} ${statusChunk(cutStatus)} ${fg(P.dim)("|")} ${statusChunk(pasteStatus)}
${label("Mouse select")} ${statusChunk(selectionStatus)}
${label("Read/Clear")} ${statusChunk(readStatus)} ${fg(P.dim)("|")} ${statusChunk(clearStatus)}
${label("Editor")} ${fg(P.muted)(`${byteLength(editor?.plainText ?? "")} B, ${editor?.hasSelection() ? "selection active" : "no selection"}`)}`
  updatePlatformPanel(renderer)
}

function createClipboardService(renderer: CliRenderer): void {
  try {
    const host = createHostClipboard({ maxReadBytes: READ_MAX_BYTES })
    clipboardService = createClipboard({
      host,
      terminal: createRendererClipboardAdapter(renderer),
    })
    serviceStatus = { tone: "ok", text: "native host + terminal OSC 52 ready" }
  } catch (error) {
    clipboardService = null
    serviceStatus = { tone: "bad", text: `unavailable: ${errorMessage(error)}` }
    addLog(renderer, "bad", "clipboard service creation failed", errorMessage(error))
  }
  updateStatePanel(renderer)
}

function panel(renderer: CliRenderer, id: string, title: string, height?: number): BoxRenderable {
  return new BoxRenderable(renderer, {
    id,
    title: ` ${title} `,
    titleAlignment: "left",
    border: true,
    borderStyle: "rounded",
    borderColor: P.border,
    backgroundColor: P.panel,
    paddingLeft: 1,
    paddingRight: 1,
    ...(height === undefined ? {} : { height }),
  })
}

function selectedEditorText(): string | null {
  if (!editor || editor.isDestroyed || !editor.hasSelection()) return null
  const text = editor.getSelectedText()
  return text.length > 0 ? text : null
}

function selectAllEditorText(): boolean {
  if (!editor || editor.isDestroyed) return false
  const text = editor.plainText
  if (text.length === 0) return false
  editor.setSelection(0, byteLength(text))
  return true
}

async function writeClipboardText(
  renderer: CliRenderer,
  text: string,
  selection: ClipboardSelection,
  destination: ClipboardWriteDestination,
  source: string,
): Promise<ClipboardWriteResult | null> {
  const service = clipboardService
  if (!service) {
    copyStatus = { tone: "bad", text: "service unavailable" }
    updateStatePanel(renderer)
    return null
  }

  try {
    const result = await service.writeText(text, { destination, selection })
    if (service !== clipboardService) return null
    const ok = writeSucceeded(result)
    addLog(renderer, ok ? "ok" : "warn", `${source} -> ${selection} · ${byteLength(text)} B`, writeResultLabel(result))
    return result
  } catch (error) {
    if (service !== clipboardService) return null
    addLog(renderer, "bad", `${source} write failed`, errorMessage(error))
    return null
  }
}

async function copyCommand(renderer: CliRenderer): Promise<boolean> {
  const text = selectedEditorText()
  if (!text) {
    copyStatus = { tone: "warn", text: "no editor selection to copy" }
    updateStatePanel(renderer)
    addLog(renderer, "warn", "copy ignored", "Select editor text first, or mouse-select sample text.")
    return false
  }

  copyStatus = { tone: "info", text: `copying ${byteLength(text)} B to clipboard` }
  updateStatePanel(renderer)
  const result = await writeClipboardText(renderer, text, "clipboard", "best-available", "copy")
  if (!result) {
    copyStatus = { tone: "bad", text: "copy failed" }
  } else {
    copyStatus = {
      tone: writeSucceeded(result) ? "ok" : "warn",
      text: `${byteLength(text)} B · ${writeResultLabel(result)}`,
    }
  }
  updateStatePanel(renderer)
  return result ? writeSucceeded(result) : false
}

async function cutCommand(renderer: CliRenderer): Promise<boolean> {
  const text = selectedEditorText()
  if (!text || !editor || editor.isDestroyed) {
    cutStatus = { tone: "warn", text: "no editor selection to cut" }
    updateStatePanel(renderer)
    addLog(renderer, "warn", "cut ignored", "Select editor text first.")
    return false
  }

  cutStatus = { tone: "info", text: `copying ${byteLength(text)} B before delete` }
  updateStatePanel(renderer)
  const result = await writeClipboardText(renderer, text, "clipboard", "best-available", "cut")
  if (result && writeSucceeded(result) && editor && !editor.isDestroyed) {
    editor.deleteSelection()
    cutStatus = { tone: "ok", text: `${byteLength(text)} B copied, then deleted` }
    updateStatePanel(renderer)
    return true
  }

  cutStatus = { tone: "bad", text: result ? writeResultLabel(result) : "copy failed; selection preserved" }
  updateStatePanel(renderer)
  return false
}

async function pasteCommand(renderer: CliRenderer, selection: ClipboardSelection): Promise<boolean> {
  const service = clipboardService
  if (!service || !editor || editor.isDestroyed) {
    pasteStatus = { tone: "bad", text: "service or editor unavailable" }
    updateStatePanel(renderer)
    return false
  }

  pasteStatus = { tone: "info", text: `reading ${selection}` }
  updateStatePanel(renderer)
  try {
    const result = await service.read({ preferredTypes: ["text/plain"], selection })
    if (service !== clipboardService || !editor || editor.isDestroyed) return false
    if (result.status !== "read") {
      pasteStatus = { tone: result.status === "failed" ? "bad" : "warn", text: `${selection} read: ${result.status}` }
      addLog(
        renderer,
        pasteStatus.tone,
        `paste read <- ${selection} · ${result.status}`,
        result.status === "failed" ? errorMessage(result.error) : undefined,
      )
      updateStatePanel(renderer)
      return false
    }

    const text = stripAnsiSequences(decoder.decode(result.representation.bytes))
    editor.insertText(normalizeNewlines(text))
    pasteStatus = { tone: "ok", text: `${selection} inserted ${byteLength(text)} B via native read` }
    addLog(renderer, "ok", `paste <- ${selection} · inserted ${byteLength(text)} B`, escapedPreview(text, 56))
    updateStatePanel(renderer)
    return true
  } catch (error) {
    if (service !== clipboardService) return false
    pasteStatus = { tone: "bad", text: `read rejected: ${errorMessage(error)}` }
    addLog(renderer, "bad", `paste read rejected · ${selection}`, errorMessage(error))
    updateStatePanel(renderer)
    return false
  }
}

function selectAllCommand(renderer: CliRenderer): boolean {
  if (!selectAllEditorText()) return false
  updateStatePanel(renderer)
  addLog(renderer, "info", "editor select all")
  return true
}

function loadSampleCommand(renderer: CliRenderer): boolean {
  if (!editor || editor.isDestroyed) return false
  const current = fixture()
  editor.focus()
  editor.setText(current.payload)
  selectAllEditorText()
  pasteStatus = { tone: "muted", text: "sample loaded; copy/cut/paste are ready" }
  readStatus = { tone: "muted", text: "not attempted" }
  updateStatePanel(renderer)
  addLog(renderer, "info", `loaded sample -> editor · ${current.name}`, `${byteLength(current.payload)} B selected`)
  return true
}

function resetEditorCommand(renderer: CliRenderer): boolean {
  editor?.setText("")
  pasteStatus = { tone: "muted", text: "editor cleared" }
  readStatus = { tone: "muted", text: "not attempted" }
  updateStatePanel(renderer)
  addLog(renderer, "muted", "editor cleared")
  editor?.focus()
  return true
}

function selectFixtureCommand(renderer: CliRenderer, index: number): boolean {
  selectedFixture = Math.max(0, Math.min(index, FIXTURES.length - 1))
  updateSamplePanel()
  updateStatePanel(renderer)
  addLog(renderer, "info", `sample selected · ${fixture().name}`)
  return true
}

async function readClipboardCommand(renderer: CliRenderer, selection: ClipboardSelection): Promise<boolean> {
  const service = clipboardService
  if (!service) {
    readStatus = { tone: "bad", text: "service unavailable" }
    updateStatePanel(renderer)
    return false
  }

  readStatus = { tone: "info", text: `reading ${selection}` }
  updateStatePanel(renderer)
  try {
    const result = await service.read({
      preferredTypes: ["image/png", "text/plain"],
      selection,
    })
    if (service !== clipboardService) return false
    if (result.status !== "read") {
      readStatus = { tone: result.status === "failed" ? "bad" : "warn", text: `${selection}: ${result.status}` }
      addLog(
        renderer,
        readStatus.tone,
        `read check <- ${selection} · ${result.status}`,
        result.status === "failed" ? errorMessage(result.error) : undefined,
      )
      updateStatePanel(renderer)
      return false
    }

    const { mimeType, bytes } = result.representation
    const digest = await sha256(bytes)
    if (service !== clipboardService) return false
    const exactFixture = mimeType === "text/plain" && decoder.decode(bytes) === fixture().payload
    readStatus = {
      tone: exactFixture ? "ok" : "info",
      text: `${selection}: ${mimeType} · ${bytes.length} B${exactFixture ? " · exact sample" : ""}`,
    }
    addLog(
      renderer,
      readStatus.tone,
      `read check <- ${selection} · ${mimeType} · ${bytes.length} B`,
      `sha256 ${digest} · hex ${hexPrefix(bytes, 8)}`,
    )
    updateStatePanel(renderer)
    return true
  } catch (error) {
    if (service !== clipboardService) return false
    readStatus = { tone: "bad", text: `rejected: ${errorMessage(error)}` }
    addLog(renderer, "bad", `read check rejected · ${selection}`, errorMessage(error))
    updateStatePanel(renderer)
    return false
  }
}

async function clearClipboardCommand(renderer: CliRenderer, selection: ClipboardSelection): Promise<boolean> {
  const service = clipboardService
  if (!service) {
    clearStatus = { tone: "bad", text: "service unavailable" }
    updateStatePanel(renderer)
    return false
  }

  clearStatus = { tone: "info", text: `clearing ${selection}` }
  updateStatePanel(renderer)
  try {
    const result = await service.clear({ destination: "all-available", selection })
    if (service !== clipboardService) return false
    clearStatus = {
      tone: clearSucceeded(result) ? "ok" : "warn",
      text: `${selection}: ${clearResultLabel(result)}`,
    }
    addLog(renderer, clearStatus.tone, `clear -> ${selection}`, clearResultLabel(result))
    updateStatePanel(renderer)
    return clearSucceeded(result)
  } catch (error) {
    if (service !== clipboardService) return false
    clearStatus = { tone: "bad", text: `rejected: ${errorMessage(error)}` }
    addLog(renderer, "bad", `clear rejected · ${selection}`, errorMessage(error))
    updateStatePanel(renderer)
    return false
  }
}

async function publishMouseSelection(renderer: CliRenderer, text: string): Promise<void> {
  const profile = platformProfile()
  const selection = profile.selectionTarget
  selectionStatus = { tone: "info", text: `publishing ${byteLength(text)} B to ${selection}` }
  updateStatePanel(renderer)
  const result = await writeClipboardText(renderer, text, selection, "all-available", "mouse selection")
  if (!result) {
    selectionStatus = { tone: "bad", text: "selection publish failed" }
  } else {
    selectionStatus = {
      tone: writeSucceeded(result) ? "ok" : "warn",
      text: `${selection} · ${byteLength(text)} B · ${writeResultLabel(result)}`,
    }
  }
  updateStatePanel(renderer)
}

function addShortcutBindings(
  shortcuts: readonly Shortcut[],
  cmd: string,
  desc: string,
): Binding<Renderable, KeyEvent>[] {
  return shortcuts.map((shortcut) => ({
    key: shortcut.key,
    cmd,
    desc,
  }))
}

function registerKeymap(renderer: CliRenderer): void {
  const profile = platformProfile()
  const keymapInstance = createDefaultOpenTuiKeymap(renderer)
  keymap = keymapInstance

  disposers.push(keymapAddons.registerEscapeClearsPendingSequence(keymapInstance))

  disposers.push(
    keymapInstance.registerLayer({
      commands: [
        {
          name: "clipboard.copy",
          title: "Copy",
          desc: "Copy selected editor text to the platform clipboard",
          category: "Clipboard",
          run() {
            return copyCommand(renderer)
          },
        },
        {
          name: "clipboard.cut",
          title: "Cut",
          desc: "Copy selected editor text, then delete it",
          category: "Clipboard",
          run() {
            return cutCommand(renderer)
          },
        },
        {
          name: "clipboard.paste",
          title: "Paste clipboard",
          desc: "Read CLIPBOARD and insert text into the editor",
          category: "Clipboard",
          run() {
            return pasteCommand(renderer, "clipboard")
          },
        },
        {
          name: "clipboard.paste.primary",
          title: "Paste primary",
          desc: "Read PRIMARY and insert text into the editor",
          category: "Clipboard",
          run() {
            return pasteCommand(renderer, "primary")
          },
        },
        {
          name: "clipboard.selectAll",
          title: "Select all",
          desc: "Select all editor text",
          category: "Clipboard",
          run() {
            return selectAllCommand(renderer)
          },
        },
        {
          name: "sample.load",
          title: "Load sample",
          desc: "Load the current sample into the editor and select it",
          category: "Demo",
          run() {
            return loadSampleCommand(renderer)
          },
        },
        {
          name: "editor.clear",
          title: "Clear editor",
          desc: "Clear the editor",
          category: "Demo",
          run() {
            return resetEditorCommand(renderer)
          },
        },
        {
          name: "clipboard.read",
          title: "Read clipboard",
          desc: "Inspect CLIPBOARD without inserting it",
          category: "Diagnostics",
          run() {
            return readClipboardCommand(renderer, "clipboard")
          },
        },
        {
          name: "clipboard.read.primary",
          title: "Read primary",
          desc: "Inspect PRIMARY without inserting it",
          category: "Diagnostics",
          run() {
            return readClipboardCommand(renderer, "primary")
          },
        },
        {
          name: "clipboard.clear",
          title: "Clear clipboard",
          desc: "Clear CLIPBOARD",
          category: "Diagnostics",
          run() {
            return clearClipboardCommand(renderer, "clipboard")
          },
        },
        {
          name: "app.quit",
          title: "Quit",
          desc: "Destroy the renderer",
          category: "Application",
          run() {
            renderer.destroy()
          },
        },
        ...FIXTURES.map((entry, index) => ({
          name: `sample.${index + 1}`,
          title: `Sample ${index + 1}`,
          desc: entry.name,
          category: "Demo",
          run() {
            return selectFixtureCommand(renderer, index)
          },
        })),
      ],
    }),
  )

  disposers.push(
    keymapAddons.registerManagedTextareaLayer(keymapInstance, renderer, {
      enabled: () => renderer.currentFocusedEditor !== null,
      bindings: [],
    }),
  )

  if (editor) {
    disposers.push(
      keymapInstance.registerLayer({
        target: editor,
        priority: 10_000,
        bindings: [
          ...addShortcutBindings(profile.copy, "clipboard.copy", "Copy selected text"),
          ...addShortcutBindings(profile.cut, "clipboard.cut", "Cut selected text"),
          ...addShortcutBindings(profile.pasteClipboard, "clipboard.paste", "Paste clipboard"),
          ...addShortcutBindings(profile.pastePrimary, "clipboard.paste.primary", "Paste primary"),
          ...addShortcutBindings(profile.selectAll, "clipboard.selectAll", "Select all"),
        ],
      }),
    )
  }

  disposers.push(
    keymapInstance.registerLayer({
      priority: 100,
      bindings: [
        { key: "ctrl+q", cmd: "app.quit", desc: "Quit" },
        { key: { name: "f1" }, cmd: "sample.1", desc: "Select Unicode sample" },
        { key: { name: "f2" }, cmd: "sample.2", desc: "Select CR/LF sample" },
        { key: { name: "f3" }, cmd: "sample.3", desc: "Select ANSI sample" },
        { key: { name: "f4" }, cmd: "sample.4", desc: "Select large sample" },
        { key: { name: "f5" }, cmd: "sample.load", desc: "Load sample into editor" },
        { key: { name: "f6" }, cmd: "editor.clear", desc: "Clear editor" },
        { key: { name: "f7" }, cmd: "clipboard.read", desc: "Read clipboard" },
        { key: { name: "f7", shift: true }, cmd: "clipboard.read.primary", desc: "Read primary" },
        { key: { name: "f8" }, cmd: "clipboard.clear", desc: "Clear clipboard" },
      ],
    }),
  )
}

export function run(renderer: CliRenderer): void {
  renderer.setBackgroundColor(P.bg)
  selectedFixture = 0
  lastLoggedCapability = ""
  copyStatus = { tone: "muted", text: "select text, then copy" }
  pasteStatus = { tone: "muted", text: "waiting for PasteEvent or platform paste" }
  cutStatus = { tone: "muted", text: "not attempted" }
  selectionStatus = { tone: "muted", text: "mouse selection has not published" }
  readStatus = { tone: "muted", text: "not attempted" }
  clearStatus = { tone: "muted", text: "not attempted" }
  serviceStatus = { tone: "muted", text: "initializing" }

  const destroyOnRendererDestroy = () => {
    destroy(renderer)
  }
  renderer.once(CliRenderEvents.DESTROY, destroyOnRendererDestroy)
  disposers.push(() => {
    renderer.off(CliRenderEvents.DESTROY, destroyOnRendererDestroy)
  })

  root = new BoxRenderable(renderer, {
    id: "clipboard-demo-root",
    width: "100%",
    height: "100%",
    padding: 1,
    flexDirection: "column",
    backgroundColor: P.bg,
  })

  const header = new TextRenderable(renderer, {
    id: "clipboard-demo-header",
    height: 2,
    marginBottom: 1,
    content: t`${bold(fg(P.cyan)("CLIPBOARD BEHAVIOR"))} ${fg(P.muted)("platform shortcuts, terminal paste events, native host clipboard")}
${fg(P.muted)("Use platform copy/paste keys. F1-F4 sample, F5 load, F6 clear editor, F7 read, Shift+F7 read PRIMARY, F8 clear, Ctrl+Q quit.")}`,
  })

  const platformPanel = panel(renderer, "clipboard-demo-platform", "Platform", 10)
  platformPanel.marginBottom = 1
  platformText = new TextRenderable(renderer, {
    id: "clipboard-demo-platform-text",
    content: "",
    selectionBg: SELECTION_BG,
    selectionFg: SELECTION_FG,
  })
  platformPanel.add(platformText)

  const samplePanel = panel(renderer, "clipboard-demo-sample", "Sample Text", 6)
  samplePanel.marginBottom = 1
  sampleText = new TextRenderable(renderer, {
    id: "clipboard-demo-sample-text",
    content: "",
    selectionBg: SELECTION_BG,
    selectionFg: SELECTION_FG,
  })
  samplePanel.add(sampleText)

  const editorPanel = new BoxRenderable(renderer, {
    id: "clipboard-demo-editor-panel",
    title: " Editor ",
    titleAlignment: "left",
    border: true,
    borderStyle: "rounded",
    borderColor: P.borderHot,
    backgroundColor: P.panelRaised,
    paddingLeft: 1,
    paddingRight: 1,
    height: 7,
    marginBottom: 1,
  })
  editor = new TextareaRenderable(renderer, {
    id: "clipboard-demo-editor",
    width: "100%",
    height: "100%",
    placeholder: "Paste here, or press F5 to load a sample and select it...",
    textColor: P.text,
    backgroundColor: P.panelRaised,
    focusedBackgroundColor: P.panelRaised,
    cursorColor: P.amber,
    selectionBg: SELECTION_BG,
    selectionFg: SELECTION_FG,
    wrapMode: "word",
    onContentChange: () => updateStatePanel(renderer),
  })
  editorPanel.add(editor)

  const statePanel = panel(renderer, "clipboard-demo-state", "State", 9)
  statePanel.marginBottom = 1
  stateText = new TextRenderable(renderer, {
    id: "clipboard-demo-state-text",
    content: "",
    selectionBg: SELECTION_BG,
    selectionFg: SELECTION_FG,
  })
  statePanel.add(stateText)

  const logPanel = new BoxRenderable(renderer, {
    id: "clipboard-demo-log-panel",
    title: " Events ",
    titleAlignment: "left",
    border: true,
    borderStyle: "rounded",
    borderColor: P.border,
    backgroundColor: P.panel,
    paddingLeft: 1,
    paddingRight: 1,
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 5,
    flexDirection: "column",
  })

  logList = new ScrollBoxRenderable(renderer, {
    id: "clipboard-demo-log-list",
    stickyScroll: true,
    stickyStart: "bottom",
    rootOptions: { backgroundColor: P.panel, border: false },
    wrapperOptions: { backgroundColor: P.panel },
    viewportOptions: { backgroundColor: P.panel },
    contentOptions: { backgroundColor: P.panel },
    scrollbarOptions: {
      trackOptions: {
        foregroundColor: P.cyan,
        backgroundColor: P.border,
      },
    },
    height: "100%",
    width: "auto",
    flexGrow: 1,
    flexShrink: 1,
  })
  logPanel.add(logList)

  root.add(header)
  root.add(platformPanel)
  root.add(samplePanel)
  root.add(editorPanel)
  root.add(statePanel)
  root.add(logPanel)
  renderer.root.add(root)

  pasteHandler = (event) => {
    const current = fixture()
    const pasted = decodePasteBytes(event.bytes)
    const exact = pasted === current.payload
    const normalized = normalizeNewlines(pasted) === normalizeNewlines(current.payload)
    pasteStatus = exact
      ? { tone: "ok", text: `PasteEvent exact sample · ${event.bytes.length} B` }
      : normalized
        ? { tone: "warn", text: `PasteEvent normalized sample only · ${event.bytes.length} B` }
        : { tone: "info", text: `PasteEvent inserted ${event.bytes.length} B` }
    updateStatePanel(renderer)
    addLog(
      renderer,
      pasteStatus.tone,
      `PasteEvent <- ${event.bytes.length} B · ${metadataLabel(event)} · raw ${exact ? "yes" : "no"} norm ${normalized ? "yes" : "no"}`,
      `${escapedPreview(pasted, 44)} · hex ${hexPrefix(event.bytes, 8)}`,
    )

    queueMicrotask(() => {
      if (!editor || editor.isDestroyed) return
      updateStatePanel(renderer)
    })
  }

  capabilityHandler = () => {
    updateStatePanel(renderer)
    const capabilities = renderer.capabilities
    if (!capabilities) return
    const snapshot = `${capabilities.osc52_support}/${capabilities.osc52 ? "hint-yes" : "hint-no"}`
    if (snapshot !== lastLoggedCapability) {
      lastLoggedCapability = snapshot
      addLog(
        renderer,
        "info",
        `capabilities · osc52=${capabilities.osc52_support} legacy-hint=${capabilities.osc52 ? "yes" : "no"}`,
      )
    }
  }

  selectionHandler = (selection) => {
    if (selection.isDragging) return
    const text = selection.getSelectedText()
    if (!text || text.trim().length === 0) return

    renderer.clearSelection()
    void publishMouseSelection(renderer, text)
  }

  renderer.on(CliRenderEvents.CAPABILITIES, capabilityHandler)
  renderer.on(CliRenderEvents.SELECTION, selectionHandler)
  renderer.keyInput.on("paste", pasteHandler)

  createClipboardService(renderer)
  registerKeymap(renderer)
  updateSamplePanel()
  updateStatePanel(renderer)
  loadSampleCommand(renderer)
}

export function destroy(renderer: CliRenderer): void {
  while (disposers.length > 0) {
    const dispose = disposers.pop()
    try {
      dispose?.()
    } catch (error) {
      console.error("Error disposing clipboard demo resource:", error)
    }
  }

  if (pasteHandler) renderer.keyInput.off("paste", pasteHandler)
  if (capabilityHandler) renderer.off(CliRenderEvents.CAPABILITIES, capabilityHandler)
  if (selectionHandler) renderer.off(CliRenderEvents.SELECTION, selectionHandler)
  renderer.clearSelection()

  const service = clipboardService
  clipboardService = null
  void service?.dispose().catch((error) => {
    console.error("Error disposing clipboard service:", error)
  })

  root?.destroyRecursively()
  root = null
  platformText = null
  sampleText = null
  editor = null
  stateText = null
  logList = null
  logRows = []
  logRowId = 0
  keymap = null
  pasteHandler = null
  capabilityHandler = null
  selectionHandler = null
  lastLoggedCapability = ""
  copyStatus = { tone: "muted", text: "select text, then copy" }
  pasteStatus = { tone: "muted", text: "waiting for PasteEvent or platform paste" }
  cutStatus = { tone: "muted", text: "not attempted" }
  selectionStatus = { tone: "muted", text: "mouse selection has not published" }
  readStatus = { tone: "muted", text: "not attempted" }
  clearStatus = { tone: "muted", text: "not attempted" }
  serviceStatus = { tone: "muted", text: "inactive" }
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: process.platform !== "win32",
    targetFps: 30,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
