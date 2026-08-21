import { TextAttributes } from "@opentui/core"
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
})
