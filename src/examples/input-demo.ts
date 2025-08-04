import {
  createCliRenderer,
  InputElement,
  InputElementEvents,
  GroupRenderable,
  type CliRenderer,
  type BorderStyle,
  t,
  bold,
  fg,
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import type { StyledTextRenderable } from "../objects"
import { getKeyHandler } from "../ui/lib/KeyHandler"

let nameInput: InputElement | null = null
let emailInput: InputElement | null = null
let passwordInput: InputElement | null = null
let commentInput: InputElement | null = null
let renderer: CliRenderer | null = null
let keyboardHandler: ((key: any) => void) | null = null
let keyLegendDisplay: StyledTextRenderable | null = null
let statusDisplay: StyledTextRenderable | null = null
let lastActionText: string = "Welcome to InputElement demo! Use Tab to navigate between fields."
let lastActionColor: string = "#FFCC00"
let activeInputIndex: number = 0

const inputElements: InputElement[] = []

function getActiveInput(): InputElement | null {
  return inputElements[activeInputIndex] || null
}

function updateDisplays() {
  if (inputElements.length === 0) return

  const activeInput = getActiveInput()
  const activeInputName = getInputName(activeInput)

  const keyLegendText = t`${bold(fg("#FFFFFF")("Key Controls:"))}
Tab/Shift+Tab: Navigate between inputs
Left/Right: Move cursor within input
Home/End: Move to start/end of input
Backspace/Delete: Remove characters
Enter: Submit current input
Ctrl+F: Toggle focus on active input
Ctrl+C: Clear active input
Ctrl+R: Reset all inputs to defaults
Ctrl+B: Cycle border styles
Type: Enter text in focused field`

  if (keyLegendDisplay) {
    keyLegendDisplay.fragment = keyLegendText
  }

  const nameValue = nameInput?.getValue() || ""
  const emailValue = emailInput?.getValue() || ""
  const passwordValue = passwordInput?.getValue() || ""
  const commentValue = commentInput?.getValue() || ""

  const nameStatus = nameInput?.isFocused() ? "FOCUSED" : "BLURRED"
  const nameColor = nameInput?.isFocused() ? "#00FF00" : "#FF0000"

  const emailStatus = emailInput?.isFocused() ? "FOCUSED" : "BLURRED"
  const emailColor = emailInput?.isFocused() ? "#00FF00" : "#FF0000"

  const passwordStatus = passwordInput?.isFocused() ? "FOCUSED" : "BLURRED"
  const passwordColor = passwordInput?.isFocused() ? "#00FF00" : "#FF0000"

  const commentStatus = commentInput?.isFocused() ? "FOCUSED" : "BLURRED"
  const commentColor = commentInput?.isFocused() ? "#00FF00" : "#FF0000"

  const statusText = t`${bold(fg("#FFFFFF")("Input Values:"))}
Name: "${nameValue}" (${fg(nameColor)(nameStatus)})
Email: "${emailValue}" (${fg(emailColor)(emailStatus)})
Password: "${passwordValue.replace(/./g, "*")}" (${fg(passwordColor)(passwordStatus)})
Comment: "${commentValue}" (${fg(commentColor)(commentStatus)})

${bold(fg("#FFAA00")(`Active Input: ${activeInputName}`))}

${bold(fg("#CCCCCC")("Validation:"))}
Name: ${validateName(nameValue) ? fg("#00FF00")("✓ Valid") : fg("#FF0000")("✗ Invalid (min 2 chars)")}
Email: ${validateEmail(emailValue) ? fg("#00FF00")("✓ Valid") : fg("#FF0000")("✗ Invalid format")}
Password: ${validatePassword(passwordValue) ? fg("#00FF00")("✓ Valid") : fg("#FF0000")("✗ Invalid (min 6 chars)")}

${fg(lastActionColor)(lastActionText)}`

  if (statusDisplay) {
    statusDisplay.fragment = statusText
  }
}

function getInputName(input: InputElement | null): string {
  if (input === nameInput) return "Name"
  if (input === emailInput) return "Email"
  if (input === passwordInput) return "Password"
  if (input === commentInput) return "Comment"
  return "Unknown"
}

function validateName(value: string): boolean {
  return value.length >= 2
}

function validateEmail(value: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(value)
}

function validatePassword(value: string): boolean {
  return value.length >= 6
}

function navigateToInput(index: number): void {
  const currentActive = getActiveInput()
  currentActive?.blur()

  activeInputIndex = Math.max(0, Math.min(index, inputElements.length - 1))
  const newActive = getActiveInput()
  newActive?.focus()

  lastActionText = `Switched to ${getInputName(newActive)} input`
  lastActionColor = "#FFCC00"
  updateDisplays()
}

function cycleBorderStyle(): void {
  const activeInput = getActiveInput()
  if (!activeInput) return

  let currentBorder: BorderStyle | "none" = activeInput.getBorderStyle()
  if (activeInput.getBorder() === false) {
    currentBorder = "none"
  }
  const borderStyles: (BorderStyle | "none")[] = ["single", "double", "rounded", "heavy", "none"]
  const currentIndex = borderStyles.indexOf(currentBorder)
  const nextIndex = (currentIndex + 1) % borderStyles.length

  if (borderStyles[nextIndex] === "none") {
    activeInput.setBorder(false, "single")
  } else {
    activeInput.setBorder(true, borderStyles[nextIndex])
  }
  updateDisplays()
}

function resetInputs(): void {
  nameInput?.setValue("")
  emailInput?.setValue("")
  passwordInput?.setValue("")
  commentInput?.setValue("")

  lastActionText = "All inputs reset to empty values"
  lastActionColor = "#FF00FF"
  updateDisplays()

  setTimeout(() => {
    lastActionColor = "#FFCC00"
    updateDisplays()
  }, 1000)
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

  // Create input elements
  nameInput = new InputElement("name-input", {
    x: 5,
    y: 2,
    width: 40,
    height: 3,
    zIndex: 100,
    backgroundColor: "#001122",
    textColor: "#FFFFFF",
    borderStyle: "single",
    borderColor: "#666666",
    focusedBorderColor: "#00AAFF",
    placeholder: "Enter your name...",
    placeholderColor: "#666666",
    cursorColor: "#FFFF00",
    value: "",
    maxLength: 50,
    title: "Name",
    titleAlignment: "left",
  })

  emailInput = new InputElement("email-input", {
    x: 5,
    y: 6,
    width: 40,
    height: 3,
    zIndex: 100,
    backgroundColor: "#001122",
    textColor: "#FFFFFF",
    borderStyle: "single",
    borderColor: "#666666",
    focusedBorderColor: "#00AAFF",
    placeholder: "Enter your email...",
    placeholderColor: "#666666",
    cursorColor: "#FFFF00",
    value: "",
    maxLength: 100,
    title: "Email",
    titleAlignment: "left",
  })

  passwordInput = new InputElement("password-input", {
    x: 5,
    y: 10,
    width: 40,
    height: 3,
    zIndex: 100,
    backgroundColor: "#001122",
    textColor: "#FFFFFF",
    borderStyle: "single",
    borderColor: "#666666",
    focusedBorderColor: "#00AAFF",
    placeholder: "Enter password...",
    placeholderColor: "#666666",
    cursorColor: "#FFFF00",
    value: "",
    maxLength: 50,
    title: "Password",
    titleAlignment: "left",
  })

  commentInput = new InputElement("comment-input", {
    x: 5,
    y: 14,
    width: 60,
    height: 3,
    zIndex: 100,
    backgroundColor: "#001122",
    textColor: "#FFFFFF",
    borderStyle: "single",
    borderColor: "#666666",
    focusedBorderColor: "#00AAFF",
    placeholder: "Enter a comment...",
    placeholderColor: "#666666",
    cursorColor: "#FFFF00",
    value: "",
    maxLength: 200,
    title: "Comment",
    titleAlignment: "left",
  })

  inputElements.push(nameInput, emailInput, passwordInput, commentInput)

  renderer.add(nameInput)
  renderer.add(emailInput)
  renderer.add(passwordInput)
  renderer.add(commentInput)

  keyLegendDisplay = renderer.createStyledText("key-legend", {
    fragment: t``,
    width: 50,
    height: 12,
    x: 50,
    y: 2,
    zIndex: 50,
    defaultFg: "#AAAAAA",
  })
  parentContainer.add(keyLegendDisplay)

  statusDisplay = renderer.createStyledText("status-display", {
    fragment: t``,
    width: 80,
    height: 18,
    x: 5,
    y: 19,
    zIndex: 50,
  })
  parentContainer.add(statusDisplay)

  // Set up event handlers for all inputs
  inputElements.forEach((input, index) => {
    input.on(InputElementEvents.INPUT, (value: string) => {
      lastActionText = `${getInputName(input)} input: "${value}"`
      lastActionColor = "#00FFFF"
      updateDisplays()
    })

    input.on(InputElementEvents.CHANGE, (value: string) => {
      lastActionText = `*** ${getInputName(input)} CHANGED: "${value}" ***`
      lastActionColor = "#FF00FF"
      updateDisplays()
      setTimeout(() => {
        lastActionColor = "#FFCC00"
        updateDisplays()
      }, 1000)
    })

    input.on(InputElementEvents.ENTER, (value: string) => {
      const inputName = getInputName(input)
      const isValid =
        inputName === "Name"
          ? validateName(value)
          : inputName === "Email"
            ? validateEmail(value)
            : inputName === "Password"
              ? validatePassword(value)
              : true

      lastActionText = `*** ${inputName} SUBMITTED: "${value}" ${isValid ? "(Valid)" : "(Invalid)"} ***`
      lastActionColor = isValid ? "#00FF00" : "#FF0000"
      updateDisplays()
      setTimeout(() => {
        lastActionColor = "#FFCC00"
        updateDisplays()
      }, 1500)
    })

    input.on(InputElementEvents.FOCUSED, () => {
      updateDisplays()
    })

    input.on(InputElementEvents.BLURRED, () => {
      updateDisplays()
    })
  })

  updateDisplays()

  keyboardHandler = (key) => {
    const anyInputFocused = inputElements.some((input) => input.isFocused())

    if (key.name === "tab") {
      if (key.shift) {
        // Navigate backward
        navigateToInput(activeInputIndex - 1)
      } else {
        // Navigate forward
        navigateToInput(activeInputIndex + 1)
      }
    } else if (key.ctrl && key.name === "f") {
      // Only respond to Ctrl+F for focus toggle
      const activeInput = getActiveInput()
      if (activeInput?.isFocused()) {
        activeInput.blur()
        lastActionText = `Focus removed from ${getInputName(activeInput)} input`
      } else {
        activeInput?.focus()
        lastActionText = `${getInputName(activeInput)} input focused`
      }
      lastActionColor = "#FFCC00"
      updateDisplays()
    } else if (key.ctrl && key.name === "c") {
      // Only respond to Ctrl+C for clear
      const activeInput = getActiveInput()
      if (activeInput) {
        activeInput.setValue("")
        lastActionText = `${getInputName(activeInput)} input cleared`
        lastActionColor = "#FFAA00"
        updateDisplays()
      }
    } else if (key.ctrl && key.name === "b") {
      // Only respond to Ctrl+B for border style
      cycleBorderStyle()
      lastActionText = `Border style changed`
      lastActionColor = "#FFCC00"
      updateDisplays()
    } else if (key.ctrl && key.name === "r") {
      // Only respond to Ctrl+R for reset
      resetInputs()
    }
  }

  getKeyHandler().on("keypress", keyboardHandler)
  nameInput.focus()
}

export function destroy(rendererInstance: CliRenderer): void {
  if (keyboardHandler) {
    getKeyHandler().off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  inputElements.forEach((input) => {
    if (input) {
      rendererInstance.remove(input.id)
      input.destroy()
    }
  })
  inputElements.length = 0

  rendererInstance.remove("parent-container")

  nameInput = null
  emailInput = null
  passwordInput = null
  commentInput = null
  keyLegendDisplay = null
  statusDisplay = null
  renderer = null
  activeInputIndex = 0
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
  renderer.start()
}
