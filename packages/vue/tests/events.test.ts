import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { defineComponent, h, ref } from "vue"
import { testRender } from "../src/test-utils"
import { createSpy } from "@opentui/core/testing"
import type { PasteEvent } from "@opentui/core"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Vue Renderer | Event Tests", () => {
  beforeEach(async () => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  describe("Input Events", () => {
    it("should handle input onInput events", async () => {
      const onInputSpy = createSpy()
      const value = ref("")

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Input", {
                focused: true,
                onInput: (val: string) => {
                  onInputSpy(val)
                  value.value = val
                },
              }),
              h("Text", { content: `Value: ${value.value}` }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      await testSetup.mockInput.typeText("hello")

      expect(onInputSpy.callCount()).toBe(5)
      expect(onInputSpy.calls[0]?.[0]).toBe("h")
      expect(onInputSpy.calls[4]?.[0]).toBe("hello")
      expect(value.value).toBe("hello")
    })

    it("should handle input onSubmit events", async () => {
      const onSubmitSpy = createSpy()
      const submittedValue = ref("")

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Input", {
                focused: true,
                onInput: (val: string) => {
                  submittedValue.value = val
                },
                onSubmit: (val: string) => onSubmitSpy(val),
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      await testSetup.mockInput.typeText("test input")
      testSetup.mockInput.pressEnter()

      expect(onSubmitSpy.callCount()).toBe(1)
      expect(onSubmitSpy.calls[0]?.[0]).toBe("test input")
      expect(submittedValue.value).toBe("test input")
    })

    it("should handle input onChange events on blur", async () => {
      const onChangeSpy = createSpy()

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Input", {
                id: "input",
                focused: true,
                onChange: (val: string) => onChangeSpy(val),
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      await testSetup.mockInput.typeText("test")
      expect(onChangeSpy.callCount()).toBe(0)

      const input = testSetup.renderer.root.findDescendantById("input")
      input?.blur()
      expect(onChangeSpy.callCount()).toBe(1)
      expect(onChangeSpy.calls[0]?.[0]).toBe("test")
    })

    it("should handle event handler attachment", async () => {
      const inputSpy = createSpy()

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Input", {
                focused: true,
                onInput: inputSpy,
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      await testSetup.mockInput.typeText("test")

      expect(inputSpy.callCount()).toBe(4)
      expect(inputSpy.calls[0]?.[0]).toBe("t")
      expect(inputSpy.calls[3]?.[0]).toBe("test")
    })
  })

  describe("Select Events", () => {
    it("should handle select onChange events", async () => {
      const onChangeSpy = createSpy()
      const selectedIndex = ref(0)

      const options = [
        { name: "Option 1", value: 1, description: "First option" },
        { name: "Option 2", value: 2, description: "Second option" },
        { name: "Option 3", value: 3, description: "Third option" },
      ]

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Select", {
                focused: true,
                options,
                onChange: (index: number, option: (typeof options)[0]) => {
                  onChangeSpy(index, option)
                  selectedIndex.value = index
                },
              }),
              h("Text", { content: `Selected: ${selectedIndex.value}` }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 10 })

      testSetup.mockInput.pressArrow("down")

      expect(onChangeSpy.callCount()).toBe(1)
      expect(onChangeSpy.calls[0]?.[0]).toBe(1)
      expect(onChangeSpy.calls[0]?.[1]).toEqual(options[1])
      expect(selectedIndex.value).toBe(1)
    })

    it("should handle select onSelect events", async () => {
      const onSelectSpy = createSpy()

      const options = [
        { name: "Option 1", value: "opt1", description: "First option" },
        { name: "Option 2", value: "opt2", description: "Second option" },
      ]

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Select", {
                focused: true,
                options,
                onSelect: (index: number, option: (typeof options)[0]) => {
                  onSelectSpy(index, option)
                },
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 10 })

      // Navigate to second option
      testSetup.mockInput.pressArrow("down")
      // Select it
      testSetup.mockInput.pressEnter()

      expect(onSelectSpy.callCount()).toBe(1)
      expect(onSelectSpy.calls[0]?.[0]).toBe(1)
      expect(onSelectSpy.calls[0]?.[1]?.value).toBe("opt2")
    })

    it("should handle keyboard navigation on select components", async () => {
      const changeSpy = createSpy()
      const selectedValue = ref("")

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Select", {
                focused: true,
                options: [
                  { name: "Option 1", value: "opt1", description: "First option" },
                  { name: "Option 2", value: "opt2", description: "Second option" },
                  { name: "Option 3", value: "opt3", description: "Third option" },
                ],
                onChange: (index: number, option: { value: string }) => {
                  changeSpy(index, option)
                  selectedValue.value = option?.value || ""
                },
              }),
              h("Text", { content: `Selected: ${selectedValue.value}` }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 25, height: 10 })

      testSetup.mockInput.pressArrow("down")

      expect(changeSpy.callCount()).toBe(1)
      expect(changeSpy.calls[0]?.[0]).toBe(1)
      expect(changeSpy.calls[0]?.[1]?.value).toBe("opt2")
      expect(selectedValue.value).toBe("opt2")

      testSetup.mockInput.pressArrow("down")

      expect(changeSpy.callCount()).toBe(2)
      expect(changeSpy.calls[1]?.[0]).toBe(2)
      expect(changeSpy.calls[1]?.[1]?.value).toBe("opt3")
      expect(selectedValue.value).toBe("opt3")
    })
  })

  describe("TabSelect Events", () => {
    it("should handle tab-select onSelect events", async () => {
      const onSelectSpy = createSpy()
      const activeTab = ref(0)

      const tabs = [{ title: "Tab 1" }, { title: "Tab 2" }, { title: "Tab 3" }]

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("tab-select", {
                focused: true,
                options: tabs.map((tab, index) => ({
                  name: tab.title,
                  value: index,
                  description: "",
                })),
                onSelect: (index: number) => {
                  onSelectSpy(index)
                  activeTab.value = index
                },
              }),
              h("Text", { content: `Active tab: ${activeTab.value}` }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 40, height: 8 })

      testSetup.mockInput.pressArrow("right")
      testSetup.mockInput.pressArrow("right")
      testSetup.mockInput.pressEnter()

      expect(onSelectSpy.callCount()).toBe(1)
      expect(onSelectSpy.calls[0]?.[0]).toBe(2)
      expect(activeTab.value).toBe(2)
    })

    it("should handle tabSelect onChange events", async () => {
      const onChangeSpy = createSpy()

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("tab-select", {
                focused: true,
                options: [
                  { name: "Tab 1", value: 0, description: "" },
                  { name: "Tab 2", value: 1, description: "" },
                ],
                onChange: (index: number) => {
                  onChangeSpy(index)
                },
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 40, height: 8 })

      testSetup.mockInput.pressArrow("right")

      expect(onChangeSpy.callCount()).toBe(1)
      expect(onChangeSpy.calls[0]?.[0]).toBe(1)
    })
  })

  describe("Focus Management", () => {
    it("should handle focus management between inputs", async () => {
      const input1Spy = createSpy()
      const input2Spy = createSpy()
      const input1Focused = ref(true)
      const input2Focused = ref(false)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Input", {
                focused: input1Focused.value,
                onInput: input1Spy,
              }),
              h("Input", {
                focused: input2Focused.value,
                onInput: input2Spy,
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 8 })

      await testSetup.mockInput.typeText("first")

      expect(input1Spy.callCount()).toBe(5)
      expect(input2Spy.callCount()).toBe(0)

      // Switch focus
      input1Focused.value = false
      input2Focused.value = true

      input1Spy.reset()
      input2Spy.reset()

      await testSetup.mockInput.typeText("second")

      expect(input1Spy.callCount()).toBe(0)
      expect(input2Spy.callCount()).toBe(6)
    })
  })

  describe("Textarea Events", () => {
    it("should handle textarea onSubmit events", async () => {
      const onSubmitSpy = createSpy()

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Textarea", {
                focused: true,
                initialValue: "test content",
                onSubmit: () => onSubmitSpy(),
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      testSetup.mockInput.pressKey("RETURN", { meta: true })
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onSubmitSpy.callCount()).toBe(1)
    })

    it("should handle textarea onContentChange events", async () => {
      const onContentChangeSpy = createSpy()

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Textarea", {
                focused: true,
                initialValue: "",
                onContentChange: (content: string) => onContentChangeSpy(content),
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      await testSetup.mockInput.typeText("hello")

      expect(onContentChangeSpy.callCount()).toBeGreaterThan(0)
    })
  })

  describe("Global preventDefault", () => {
    it("should handle global preventDefault for keyboard events", async () => {
      const inputSpy = createSpy()
      const globalHandlerSpy = createSpy()

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Input", {
                focused: true,
                onInput: inputSpy,
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      // Register global handler that prevents 'a' key
      testSetup.renderer.keyInput.on("keypress", (event) => {
        globalHandlerSpy(event.name)
        if (event.name === "a") {
          event.preventDefault()
        }
      })

      await testSetup.mockInput.typeText("abc")

      // Global handler should be called for all keys
      expect(globalHandlerSpy.callCount()).toBe(3)
      expect(globalHandlerSpy.calls[0]?.[0]).toBe("a")
      expect(globalHandlerSpy.calls[1]?.[0]).toBe("b")
      expect(globalHandlerSpy.calls[2]?.[0]).toBe("c")

      // Input should only receive 'b' and 'c' (not 'a')
      expect(inputSpy.callCount()).toBe(2)
      expect(inputSpy.calls[0]?.[0]).toBe("b")
      expect(inputSpy.calls[1]?.[0]).toBe("bc")
    })

    it("should handle global handler registered after component mount", async () => {
      const inputSpy = createSpy()
      const value = ref("")

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Input", {
                focused: true,
                onInput: (val: string) => {
                  inputSpy(val)
                  value.value = val
                },
              }),
              h("Text", { content: `Value: ${value.value}` }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      // Type before global handler exists
      await testSetup.mockInput.typeText("hello")
      expect(inputSpy.callCount()).toBe(5)
      expect(value.value).toBe("hello")

      inputSpy.reset()

      testSetup.renderer.keyInput.on("keypress", (event) => {
        if (/^[0-9]$/.test(event.name)) {
          event.preventDefault()
        }
      })

      // Type mixed content
      await testSetup.mockInput.typeText("abc123xyz")

      // Only letters should reach the input
      expect(inputSpy.callCount()).toBe(6) // a, b, c, x, y, z (not 1, 2, 3)
      expect(value.value).toBe("helloabcxyz")
    })

    it("should handle dynamic preventDefault conditions", async () => {
      const inputSpy = createSpy()
      let preventNumbers = false

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Input", {
                focused: true,
                onInput: inputSpy,
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      // Register handler with dynamic condition
      testSetup.renderer.keyInput.on("keypress", (event) => {
        if (preventNumbers && /^[0-9]$/.test(event.name)) {
          event.preventDefault()
        }
      })

      // Initially allow numbers
      await testSetup.mockInput.typeText("a1")
      expect(inputSpy.callCount()).toBe(2)
      expect(inputSpy.calls[1]?.[0]).toBe("a1")

      // Enable number prevention
      preventNumbers = true
      inputSpy.reset()

      // Now numbers should be prevented
      await testSetup.mockInput.typeText("b2c3")
      expect(inputSpy.callCount()).toBe(2) // Only 'b' and 'c'
      expect(inputSpy.calls[0]?.[0]).toBe("a1b")
      expect(inputSpy.calls[1]?.[0]).toBe("a1bc")

      // Disable prevention again
      preventNumbers = false
      inputSpy.reset()

      // Numbers should work again
      await testSetup.mockInput.typeText("4")
      expect(inputSpy.callCount()).toBe(1)
      expect(inputSpy.calls[0]?.[0]).toBe("a1bc4")
    })

    it("should handle preventDefault for select components", async () => {
      const changeSpy = createSpy()
      const globalHandlerSpy = createSpy()
      const selectedIndex = ref(0)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Select", {
                focused: true,
                wrapSelection: true,
                options: [
                  { name: "Option 1", value: 1, description: "First" },
                  { name: "Option 2", value: 2, description: "Second" },
                  { name: "Option 3", value: 3, description: "Third" },
                ],
                onChange: (index: number, option: { value: number }) => {
                  changeSpy(index, option)
                  selectedIndex.value = index
                },
              }),
              h("Text", { content: `Selected: ${selectedIndex.value}` }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 10 })

      // Register global handler that prevents down arrow
      testSetup.renderer.keyInput.on("keypress", (event) => {
        globalHandlerSpy(event.name)
        if (event.name === "down") {
          event.preventDefault()
        }
      })

      // Try to press down arrow - should be prevented
      testSetup.mockInput.pressArrow("down")
      expect(globalHandlerSpy.callCount()).toBe(1)
      expect(changeSpy.callCount()).toBe(0) // Should not change
      expect(selectedIndex.value).toBe(0) // Should remain at 0

      // Up arrow should still work
      testSetup.mockInput.pressArrow("up")
      expect(globalHandlerSpy.callCount()).toBe(2)
      expect(changeSpy.callCount()).toBe(1) // Should wrap to last option
      expect(selectedIndex.value).toBe(2) // Should be at last option
    })

    it("should handle multiple global handlers with preventDefault", async () => {
      const inputSpy = createSpy()
      const firstHandlerSpy = createSpy()
      const secondHandlerSpy = createSpy()

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Input", {
                focused: true,
                onInput: inputSpy,
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      // First handler prevents 'x'
      testSetup.renderer.keyInput.on("keypress", (event) => {
        firstHandlerSpy(event.name)
        if (event.name === "x") {
          event.preventDefault()
        }
      })

      // Second handler also runs but can't undo preventDefault
      testSetup.renderer.keyInput.on("keypress", (event) => {
        secondHandlerSpy(event.name)
      })

      await testSetup.mockInput.typeText("xyz")

      // Both handlers should be called for all keys
      expect(firstHandlerSpy.callCount()).toBe(3)
      expect(secondHandlerSpy.callCount()).toBe(3)

      // But input should only receive 'y' and 'z'
      expect(inputSpy.callCount()).toBe(2)
      expect(inputSpy.calls[0]?.[0]).toBe("y")
      expect(inputSpy.calls[1]?.[0]).toBe("yz")
    })
  })

  describe("Paste Events", () => {
    it("should handle global preventDefault for paste events", async () => {
      const pasteSpy = createSpy()
      const globalHandlerSpy = createSpy()
      const pastedText = ref("")

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Input", {
                focused: true,
                onPaste: (val: PasteEvent) => {
                  pasteSpy(val)
                  pastedText.value = val.text
                },
              }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 5 })

      // Register global handler that prevents paste containing "forbidden"
      testSetup.renderer.keyInput.on("paste", (event: PasteEvent) => {
        globalHandlerSpy(event.text)
        if (event.text.includes("forbidden")) {
          event.preventDefault()
        }
      })

      // First paste should go through
      await testSetup.mockInput.pasteBracketedText("allowed content")
      expect(globalHandlerSpy.callCount()).toBe(1)
      expect(pasteSpy.callCount()).toBe(1)
      expect(pastedText.value).toBe("allowed content")

      // Reset spies
      globalHandlerSpy.reset()
      pasteSpy.reset()

      // Second paste should be prevented
      await testSetup.mockInput.pasteBracketedText("forbidden content")
      expect(globalHandlerSpy.callCount()).toBe(1)
      expect(globalHandlerSpy.calls[0]?.[0]).toBe("forbidden content")
      expect(pasteSpy.callCount()).toBe(0)
      expect(pastedText.value).toBe("allowed content") // Should remain unchanged
    })
  })

  describe("Dynamic Content", () => {
    it("should handle dynamic arrays and list updates", async () => {
      const items = ref(["Item 1", "Item 2"])

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "box",
              {},
              items.value.map((item) => h("Text", { content: item })),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 10 })

      let children = testSetup.renderer.root.getChildren()
      expect(children.length).toBe(1)
      let boxChildren = children[0]!.getChildren()
      expect(boxChildren.length).toBe(2)

      items.value = ["Item 1", "Item 2", "Item 3"]
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()
      boxChildren = children[0]!.getChildren()
      expect(boxChildren.length).toBe(3)

      items.value = ["Item 1", "Item 3"]
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()
      boxChildren = children[0]!.getChildren()
      expect(boxChildren.length).toBe(2)
    })

    it("should handle dynamic text content", async () => {
      const dynamicText = ref("Initial")

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("Text", { content: `Static: ${dynamicText.value}` }),
              h("Text", { content: "Direct content" }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 8 })

      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Static: Initial")
      expect(frame).toContain("Direct content")

      dynamicText.value = "Updated"
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Static: Updated")
      expect(frame).toContain("Direct content")
    })
  })
})
