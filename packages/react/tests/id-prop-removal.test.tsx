import { describe, expect, it } from "bun:test"
import React, { useState, act } from "react"
import { testRender } from "../src/test-utils.js"

/**
 * Regression test for: child renderable persists after unmount when its `id`
 * prop transitioned to undefined on a previous render.
 *
 * Before the fix, React could reuse the same host instance for an element whose
 * `id` prop changed from a string to undefined. That assigned
 * `instance.id = undefined`, leaving `_id` undefined while the parent still
 * relied on `child.id` for removal.
 *
 * Later, when React unmounted the element, `removeChild` invoked
 * `parent.remove(child.id)` -> `parent.remove(undefined)`, which early-returned
 * on falsy id. The child stayed mounted and visible, which showed up in
 * dialog/mode-switching subtrees that only set an id in one mode.
 *
 * The core renderable id setter now preserves the existing id when an invalid
 * value is assigned.
 */

const PROBE_TEXT = "PROBE_VISIBLE_BIT"

describe("id prop removal does not orphan children", () => {
  it("removes a child whose id prop became undefined before unmount", async () => {
    let setStep: (s: 0 | 1 | 2) => void = () => {}
    const captured: { box: any | null } = { box: null }

    function App() {
      const [step, setStepState] = useState<0 | 1 | 2>(0)
      setStep = setStepState
      if (step === 2) return null
      return (
        <box flexDirection="column">
          <box
            ref={(r: any) => {
              if (r) captured.box = r
            }}
            id={step === 0 ? "regression-target-box" : undefined}
            flexDirection="column"
          >
            <text>{PROBE_TEXT}</text>
          </box>
        </box>
      )
    }

    const testSetup = await testRender(<App />, { width: 40, height: 6 })
    await testSetup.renderOnce()
    expect(testSetup.captureCharFrame()).toContain(PROBE_TEXT)
    expect(captured.box).not.toBeNull()
    const innerBox = captured.box
    const parentBox = innerBox.parent
    expect(parentBox).not.toBeNull()
    expect(parentBox.renderableMapById.has("regression-target-box")).toBe(true)

    // Drop the id prop while the same fiber is reused.
    await act(async () => {
      setStep(1)
    })
    await testSetup.renderOnce()
    // The inner box is still mounted and should still be in the parent map.
    // After the bug, the id has been clobbered to undefined and the parent
    // map has lost the previous key. We probe by looking at the inner box's id.
    expect(innerBox.id == null).toBe(false) // bug: would be true (id undefined)

    // Unmount that subtree entirely. With the bug, the inner box stays
    // attached because parent.remove(undefined) is a no-op.
    await act(async () => {
      setStep(2)
    })
    await testSetup.renderOnce()
    expect(parentBox.renderableMapById.size).toBe(0)
    expect(testSetup.captureCharFrame()).not.toContain(PROBE_TEXT)

    testSetup.renderer.destroy()
  })
})
