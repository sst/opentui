// Accessibility Demo for OpenTUI
// Demonstrates how to use accessibility properties for screen reader support

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  type CliRenderer,
  type KeyEvent,
} from "../index"
import { getAccessibilityManager } from "../lib/AccessibilityManager"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let container: BoxRenderable | null = null
let progressLabel: TextRenderable | null = null
let nameInput: InputRenderable | null = null
let emailInput: InputRenderable | null = null
let keyboardHandler: ((key: KeyEvent) => void) | null = null

const inputElements: InputRenderable[] = []
let activeInputIndex = 0

function navigateToInput(index: number): void {
  const currentActive = inputElements[activeInputIndex]
  currentActive?.blur()

  activeInputIndex = Math.max(0, Math.min(index, inputElements.length - 1))
  const newActive = inputElements[activeInputIndex]
  newActive?.focus()

  // Notify accessibility manager of focus change
  const accessibility = getAccessibilityManager()
  if (newActive) {
    accessibility.setFocused(newActive)
  }
}

export function run(renderer: CliRenderer): void {
  renderer.setBackgroundColor("#001122")

  // Enable accessibility support
  const accessibility = getAccessibilityManager()
  accessibility.setEnabled(true)

  // Main container
  container = new BoxRenderable(renderer, {
    id: "accessibility-container",
    zIndex: 10,
  })

  // Header
  const header = new TextRenderable(renderer, {
    content: "🔊 Accessibility Demo",
    position: "absolute",
    left: 2,
    top: 1,
    accessibilityRole: "text",
    accessibilityLabel: "Page Header: Accessibility Demo",
  })
  container.add(header)

  // Description
  const description = new TextRenderable(renderer, {
    content: "This demo showcases accessibility properties for screen readers.",
    position: "absolute",
    left: 2,
    top: 2,
    accessibilityRole: "text",
  })
  container.add(description)

  // Section header
  const sectionHeader = new TextRenderable(renderer, {
    content: "Interactive Controls:",
    position: "absolute",
    left: 2,
    top: 4,
    accessibilityRole: "text",
  })
  container.add(sectionHeader)

  // Name label and input
  const nameLabel = new TextRenderable(renderer, {
    content: "Name:",
    position: "absolute",
    left: 2,
    top: 6,
    accessibilityRole: "text",
  })
  container.add(nameLabel)

  nameInput = new InputRenderable(renderer, {
    id: "name-input",
    position: "absolute",
    left: 10,
    top: 6,
    width: 40,
    height: 1,
    backgroundColor: "#002244",
    textColor: "#FFFFFF",
    placeholder: "Enter your name...",
    placeholderColor: "#666666",
    cursorColor: "#FFFF00",
    accessibilityRole: "input",
    accessibilityLabel: "Name input field",
    accessibilityHint: "Type your full name here",
  })
  container.add(nameInput)
  inputElements.push(nameInput)

  // Email label and input
  const emailLabel = new TextRenderable(renderer, {
    content: "Email:",
    position: "absolute",
    left: 2,
    top: 8,
    accessibilityRole: "text",
  })
  container.add(emailLabel)

  emailInput = new InputRenderable(renderer, {
    id: "email-input",
    position: "absolute",
    left: 10,
    top: 8,
    width: 40,
    height: 1,
    backgroundColor: "#002244",
    textColor: "#FFFFFF",
    placeholder: "Enter your email...",
    placeholderColor: "#666666",
    cursorColor: "#FFFF00",
    accessibilityRole: "input",
    accessibilityLabel: "Email input field",
    accessibilityHint: "Type your email address here",
  })
  container.add(emailInput)
  inputElements.push(emailInput)

  // Buttons
  const submitButton = new TextRenderable(renderer, {
    content: "[Submit]",
    position: "absolute",
    left: 2,
    top: 10,
    accessibilityRole: "button",
    accessibilityLabel: "Submit Form",
    accessibilityHint: "Press Enter to submit",
  })
  container.add(submitButton)

  const cancelButton = new TextRenderable(renderer, {
    content: "[Cancel]",
    position: "absolute",
    left: 12,
    top: 10,
    accessibilityRole: "button",
    accessibilityLabel: "Cancel",
    accessibilityHint: "Press Escape to cancel",
  })
  container.add(cancelButton)

  // Progress
  progressLabel = new TextRenderable(renderer, {
    content: "Form Completion: 0%",
    position: "absolute",
    left: 2,
    top: 12,
    accessibilityRole: "text",
    accessibilityLabel: "Form completion progress",
    accessibilityValue: "0 percent",
    accessibilityLive: "polite",
  })
  container.add(progressLabel)

  // Instructions
  const instructions = new TextRenderable(renderer, {
    content: "Press Tab to navigate, Enter to submit, Escape to exit",
    position: "absolute",
    left: 2,
    top: 14,
    fg: "#888888",
    accessibilityRole: "text",
    accessibilityLive: "off",
  })
  container.add(instructions)

  // Update progress when inputs change
  let filledFields = 0
  const updateProgress = () => {
    const percentage = Math.round((filledFields / 2) * 100)
    if (progressLabel) {
      progressLabel.content = `Form Completion: ${percentage}%`
      progressLabel.accessibilityValue = `${percentage} percent`
    }

    if (percentage === 100) {
      accessibility.announce("Form is complete! You can now submit.", "polite")
    }
  }

  nameInput.on("change", () => {
    const hasValue = nameInput!.value.length > 0
    filledFields = hasValue ? filledFields + 1 : Math.max(0, filledFields - 1)
    updateProgress()
  })

  emailInput.on("change", () => {
    const hasValue = emailInput!.value.length > 0
    filledFields = hasValue ? filledFields + 1 : Math.max(0, filledFields - 1)
    updateProgress()
  })

  // Keyboard handling
  keyboardHandler = (key: KeyEvent) => {
    if (key.name === "tab") {
      if (key.shift) {
        navigateToInput(activeInputIndex - 1)
      } else {
        navigateToInput(activeInputIndex + 1)
      }
    } else if (key.name === "return" || key.name === "enter") {
      // Form submitted - announce to screen reader
      accessibility.announce("Form submitted successfully!", "assertive")
    } else if (key.name === "escape") {
      process.exit(0)
    }
  }

  renderer.keyInput.on("keypress", keyboardHandler)
  renderer.root.add(container)

  // Focus first input and announce for accessibility
  nameInput.focus()
  accessibility.setFocused(nameInput)
}

export function destroy(renderer: CliRenderer): void {
  if (keyboardHandler) {
    renderer.keyInput.off("keypress", keyboardHandler)
    keyboardHandler = null
  }
  container?.destroyRecursively()
  container = null
  progressLabel = null
  nameInput = null
  emailInput = null
  inputElements.length = 0
  activeInputIndex = 0
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    targetFps: 30,
    exitOnCtrlC: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
