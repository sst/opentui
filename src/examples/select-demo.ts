import {
  createCliRenderer,
  SelectElement,
  SelectElementEvents,
  GroupRenderable,
  type SelectOption,
  type CliRenderer,
  type BorderStyle,
  t,
  bold,
  fg,
  underline,
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import type { StyledTextRenderable } from "../objects"
import { getKeyHandler } from "../ui/lib/KeyHandler"

let selectElement: SelectElement | null = null
let renderer: CliRenderer | null = null
let keyboardHandler: ((key: any) => void) | null = null
let keyLegendDisplay: StyledTextRenderable | null = null
let statusDisplay: StyledTextRenderable | null = null
let lastActionText: string = "Welcome to SelectElement demo! Use the controls to test features."
let lastActionColor: string = "#FFCC00"

const selectOptions: SelectOption[] = [
  { name: "Home", description: "Navigate to the home page", value: "home" },
  { name: "Profile", description: "View and edit your user profile", value: "profile" },
  { name: "Settings", description: "Configure application preferences", value: "settings" },
  { name: "Dashboard", description: "View analytics and key metrics", value: "dashboard" },
  { name: "Projects", description: "Manage your active projects", value: "projects" },
  { name: "Reports", description: "Generate and view detailed reports", value: "reports" },
  { name: "Users", description: "Manage user accounts and permissions", value: "users" },
  { name: "Analytics", description: "Deep dive into usage analytics", value: "analytics" },
  { name: "Tools", description: "Access various utility tools", value: "tools" },
  { name: "API Documentation", description: "Browse API endpoints and examples", value: "api" },
  { name: "Help Center", description: "Find answers to common questions", value: "help" },
  { name: "Support", description: "Contact our support team", value: "support" },
  { name: "Billing", description: "Manage your subscription and billing", value: "billing" },
  { name: "Integrations", description: "Connect with third-party services", value: "integrations" },
  { name: "Security", description: "Configure security settings", value: "security" },
  { name: "Notifications", description: "Manage your notification preferences", value: "notifications" },
  { name: "Backup", description: "Backup and restore your data", value: "backup" },
  { name: "Import/Export", description: "Import or export your data", value: "import-export" },
  { name: "Advanced Settings", description: "Configure advanced options", value: "advanced" },
  { name: "About", description: "Learn more about this application", value: "about" },
]

function updateDisplays() {
  if (!selectElement) return

  const border = selectElement.getBorder()
  const scrollIndicator = selectElement.getShowScrollIndicator() ? "on" : "off"
  const description = selectElement.getShowDescription() ? "on" : "off"
  const wrap = selectElement.getWrapSelection() ? "on" : "off"

  const keyLegendText = t`${bold(fg("#FFFFFF")("Key Controls:"))}
↑/↓ or j/k: Navigate items
Shift+↑/↓ or Shift+j/k: Fast scroll
Enter: Select item
F: Toggle focus
D: Toggle descriptions
B: Cycle border styles
S: Toggle scroll indicator
W: Toggle wrap selection`

  if (keyLegendDisplay) {
    keyLegendDisplay.fragment = keyLegendText
  }

  const currentSelection = selectElement.getSelectedOption()
  const selectionText = currentSelection
    ? `Selection: ${currentSelection.name} (${currentSelection.value}) - Index: ${selectElement.getSelectedIndex()}`
    : "No selection"

  const focusText = selectElement.isFocused() ? "Select element is FOCUSED" : "Select element is BLURRED"
  const focusColor = selectElement.isFocused() ? "#00FF00" : "#FF0000"

  const statusText = t`${fg("#00FF00")(selectionText)}

${fg(focusColor)(focusText)}

${fg("#CCCCCC")(`Border: ${border} | Scroll indicator: ${scrollIndicator} | Description: ${description} | Wrap: ${wrap}`)}

${fg(lastActionColor)(lastActionText)}`

  if (statusDisplay) {
    statusDisplay.fragment = statusText
  }
}

function cycleBorderStyle() {
  if (!selectElement) return
  let currentBorder: BorderStyle | "none" = selectElement.getBorderStyle()
  if (selectElement.getBorder() === false) {
    currentBorder = "none"
  }
  const borderStyles: (BorderStyle | "none")[] = ["single", "double", "rounded", "heavy", "none"]
  const currentIndex = borderStyles.indexOf(currentBorder)
  const nextIndex = (currentIndex + 1) % borderStyles.length
  if (borderStyles[nextIndex] === "none") {
    selectElement.setBorder(false, "single")
  } else {
    selectElement.setBorder(true, borderStyles[nextIndex])
  }
  updateDisplays()
}

export function run(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.setBackgroundColor("#001122")

  const parentContainer = new GroupRenderable("parent-container", {
    x: 0,
    y: 0,
    zIndex: 10,
    visible: true,
  })
  renderer.add(parentContainer)

  selectElement = new SelectElement("demo-select", {
    x: 5,
    y: 2,
    width: 50,
    height: 20,
    options: selectOptions,
    zIndex: 100,
    backgroundColor: "#001122",
    selectedBackgroundColor: "#334455",
    selectedTextColor: "#FFFF00",
    textColor: "#CCCCCC",
    selectedDescriptionColor: "#FFFFFF",
    descriptionColor: "#888888",
    borderStyle: "single",
    borderColor: "#666666",
    focusedBorderColor: "#00AAFF",
    showDescription: true,
    showScrollIndicator: true,
    wrapSelection: false,
    title: "Menu Options",
    titleAlignment: "center",
    fastScrollStep: 5,
  })

  renderer.add(selectElement)

  keyLegendDisplay = renderer.createStyledText("key-legend", {
    fragment: t``,
    width: 40,
    height: 9,
    x: 60,
    y: 3,
    zIndex: 50,
    defaultFg: "#AAAAAA",
  })
  parentContainer.add(keyLegendDisplay)

  statusDisplay = renderer.createStyledText("status-display", {
    fragment: t``,
    width: 80,
    height: 8,
    x: 5,
    y: 24,
    zIndex: 50,
  })
  parentContainer.add(statusDisplay)

  selectElement.on(SelectElementEvents.SELECTION_CHANGED, (index: number, option: SelectOption) => {
    lastActionText = `Navigation: Moved to "${option.name}"`
    lastActionColor = "#FFCC00"
    updateDisplays()
  })

  selectElement.on(SelectElementEvents.ITEM_SELECTED, (index: number, option: SelectOption) => {
    lastActionText = `*** ACTIVATED: ${option.name} (${option.value}) ***`
    lastActionColor = "#FF00FF"
    updateDisplays()
    // Reset color after a moment
    setTimeout(() => {
      lastActionColor = "#FFCC00"
      updateDisplays()
    }, 1000)
  })

  selectElement.on(SelectElementEvents.FOCUSED, () => {
    updateDisplays()
  })

  selectElement.on(SelectElementEvents.BLURRED, () => {
    updateDisplays()
  })

  updateDisplays()

  keyboardHandler = (key) => {
    if (key.name === "f") {
      if (selectElement?.isFocused()) {
        selectElement.blur()
        lastActionText = "Focus removed from select element"
      } else {
        selectElement?.focus()
        lastActionText = "Select element focused"
      }
      lastActionColor = "#FFCC00"
      updateDisplays()
    } else if (key.name === "d") {
      const newState = !selectElement?.getShowDescription()
      selectElement?.setShowDescription(newState)
      lastActionText = `Descriptions ${newState ? "enabled" : "disabled"}`
      lastActionColor = "#FFCC00"
      updateDisplays()
    } else if (key.name === "b") {
      cycleBorderStyle()
      lastActionText = `Border style changed to ${selectElement?.getBorderStyle()}`
      lastActionColor = "#FFCC00"
      updateDisplays()
    } else if (key.name === "s") {
      const newState = !selectElement?.getShowScrollIndicator()
      selectElement?.setShowScrollIndicator(newState)
      lastActionText = `Scroll indicator ${newState ? "enabled" : "disabled"}`
      lastActionColor = "#FFCC00"
      updateDisplays()
    } else if (key.name === "w") {
      const newState = !selectElement?.getWrapSelection()
      selectElement?.setWrapSelection(newState)
      lastActionText = `Wrap selection ${newState ? "enabled" : "disabled"}`
      lastActionColor = "#FFCC00"
      updateDisplays()
    }
  }

  getKeyHandler().on("keypress", keyboardHandler)
  selectElement.focus()
}

export function destroy(rendererInstance: CliRenderer): void {
  if (keyboardHandler) {
    getKeyHandler().off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  if (selectElement) {
    rendererInstance.remove(selectElement.id)
    selectElement.destroy()
    selectElement = null
  }

  rendererInstance.remove("parent-container")

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
  renderer.start()
}
