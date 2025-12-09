#!/usr/bin/env bun

import { type CliRenderer, createCliRenderer, BoxRenderable, TextRenderable, type KeyEvent } from "../index"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { TextNodeRenderable } from "../renderables/TextNode"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { env, registerEnvVar } from "../lib/env"

registerEnvVar({
  name: "OTUI_KEYPRESS_DEBUG_SHOW_JSON",
  description: "Show full JSON alongside formatted output in keypress debug tool",
  type: "boolean",
  default: false,
})

let scrollBox: ScrollBoxRenderable | null = null
let eventCount = 0
let helpModal: BoxRenderable | null = null
let helpContent: TextRenderable | null = null
let scrollHint: TextRenderable | null = null
let showingHelp = false
let showJson = false
let inputHandler: ((sequence: string) => boolean) | null = null
let keypressHandler: ((event: KeyEvent) => void) | null = null
let keyreleaseHandler: ((event: KeyEvent) => void) | null = null
let pasteHandler: ((event: { text: string }) => void) | null = null

// Storage for all captured data
let allRawInputs: Array<{ timestamp: string; sequence: string }> = []
let allKeyEvents: Array<{ timestamp: string; type: string; event: any }> = []

function saveToFile(capabilities: CliRenderer["capabilities"]) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filename = `keypress-debug-${timestamp}.json`

  const data = {
    exportedAt: new Date().toISOString(),
    rawInputs: allRawInputs,
    keyEvents: allKeyEvents,
    summary: {
      totalRawInputs: allRawInputs.length,
      totalKeyEvents: allKeyEvents.length,
    },
    capabilities,
  }

  try {
    Bun.write(filename, JSON.stringify(data, null, 2))
    console.log(`Saved debug data to ${filename}`)
  } catch (error) {
    console.error(`Failed to save file: ${error}`)
  }
}

function formatEventAsText(renderer: CliRenderer, eventType: string, event: any): TextRenderable {
  const eventText = new TextRenderable(renderer, {
    id: `event-text-${eventCount}`,
  })

  // Event type header with icon
  let icon = "⌨️ "
  let typeColor = "#A5D6FF"
  if (eventType === "keypress") {
    icon = "↓ "
    typeColor = "#7EE787"
  } else if (eventType === "keyrelease") {
    icon = "↑ "
    typeColor = "#FFA657"
  } else if (eventType === "paste") {
    icon = "📋 "
    typeColor = "#D2A8FF"
  } else if (eventType === "capabilities") {
    icon = "ℹ️  "
    typeColor = "#79C0FF"
  }

  const typeNode = TextNodeRenderable.fromString(`${icon}${eventType.toUpperCase()}`, {
    fg: typeColor,
    attributes: 1, // bold
  })
  eventText.textNode.add(typeNode)

  // Key name (if available)
  if (event.name) {
    const keyNode = TextNodeRenderable.fromString(` ${event.name}`, {
      fg: "#FFA657",
      attributes: 1,
    })
    eventText.textNode.add(keyNode)
  }

  // Modifiers
  const modifiers: string[] = []
  if (event.ctrl) modifiers.push("Ctrl")
  if (event.meta) modifiers.push("Meta")
  if (event.shift) modifiers.push("Shift")
  if (event.option) modifiers.push("Option")
  if (event.super) modifiers.push("Super")
  if (event.hyper) modifiers.push("Hyper")

  if (modifiers.length > 0) {
    const modNode = TextNodeRenderable.fromString(` [${modifiers.join("+")}]`, {
      fg: "#D2A8FF",
    })
    eventText.textNode.add(modNode)
  }

  // Sequence/Raw
  if (event.raw || event.sequence) {
    const raw = event.raw || event.sequence
    const displayRaw = JSON.stringify(raw)
    const rawNode = TextNodeRenderable.fromString(` ${displayRaw}`, {
      fg: "#79C0FF",
    })
    eventText.textNode.add(rawNode)
  }

  // Source
  if (event.source) {
    const sourceNode = TextNodeRenderable.fromString(` (${event.source})`, {
      fg: "#8B949E",
    })
    eventText.textNode.add(sourceNode)
  }

  // Paste text
  if (event.text && eventType === "paste") {
    const textPreview = event.text.length > 50 ? event.text.substring(0, 47) + "..." : event.text
    const pasteNode = TextNodeRenderable.fromString(`\n  "${textPreview}"`, {
      fg: "#A5D6FF",
    })
    eventText.textNode.add(pasteNode)
  }

  // Capabilities info - show full details
  if (eventType === "capabilities") {
    const capsText = JSON.stringify(event, null, 2)
    const capsNode = TextNodeRenderable.fromString(`\n${capsText}`, {
      fg: "#8B949E",
    })
    eventText.textNode.add(capsNode)
  }

  // Timestamp
  const time = new Date().toLocaleTimeString()
  const timeNode = TextNodeRenderable.fromString(`\n  ${time}`, {
    fg: "#6E7681",
  })
  eventText.textNode.add(timeNode)

  // Show full JSON if enabled
  if (showJson && eventType !== "capabilities") {
    const jsonText = JSON.stringify({ type: eventType, timestamp: new Date().toISOString(), ...event }, null, 2)
    const jsonNode = TextNodeRenderable.fromString(`\n\n${jsonText}`, {
      fg: "#8B949E",
    })
    eventText.textNode.add(jsonNode)
  }

  return eventText
}

function addEvent(renderer: CliRenderer, eventType: string, event: object) {
  if (!scrollBox) return

  eventCount++

  const eventBox = new BoxRenderable(renderer, {
    id: `event-${eventCount}`,
    width: "auto",
    marginBottom: 1,
    padding: 1,
    backgroundColor: "#1f2937",
    borderColor: "#374151",
    borderStyle: "single",
    border: true,
  })

  const eventDisplay = formatEventAsText(renderer, eventType, event)
  eventBox.add(eventDisplay)
  scrollBox.add(eventBox)

  const children = scrollBox.getChildren()
  if (children.length > 50) {
    const oldest = children[0]
    if (oldest) {
      scrollBox.remove(oldest.id)
      oldest.destroyRecursively()
    }
  }
}

export function run(renderer: CliRenderer): void {
  renderer.setBackgroundColor("#0D1117")

  // Initialize showJson from env var
  showJson = env.OTUI_KEYPRESS_DEBUG_SHOW_JSON

  // Get any debug inputs captured before this tool started (e.g., during setupTerminal)
  const cachedDebugInputs = renderer.getDebugInputs()
  if (cachedDebugInputs.length > 0) {
    allRawInputs.push(...cachedDebugInputs)
    console.log(`Loaded ${cachedDebugInputs.length} pre-captured debug inputs (including terminal setup)`)
  }

  const mainContainer = new BoxRenderable(renderer, {
    id: "main-container",
    flexGrow: 1,
    flexDirection: "column",
  })

  renderer.root.add(mainContainer)

  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "event-scroll-box",
    stickyScroll: true,
    stickyStart: "bottom",
    border: true,
    borderColor: "#6BCF7F",
    title: "Keypress Debug Tool (Press ? for keys)",
    titleAlignment: "center",
    contentOptions: {
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
    },
  })

  mainContainer.add(scrollBox)

  // Create help modal (hidden by default)
  helpModal = new BoxRenderable(renderer, {
    id: "help-modal",
    position: "absolute",
    left: "5%",
    top: "5%",
    width: "90%",
    height: "90%",
    border: true,
    borderStyle: "double",
    borderColor: "#4ECDC4",
    backgroundColor: "#0D1117",
    title: "Keybindings",
    titleAlignment: "center",
    flexDirection: "column",
    zIndex: 100,
    visible: false,
  })

  helpContent = new TextRenderable(renderer, {
    id: "help-content",
    content: `Actions:
  Shift+C : Refresh terminal capabilities
  Shift+J : Toggle JSON view (show full JSON)
  Shift+S : Save all captured data to JSON file
  ?       : Toggle this help screen
  ESC     : Return to main menu

Events Captured:
  • All keypress events
  • All keyrelease events
  • Paste events
  • Raw input sequences (including unhandled)

Env Vars:
  OTUI_KEYPRESS_DEBUG_SHOW_JSON=true
    Enable JSON view at startup

The debug tool displays all keyboard and
input events in real-time. Use Shift+S to
save all captured data to a timestamped
JSON file in the current directory.`,
    fg: "#E6EDF3",
    flexGrow: 1,
    flexShrink: 1,
  })

  helpModal.add(helpContent)

  // Scroll hint (shown only when there's content to scroll)
  scrollHint = new TextRenderable(renderer, {
    id: "scroll-hint",
    content: "↑↓ to scroll",
    fg: "#6E7681",
    flexShrink: 0,
    height: 1,
    visible: false,
  })
  helpModal.add(scrollHint)

  renderer.root.add(helpModal)

  addEvent(renderer, "capabilities", renderer.capabilities)

  inputHandler = (sequence: string) => {
    // Store all raw input
    allRawInputs.push({
      timestamp: new Date().toISOString(),
      sequence,
    })

    addEvent(renderer, "raw-input", { sequence })
    return false
  }
  // Prepend to capture everything, even what other handlers process
  renderer.prependInputHandler(inputHandler)

  keypressHandler = (event: KeyEvent) => {
    // Store all keypress events
    allKeyEvents.push({
      timestamp: new Date().toISOString(),
      type: "keypress",
      event: { ...event },
    })

    // Handle help modal toggle
    if (event.raw === "?" && helpModal) {
      showingHelp = !showingHelp
      helpModal.visible = showingHelp

      // Update scroll hint visibility when modal opens
      if (showingHelp && helpContent && scrollHint) {
        const canScroll = helpContent.maxScrollY > 0
        scrollHint.visible = canScroll
      }
      return
    }

    // Handle scrolling when help modal is open
    if (showingHelp && helpContent) {
      if (event.name === "up") {
        helpContent.scrollY = Math.max(0, helpContent.scrollY - 1)
        return
      } else if (event.name === "down") {
        helpContent.scrollY = Math.min(helpContent.maxScrollY, helpContent.scrollY + 1)
        return
      }
    }

    // Handle JSON view toggle
    if (event.name === "j" && event.shift) {
      showJson = !showJson
      return
    }

    // Handle save to file
    if (event.name === "s" && event.shift) {
      saveToFile(renderer.capabilities)
      return
    }

    // Don't log modal toggle key
    if (showingHelp && event.raw === "?") {
      return
    }

    addEvent(renderer, "keypress", event)

    if (event.name === "c" && event.shift) {
      addEvent(renderer, "capabilities", renderer.capabilities)
    }
  }
  renderer.keyInput.on("keypress", keypressHandler)

  keyreleaseHandler = (event: KeyEvent) => {
    // Store all keyrelease events
    allKeyEvents.push({
      timestamp: new Date().toISOString(),
      type: "keyrelease",
      event: { ...event },
    })

    addEvent(renderer, "keyrelease", event)
  }
  renderer.keyInput.on("keyrelease", keyreleaseHandler)

  pasteHandler = (event: { text: string }) => {
    // Store all paste events
    allKeyEvents.push({
      timestamp: new Date().toISOString(),
      type: "paste",
      event: { ...event },
    })

    addEvent(renderer, "paste", event)
  }
  renderer.keyInput.on("paste", pasteHandler)

  renderer.requestRender()
}

export function destroy(renderer: CliRenderer): void {
  renderer.clearFrameCallbacks()

  // Remove event listeners
  if (keypressHandler) {
    renderer.keyInput.off("keypress", keypressHandler)
    keypressHandler = null
  }

  if (keyreleaseHandler) {
    renderer.keyInput.off("keyrelease", keyreleaseHandler)
    keyreleaseHandler = null
  }

  if (pasteHandler) {
    renderer.keyInput.off("paste", pasteHandler)
    pasteHandler = null
  }

  if (inputHandler) {
    renderer.removeInputHandler(inputHandler)
    inputHandler = null
  }

  if (scrollBox) {
    renderer.root.remove("main-container")
    scrollBox = null
  }

  helpModal?.destroy()
  helpModal = null
  helpContent = null
  scrollHint = null

  eventCount = 0
  showingHelp = false
  showJson = false

  // Clear captured data
  allRawInputs = []
  allKeyEvents = []
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
    useKittyKeyboard: { events: true },
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
