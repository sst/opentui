import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { createSignal } from "solid-js"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Textarea Cursor Behavior Tests", () => {
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

  describe("Cursor Visibility", () => {
    it("should show cursor when textarea is focused", async () => {
      testSetup = await testRender(() => <textarea focused initialValue="Hello" width={20} height={5} />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()

      const cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)
    })

    it("should not change cursor state when textarea is never focused", async () => {
      testSetup = await testRender(() => <textarea initialValue="Hello" width={20} height={5} />, {
        width: 30,
        height: 10,
      })

      const beforeRender = testSetup.renderer.getCursorState()

      await testSetup.renderOnce()

      const afterRender = testSetup.renderer.getCursorState()

      expect(afterRender.visible).toBe(beforeRender.visible)
      expect(afterRender.x).toBe(beforeRender.x)
      expect(afterRender.y).toBe(beforeRender.y)
    })

    it("should hide cursor when showCursor is set to false while focused", async () => {
      const [showCursor, setShowCursor] = createSignal(true)

      testSetup = await testRender(
        () => <textarea focused initialValue="Hello" width={20} height={5} showCursor={showCursor()} />,
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()

      let cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)

      setShowCursor(false)
      await testSetup.renderOnce()

      cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(false)
    })

    it("should show cursor again when showCursor is set back to true", async () => {
      const [showCursor, setShowCursor] = createSignal(true)

      testSetup = await testRender(
        () => <textarea focused initialValue="Hello" width={20} height={5} showCursor={showCursor()} />,
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()
      let cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)

      setShowCursor(false)
      await testSetup.renderOnce()
      cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(false)

      setShowCursor(true)
      await testSetup.renderOnce()
      cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)
    })

    it("should hide cursor when textarea loses focus", async () => {
      const [isFocused, setIsFocused] = createSignal(true)

      testSetup = await testRender(
        () => <textarea focused={isFocused()} initialValue="Hello" width={20} height={5} />,
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()
      let cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)

      setIsFocused(false)
      await testSetup.renderOnce()

      cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(false)
    })

    it("should show cursor when textarea gains focus", async () => {
      const [isFocused, setIsFocused] = createSignal(false)

      testSetup = await testRender(
        () => <textarea focused={isFocused()} initialValue="Hello" width={20} height={5} />,
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()
      let cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(false)

      setIsFocused(true)
      await testSetup.renderOnce()

      cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)
    })

    it("should not show cursor if showCursor is false even when focused", async () => {
      testSetup = await testRender(
        () => <textarea focused initialValue="Hello" width={20} height={5} showCursor={false} />,
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()

      const cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(false)
    })
  })

  describe("Cursor Position", () => {
    it("should position cursor at the end of text initially", async () => {
      testSetup = await testRender(() => <textarea focused initialValue="Hello" width={20} height={5} />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()

      const cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)
      expect(cursorState.x).toBeGreaterThan(0)
      expect(cursorState.y).toBeGreaterThan(0)
    })

    it("should update cursor position when typing", async () => {
      testSetup = await testRender(() => <textarea focused initialValue="X" width={20} height={5} />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()

      const initialState = testSetup.renderer.getCursorState()
      const initialX = initialState.x

      await testSetup.mockInput.typeText("ABC")
      await testSetup.renderOnce()

      const afterTypingState = testSetup.renderer.getCursorState()
      expect(afterTypingState.x).toBe(initialX + 3)
    })

    it("should position cursor correctly with multiline text", async () => {
      testSetup = await testRender(() => <textarea focused initialValue={"Line1\nLine2"} width={20} height={5} />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()

      const cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)
      expect(cursorState.x).toBeGreaterThan(0)
      expect(cursorState.y).toBeGreaterThanOrEqual(1)
    })

    it("should update cursor position when navigating with arrow keys", async () => {
      testSetup = await testRender(() => <textarea focused initialValue="Hello" width={20} height={5} />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()

      const initialState = testSetup.renderer.getCursorState()
      expect(initialState.visible).toBe(true)
      const initialX = initialState.x

      testSetup.mockInput.pressArrow("left")
      await testSetup.renderOnce()

      const afterLeftState = testSetup.renderer.getCursorState()
      expect(afterLeftState.visible).toBe(true)
      expect(afterLeftState.x).toBeLessThanOrEqual(initialX)
    })
  })

  describe("Cursor Style and Color", () => {
    it("should apply default cursor style when focused", async () => {
      testSetup = await testRender(() => <textarea focused initialValue="Hello" width={20} height={5} />, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()

      const cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)
      expect(cursorState.style).toBe("block")
      expect(cursorState.blinking).toBe(true)
    })

    it("should apply custom cursor style", async () => {
      testSetup = await testRender(
        () => (
          <textarea
            focused
            initialValue="Hello"
            width={20}
            height={5}
            cursorStyle={{ style: "line", blinking: false }}
          />
        ),
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()

      const cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)
      expect(cursorState.style).toBe("line")
      expect(cursorState.blinking).toBe(false)
    })

    it("should apply custom cursor color", async () => {
      testSetup = await testRender(
        () => <textarea focused initialValue="Hello" width={20} height={5} cursorColor="#ff0000" />,
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()

      const cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)
      expect(cursorState.color.r).toBeCloseTo(1, 1)
      expect(cursorState.color.g).toBeCloseTo(0, 1)
      expect(cursorState.color.b).toBeCloseTo(0, 1)
    })
  })

  describe("Cursor with Multiple Textareas", () => {
    it("should only show cursor for the focused textarea", async () => {
      const [focused1, setFocused1] = createSignal(true)
      const [focused2, setFocused2] = createSignal(false)

      testSetup = await testRender(
        () => (
          <box>
            <textarea focused={focused1()} initialValue="First" width={20} height={3} />
            <textarea focused={focused2()} initialValue="Second" width={20} height={3} />
          </box>
        ),
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()

      let cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)
      const firstY = cursorState.y

      setFocused1(false)
      setFocused2(true)
      await testSetup.renderOnce()

      cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)
      expect(cursorState.y).toBeGreaterThan(firstY)
    })

    it("should hide cursor when all textareas are unfocused", async () => {
      const [focused1, setFocused1] = createSignal(true)
      const [focused2, setFocused2] = createSignal(false)

      testSetup = await testRender(
        () => (
          <box>
            <textarea focused={focused1()} initialValue="First" width={20} height={3} />
            <textarea focused={focused2()} initialValue="Second" width={20} height={3} />
          </box>
        ),
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()
      let cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(true)

      setFocused1(false)
      await testSetup.renderOnce()

      cursorState = testSetup.renderer.getCursorState()
      expect(cursorState.visible).toBe(false)
    })
  })
})
