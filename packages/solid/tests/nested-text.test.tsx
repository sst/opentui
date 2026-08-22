import { SyntaxStyle, TextAttributes, type TextRenderable } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { batch, createSignal, For } from "solid-js"
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

  test("reconciles keyed reorder, insertion, removal, and text updates in one batch", async () => {
    const initial = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "x" }]
    const inserted = { id: "d" }
    const [items, setItems] = createSignal(initial)
    const [labels, setLabels] = createSignal<Record<string, string>>({ a: "A", b: "B", c: "C", x: "X", d: "D" })
    const refs = new Map<string, TextRenderable>()
    let outer: TextRenderable | undefined

    setup = await testRender(
      () => (
        <text ref={(value) => (outer = value)}>
          <For each={items()}>
            {(item) => <text ref={(value) => refs.set(item.id, value)}>{labels()[item.id]}</text>}
          </For>
        </text>
      ),
      { width: 30, height: 3 },
    )
    await setup.renderOnce()
    const stable = [refs.get("a")!, refs.get("b")!, refs.get("c")!]
    const ids = stable.map((child) => (child as any)._nativeRangeId)
    const removed = refs.get("x")!

    batch(() => {
      setLabels((current) => ({ ...current, b: "b" }))
      setItems([initial[1]!, initial[2]!, initial[0]!, inserted])
    })
    expect(outer!.getTextChildren()).toEqual([stable[1], stable[2], stable[0], refs.get("d")])
    expect((outer as any)._pendingNativeMoves).toHaveLength(0)
    expect(stable.every((child) => child.parent === outer)).toBe(true)
    expect(removed.parent).toBeNull()

    await setup.renderOnce()
    expect(outer!.plainText).toBe("bCAD")
    expect(stable.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
  })

  test("resets reactive inline styles instead of retaining stale attributes", async () => {
    const [active, setActive] = createSignal(true)

    setup = await testRender(
      () => (
        <text>
          <span style={active() ? { fg: "#ff0000", bold: true } : {}}>status</span>
        </text>
      ),
      { width: 20, height: 2 },
    )

    await setup.renderOnce()
    let span = setup.captureSpans().lines[0]!.spans.find((candidate) => candidate.text.includes("status"))!
    expect(span.attributes & TextAttributes.BOLD).toBeTruthy()
    expect(span.fg.toInts()).toEqual([255, 0, 0, 255])

    setActive(false)
    await setup.renderOnce()
    span = setup.captureSpans().lines[0]!.spans.find((candidate) => candidate.text.includes("status"))!
    expect(span.attributes & TextAttributes.BOLD).toBeFalsy()
    expect(span.fg.toInts()).not.toEqual([255, 0, 0, 255])
  })

  test("batches registered styleId and styleSource updates in one lifecycle pass", async () => {
    const first = SyntaxStyle.fromStyles({ token: { fg: "#ff0000" } })
    const second = SyntaxStyle.fromStyles({ token: { fg: "#00ff00", bold: true } })
    const [mode, setMode] = createSignal<0 | 1 | 2>(0)
    let span: TextRenderable | undefined

    setup = await testRender(
      () => (
        <text>
          <span
            ref={(value) => (span = value)}
            styleId={mode() === 0 ? first.getStyleId("token")! : mode() === 1 ? second.getStyleId("token")! : undefined}
            styleSource={mode() === 0 ? first : second}
          >
            token
          </span>
        </text>
      ),
      { width: 20, height: 2 },
    )
    await setup.renderOnce()
    expect(span?.styleSource).toBe(first)
    expect(setup.captureSpans().lines[0]!.spans[0]!.fg.toInts()).toEqual([255, 0, 0, 255])

    setMode(1)
    await setup.renderOnce()
    expect(span?.styleSource).toBe(second)
    expect(setup.captureSpans().lines[0]!.spans[0]!.fg.toInts()).toEqual([0, 255, 0, 255])

    setMode(2)
    await setup.renderOnce()
    expect(span?.styleId).toBeUndefined()
    expect(span?.styleSource).toBeUndefined()
  })

  test("promotes only layout text while nested refs delegate functional APIs", async () => {
    let outer: TextRenderable | undefined
    let nested: TextRenderable | undefined
    setup = await testRender(
      () => (
        <text ref={(value) => (outer = value)}>
          prefix <text ref={(value) => (nested = value)}>界{"\t"}value</text>
        </text>
      ),
      { width: 30, height: 3 },
    )
    await setup.renderOnce()

    expect((outer as any).hasTextDocumentState).toBe(true)
    expect((nested as any).hasTextDocumentState).toBe(false)
    expect(nested!.plainText).toBe("界\tvalue")
    expect(nested!.textLength).toBe(9)
    expect(nested!.lineInfo).toEqual(outer!.lineInfo)
  })

  test("preserves hidden outer content and removes hidden nested text from flow", async () => {
    const [nestedVisible, setNestedVisible] = createSignal(true)
    const [outerVisible, setOuterVisible] = createSignal(true)
    let outer: TextRenderable | undefined
    setup = await testRender(
      () => (
        <text ref={(value) => (outer = value)} visible={outerVisible()}>
          prefix <text visible={nestedVisible()}>nested</text>
        </text>
      ),
      { width: 30, height: 3 },
    )
    await setup.renderOnce()

    setNestedVisible(false)
    await setup.renderOnce()
    expect(outer!.plainText).toBe("prefix ")

    setOuterVisible(false)
    await setup.renderOnce()
    expect(outer!.plainText).toBe("prefix ")
  })
})
