import { describe, expect, it, afterAll } from "bun:test"
import { InputRenderable, type InputRenderableOptions, InputRenderableEvents } from "./Input"
import { createTestRenderer } from "../testing/test-renderer"
import type { KeyEvent } from "../lib/KeyHandler"

const { renderer, mockInput } = await createTestRenderer({})

function createInputRenderable(options: InputRenderableOptions): { input: InputRenderable; root: any } {
  if (!renderer) {
    throw new Error("Renderer not initialized")
  }

  const inputRenderable = new InputRenderable(renderer, options)
  renderer.root.add(inputRenderable)
  renderer.requestRender()

  return { input: inputRenderable, root: renderer.root }
}

describe("InputRenderable", () => {
  afterAll(() => {
    if (renderer) {
      renderer.destroy()
    }
  })

  describe("Initialization", () => {
    it("should initialize properly with default options", () => {
      const { input, root } = createInputRenderable({ width: 20, height: 1 })

      expect(input.x).toBeDefined()
      expect(input.y).toBeDefined()
      expect(input.width).toBeGreaterThan(0)
      expect(input.height).toBeGreaterThan(0)
      expect(input.value).toBe("")
      expect(input.focusable).toBe(true)
    })

    it("should initialize with custom options", () => {
      const { input } = createInputRenderable({
        value: "test",
        placeholder: "Enter text",
        maxLength: 50,
      })

      expect(input.value).toBe("test")
      expect(input.focusable).toBe(true)
    })
  })

  describe("Focus Management", () => {
    it("should handle focus and blur correctly", () => {
      const { input } = createInputRenderable({
        value: "test",
      })

      expect(input.focused).toBe(false)

      input.focus()
      expect(input.focused).toBe(true)

      input.blur()
      expect(input.focused).toBe(false)
    })

    it("should emit change event on blur if value changed", () => {
      const { input } = createInputRenderable({
        value: "initial",
      })

      let changeEventFired = false
      let changeValue = ""

      input.on(InputRenderableEvents.CHANGE, (value: string) => {
        changeEventFired = true
        changeValue = value
      })

      input.focus()
      input.value = "modified"

      // Change event should not fire during focus
      expect(changeEventFired).toBe(false)

      input.blur()

      // Change event should fire on blur
      expect(changeEventFired).toBe(true)
      expect(changeValue).toBe("modified")
    })

    it("should not emit change event on blur if value unchanged", () => {
      const { input } = createInputRenderable({
        value: "unchanged",
      })

      let changeEventFired = false

      input.on(InputRenderableEvents.CHANGE, () => {
        changeEventFired = true
      })

      input.focus()
      // Value remains the same
      input.blur()

      expect(changeEventFired).toBe(false)
    })
  })

  describe("Single Input Key Handling", () => {
    it("should handle text input when focused", () => {
      const { input } = createInputRenderable({ width: 20, height: 1 })

      input.focus()

      let inputEventFired = false
      let inputValue = ""

      input.on(InputRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      // Simulate typing "hello"
      mockInput.pressKey("h")
      expect(input.value).toBe("h")
      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("h")

      mockInput.pressKey("e")
      expect(input.value).toBe("he")

      mockInput.pressKey("l")
      expect(input.value).toBe("hel")

      mockInput.pressKey("l")
      expect(input.value).toBe("hell")

      mockInput.pressKey("o")
      expect(input.value).toBe("hello")
    })

    it("should not handle key events when not focused", () => {
      const { input } = createInputRenderable({ width: 20, height: 1 })

      // Don't focus the input
      expect(input.focused).toBe(false)

      let inputEventFired = false

      input.on(InputRenderableEvents.INPUT, () => {
        inputEventFired = true
      })

      // Simulate key event through stdin - should be ignored since not focused
      mockInput.pressKey("a")
      expect(input.value).toBe("")
      expect(inputEventFired).toBe(false)
    })

    it("should handle backspace correctly", () => {
      const { input } = createInputRenderable({
        value: "hello",
      })

      input.focus()

      mockInput.pressBackspace()
      expect(input.value).toBe("hell")

      mockInput.pressBackspace()
      expect(input.value).toBe("hel")
    })

    it("should handle delete correctly", () => {
      const { input } = createInputRenderable({
        value: "hello",
        width: 20,
        height: 1,
      })

      input.focus()
      input.cursorPosition = 1 // Move cursor after 'e'

      mockInput.pressKey("DELETE")
      expect(input.value).toBe("hllo")
    })

    it("should handle arrow keys for cursor movement", () => {
      const { input } = createInputRenderable({
        value: "hello",
      })

      input.focus()
      expect(input.cursorPosition).toBe(5) // Should be at end

      mockInput.pressArrow("left")
      expect(input.cursorPosition).toBe(4)

      mockInput.pressArrow("left")
      expect(input.cursorPosition).toBe(3)

      mockInput.pressArrow("right")
      expect(input.cursorPosition).toBe(4)

      mockInput.pressKey("HOME")
      expect(input.cursorPosition).toBe(0)

      mockInput.pressKey("END")
      expect(input.cursorPosition).toBe(5)
    })

    it("should handle enter key", () => {
      const { input } = createInputRenderable({
        value: "test input",
      })

      input.focus()

      let enterEventFired = false
      let enterValue = ""

      input.on(InputRenderableEvents.ENTER, (value: string) => {
        enterEventFired = true
        enterValue = value
      })

      mockInput.pressEnter()
      expect(enterEventFired).toBe(true)
      expect(enterValue).toBe("test input")
    })

    it("should respect maxLength", () => {
      const { input } = createInputRenderable({
        maxLength: 3,
      })

      input.focus()

      mockInput.pressKey("a")
      expect(input.value).toBe("a")

      mockInput.pressKey("b")
      expect(input.value).toBe("ab")

      mockInput.pressKey("c")
      expect(input.value).toBe("abc")

      // This should be ignored
      mockInput.pressKey("d")
      expect(input.value).toBe("abc")
    })

    it("should handle cursor position with text insertion", () => {
      const { input } = createInputRenderable({
        value: "hello",
      })

      input.focus()
      input.cursorPosition = 2 // Position after 'l'

      mockInput.pressKey("x")
      expect(input.value).toBe("hexllo")
      expect(input.cursorPosition).toBe(3)
    })

    it("should handle onPaste option", () => {
      let pasteText = ""
      let pasteCalled = false

      const { input } = createInputRenderable({
        width: 20,
        height: 1,
        onPaste: (text: string) => {
          pasteText = text
          pasteCalled = true
        },
      })

      input.focus()

      mockInput.pasteBracketedText("pasted text")
      // NOTE: The input itself does not automatically insert the pasted text for now,
      // as the whole InputRenderable will get replaced by and EditBuffer that handles it
      expect(input.value).toBe("")
      expect(pasteCalled).toBe(true)
      expect(pasteText).toBe("pasted text")
    })
  })

  describe("Multiple Input Focus Management", () => {
    it("should allow only one input to be focused at a time", () => {
      const { input: input1 } = createInputRenderable({
        value: "first",
      })

      const { input: input2 } = createInputRenderable({
        value: "second",
      })

      // Initially neither should be focused
      expect(input1.focused).toBe(false)
      expect(input2.focused).toBe(false)

      // Focus first input
      input1.focus()
      expect(input1.focused).toBe(true)
      expect(input2.focused).toBe(false)

      // Focus second input - first should lose focus
      input2.focus()
      expect(input1.focused).toBe(false)
      expect(input2.focused).toBe(true)
    })

    it("should only handle key events for focused input", () => {
      const { input: input1 } = createInputRenderable({
        value: "first",
      })

      const { input: input2 } = createInputRenderable({
        value: "second",
      })

      let input1EventFired = false
      let input2EventFired = false

      input1.on(InputRenderableEvents.INPUT, () => {
        input1EventFired = true
      })

      input2.on(InputRenderableEvents.INPUT, () => {
        input2EventFired = true
      })

      // Focus first input
      input1.focus()

      // Send key event through stdin - only focused input1 should handle it
      mockInput.pressKey("a")

      expect(input1EventFired).toBe(true)
      expect(input2EventFired).toBe(false)
      expect(input1.value).toBe("firsta")
      expect(input2.value).toBe("second")

      // Switch focus to input2
      input2.focus()

      // Reset flags
      input1EventFired = false
      input2EventFired = false

      // Send key event through stdin - only focused input2 should handle it
      mockInput.pressKey("b")

      expect(input1EventFired).toBe(false)
      expect(input2EventFired).toBe(true)
      expect(input1.value).toBe("firsta")
      expect(input2.value).toBe("secondb")
    })

    it("should handle focus switching with blur events", () => {
      const { input: input1 } = createInputRenderable({
        value: "first",
      })

      const { input: input2 } = createInputRenderable({
        value: "second",
      })

      let input1ChangeFired = false
      let input2ChangeFired = false

      input1.on(InputRenderableEvents.CHANGE, () => {
        input1ChangeFired = true
      })

      input2.on(InputRenderableEvents.CHANGE, () => {
        input2ChangeFired = true
      })

      // Focus input1 and modify value
      input1.focus()
      mockInput.pressKey("x")

      // Switch to input2 - should trigger change event for input1
      input2.focus()

      expect(input1ChangeFired).toBe(true)
      expect(input2ChangeFired).toBe(false)
      expect(input1.focused).toBe(false)
      expect(input2.focused).toBe(true)
    })

    it("should handle rapid focus switching", () => {
      const { input: input1 } = createInputRenderable({
        value: "first",
      })

      const { input: input2 } = createInputRenderable({
        value: "second",
      })

      const { input: input3 } = createInputRenderable({
        value: "third",
      })

      // Rapid focus switching
      input1.focus()
      expect(input1.focused).toBe(true)
      expect(input2.focused).toBe(false)
      expect(input3.focused).toBe(false)

      input2.focus()
      expect(input1.focused).toBe(false)
      expect(input2.focused).toBe(true)
      expect(input3.focused).toBe(false)

      input3.focus()
      expect(input1.focused).toBe(false)
      expect(input2.focused).toBe(false)
      expect(input3.focused).toBe(true)

      input1.focus()
      expect(input1.focused).toBe(true)
      expect(input2.focused).toBe(false)
      expect(input3.focused).toBe(false)
    })

    it("should prevent multiple inputs from being focused simultaneously", () => {
      const { input: input1 } = createInputRenderable({
        value: "first",
      })

      const { input: input2 } = createInputRenderable({
        value: "second",
      })

      const { input: input3 } = createInputRenderable({
        value: "third",
      })

      // Focus all three in sequence
      input1.focus()
      input2.focus()
      input3.focus()

      // Only the last focused input should be focused
      expect(input1.focused).toBe(false)
      expect(input2.focused).toBe(false)
      expect(input3.focused).toBe(true)

      // Focus input1 again
      input1.focus()

      expect(input1.focused).toBe(true)
      expect(input2.focused).toBe(false)
      expect(input3.focused).toBe(false)
    })
  })

  describe("Input Value Management", () => {
    it("should handle value setting programmatically", () => {
      const { input } = createInputRenderable({ width: 20, height: 1 })

      input.value = "programmatic"
      expect(input.value).toBe("programmatic")

      // Cursor position should be clamped to current position (0) since value changed
      expect(input.cursorPosition).toBe(0)
    })

    it("should handle value changes with cursor position preservation", () => {
      const { input } = createInputRenderable({
        value: "hello",
      })

      input.focus()
      input.cursorPosition = 2

      input.value = "world"
      expect(input.value).toBe("world")
      expect(input.cursorPosition).toBe(2) // Cursor should be clamped
    })

    it("should handle empty value setting", () => {
      const { input } = createInputRenderable({
        value: "not empty",
      })

      input.value = ""
      expect(input.value).toBe("")
      expect(input.cursorPosition).toBe(0)
    })

    it("should emit input events when value changes programmatically", () => {
      const { input } = createInputRenderable({ width: 20, height: 1 })

      let inputEventFired = false
      let inputValue = ""

      input.on(InputRenderableEvents.INPUT, (value: string) => {
        inputEventFired = true
        inputValue = value
      })

      input.value = "changed"

      expect(inputEventFired).toBe(true)
      expect(inputValue).toBe("changed")
    })
  })

  describe("Input Properties", () => {
    it("should handle maxLength changes", () => {
      const { input } = createInputRenderable({
        value: "verylongtext",
        maxLength: 20,
      })

      expect(input.value).toBe("verylongtext")

      // Reduce maxLength - should truncate existing value
      input.maxLength = 5
      expect(input.value).toBe("veryl")
    })

    it("should handle placeholder changes", () => {
      const { input } = createInputRenderable({
        placeholder: "old placeholder",
      })

      input.placeholder = "new placeholder"
      // Placeholder change should trigger render request
      expect(input).toBeDefined()
    })

    it("should handle color property changes", () => {
      const { input } = createInputRenderable({ width: 20, height: 1 })

      input.backgroundColor = "#ff0000"
      input.textColor = "#00ff00"
      input.focusedBackgroundColor = "#0000ff"
      input.focusedTextColor = "#ffff00"
      input.placeholderColor = "#ff00ff"
      input.cursorColor = "#00ffff"

      // Color changes should trigger render requests
      expect(input).toBeDefined()
    })
  })

  describe("Global Key Event Prevention", () => {
    it("should not handle key events when preventDefault is called by global handler", () => {
      const { input } = createInputRenderable({
        width: 20,
        height: 1,
        value: "initial",
      })

      let globalHandlerCalled = false
      let inputEventFired = false

      // Register global handler that prevents 'a' key
      renderer.keyInput.on("keypress", (key: KeyEvent) => {
        globalHandlerCalled = true
        if (key.name === "a") {
          key.preventDefault()
        }
      })

      input.on(InputRenderableEvents.INPUT, () => {
        inputEventFired = true
      })

      input.focus()
      expect(input.focused).toBe(true)

      // Press 'a' - should be prevented
      mockInput.pressKey("a")
      expect(globalHandlerCalled).toBe(true)
      expect(inputEventFired).toBe(false)
      expect(input.value).toBe("initial") // Value should not change

      // Reset flags
      globalHandlerCalled = false
      inputEventFired = false

      // Press 'b' - should not be prevented
      mockInput.pressKey("b")
      expect(globalHandlerCalled).toBe(true)
      expect(inputEventFired).toBe(true)
      expect(input.value).toBe("initialb") // Value should change

      // Clean up
      renderer.keyInput.removeAllListeners("keypress")
    })

    it("should handle multiple global handlers with preventDefault", () => {
      const { input } = createInputRenderable({
        width: 20,
        height: 1,
      })

      let firstHandlerCalled = false
      let secondHandlerCalled = false
      let inputEventFired = false

      // First global handler prevents 'x'
      const firstHandler = (key: KeyEvent) => {
        firstHandlerCalled = true
        if (key.name === "x") {
          key.preventDefault()
        }
      }

      // Second global handler should not run for 'x' if first prevents it
      const secondHandler = (key: KeyEvent) => {
        secondHandlerCalled = true
      }

      renderer.keyInput.on("keypress", firstHandler)
      renderer.keyInput.on("keypress", secondHandler)

      input.on(InputRenderableEvents.INPUT, () => {
        inputEventFired = true
      })

      input.focus()

      // Press 'x' - should be prevented by first handler
      mockInput.pressKey("x")
      expect(firstHandlerCalled).toBe(true)
      expect(secondHandlerCalled).toBe(true) // EventEmitter still calls all handlers
      expect(inputEventFired).toBe(false) // But input should not process it
      expect(input.value).toBe("")

      // Clean up
      renderer.keyInput.removeListener("keypress", firstHandler)
      renderer.keyInput.removeListener("keypress", secondHandler)
    })

    it("should respect preventDefault from global handler registered AFTER input focus", () => {
      const { input } = createInputRenderable({
        width: 20,
        height: 1,
        value: "initial",
      })

      let globalHandlerCalled = false
      let inputEventFired = false

      input.on(InputRenderableEvents.INPUT, () => {
        inputEventFired = true
      })

      // Focus the input FIRST
      input.focus()
      expect(input.focused).toBe(true)

      // Type 'a' before global handler exists - should work
      mockInput.pressKey("a")
      expect(input.value).toBe("initiala")
      expect(inputEventFired).toBe(true)

      // Reset flag
      inputEventFired = false

      // NOW register a global handler that prevents 'b' key
      const globalHandler = (key: KeyEvent) => {
        globalHandlerCalled = true
        if (key.name === "b") {
          key.preventDefault()
        }
      }
      renderer.keyInput.on("keypress", globalHandler)

      // Press 'b' - should be prevented even though handler was added after focus
      mockInput.pressKey("b")
      expect(globalHandlerCalled).toBe(true)
      expect(inputEventFired).toBe(false)
      expect(input.value).toBe("initiala") // Value should not change

      // Reset flags
      globalHandlerCalled = false
      inputEventFired = false

      // Press 'c' - should not be prevented
      mockInput.pressKey("c")
      expect(globalHandlerCalled).toBe(true)
      expect(inputEventFired).toBe(true)
      expect(input.value).toBe("initialac") // Value should change

      // Clean up
      renderer.keyInput.removeListener("keypress", globalHandler)
    })

    it("should handle dynamic preventDefault conditions", () => {
      const { input } = createInputRenderable({
        width: 20,
        height: 1,
        value: "",
      })

      let preventNumbers = false
      let inputEventFired = false

      // Register handler that can dynamically change what it prevents
      const dynamicHandler = (key: KeyEvent) => {
        if (preventNumbers && /^[0-9]$/.test(key.name)) {
          key.preventDefault()
        }
      }

      renderer.keyInput.on("keypress", dynamicHandler)

      input.on(InputRenderableEvents.INPUT, () => {
        inputEventFired = true
      })

      input.focus()

      // Initially allow numbers
      mockInput.pressKey("1")
      expect(input.value).toBe("1")
      expect(inputEventFired).toBe(true)

      // Enable number prevention
      preventNumbers = true
      inputEventFired = false

      // Now numbers should be prevented
      mockInput.pressKey("2")
      expect(input.value).toBe("1") // Should not change
      expect(inputEventFired).toBe(false)

      // Letters should still work
      inputEventFired = false
      mockInput.pressKey("a")
      expect(input.value).toBe("1a")
      expect(inputEventFired).toBe(true)

      // Disable prevention again
      preventNumbers = false
      inputEventFired = false

      // Numbers should work again
      mockInput.pressKey("3")
      expect(input.value).toBe("1a3")
      expect(inputEventFired).toBe(true)

      // Clean up
      renderer.keyInput.removeListener("keypress", dynamicHandler)
    })
  })

  it("should respect preventDefault from onKeyDown handler", () => {
    const { input } = createInputRenderable({
      width: 20,
      height: 1,
      value: "initial",
    })

    let onKeyDownCalled = false
    let inputEventFired = false

    input.onKeyDown = (key: KeyEvent) => {
      onKeyDownCalled = true
      if (key.name === "a") {
        key.preventDefault()
      }
    }

    input.on(InputRenderableEvents.INPUT, () => {
      inputEventFired = true
    })

    input.focus()

    mockInput.pressKey("a")
    expect(onKeyDownCalled).toBe(true)
    expect(inputEventFired).toBe(false)
    expect(input.value).toBe("initial")

    onKeyDownCalled = false
    inputEventFired = false

    mockInput.pressKey("b")
    expect(onKeyDownCalled).toBe(true)
    expect(inputEventFired).toBe(true)
    expect(input.value).toBe("initialb")
  })

  describe("Edge Cases", () => {
    it("should handle non-printable characters", () => {
      const { input } = createInputRenderable({ width: 20, height: 1 })

      input.focus()

      // Non-printable character should be ignored
      mockInput.pressTab()
      expect(input.value).toBe("")

      // Control character should be ignored
      mockInput.pressKey("a", { ctrl: true })
      expect(input.value).toBe("")
    })

    it("should handle cursor movement at boundaries", () => {
      const { input } = createInputRenderable({
        value: "hi",
      })

      input.focus()

      // Move cursor to start
      input.cursorPosition = 0
      mockInput.pressArrow("left")
      expect(input.cursorPosition).toBe(0) // Should not go below 0

      // Move cursor to end
      input.cursorPosition = 2
      mockInput.pressArrow("right")
      expect(input.cursorPosition).toBe(2) // Should not go beyond length
    })

    it("should handle backspace at start of input", () => {
      const { input } = createInputRenderable({
        value: "hi",
      })

      input.focus()
      input.cursorPosition = 0

      // Backspace at start should do nothing
      mockInput.pressBackspace()
      expect(input.value).toBe("hi")
      expect(input.cursorPosition).toBe(0)
    })

    it("should handle delete at end of input", () => {
      const { input } = createInputRenderable({
        value: "hi",
      })

      input.focus()
      input.cursorPosition = 2

      // Delete at end should do nothing
      mockInput.pressKey("DELETE")
      expect(input.value).toBe("hi")
      expect(input.cursorPosition).toBe(2)
    })

    it("should handle empty input operations", () => {
      const { input } = createInputRenderable({
        value: "",
      })

      input.focus()

      // Operations on empty input should be safe
      mockInput.pressBackspace()
      expect(input.value).toBe("")
      expect(input.cursorPosition).toBe(0)

      mockInput.pressKey("DELETE")
      expect(input.value).toBe("")
      expect(input.cursorPosition).toBe(0)

      mockInput.pressArrow("left")
      expect(input.cursorPosition).toBe(0)

      mockInput.pressArrow("right")
      expect(input.cursorPosition).toBe(0)
    })
  })
})
