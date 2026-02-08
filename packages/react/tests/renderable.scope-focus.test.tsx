import { afterEach, describe, expect, it } from "bun:test"
import { createSpy } from "@opentui/core/testing"
import type { Renderable } from "@opentui/core"
import { useRef } from "react"
import { useKeyboard } from "../src/hooks/use-keyboard"
import { testRender } from "../src/test-utils"

let testSetup: Awaited<ReturnType<typeof testRender>>

afterEach(() => {
  testSetup?.renderer.destroy()
})

describe("React Renderer | Keyboard Scope Hook", () => {
  it("useKeyboard with scope ref receives scoped keys", async () => {
    const spy = createSpy()

    const App = () => {
      const scopeRef = useRef<Renderable | null>(null)
      useKeyboard((key) => spy(key.name), { ref: scopeRef })
      return (
        <box ref={scopeRef} trapFocus autoFocus>
          <box style={{ width: 10, height: 1 }} />
        </box>
      )
    }

    testSetup = await testRender(<App />, { width: 40, height: 10, kittyKeyboard: true })
    await testSetup.renderOnce()
    testSetup.mockInput.pressKey("j")
    expect(spy.callCount()).toBe(1)
  })

  it("global useKeyboard is blocked while scope is active", async () => {
    const insideSpy = createSpy()
    const outsideSpy = createSpy()

    const Inner = () => {
      const scopeRef = useRef<Renderable | null>(null)
      useKeyboard((key) => insideSpy(key.name), { ref: scopeRef })
      return (
        <box ref={scopeRef} trapFocus autoFocus>
          <box style={{ width: 10, height: 1 }} />
        </box>
      )
    }

    const Outer = () => {
      useKeyboard((key) => outsideSpy(key.name))
      return null
    }

    testSetup = await testRender(
      <box>
        <Outer />
        <Inner />
      </box>,
      { width: 40, height: 10, kittyKeyboard: true },
    )

    await testSetup.renderOnce()
    testSetup.mockInput.pressKey("j")
    expect(insideSpy.callCount()).toBe(1)
    expect(outsideSpy.callCount()).toBe(0)
  })
})
