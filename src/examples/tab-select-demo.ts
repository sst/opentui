import {
  createCliRenderer,
  TabSelectElement,
  TabSelectElementEvents,
  GroupRenderable,
  type TabSelectOption,
  type CliRenderer,
  type BorderStyle,
  t,
  bold,
  fg,
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import type { StyledTextRenderable } from "../objects"
import { getKeyHandler } from "../ui/lib/KeyHandler"

let tabSelect: TabSelectElement | null = null
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

  const border = tabSelect.getBorderStyle()
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
B: Cycle borders
S: Toggle scroll arrows
W: Toggle wrap selection`

  if (keyLegendDisplay) {
    keyLegendDisplay.fragment = keyLegendText
  }

  const currentSelection = tabSelect.getSelectedOption()
  const selectionText = currentSelection
    ? `Selected: ${currentSelection.name} (${currentSelection.value}) - Index: ${tabSelect.getSelectedIndex()}`
    : "No selection"

  const focusText = tabSelect.isFocused() ? "Tab selector is FOCUSED" : "Tab selector is BLURRED"
  const focusColor = tabSelect.isFocused() ? "#00FF00" : "#FF0000"

  const statusText = t`${fg("#00FF00")(selectionText)}

${fg(focusColor)(focusText)}

${fg("#CCCCCC")(`Border: ${border} | Underline: ${underlineStatus} | Description: ${description} | Scroll arrows: ${scrollArrows} | Wrap: ${wrap}`)}`

  if (statusDisplay) {
    statusDisplay.fragment = statusText
  }
}

function cycleBorderStyle() {
  if (!tabSelect) return
  let currentBorder: BorderStyle | "none" = tabSelect.getBorderStyle()
  if (tabSelect.getBorder() === false) {
    currentBorder = "none"
  }
  const borderStyles: (BorderStyle | "none")[] = ["single", "double", "rounded", "heavy", "none"]
  const currentIndex = borderStyles.indexOf(currentBorder)
  const nextIndex = (currentIndex + 1) % borderStyles.length
  if (borderStyles[nextIndex] === "none") {
    tabSelect.setBorder(false, "single")
  } else {
    tabSelect.setBorder(true, borderStyles[nextIndex])
  }
  updateDisplays()
}

export function run(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.setBackgroundColor("#001122")

  parentContainer = new GroupRenderable("tab-select-container", {
    x: 0,
    y: 0,
    zIndex: 10,
    visible: true,
  })
  renderer.add(parentContainer)

  tabSelect = new TabSelectElement("main-tabs", {
    x: 5,
    y: 2,
    width: 70,
    options: tabOptions,
    zIndex: 100,
    tabWidth: 12,
    selectedBackgroundColor: "#334455",
    selectedTextColor: "#FFFF00",
    textColor: "#CCCCCC",
    selectedDescriptionColor: "#FFFFFF",
    borderStyle: "single",
    borderColor: "#666666",
    focusedBorderColor: "#00AAFF",
    showDescription: true,
    showUnderline: true,
    showScrollArrows: true,
    wrapSelection: false,
  })

  renderer.add(tabSelect)

  keyLegendDisplay = renderer.createStyledText("key-legend", {
    fragment: t``,
    width: 40,
    height: 10,
    x: 5,
    y: 8,
    zIndex: 50,
    defaultFg: "#AAAAAA",
  })
  parentContainer.add(keyLegendDisplay)

  // Create status display
  statusDisplay = renderer.createStyledText("status-display", {
    fragment: t``,
    width: 80,
    height: 6,
    x: 5,
    y: 19,
    zIndex: 50,
  })
  parentContainer.add(statusDisplay)

  tabSelect.on(TabSelectElementEvents.SELECTION_CHANGED, (index: number, option: TabSelectOption) => {
    updateDisplays()
  })

  tabSelect.on(TabSelectElementEvents.ITEM_SELECTED, (index: number, option: TabSelectOption) => {
    updateDisplays()
  })

  tabSelect.on(TabSelectElementEvents.FOCUSED, () => {
    updateDisplays()
  })

  tabSelect.on(TabSelectElementEvents.BLURRED, () => {
    updateDisplays()
  })

  updateDisplays()

  keyboardHandler = (key) => {
    if (key.name === "f") {
      if (tabSelect?.isFocused()) {
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
    } else if (key.name === "b") {
      cycleBorderStyle()
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
    rendererInstance.remove(tabSelect.id)
    tabSelect.destroy()
    tabSelect = null
  }

  if (parentContainer) {
    rendererInstance.remove("tab-select-container")
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
