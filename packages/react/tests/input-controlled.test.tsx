import { afterEach, beforeAll, afterAll, describe, expect, it, mock } from "bun:test"
import { useEffect, useState } from "react"
import { act } from "react"
import { testRender } from "../src/test-utils.js"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("React Renderer | <input> controlled-component patterns (#726)", () => {
  let originalConsoleError: (...args: any[]) => void

  beforeAll(() => {
    originalConsoleError = console.error
    console.error = mock(() => {})
  })

  afterAll(() => {
    console.error = originalConsoleError
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  it("setState that changes value re-renders and syncs the input", async () => {
    let setExternally!: (s: string) => void
    function App() {
      const [value, setValue] = useState("hello")
      useEffect(() => {
        setExternally = setValue
      }, [])
      return <input value={value} onChange={() => {}} />
    }

    testSetup = await testRender(<App />, { width: 40, height: 5 })
    await testSetup.renderOnce()

    await act(async () => {
      setExternally("")
    })
    await testSetup.renderOnce()

    const input = testSetup.renderer.root.getChildren()[0] as any
    expect(input.value).toBe("")
  })

  it("`onChange` is HTML-style (blur), not React-web style (per-keystroke) — typing desyncs a controlled input", async () => {
    let setExternally!: (s: string) => void
    let changeFired = 0

    function App() {
      const [value, setValue] = useState("")
      useEffect(() => {
        setExternally = setValue
      }, [])
      return (
        <input
          value={value}
          onChange={() => {
            changeFired++
          }}
          focused
        />
      )
    }

    testSetup = await testRender(<App />, { width: 40, height: 5 })
    await testSetup.renderOnce()

    // User types — input.value visually becomes "abc", but state stays ""
    // because onChange (= HTML's `change`, blur-only) hasn't fired yet.
    testSetup.mockInput.pressKey("a")
    testSetup.mockInput.pressKey("b")
    testSetup.mockInput.pressKey("c")
    await testSetup.renderOnce()

    const input = testSetup.renderer.root.getChildren()[0] as any
    expect(input.value).toBe("abc")
    expect(changeFired).toBe(0) // onChange hasn't fired — no blur yet

    // Programmatic clear: state stays "" → "", React skips re-render → desync.
    await act(async () => {
      setExternally("")
    })
    await testSetup.renderOnce()

    // The input still shows "abc" — the documented gotcha from #726.
    expect(input.value).toBe("abc")
  })

  it("`onInput` keeps a controlled input in sync per keystroke (the React-web pattern)", async () => {
    let setExternally!: (s: string) => void

    function App() {
      const [value, setValue] = useState("")
      useEffect(() => {
        setExternally = setValue
      }, [])
      return <input value={value} onInput={(v: string) => setValue(v)} focused />
    }

    testSetup = await testRender(<App />, { width: 40, height: 5 })
    await testSetup.renderOnce()

    await act(async () => {
      testSetup.mockInput.pressKey("a")
      testSetup.mockInput.pressKey("b")
      testSetup.mockInput.pressKey("c")
    })
    await testSetup.renderOnce()

    const input = testSetup.renderer.root.getChildren()[0] as any
    expect(input.value).toBe("abc")

    // State is now "abc" too, so setExternally("") actually triggers a
    // re-render and the value prop drives the input back to "".
    await act(async () => {
      setExternally("")
    })
    await testSetup.renderOnce()

    expect(input.value).toBe("")
  })
})
