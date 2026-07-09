#!/usr/bin/env bun

import {
  BoxRenderable,
  type CliRenderer,
  type ClipboardSelection,
  type ClipboardService,
  type ClipboardWriteDestination,
  createCliRenderer,
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  decodePasteBytes,
  type KeyEvent,
  type PasteEvent,
  type Selection,
  TextareaRenderable,
  TextRenderable,
} from "@opentui/core"

const COLORS = {
  background: "#071018",
  panel: "#101c28",
  border: "#36516c",
  text: "#e5edf5",
  muted: "#8ba0b5",
  accent: "#66d9ef",
  selection: "#28577a",
} as const

const READ_MAX_BYTES = 2 * 1024 * 1024
const UNICODE_PAYLOAD = "OpenTUI clipboard round-trip\nUnicode: \u4e16\u754c cafe \ud83d\ude80\nLine endings: LF\nEnd"
const LARGE_PAYLOAD = "0123456789abcdef".repeat(1024)

let root: BoxRenderable | null = null
let editor: TextareaRenderable | null = null
let stateText: TextRenderable | null = null
let readText: TextRenderable | null = null
let clipboard: ClipboardService | null = null
let selection: ClipboardSelection = "clipboard"
let destination: ClipboardWriteDestination = "all-available"
let payload = UNICODE_PAYLOAD
let operationStatus = "Ready"
let pasteStatus = "No PasteEvent received"
let keyHandler: ((key: KeyEvent) => void) | null = null
let pasteHandler: ((event: PasteEvent) => void) | null = null
let selectionHandler: ((selection: Selection) => void) | null = null
let destroyPromise: Promise<void> | null = null
let serviceDisposal: Promise<void> = Promise.resolve()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function byteCount(text: string): number {
  return new TextEncoder().encode(text).length
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function terminalResult(status: string, capability: string): string {
  return status === "attempted" ? `attempted, unconfirmed (${capability})` : `${status} (${capability})`
}

function updateState(): void {
  if (!stateText) return
  const payloadName = payload === UNICODE_PAYLOAD ? "exact Unicode" : "exact 16 KiB"
  stateText.content = [
    `Service: ${clipboard ? "active" : "disposed"}`,
    `Selection: ${selection} | Last destination: ${destination}`,
    `Payload: ${payloadName}, ${byteCount(payload)} bytes`,
    `Operation: ${operationStatus}`,
    `PasteEvent: ${pasteStatus}`,
  ].join("\n")
}

function setOperation(status: string): void {
  operationStatus = status
  updateState()
}

async function createService(renderer: CliRenderer): Promise<void> {
  if (clipboard) {
    setOperation("Service is already active")
    return
  }

  await serviceDisposal.catch(() => {})
  if (destroyPromise) return
  if (clipboard) {
    setOperation("Service is already active")
    return
  }
  try {
    clipboard = createClipboard({
      host: createHostClipboard({ maxReadBytes: READ_MAX_BYTES }),
      terminal: createRendererClipboardAdapter(renderer),
    })
    setOperation("Created host and terminal clipboard service")
  } catch (error) {
    setOperation(`Create failed: ${errorMessage(error)}`)
  }
}

async function disposeService(): Promise<void> {
  const service = clipboard
  clipboard = null
  updateState()
  if (service) {
    serviceDisposal = serviceDisposal.catch(() => {}).then(() => service.dispose())
  }

  try {
    await serviceDisposal
    setOperation(service ? "Service disposal awaited" : "Service is already disposed")
  } catch (error) {
    setOperation(`Dispose failed: ${errorMessage(error)}`)
  }
}

async function recreateService(renderer: CliRenderer): Promise<void> {
  await disposeService()
  await createService(renderer)
}

async function write(renderer: CliRenderer, nextDestination: ClipboardWriteDestination): Promise<void> {
  destination = nextDestination
  const service = clipboard
  if (!service) {
    setOperation("Write skipped: service disposed (F11 recreates)")
    return
  }

  setOperation(`Writing ${byteCount(payload)} bytes to ${selection} via ${destination}`)
  try {
    const result = await service.writeText(payload, { destination, selection })
    if (service !== clipboard) return
    setOperation(
      `Write ${selection}: host ${result.host.status}; terminal ${terminalResult(result.terminal.status, result.terminal.capability)}`,
    )
  } catch (error) {
    if (service === clipboard) setOperation(`Write failed: ${errorMessage(error)}`)
  }
  editor?.focus()
  renderer.requestRender()
}

async function readHost(chosenSelection: ClipboardSelection): Promise<void> {
  const service = clipboard
  if (!service) {
    setOperation("Read skipped: service disposed (F11 recreates)")
    return
  }

  setOperation(`Reading host ${chosenSelection}; prefers image/png then text/plain`)
  try {
    const result = await service.read({ preferredTypes: ["image/png", "text/plain"], selection: chosenSelection })
    if (service !== clipboard) return
    if (result.status !== "read") {
      const detail = result.status === "failed" ? `: ${result.error.message}` : ""
      if (readText) readText.content = `${chosenSelection}: ${result.status}${detail}`
      setOperation(`Host read ${result.status}`)
      return
    }

    const { mimeType, bytes } = result.representation
    const digest = await sha256(bytes)
    if (service !== clipboard) return
    const exact = mimeType === "text/plain" && new TextDecoder().decode(bytes) === payload
    if (readText) {
      readText.content = `${chosenSelection} | ${mimeType} | ${bytes.length} bytes | exact fixture: ${exact ? "yes" : "no"}\nSHA-256 ${digest}`
    }
    setOperation("Host read completed as data; no PasteEvent was synthesized")
  } catch (error) {
    if (service === clipboard) setOperation(`Read failed: ${errorMessage(error)}`)
  }
}

async function clear(chosenSelection: ClipboardSelection, chosenDestination: ClipboardWriteDestination): Promise<void> {
  const service = clipboard
  if (!service) {
    setOperation("Clear skipped: service disposed (F11 recreates)")
    return
  }

  setOperation(`Clearing ${chosenSelection} via ${chosenDestination}`)
  try {
    const result = await service.clear({ destination: chosenDestination, selection: chosenSelection })
    if (service !== clipboard) return
    setOperation(
      `Clear ${chosenSelection}: host ${result.host.status}; terminal ${terminalResult(result.terminal.status, result.terminal.capability)}`,
    )
  } catch (error) {
    if (service === clipboard) setOperation(`Clear failed: ${errorMessage(error)}`)
  }
}

async function publishSelection(text: string): Promise<void> {
  const service = clipboard
  if (!service) return

  try {
    const result = await service.writeText(text, { destination: "all-available", selection })
    if (service !== clipboard) return
    setOperation(
      `Mouse selection published ${byteCount(text)} bytes to ${selection}: host ${result.host.status}; terminal ${terminalResult(result.terminal.status, result.terminal.capability)}`,
    )
  } catch (error) {
    if (service === clipboard) setOperation(`Selection publish failed: ${errorMessage(error)}`)
  }
}

function panel(renderer: CliRenderer, id: string, title: string, height?: number): BoxRenderable {
  return new BoxRenderable(renderer, {
    id,
    title: ` ${title} `,
    border: true,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    paddingLeft: 1,
    paddingRight: 1,
    ...(height === undefined ? { flexGrow: 1 } : { height }),
  })
}

function handleKey(renderer: CliRenderer, key: KeyEvent): void {
  if (key.name === "f7") {
    key.preventDefault()
    void readHost(key.shift ? "primary" : "clipboard")
    return
  }

  switch (key.name) {
    case "f1":
      payload = UNICODE_PAYLOAD
      setOperation("Selected exact Unicode payload")
      break
    case "f2":
      void write(renderer, "host-only")
      break
    case "f3":
      selection = selection === "clipboard" ? "primary" : "clipboard"
      setOperation(`Selected ${selection}`)
      break
    case "f4":
      payload = LARGE_PAYLOAD
      setOperation("Selected exact 16 KiB payload")
      break
    case "f5":
      void write(renderer, "terminal-only")
      break
    case "f6":
      void write(renderer, "all-available")
      break
    case "f8":
      void clear("clipboard", "all-available")
      break
    case "f9":
      void clear(selection, destination)
      break
    case "f10":
      void disposeService()
      break
    case "f11":
      void recreateService(renderer)
      break
    default:
      return
  }
  key.preventDefault()
  editor?.focus()
}

export function run(renderer: CliRenderer): void {
  destroyPromise = null
  selection = "clipboard"
  destination = "all-available"
  payload = UNICODE_PAYLOAD
  operationStatus = "Ready"
  pasteStatus = "No PasteEvent received"
  renderer.setBackgroundColor(COLORS.background)

  root = new BoxRenderable(renderer, {
    id: "clipboard-demo-root",
    width: "100%",
    height: "100%",
    padding: 1,
    flexDirection: "column",
    gap: 1,
    backgroundColor: COLORS.background,
  })

  const instructions = new TextRenderable(renderer, {
    id: "clipboard-demo-instructions",
    height: 5,
    fg: COLORS.muted,
    content: [
      "CLIPBOARD AND PASTE MANUAL ACCEPTANCE",
      "F1 Unicode | F2 host write | F3 clipboard/primary | F4 16 KiB | F5 terminal write | F6 all write",
      "F7 read clipboard | Shift+F7 read primary | F8 clear clipboard/all | F9 clear selected destination/selection",
      "F10 dispose | F11 recreate | Menu: Escape returns | Standalone: Ctrl+C/Ctrl+Q quits",
      "Terminal attempts are unconfirmed. Paste normally into the focused textarea below.",
    ].join("\n"),
  })

  const editorPanel = panel(renderer, "clipboard-demo-editor-panel", "Focused Paste Target")
  editor = new TextareaRenderable(renderer, {
    id: "clipboard-demo-editor",
    width: "100%",
    height: "100%",
    placeholder: "Ordinary terminal paste bytes/text appear here...",
    textColor: COLORS.text,
    backgroundColor: COLORS.panel,
    focusedBackgroundColor: COLORS.panel,
    cursorColor: COLORS.accent,
    selectionBg: COLORS.selection,
    selectionFg: COLORS.text,
    wrapMode: "word",
  })
  editorPanel.add(editor)

  const statePanel = panel(renderer, "clipboard-demo-state-panel", "Current State", 7)
  stateText = new TextRenderable(renderer, { id: "clipboard-demo-state", content: "", fg: COLORS.text })
  statePanel.add(stateText)

  const readPanel = panel(renderer, "clipboard-demo-read-panel", "Latest Host Read", 4)
  readText = new TextRenderable(renderer, {
    id: "clipboard-demo-read",
    content: "No host read yet",
    fg: COLORS.text,
    selectionBg: COLORS.selection,
    selectionFg: COLORS.text,
  })
  readPanel.add(readText)

  root.add(instructions)
  root.add(editorPanel)
  root.add(statePanel)
  root.add(readPanel)
  renderer.root.add(root)

  keyHandler = (key) => handleKey(renderer, key)
  pasteHandler = (event) => {
    const expected = payload
    const rawMatch = decodePasteBytes(event.bytes) === expected
    pasteStatus = `${event.bytes.length} bytes | raw fixture match: ${rawMatch ? "yes" : "no"} | editor match: pending`
    updateState()
    queueMicrotask(() => {
      const editorMatch = editor?.plainText === normalizeNewlines(expected)
      pasteStatus = `${event.bytes.length} bytes | raw fixture match: ${rawMatch ? "yes" : "no"} | editor normalized match: ${editorMatch ? "yes" : "no"}`
      updateState()
    })
  }
  selectionHandler = (currentSelection) => {
    if (currentSelection.isDragging) return
    const text = currentSelection.getSelectedText()
    if (text.trim().length === 0) return
    renderer.clearSelection()
    void publishSelection(text)
  }

  renderer.keyInput.on("keypress", keyHandler)
  renderer.keyInput.on("paste", pasteHandler)
  renderer.on("selection", selectionHandler)
  void createService(renderer)
  updateState()
  editor.focus()
}

export function destroy(renderer: CliRenderer): Promise<void> {
  destroyPromise ??= (async () => {
    if (keyHandler) renderer.keyInput.off("keypress", keyHandler)
    if (pasteHandler) renderer.keyInput.off("paste", pasteHandler)
    if (selectionHandler) renderer.off("selection", selectionHandler)
    keyHandler = null
    pasteHandler = null
    selectionHandler = null
    renderer.clearSelection()
    await disposeService()
    root?.destroyRecursively()
    root = null
    editor = null
    stateText = null
    readText = null
  })()
  return destroyPromise
}

if (import.meta.main) {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 })
  run(renderer)
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if ((key.name === "c" && key.ctrl) || (key.name === "q" && key.ctrl)) {
      void destroy(renderer).finally(() => renderer.destroy())
    }
  })
}
