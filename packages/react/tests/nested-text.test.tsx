import { TextAttributes, type TextRenderable } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { act, useState } from "react"
import { testRender } from "../src/test-utils.js"

describe("React nested text", () => {
  let setup: Awaited<ReturnType<typeof testRender>> | undefined

  afterEach(() => {
    setup?.renderer.destroy()
    setup = undefined
  })

  test("nests text elements in one inherited text flow", async () => {
    setup = await testRender(
      <text attributes={TextAttributes.DIM}>
        What will you <text attributes={TextAttributes.UNDERLINE}>build?</text>
      </text>,
      { width: 30, height: 3 },
    )

    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("What will you build?")

    const spans = setup.captureSpans().lines[0]!.spans
    const prefix = spans.find((span) => span.text.includes("What will you"))
    const nested = spans.find((span) => span.text.includes("build?"))

    expect(prefix!.attributes & TextAttributes.DIM).toBeTruthy()
    expect(nested!.attributes & TextAttributes.DIM).toBeTruthy()
    expect(nested!.attributes & TextAttributes.UNDERLINE).toBeTruthy()
  })

  test("updates and reorders nested text without recreating unaffected siblings", async () => {
    let update!: (value: string) => void
    let reverse!: () => void

    function App() {
      const [value, setValue] = useState("idle")
      const [reversed, setReversed] = useState(false)
      update = setValue
      reverse = () => setReversed((current) => !current)

      const stable = <text key="stable">stable</text>
      const dynamic = (
        <text key="dynamic" attributes={TextAttributes.BOLD}>
          {value}
        </text>
      )

      return <text>{reversed ? [dynamic, " ", stable] : [stable, " ", dynamic]}</text>
    }

    setup = await testRender(<App />, { width: 30, height: 3 })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("stable idle")

    act(() => update("ready"))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("stable ready")

    act(() => reverse())
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("ready stable")
  })

  test("keeps nested refs functional without giving them a second document backend", async () => {
    let outer: TextRenderable | null = null
    let nested: TextRenderable | null = null
    setup = await testRender(
      <text ref={(value) => (outer = value)}>
        prefix <text ref={(value) => (nested = value)}>界{"\t"}value</text>
      </text>,
      { width: 30, height: 3 },
    )
    await setup.renderOnce()

    expect(outer).not.toBeNull()
    expect(nested).not.toBeNull()
    expect((outer as any).hasTextDocumentState).toBe(true)
    expect((nested as any).hasTextDocumentState).toBe(false)
    expect(nested!.plainText).toBe("界\tvalue")
    expect(nested!.textLength).toBe(9)
    expect(nested!.lineInfo).toEqual(outer!.lineInfo)
  })

  test("updates nested visibility without erasing hidden outer public content", async () => {
    let setNestedVisible!: (value: boolean) => void
    let setOuterVisible!: (value: boolean) => void
    let outer: TextRenderable | null = null

    function App() {
      const [nestedVisible, updateNestedVisible] = useState(true)
      const [outerVisible, updateOuterVisible] = useState(true)
      setNestedVisible = updateNestedVisible
      setOuterVisible = updateOuterVisible
      return (
        <text ref={(value) => (outer = value)} visible={outerVisible}>
          prefix <text visible={nestedVisible}>nested</text>
        </text>
      )
    }

    setup = await testRender(<App />, { width: 30, height: 3 })
    await setup.renderOnce()
    act(() => setNestedVisible(false))
    await setup.renderOnce()
    expect(outer!.plainText).toBe("prefix ")

    act(() => setOuterVisible(false))
    await setup.renderOnce()
    expect(outer!.plainText).toBe("prefix ")
  })
})
