import {
  CliRenderer,
  Layout,
  ContainerElement,
  BufferedElement,
  FlexDirection,
  createCliRenderer,
  type ParsedKey,
} from "../index"
import { InputElement, InputElementEvents } from "../ui/elements/input"
import { SelectElement, SelectElementEvents, type SelectOption } from "../ui/elements/select"
import { getKeyHandler } from "../ui/lib/KeyHandler"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

/**
 * Simple text element for labels and headers
 */
class LabelElement extends BufferedElement {
  private text: string = ""

  constructor(id: string, text: string, options: any) {
    super(id, options)
    this.text = text
  }

  public setText(text: string): void {
    this.text = text
    this.needsRefresh = true
  }

  protected refreshContent(contentX: number, contentY: number, contentWidth: number, contentHeight: number): void {
    if (!this.frameBuffer) return

    const textX = Math.max(0, Math.floor((contentWidth - this.text.length) / 2))
    const textY = Math.floor(contentHeight / 2)

    if (textY >= 0 && textY < contentHeight) {
      this.frameBuffer.drawText(this.text, contentX + textX, contentY + textY, this.textColor, this.backgroundColor)
    }
  }
}

let renderer: CliRenderer | null = null
let mainLayout: Layout | null = null
let header: LabelElement | null = null
let selectContainer: ContainerElement | null = null
let leftSelect: SelectElement | null = null
let rightSelect: SelectElement | null = null
let inputContainer: ContainerElement | null = null
let inputLabel: LabelElement | null = null
let textInput: InputElement | null = null
let footer: LabelElement | null = null
let currentFocusIndex = 0

const focusableElements: Array<InputElement | SelectElement> = []

const colorOptions: SelectOption[] = [
  { name: "Red", description: "A warm primary color", value: "#ff0000" },
  { name: "Blue", description: "A cool primary color", value: "#0066ff" },
  { name: "Green", description: "A natural color", value: "#00aa00" },
  { name: "Purple", description: "A regal color", value: "#8a2be2" },
  { name: "Orange", description: "A vibrant color", value: "#ff8c00" },
  { name: "Teal", description: "A calming color", value: "#008080" },
]

const sizeOptions: SelectOption[] = [
  { name: "Small", description: "Compact size (8px)", value: 8 },
  { name: "Medium", description: "Standard size (12px)", value: 12 },
  { name: "Large", description: "Big size (16px)", value: 16 },
  { name: "Extra Large", description: "Huge size (20px)", value: 20 },
]

function createLayoutElements(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.setBackgroundColor("#001122")

  mainLayout = new Layout("main-layout", {
    x: 0,
    y: 0,
    zIndex: 1,
    width: renderer.terminalWidth,
    height: renderer.terminalHeight,
  })
  renderer.add(mainLayout)

  header = new LabelElement("header", "INPUT & SELECT LAYOUT DEMO", {
    x: 0,
    y: 0,
    zIndex: 0,
    width: "auto",
    height: 3,
    backgroundColor: "#3b82f6",
    textColor: "#ffffff",
    border: true,
    borderColor: "#2563eb",
    flexGrow: 0,
    flexShrink: 0,
  })

  selectContainer = new ContainerElement("select-container", {
    x: 0,
    y: 0,
    zIndex: 0,
    width: "auto",
    height: "auto",
    flexDirection: FlexDirection.Row,
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 10,
    backgroundColor: "#1e293b",
    border: true,
    borderColor: "#475569",
  })

  leftSelect = new SelectElement("color-select", {
    x: 0,
    y: 0,
    zIndex: 0,
    width: "auto",
    height: "auto",
    minHeight: 8,
    options: colorOptions,
    backgroundColor: "#1e293b",
    selectedBackgroundColor: "#3b82f6",
    textColor: "#e2e8f0",
    selectedTextColor: "#ffffff",
    descriptionColor: "#94a3b8",
    selectedDescriptionColor: "#cbd5e1",
    showScrollIndicator: true,
    wrapSelection: true,
    showDescription: true,
    borderStyle: "single",
    borderColor: "#475569",
    focusedBorderColor: "#3b82f6",
    title: "Color Selection",
    titleAlignment: "center",
    flexGrow: 1,
    flexShrink: 1,
  })

  rightSelect = new SelectElement("size-select", {
    x: 0,
    y: 0,
    zIndex: 0,
    width: "auto",
    height: "auto",
    minHeight: 8,
    options: sizeOptions,
    backgroundColor: "#1e293b",
    selectedBackgroundColor: "#059669",
    textColor: "#e2e8f0",
    selectedTextColor: "#ffffff",
    descriptionColor: "#94a3b8",
    selectedDescriptionColor: "#cbd5e1",
    showScrollIndicator: true,
    wrapSelection: true,
    showDescription: true,
    borderStyle: "single",
    borderColor: "#475569",
    focusedBorderColor: "#059669",
    title: "Size Selection",
    titleAlignment: "center",
    flexGrow: 1,
    flexShrink: 1,
  })

  inputContainer = new ContainerElement("input-container", {
    x: 0,
    y: 0,
    zIndex: 0,
    width: "auto",
    height: "auto",
    minHeight: 6,
    flexDirection: FlexDirection.Column,
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: "#0f172a",
    border: true,
    borderColor: "#334155",
  })

  inputLabel = new LabelElement("input-label", "Enter your text:", {
    x: 0,
    y: 0,
    zIndex: 0,
    width: "auto",
    height: "auto",
    minHeight: 3,
    backgroundColor: "#0f172a",
    textColor: "#f1f5f9",
    border: false,
    flexGrow: 0,
    flexShrink: 0,
  })

  textInput = new InputElement("text-input", {
    x: 0,
    y: 0,
    zIndex: 0,
    width: "auto",
    height: 3,
    placeholder: "Type something here...",
    backgroundColor: "#1e293b",
    textColor: "#f1f5f9",
    placeholderColor: "#64748b",
    cursorColor: "#f1f5f9",
    border: true,
    borderColor: "#475569",
    focusedBorderColor: "#eab308",
    maxLength: 100,
    flexGrow: 0,
    flexShrink: 0,
  })

  footer = new LabelElement(
    "footer",
    "TAB: focus next | SHIFT+TAB: focus prev | ARROWS/JK: navigate | ENTER: select | ESC: quit",
    {
      x: 0,
      y: 0,
      zIndex: 0,
      width: "auto",
      height: 3,
      backgroundColor: "#1e40af",
      textColor: "#dbeafe",
      border: true,
      borderColor: "#1d4ed8",
      flexGrow: 0,
      flexShrink: 0,
    },
  )

  selectContainer.add(leftSelect)
  selectContainer.add(rightSelect)
  inputContainer.add(inputLabel)
  inputContainer.add(textInput)

  mainLayout.add(header)
  mainLayout.add(selectContainer)
  mainLayout.add(inputContainer)
  mainLayout.add(footer)

  focusableElements.push(leftSelect, rightSelect, textInput)
  setupEventHandlers()
  updateFocus()

  renderer.on("resize", handleResize)
}

function setupEventHandlers(): void {
  if (!leftSelect || !rightSelect || !textInput) return

  leftSelect.on(SelectElementEvents.SELECTION_CHANGED, (index: number, option: SelectOption) => {
    updateDisplay()
  })

  leftSelect.on(SelectElementEvents.ITEM_SELECTED, (index: number, option: SelectOption) => {
    updateDisplay()
  })

  rightSelect.on(SelectElementEvents.SELECTION_CHANGED, (index: number, option: SelectOption) => {
    updateDisplay()
  })

  rightSelect.on(SelectElementEvents.ITEM_SELECTED, (index: number, option: SelectOption) => {
    updateDisplay()
  })

  textInput.on(InputElementEvents.INPUT, (value: string) => {
    updateDisplay()
  })

  textInput.on(InputElementEvents.CHANGE, (value: string) => {
    updateDisplay()
  })
}

function updateDisplay(): void {
  if (!leftSelect || !rightSelect || !textInput || !inputLabel) return

  const selectedColor = leftSelect.getSelectedOption()
  const selectedSize = rightSelect.getSelectedOption()
  const inputValue = textInput.getValue()

  let displayText = "Enter your text:"
  if (inputValue) {
    displayText += ` "${inputValue}"`
  }
  if (selectedColor) {
    displayText += ` in ${selectedColor.name}`
  }
  if (selectedSize) {
    displayText += ` (${selectedSize.name})`
  }

  inputLabel.setText(displayText)
}

function handleResize(width: number, height: number): void {
  if (!mainLayout) return
  mainLayout.resize(width, height)
}

function updateFocus(): void {
  focusableElements.forEach((element) => element.blur())

  if (focusableElements[currentFocusIndex]) {
    focusableElements[currentFocusIndex].focus()
  }
}

function handleKeyPress(key: ParsedKey): void {
  const currentElement = focusableElements[currentFocusIndex]

  if (key.name === "tab") {
    if (key.shift) {
      currentFocusIndex = (currentFocusIndex - 1 + focusableElements.length) % focusableElements.length
    } else {
      currentFocusIndex = (currentFocusIndex + 1) % focusableElements.length
    }
    updateFocus()
    return
  }
}

export function run(rendererInstance: CliRenderer): void {
  createLayoutElements(rendererInstance)
  getKeyHandler().on("keypress", handleKeyPress)
  updateDisplay()
}

export function destroy(rendererInstance: CliRenderer): void {
  getKeyHandler().off("keypress", handleKeyPress)

  if (renderer) {
    renderer.off("resize", handleResize)
  }

  if (mainLayout) {
    rendererInstance.remove(mainLayout.id)
    mainLayout.destroy()
    mainLayout = null
  }

  // Clean up all elements
  header = null
  selectContainer = null
  leftSelect = null
  rightSelect = null
  inputContainer = null
  inputLabel = null
  textInput = null
  footer = null
  renderer = null
  currentFocusIndex = 0
  focusableElements.length = 0
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
    parseKeys: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
  renderer.start()
}
