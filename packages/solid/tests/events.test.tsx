import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { createSignal } from "solid-js"
import { createSpy } from "./utils/spy"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("SolidJS Renderer Integration Tests", () => {
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

  describe("Event Scenarios", () => {
    it("should handle input onInput events", async () => {
      const onInputSpy = createSpy()
      const [value, setValue] = createSignal("")

      testSetup = await testRender(
        () => (
          <box>
            <input
              focused
              onInput={(val) => {
                onInputSpy(val)
                setValue(val)
              }}
            />
            <text>Value: {value()}</text>
          </box>
        ),
        { width: 20, height: 5 },
      )

      await testSetup.mockInput.typeText("hello")

      expect(onInputSpy.callCount()).toBe(5)
      expect(onInputSpy.calls[0]?.[0]).toBe("h")
      expect(onInputSpy.calls[4]?.[0]).toBe("hello")

      expect(value()).toBe("hello")
    })

    it("should handle input onSubmit events", async () => {
      const onSubmitSpy = createSpy()
      const [submittedValue, setSubmittedValue] = createSignal("")

      testSetup = await testRender(
        () => (
          <box>
            <input focused onInput={(val) => setSubmittedValue(val)} onSubmit={(val) => onSubmitSpy(val)} />
          </box>
        ),
        { width: 20, height: 5 },
      )

      await testSetup.mockInput.typeText("test input")

      testSetup.mockInput.pressEnter()

      expect(onSubmitSpy.callCount()).toBe(1)
      expect(onSubmitSpy.calls[0]?.[0]).toBe("test input")
      expect(submittedValue()).toBe("test input")
    })

    it("should handle select onChange events", async () => {
      const onChangeSpy = createSpy()
      const [selectedIndex, setSelectedIndex] = createSignal(0)

      const options = [
        { name: "Option 1", value: 1, description: "First option" },
        { name: "Option 2", value: 2, description: "Second option" },
        { name: "Option 3", value: 3, description: "Third option" },
      ]

      testSetup = await testRender(
        () => (
          <box>
            <select
              focused
              options={options}
              onChange={(index, option) => {
                onChangeSpy(index, option)
                setSelectedIndex(index)
              }}
            />
            <text>Selected: {selectedIndex()}</text>
          </box>
        ),
        { width: 30, height: 10 },
      )

      testSetup.mockInput.pressArrow("down")

      expect(onChangeSpy.callCount()).toBe(1)
      expect(onChangeSpy.calls[0]?.[0]).toBe(1)
      expect(onChangeSpy.calls[0]?.[1]).toEqual(options[1])

      expect(selectedIndex()).toBe(1)
    })

    it("should handle tab_select onSelect events", async () => {
      const onSelectSpy = createSpy()
      const [activeTab, setActiveTab] = createSignal(0)

      const tabs = [{ title: "Tab 1" }, { title: "Tab 2" }, { title: "Tab 3" }]

      testSetup = await testRender(
        () => (
          <box>
            <tab_select
              focused
              options={tabs.map((tab, index) => ({
                name: tab.title,
                value: index,
                description: "",
              }))}
              onSelect={(index) => {
                onSelectSpy(index)
                setActiveTab(index)
              }}
            />
            <text>Active tab: {activeTab()}</text>
          </box>
        ),
        { width: 40, height: 8 },
      )

      testSetup.mockInput.pressArrow("right")
      testSetup.mockInput.pressArrow("right")

      testSetup.mockInput.pressEnter()

      expect(onSelectSpy.callCount()).toBe(1)
      expect(onSelectSpy.calls[0]?.[0]).toBe(2)

      expect(activeTab()).toBe(2)
    })

    it("should handle focus management", async () => {
      const input1Spy = createSpy()
      const input2Spy = createSpy()
      const [input1Focused, setInput1Focused] = createSignal(true)
      const [input2Focused, setInput2Focused] = createSignal(false)

      testSetup = await testRender(
        () => (
          <box>
            <input focused={input1Focused()} onInput={input1Spy} />
            <input focused={input2Focused()} onInput={input2Spy} />
          </box>
        ),
        { width: 30, height: 8 },
      )

      await testSetup.mockInput.typeText("first")

      expect(input1Spy.callCount()).toBe(5) // "f", "i", "r", "s", "t"
      expect(input2Spy.callCount()).toBe(0)

      // NOTE: Here tabbing would switch focus when it is implemented
      setInput1Focused(false)
      setInput2Focused(true)

      input1Spy.reset()
      input2Spy.reset()

      await testSetup.mockInput.typeText("second")

      expect(input1Spy.callCount()).toBe(0)
      expect(input2Spy.callCount()).toBe(6) // "s", "e", "c", "o", "n", "d"
    })

    it("should handle event handler attachment", async () => {
      const inputSpy = createSpy()

      testSetup = await testRender(
        () => (
          <box>
            <input focused onInput={inputSpy} />
          </box>
        ),
        { width: 20, height: 5 },
      )

      await testSetup.mockInput.typeText("test")

      expect(inputSpy.callCount()).toBe(4)
      expect(inputSpy.calls[0]?.[0]).toBe("t")
      expect(inputSpy.calls[3]?.[0]).toBe("test")
    })

    it("should handle keyboard navigation on select components", async () => {
      const changeSpy = createSpy()
      const [selectedValue, setSelectedValue] = createSignal("")

      testSetup = await testRender(
        () => (
          <box>
            <select
              focused
              options={[
                { name: "Option 1", value: "opt1", description: "First option" },
                { name: "Option 2", value: "opt2", description: "Second option" },
                { name: "Option 3", value: "opt3", description: "Third option" },
              ]}
              onChange={(index, option) => {
                changeSpy(index, option)
                setSelectedValue(option?.value || "")
              }}
            />
            <text>Selected: {selectedValue()}</text>
          </box>
        ),
        { width: 25, height: 10 },
      )

      testSetup.mockInput.pressArrow("down")

      expect(changeSpy.callCount()).toBe(1)
      expect(changeSpy.calls[0]?.[0]).toBe(1)
      expect(changeSpy.calls[0]?.[1]?.value).toBe("opt2")
      expect(selectedValue()).toBe("opt2")

      testSetup.mockInput.pressArrow("down")

      expect(changeSpy.callCount()).toBe(2)
      expect(changeSpy.calls[1]?.[0]).toBe(2)
      expect(changeSpy.calls[1]?.[1]?.value).toBe("opt3")
      expect(selectedValue()).toBe("opt3")
    })

    it("should handle dynamic arrays and list updates", async () => {
      const [items, setItems] = createSignal(["Item 1", "Item 2"])

      testSetup = await testRender(
        () => (
          <box>
            {items().map((item) => (
              <text>{item}</text>
            ))}
          </box>
        ),
        { width: 20, height: 10 },
      )

      let children = testSetup.renderer.root.getChildren()
      expect(children.length).toBe(1)
      let boxChildren = children[0]!.getChildren()
      expect(boxChildren.length).toBe(2)

      setItems(["Item 1", "Item 2", "Item 3"])

      children = testSetup.renderer.root.getChildren()
      boxChildren = children[0]!.getChildren()
      expect(boxChildren.length).toBe(3)

      setItems(["Item 1", "Item 3"])

      children = testSetup.renderer.root.getChildren()
      boxChildren = children[0]!.getChildren()
      expect(boxChildren.length).toBe(2)
    })

    it("should handle text modifier components", async () => {
      testSetup = await testRender(
        () => (
          <box>
            <text>
              <b>Bold text</b> and <i>italic text</i> with <u>underline</u>
            </text>
          </box>
        ),
        { width: 40, height: 5 },
      )

      await testSetup.renderOnce()

      // The text node should contain the styled text content
      // We can verify this by checking the visual output
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Bold text")
      expect(frame).toContain("italic text")
      expect(frame).toContain("underline")
    })

    it("should handle dynamic text content", async () => {
      const [dynamicText, setDynamicText] = createSignal("Initial")

      testSetup = await testRender(
        () => (
          <box>
            <text>Static: {dynamicText()}</text>
            <text>Direct content</text>
          </box>
        ),
        { width: 30, height: 8 },
      )

      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Static: Initial")
      expect(frame).toContain("Direct content")

      setDynamicText("Updated")
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Static: Updated")
      expect(frame).toContain("Direct content")
    })
  })
})
