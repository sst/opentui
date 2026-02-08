import { describe, expect, it, afterEach } from "bun:test"
import { testRender } from "../index"
import { createSignal, Show } from "solid-js"
import { createSpy } from "@opentui/core/testing"
import type { BoxRenderable } from "@opentui/core"
import { useKeyboard } from "../src/elements/hooks"

let testSetup: Awaited<ReturnType<typeof testRender>>
const scopeDefaults = { trapFocus: true, autoFocus: true } as const

afterEach(() => {
  testSetup?.renderer.destroy()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Scope-aware useKeyboard (ref-based)
// ═══════════════════════════════════════════════════════════════════════════════

describe("scope-aware useKeyboard", () => {
  it("useKeyboard with ref inside scope receives keys", async () => {
    const spy = createSpy()

    const Inner = () => {
      let ref!: BoxRenderable
      useKeyboard((key) => spy(key.name), { ref: () => ref })
      return <box ref={ref} width={10} height={1} />
    }

    testSetup = await testRender(
      () => (
        <box {...scopeDefaults}>
          <Inner />
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    testSetup.mockInput.pressKey("j")
    expect(spy.callCount()).toBe(1)
    expect(spy.calls[0]?.[0]).toBe("j")
  })

  it("useKeyboard without ref is global — blocked when scope active", async () => {
    const insideSpy = createSpy()
    const outsideSpy = createSpy()

    const Inner = () => {
      let ref!: BoxRenderable
      useKeyboard((key) => insideSpy(key.name), { ref: () => ref })
      return <box ref={ref} width={10} height={1} />
    }

    const Outer = () => {
      // No ref — global handler
      useKeyboard((key) => outsideSpy(key.name))
      return null
    }

    testSetup = await testRender(
      () => (
        <box>
          <Outer />
          <box {...scopeDefaults}>
            <Inner />
          </box>
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    testSetup.mockInput.pressKey("j")
    expect(insideSpy.callCount()).toBe(1)
    expect(outsideSpy.callCount()).toBe(0)
  })

  it("useKeyboard without ref works when no scope mounted", async () => {
    const spy = createSpy()

    const Handler = () => {
      useKeyboard((key) => spy(key.name))
      return null
    }

    testSetup = await testRender(
      () => (
        <box>
          <Handler />
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    testSetup.mockInput.pressKey("j")
    expect(spy.callCount()).toBe(1)
    expect(spy.calls[0]?.[0]).toBe("j")
  })

  it("multiple useKeyboard handlers inside same scope all fire", async () => {
    const spy1 = createSpy()
    const spy2 = createSpy()

    const Handler1 = () => {
      let ref!: BoxRenderable
      useKeyboard((key) => spy1(key.name), { ref: () => ref })
      return <box ref={ref} />
    }

    const Handler2 = () => {
      let ref!: BoxRenderable
      useKeyboard((key) => spy2(key.name), { ref: () => ref })
      return <box ref={ref} />
    }

    testSetup = await testRender(
      () => (
        <box {...scopeDefaults}>
          <Handler1 />
          <Handler2 />
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    testSetup.mockInput.pressKey("a")
    expect(spy1.callCount()).toBe(1)
    expect(spy2.callCount()).toBe(1)
  })

  it("nested scopes: innermost scope wins", async () => {
    const outerSpy = createSpy()
    const innerSpy = createSpy()

    const OuterHandler = () => {
      let ref!: BoxRenderable
      useKeyboard((key) => outerSpy(key.name), { ref: () => ref })
      return <box ref={ref} />
    }

    const InnerHandler = () => {
      let ref!: BoxRenderable
      useKeyboard((key) => innerSpy(key.name), { ref: () => ref })
      return <box ref={ref} />
    }

    testSetup = await testRender(
      () => (
        <box {...scopeDefaults}>
          <OuterHandler />
          <box {...scopeDefaults}>
            <InnerHandler />
          </box>
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    testSetup.mockInput.pressKey("x")
    expect(innerSpy.callCount()).toBe(1)
    expect(outerSpy.callCount()).toBe(0)
  })

  it("nested scopes: inner unmounts and stops receiving events", async () => {
    const outerSpy = createSpy()
    const innerSpy = createSpy()
    const [showInner, setShowInner] = createSignal(true)

    const InnerHandler = () => {
      let ref!: BoxRenderable
      useKeyboard((key) => innerSpy(key.name), { ref: () => ref })
      return <box ref={ref} />
    }

    const OuterScope = () => {
      let scopeRef!: BoxRenderable
      useKeyboard((key) => outerSpy(key.name), { ref: () => scopeRef })

      return (
        <box {...scopeDefaults} ref={scopeRef}>
          <Show when={showInner()}>
            <box {...scopeDefaults}>
              <InnerHandler />
            </box>
          </Show>
        </box>
      )
    }

    testSetup = await testRender(() => <OuterScope />, { width: 40, height: 10, kittyKeyboard: true })

    await testSetup.renderOnce()
    testSetup.mockInput.pressKey("a")
    expect(innerSpy.callCount()).toBe(1)
    expect(outerSpy.callCount()).toBe(0)

    setShowInner(false)
    await testSetup.renderOnce()

    innerSpy.reset()
    outerSpy.reset()

    testSetup.mockInput.pressKey("b")
    expect(innerSpy.callCount()).toBe(0)
  })

  it("key event properties preserved", async () => {
    const spy = createSpy()

    const Handler = () => {
      let ref!: BoxRenderable
      useKeyboard(
        (key) =>
          spy({
            name: key.name,
            ctrl: key.ctrl,
            shift: key.shift,
          }),
        { ref: () => ref },
      )
      return <box ref={ref} />
    }

    testSetup = await testRender(
      () => (
        <box {...scopeDefaults}>
          <Handler />
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    testSetup.mockInput.pressKey("p", { ctrl: true })
    expect(spy.callCount()).toBe(1)
    expect(spy.calls[0]?.[0].name).toBe("p")
    expect(spy.calls[0]?.[0].ctrl).toBe(true)
  })

  it("cleanup: useKeyboard handler removed on component unmount", async () => {
    const spy = createSpy()
    const [show, setShow] = createSignal(true)

    const Handler = () => {
      let ref!: BoxRenderable
      useKeyboard((key) => spy(key.name), { ref: () => ref })
      return <box ref={ref} />
    }

    testSetup = await testRender(
      () => (
        <box {...scopeDefaults}>
          <Show when={show()}>
            <Handler />
          </Show>
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    testSetup.mockInput.pressKey("a")
    expect(spy.callCount()).toBe(1)

    setShow(false)
    await testSetup.renderOnce()
    spy.reset()

    testSetup.mockInput.pressKey("b")
    expect(spy.callCount()).toBe(0)
  })

  it("ref outside any scope falls back to global", async () => {
    const spy = createSpy()

    const Handler = () => {
      let ref!: BoxRenderable
      useKeyboard((key) => spy(key.name), { ref: () => ref })
      return <box ref={ref} />
    }

    testSetup = await testRender(
      () => (
        <box>
          <Handler />
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    await testSetup.renderOnce()
    testSetup.mockInput.pressKey("j")
    expect(spy.callCount()).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Focus restoration
// ═══════════════════════════════════════════════════════════════════════════════

describe("focus restoration", () => {
  it("focus restored on scope unmount", async () => {
    const [showScope, setShowScope] = createSignal(false)

    testSetup = await testRender(
      () => (
        <box>
          <box id="box-a" focusable focused />
          <Show when={showScope()}>
            <box {...scopeDefaults}>
              <box id="box-b" focusable />
            </box>
          </Show>
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    expect(testSetup.renderer.currentFocusedRenderable?.id).toBe("box-a")

    setShowScope(true)
    await testSetup.renderOnce()
    expect(testSetup.renderer.currentFocusedRenderable?.id).toBe("box-b")

    setShowScope(false)
    await testSetup.renderOnce()
    expect(testSetup.renderer.currentFocusedRenderable?.id).toBe("box-a")
  })

  it("focus restored to correct element with nested scopes", async () => {
    const [showOuter, setShowOuter] = createSignal(false)
    const [showInner, setShowInner] = createSignal(false)

    testSetup = await testRender(
      () => (
        <box>
          <box id="box-a" focusable focused />
          <Show when={showOuter()}>
            <box {...scopeDefaults}>
              <box id="box-b" focusable />
              <Show when={showInner()}>
                <box {...scopeDefaults}>
                  <box id="box-c" focusable />
                </box>
              </Show>
            </box>
          </Show>
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    expect(testSetup.renderer.currentFocusedRenderable?.id).toBe("box-a")

    setShowOuter(true)
    await testSetup.renderOnce()
    expect(testSetup.renderer.currentFocusedRenderable?.id).toBe("box-b")

    setShowInner(true)
    await testSetup.renderOnce()
    expect(testSetup.renderer.currentFocusedRenderable?.id).toBe("box-c")

    setShowInner(false)
    await testSetup.renderOnce()
    expect(testSetup.renderer.currentFocusedRenderable?.id).toBe("box-b")

    setShowOuter(false)
    await testSetup.renderOnce()
    expect(testSetup.renderer.currentFocusedRenderable?.id).toBe("box-a")
  })

  it("no restoration if nothing was focused before scope", async () => {
    const [showScope, setShowScope] = createSignal(true)

    testSetup = await testRender(
      () => (
        <box>
          <Show when={showScope()}>
            <box {...scopeDefaults}>
              <box id="box-a" focusable />
            </box>
          </Show>
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    setShowScope(false)
    await testSetup.renderOnce()
    expect(testSetup.renderer.currentFocusedRenderable).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// autoFocus / trapFocus props
// ═══════════════════════════════════════════════════════════════════════════════

describe("autoFocus / trapFocus", () => {
  it("autoFocus=true (default) focuses first focusable child", async () => {
    testSetup = await testRender(
      () => (
        <box {...scopeDefaults}>
          <box id="first" focusable />
          <box id="second" focusable />
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    await testSetup.renderOnce()
    expect(testSetup.renderer.currentFocusedRenderable?.id).toBe("first")
  })

  it("autoFocus=false skips initial focus", async () => {
    testSetup = await testRender(
      () => (
        <box {...scopeDefaults} autoFocus={false}>
          <box id="first" focusable />
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    await testSetup.renderOnce()
    expect(testSetup.renderer.currentFocusedRenderable).toBeNull()
  })

  it("trapFocus=false allows keys to propagate to global", async () => {
    const globalSpy = createSpy()

    const Global = () => {
      useKeyboard((key) => globalSpy(key.name))
      return null
    }

    testSetup = await testRender(
      () => (
        <box>
          <Global />
          <box {...scopeDefaults} trapFocus={false}>
            <box focusable />
          </box>
        </box>
      ),
      { width: 40, height: 10, kittyKeyboard: true },
    )

    testSetup.mockInput.pressKey("x")
    expect(globalSpy.callCount()).toBe(1)
  })
})
