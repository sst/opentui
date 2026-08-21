import { TextAttributes } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { createSignal, For } from "solid-js"
import { testRender } from "../index.js"

describe("Solid nested text", () => {
  let setup: Awaited<ReturnType<typeof testRender>> | undefined

  afterEach(() => {
    setup?.renderer.destroy()
    setup = undefined
  })

  test("nests text elements in one inherited text flow", async () => {
    setup = await testRender(
      () => (
        <text attributes={TextAttributes.DIM}>
          What will you <text attributes={TextAttributes.UNDERLINE}>build?</text>
        </text>
      ),
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

  test("updates and reorders nested text", async () => {
    const [value, setValue] = createSignal("idle")
    const [items, setItems] = createSignal(["stable", "dynamic"])

    setup = await testRender(
      () => (
        <text>
          <For each={items()}>
            {(item, index) => (
              <>
                {index() > 0 ? " " : ""}
                <text attributes={item === "dynamic" ? TextAttributes.BOLD : 0}>
                  {item === "dynamic" ? value() : item}
                </text>
              </>
            )}
          </For>
        </text>
      ),
      { width: 30, height: 3 },
    )

    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("stable idle")

    setValue("ready")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("stable ready")

    setItems(["dynamic", "stable"])
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("ready stable")
  })
})
