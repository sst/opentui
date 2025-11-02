import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { createSignal } from "solid-js"
import type { TextareaRenderable, BoxRenderable } from "@opentui/core"

/**
 * Tests for ref invalidation behavior in Solid.
 *
 * When an element with a ref is destroyed, the ref callback is called with undefined.
 * This allows components to clean up any references.
 *
 * Note: Destroy operations happen in process.nextTick, so tests must await the next tick
 * before checking if refs have been invalidated.
 */

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Refs Tests", () => {
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

  describe("Ref Invalidation", () => {
    it("should invalidate ref when textarea is destroyed via Show", async () => {
      let textareaRef: TextareaRenderable | undefined
      const [show, setShow] = createSignal(true)

      testSetup = await testRender(
        () => (
          <box>
            {show() && (
              <textarea
                ref={(el: TextareaRenderable | undefined) => (textareaRef = el)}
                initialValue="Test content"
                width={20}
                height={5}
                backgroundColor="#1e1e1e"
                textColor="#ffffff"
              />
            )}
          </box>
        ),
        {
          width: 30,
          height: 10,
        },
      )

      await testSetup.renderOnce()

      expect(textareaRef).toBeDefined()
      expect(textareaRef?.id).toBeDefined()

      setShow(false)
      await testSetup.renderOnce()
      await new Promise((resolve) => process.nextTick(resolve))

      expect(textareaRef).toBeUndefined()
    })

    it("should invalidate ref when box is destroyed via conditional rendering", async () => {
      let boxRef: BoxRenderable | undefined
      const [show, setShow] = createSignal(true)

      testSetup = await testRender(
        () => <box>{show() && <box ref={(el) => (boxRef = el)} border title="Test Box" width={20} height={5} />}</box>,
        {
          width: 30,
          height: 10,
        },
      )

      await testSetup.renderOnce()

      expect(boxRef).toBeDefined()
      expect(boxRef?.id).toBeDefined()

      setShow(false)
      await testSetup.renderOnce()
      await new Promise((resolve) => process.nextTick(resolve))

      expect(boxRef).toBeUndefined()
    })

    it("should invalidate ref when element is removed from parent", async () => {
      let boxRef: BoxRenderable | undefined
      const [items, setItems] = createSignal(["item1", "item2", "item3"])

      testSetup = await testRender(
        () => (
          <box>
            {items().map((item, index) => (
              <box
                ref={index === 1 ? (el: BoxRenderable) => (boxRef = el) : undefined}
                border
                title={item}
                height={3}
              />
            ))}
          </box>
        ),
        {
          width: 30,
          height: 15,
        },
      )

      await testSetup.renderOnce()

      expect(boxRef).toBeDefined()
      expect(boxRef?.id).toBeDefined()

      setItems(["item1", "item3"])
      await testSetup.renderOnce()

      await new Promise((resolve) => process.nextTick(resolve))

      expect(boxRef).toBeUndefined()
    })

    it("should track isDestroyed flag on referenced element", async () => {
      let textareaRef: TextareaRenderable | undefined
      const [show, setShow] = createSignal(true)

      testSetup = await testRender(
        () => (
          <box>
            {show() && (
              <textarea
                ref={(el: TextareaRenderable | undefined) => (textareaRef = el)}
                initialValue="Test content"
                width={20}
                height={5}
              />
            )}
          </box>
        ),
        {
          width: 30,
          height: 10,
        },
      )

      await testSetup.renderOnce()

      expect(textareaRef).toBeDefined()
      expect(textareaRef?.isDestroyed).toBe(false)

      setShow(false)
      await testSetup.renderOnce()

      await new Promise((resolve) => process.nextTick(resolve))

      expect(textareaRef).toBeUndefined()
    })

    it("should handle ref callback being called on destroy", async () => {
      const refCalls: Array<{ element: TextareaRenderable | undefined; timestamp: number }> = []
      const [show, setShow] = createSignal(true)

      testSetup = await testRender(
        () => (
          <box>
            {show() && (
              <textarea
                ref={(el: TextareaRenderable | undefined) => {
                  refCalls.push({ element: el, timestamp: Date.now() })
                }}
                initialValue="Test content"
                width={20}
                height={5}
              />
            )}
          </box>
        ),
        {
          width: 30,
          height: 10,
        },
      )

      await testSetup.renderOnce()

      expect(refCalls.length).toBe(1)
      expect(refCalls[0]?.element).toBeDefined()

      setShow(false)
      await testSetup.renderOnce()

      await new Promise((resolve) => process.nextTick(resolve))

      expect(refCalls.length).toBe(2)
      expect(refCalls[1]?.element).toBeUndefined()
    })

    it("should handle ref with Show component fallback switching", async () => {
      let refValue: BoxRenderable | undefined
      const [condition, setCondition] = createSignal(true)

      testSetup = await testRender(
        () => (
          <box>
            {condition() ? (
              <box ref={(el) => (refValue = el)} border title="Main" height={5} />
            ) : (
              <box border title="Fallback" height={5} />
            )}
          </box>
        ),
        {
          width: 30,
          height: 10,
        },
      )

      await testSetup.renderOnce()

      expect(refValue).toBeDefined()

      setCondition(false)
      await testSetup.renderOnce()

      await new Promise((resolve) => process.nextTick(resolve))

      expect(refValue).toBeUndefined()
    })
  })

  describe("Ref Assignment", () => {
    it("should assign ref to textarea element", async () => {
      let textareaRef: TextareaRenderable | undefined

      testSetup = await testRender(
        () => (
          <box>
            <textarea
              ref={(el: TextareaRenderable | undefined) => (textareaRef = el)}
              initialValue="Hello World"
              width={20}
              height={5}
              backgroundColor="#1e1e1e"
              textColor="#ffffff"
            />
          </box>
        ),
        {
          width: 30,
          height: 10,
        },
      )

      await testSetup.renderOnce()

      expect(textareaRef).toBeDefined()
      expect(textareaRef?.id).toBeDefined()
    })

    it("should call ref callback with element", async () => {
      let capturedRef: TextareaRenderable | undefined

      testSetup = await testRender(
        () => (
          <box>
            <textarea
              ref={(el: TextareaRenderable) => {
                capturedRef = el
              }}
              initialValue="Hello World"
              width={20}
              height={5}
            />
          </box>
        ),
        {
          width: 30,
          height: 10,
        },
      )

      await testSetup.renderOnce()

      expect(capturedRef).toBeDefined()
      expect(capturedRef?.id).toBeDefined()
    })
  })
})
