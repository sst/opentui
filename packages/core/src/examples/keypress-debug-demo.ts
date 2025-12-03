#!/usr/bin/env bun

import {
  type CliRenderer,
  createCliRenderer,
  BoxRenderable,
  CodeRenderable,
  TextRenderable,
  addDefaultParsers,
  type KeyEvent,
} from "../index"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { SyntaxStyle } from "../syntax-style"
import { parseColor } from "../lib/RGBA"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

const parsers = [
  {
    filetype: "json",
    wasm: "https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.8/tree-sitter-json.wasm",
    queries: {
      highlights: [
        "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/json/highlights.scm",
      ],
    },
  },
]
addDefaultParsers(parsers)

let scrollBox: ScrollBoxRenderable | null = null
let syntaxStyle: SyntaxStyle | null = null
let eventCount = 0
let helpModal: BoxRenderable | null = null
let showingHelp = false
let inputHandler: ((sequence: string) => boolean) | null = null
let keypressHandler: ((event: KeyEvent) => void) | null = null
let keyreleaseHandler: ((event: KeyEvent) => void) | null = null
let pasteHandler: ((event: { text: string }) => void) | null = null

function addEvent(renderer: CliRenderer, eventType: string, event: object) {
  if (!scrollBox || !syntaxStyle) return

  eventCount++

  const eventData = {
    type: eventType,
    timestamp: new Date().toISOString(),
    ...event,
  }

  const eventBox = new BoxRenderable(renderer, {
    id: `event-${eventCount}`,
    width: "auto",
    marginBottom: 1,
    padding: 1,
    backgroundColor: "#1f2937",
  })

  const codeDisplay = new CodeRenderable(renderer, {
    id: `event-code-${eventCount}`,
    content: JSON.stringify(eventData, null, 2),
    filetype: "json",
    conceal: false,
    syntaxStyle,
    bg: "#1f2937",
  })

  eventBox.add(codeDisplay)
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
    left: "50%",
    top: "50%",
    width: 50,
    height: 12,
    marginLeft: -25, // Center horizontally
    marginTop: -6, // Center vertically
    border: true,
    borderStyle: "double",
    borderColor: "#4ECDC4",
    backgroundColor: "#0D1117",
    title: "Keybindings",
    titleAlignment: "center",
    padding: 2,
    zIndex: 100,
    visible: false,
  })

  const helpContent = new TextRenderable(renderer, {
    id: "help-content",
    content: `Events Captured:
  • All keypress events
  • All keyrelease events
  • Paste events
  • Raw input sequences

Actions:
  Shift+C : Refresh terminal capabilities
  ?       : Toggle this help screen
  ESC     : Return to main menu

The debug tool displays all keyboard and
input events in real-time as JSON.`,
    fg: "#E6EDF3",
  })

  helpModal.add(helpContent)
  renderer.root.add(helpModal)

  syntaxStyle = SyntaxStyle.fromStyles({
    string: { fg: parseColor("#A5D6FF") },
    number: { fg: parseColor("#79C0FF") },
    boolean: { fg: parseColor("#79C0FF") },
    keyword: { fg: parseColor("#FF7B72") },
    default: { fg: parseColor("#E6EDF3") },
  })

  addEvent(renderer, "capabilities", renderer.capabilities)

  inputHandler = (sequence: string) => {
    addEvent(renderer, "raw-input", { sequence })
    return false
  }
  renderer.addInputHandler(inputHandler)

  keypressHandler = (event: KeyEvent) => {
    // Handle help modal toggle
    if (event.raw === "?" && helpModal) {
      showingHelp = !showingHelp
      helpModal.visible = showingHelp
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
    addEvent(renderer, "keyrelease", event)
  }
  renderer.keyInput.on("keyrelease", keyreleaseHandler)

  pasteHandler = (event: { text: string }) => {
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

  syntaxStyle = null
  eventCount = 0
  showingHelp = false
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
    useKittyKeyboard: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
