import {
  createCliRenderer,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  RenderableEvents,
  GroupRenderable,
  type TabSelectOption,
  type CliRenderer,
  t,
  bold,
  fg,
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { StyledTextRenderable } from "../renderables/StyledText"
import { getKeyHandler } from "../lib/KeyHandler"

let tabSelect: TabSelectRenderable | null = null
let renderer: CliRenderer | null = null
let keyboardHandler: ((key: any) => void) | null = null
let parentContainer: GroupRenderable | null = null
let keyLegendDisplay: StyledTextRenderable | null = null
let statusDisplay: StyledTextRenderable | null = null

const tabOptions: TabSelectOption[] = [
  { name: "Home", description: "Welcome to the home page", value: "home" },
  { name: "Profile", description: "Manage your user profile", value: "profile" },
  { name: "Settings", description: "Configure application settings", value: "settings" },
  { name: "About", description: "Learn more about this application", value: "about" },
  { name: "Help", description: "Get help and support", value: "help" },
  { name: "Projects", description: "View and manage your projects", value: "projects" },
  { name: "Dashboard", description: "View analytics and statistics", value: "dashboard" },
  { name: "Reports", description: "Generate and view reports", value: "reports" },
  { name: "Users", description: "Manage user accounts", value: "users" },
  { name: "Admin", description: "Administrative functions", value: "admin" },
  { name: "Tools", description: "Various utility tools", value: "tools" },
  { name: "API", description: "API documentation and testing", value: "api" },
]

function updateDisplays() {
  if (!tabSelect || !parentContainer) return

  const underlineStatus = tabSelect.getShowUnderline() ? "on" : "off"
  const description = tabSelect.getShowDescription() ? "on" : "off"
  const scrollArrows = tabSelect.getShowScrollArrows() ? "on" : "off"
  const wrap = tabSelect.getWrapSelection() ? "on" : "off"

  const keyLegendText = t`${bold(fg("#FFFFFF")("Key Controls:"))}
←/→ or [/]: Navigate tabs
Enter: Select tab
F: Toggle focus
U: Toggle underline
P: Toggle description
S: Toggle scroll arrows
W: Toggle wrap selection`

  if (keyLegendDisplay) {
    keyLegendDisplay.fragment = keyLegendText
  }

  const currentSelection = tabSelect.getSelectedOption()
  const selectionText = currentSelection
    ? `Selected: ${currentSelection.name} (${currentSelection.value}) - Index: ${tabSelect.getSelectedIndex()}`
    : "No selection"

  const focusText = tabSelect.focused ? "Tab selector is FOCUSED" : "Tab selector is BLURRED"
  const focusColor = tabSelect.focused ? "#00FF00" : "#FF0000"

  const statusText = t`${fg("#00FF00")(selectionText)}

${fg(focusColor)(focusText)}

${fg("#CCCCCC")(`Underline: ${underlineStatus} | Description: ${description} | Scroll arrows: ${scrollArrows} | Wrap: ${wrap}`)}`

  if (statusDisplay) {
    statusDisplay.fragment = statusText
  }
}

export function run(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.setBackgroundColor("#001122")

  parentContainer = new GroupRenderable("tab-select-container", {
    zIndex: 10,
    visible: true,
  })
  renderer.root.add(parentContainer)

  tabSelect = new TabSelectRenderable("main-tabs", {
    positionType: "absolute",
    position: {
      left: 5,
      top: 2,
    },
    width: 70,
    options: tabOptions,
    zIndex: 100,
    tabWidth: 12,
    backgroundColor: "#1e293b",
    focusedBackgroundColor: "#2d3748",
    textColor: "#e2e8f0",
    focusedTextColor: "#f7fafc",
    selectedBackgroundColor: "#3b82f6",
    selectedTextColor: "#ffffff",
    selectedDescriptionColor: "#cbd5e1",
    showDescription: true,
    showUnderline: true,
    showScrollArrows: true,
    wrapSelection: false,
  })

  renderer.root.add(tabSelect)

  keyLegendDisplay = new StyledTextRenderable("key-legend", {
    fragment: t``,
    width: 40,
    height: 10,
    positionType: "absolute",
    position: {
      left: 5,
      top: 8,
    },
    zIndex: 50,
    defaultFg: "#AAAAAA",
  })
  parentContainer.add(keyLegendDisplay)

  // Create status display
  statusDisplay = new StyledTextRenderable("status-display", {
    fragment: t``,
    width: 80,
    height: 6,
    positionType: "absolute",
    position: {
      left: 5,
      top: 19,
    },
    zIndex: 50,
  })
  parentContainer.add(statusDisplay)

  tabSelect.on(TabSelectRenderableEvents.SELECTION_CHANGED, (index: number, option: TabSelectOption) => {
    updateDisplays()
  })

  tabSelect.on(TabSelectRenderableEvents.ITEM_SELECTED, (index: number, option: TabSelectOption) => {
    updateDisplays()
  })

  tabSelect.on(RenderableEvents.FOCUSED, () => {
    updateDisplays()
  })

  tabSelect.on(RenderableEvents.BLURRED, () => {
    updateDisplays()
  })

  updateDisplays()

  keyboardHandler = (key) => {
    if (key.name === "f") {
      if (tabSelect?.focused) {
        tabSelect.blur()
      } else {
        tabSelect?.focus()
      }
    } else if (key.name === "u") {
      tabSelect?.setShowUnderline(!tabSelect.getShowUnderline())
      updateDisplays()
    } else if (key.name === "p") {
      tabSelect?.setShowDescription(!tabSelect.getShowDescription())
      updateDisplays()
    } else if (key.name === "s") {
      tabSelect?.setShowScrollArrows(!tabSelect.getShowScrollArrows())
      updateDisplays()
    } else if (key.name === "w") {
      tabSelect?.setWrapSelection(!tabSelect.getWrapSelection())
      updateDisplays()
    }
  }

  getKeyHandler().on("keypress", keyboardHandler)
  tabSelect.focus()
}

export function destroy(rendererInstance: CliRenderer): void {
  if (keyboardHandler) {
    getKeyHandler().off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  if (tabSelect) {
    rendererInstance.root.remove(tabSelect.id)
    tabSelect.destroy()
    tabSelect = null
  }

  if (parentContainer) {
    rendererInstance.root.remove("tab-select-container")
    parentContainer = null
  }

  keyLegendDisplay = null
  statusDisplay = null
  renderer = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
}
