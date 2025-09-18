import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { createSignal, createEffect, createMemo, For, Show, Switch, Match, Index, ErrorBoundary } from "solid-js"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("SolidJS Renderer - Control Flow Components", () => {
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

  describe("<For> Component", () => {
    it("should render items with <For> component", async () => {
      const items = ["First", "Second", "Third"]

      testSetup = await testRender(
        () => (
          <box>
            <For each={items}>{(item, index) => <text>{`${index() + 1}. ${item}`}</text>}</For>
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()

      expect(frame).toContain("1. First")
      expect(frame).toContain("2. Second")
      expect(frame).toContain("3. Third")

      const children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(3)
    })

    it("should handle reactive updates with <For>", async () => {
      const [items, setItems] = createSignal(["A", "B"])

      testSetup = await testRender(
        () => (
          <box>
            <For each={items()}>{(item) => <text>Item: {item}</text>}</For>
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)

      setItems(["A", "B", "C", "D"])
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(4)

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item: A")
      expect(frame).toContain("Item: D")
    })

    it("should handle empty arrays with <For>", async () => {
      const [items, setItems] = createSignal(["Item"])

      testSetup = await testRender(
        () => (
          <box>
            <For each={items()}>{(item) => <text>{item}</text>}</For>
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(1)

      setItems([])
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(0)
    })

    it("should handle complex objects with <For>", async () => {
      const [todos, setTodos] = createSignal([
        { id: 1, text: "Learn SolidJS", done: false },
        { id: 2, text: "Build TUI", done: true },
      ])

      testSetup = await testRender(
        () => (
          <box>
            <For each={todos()}>
              {(todo, index) => (
                <text>
                  {index() + 1}. {todo.done ? "✓" : "○"} {todo.text}
                </text>
              )}
            </For>
          </box>
        ),
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()

      expect(frame).toContain("1. ○ Learn SolidJS")
      expect(frame).toContain("2. ✓ Build TUI")
    })
  })

  describe("<Show> Component", () => {
    it("should conditionally render content with <Show>", async () => {
      const [showContent, setShowContent] = createSignal(true)

      testSetup = await testRender(
        () => (
          <box>
            <Show when={showContent()} fallback={<text>Fallback content</text>}>
              <text>Main content</text>
            </Show>
          </box>
        ),
        { width: 20, height: 5 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Main content")
      expect(frame).not.toContain("Fallback content")

      setShowContent(false)
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Fallback content")
      expect(frame).not.toContain("Main content")
    })

    it("should handle reactive condition changes with <Show>", async () => {
      const [count, setCount] = createSignal(5)

      testSetup = await testRender(
        () => (
          <box>
            <Show when={count() > 3} fallback={<text>Count too low</text>}>
              <text>Count is high: {count()}</text>
            </Show>
          </box>
        ),
        { width: 25, height: 5 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Count is high: 5")

      setCount(2)
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Count too low")
      expect(frame).not.toContain("Count is high")
    })

    it("should handle <Show> without fallback", async () => {
      const [visible, setVisible] = createSignal(true)

      testSetup = await testRender(
        () => (
          <box>
            <Show when={visible()}>
              <text>Visible content</text>
            </Show>
            <text>Always visible</text>
          </box>
        ),
        { width: 20, height: 8 },
      )

      await testSetup.renderOnce()
      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Visible content")
      expect(frame).toContain("Always visible")

      setVisible(false)
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)

      frame = testSetup.captureCharFrame()
      expect(frame).not.toContain("Visible content")
      expect(frame).toContain("Always visible")
    })
  })

  describe("<Switch> and <Match> Components", () => {
    it("should render first matching <Match> in <Switch>", async () => {
      const [value, setValue] = createSignal("option1")

      testSetup = await testRender(
        () => (
          <box>
            <Switch fallback={<text>No match</text>}>
              <Match when={value() === "option1"}>
                <text>Option 1 selected</text>
              </Match>
              <Match when={value() === "option2"}>
                <text>Option 2 selected</text>
              </Match>
              <Match when={value() === "option3"}>
                <text>Option 3 selected</text>
              </Match>
            </Switch>
          </box>
        ),
        { width: 25, height: 5 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Option 1 selected")
      expect(frame).not.toContain("Option 2 selected")

      setValue("option2")
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Option 2 selected")
      expect(frame).not.toContain("Option 1 selected")

      setValue("unknown")
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("No match")
    })

    it("should handle reactive conditions with <Switch>", async () => {
      const [score, setScore] = createSignal(85)

      testSetup = await testRender(
        () => (
          <box>
            <Switch>
              <Match when={score() >= 90}>
                <text>Grade: A</text>
              </Match>
              <Match when={score() >= 80}>
                <text>Grade: B</text>
              </Match>
              <Match when={score() >= 70}>
                <text>Grade: C</text>
              </Match>
              <Match when={true}>
                <text>Grade: F</text>
              </Match>
            </Switch>
          </box>
        ),
        { width: 15, height: 5 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Grade: B")

      setScore(95)
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Grade: A")

      setScore(65)
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Grade: F")
    })
  })

  describe("<Index> Component", () => {
    it("should iterate over array with <Index> providing index access", async () => {
      const items = ["Apple", "Banana", "Cherry"]

      testSetup = await testRender(
        () => (
          <box>
            <Index each={items}>{(item, index) => <text>{`${index}. ${item()}`}</text>}</Index>
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()

      expect(frame).toContain("0. Apple")
      expect(frame).toContain("1. Banana")
      expect(frame).toContain("2. Cherry")
    })

    it("should handle reactive updates with <Index>", async () => {
      const [items, setItems] = createSignal([10, 20])

      testSetup = await testRender(
        () => (
          <box>
            <Index each={items()}>
              {(item, index) => (
                <text>
                  Index {index}: {item()}
                </text>
              )}
            </Index>
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Index 0: 10")
      expect(frame).toContain("Index 1: 20")

      setItems([10, 20, 30, 40])
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Index 0: 10")
      expect(frame).toContain("Index 3: 40")
    })

    it("should work with complex data structures in <Index>", async () => {
      const data = [
        { name: "Alice", score: 95 },
        { name: "Bob", score: 87 },
        { name: "Charlie", score: 92 },
      ]

      testSetup = await testRender(
        () => (
          <box>
            <Index each={data}>
              {(item, index) => (
                <text>
                  #{index + 1} {item().name}: {item().score} points
                </text>
              )}
            </Index>
          </box>
        ),
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()

      expect(frame).toContain("#1 Alice: 95 points")
      expect(frame).toContain("#2 Bob: 87 points")
      expect(frame).toContain("#3 Charlie: 92 points")
    })
  })

  describe("<ErrorBoundary> Component", () => {
    it("should catch and handle errors with <ErrorBoundary>", async () => {
      const [shouldError, setShouldError] = createSignal(false)

      const ErrorComponent = ({ shouldError }: { shouldError: () => boolean }) => {
        createEffect(() => {
          if (shouldError()) {
            throw new Error("Test error")
          }
        })
        return <text>Normal content</text>
      }

      testSetup = await testRender(
        () => (
          <box>
            <ErrorBoundary fallback={(err: any) => <text>Error caught: {err.message}</text>}>
              <ErrorComponent shouldError={shouldError} />
            </ErrorBoundary>
          </box>
        ),
        { width: 30, height: 5 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Normal content")
      expect(frame).not.toContain("Error caught")

      setShouldError(true)
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Error caught: Test error")
      expect(frame).not.toContain("Normal content")
    })

    it("should handle nested error boundaries", async () => {
      const [shouldErrorOuter, setShouldErrorOuter] = createSignal(false)
      const [shouldErrorInner, setShouldErrorInner] = createSignal(false)

      const InnerComponent = () => {
        createEffect(() => {
          if (shouldErrorInner()) {
            throw new Error("Inner error")
          }
        })
        return <text>Inner content</text>
      }

      const OuterComponent = () => {
        createEffect(() => {
          if (shouldErrorOuter()) {
            throw new Error("Outer error")
          }
        })
        return (
          <ErrorBoundary fallback={(err: any) => <text>Inner boundary: {err.message}</text>}>
            <InnerComponent />
          </ErrorBoundary>
        )
      }

      testSetup = await testRender(
        () => (
          <box>
            <ErrorBoundary fallback={(err: any) => <text>Outer boundary: {err.message}</text>}>
              <OuterComponent />
            </ErrorBoundary>
          </box>
        ),
        { width: 40, height: 5 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Inner content")

      setShouldErrorInner(true)
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Inner boundary: Inner error")

      // Note: Once an ErrorBoundary catches an error, it stays in error state
    })
  })

  describe("Combined Control Flow", () => {
    it("should handle <For> inside <Show>", async () => {
      const [showList, setShowList] = createSignal(true)
      const [items, setItems] = createSignal(["A", "B", "C"])

      testSetup = await testRender(
        () => (
          <box>
            <Show when={showList()} fallback={<text>List is hidden</text>}>
              <For each={items()}>{(item) => <text>Item: {item}</text>}</For>
            </Show>
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(3)

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item: A")
      expect(frame).toContain("Item: C")

      setShowList(false)
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(1)

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("List is hidden")
      expect(frame).not.toContain("Item: A")
    })

    it("should handle <Show> inside <text>", async () => {
      const [showExtra, setShowExtra] = createSignal(true)

      testSetup = await testRender(
        () => (
          <box>
            <text>
              Base text
              <Show when={showExtra()}>
                <span style={{ fg: "red" }}> extra styled text</span>
              </Show>
            </text>
          </box>
        ),
        { width: 30, height: 5 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Base text")
      expect(frame).toContain("extra styled text")

      setShowExtra(false)
      await testSetup.renderOnce()
      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Base text")
      expect(frame).not.toContain("extra styled text")
    })

    it("should handle <Show> inside <span>/<b>", async () => {
      const [showExtra, setShowExtra] = createSignal(true)

      testSetup = await testRender(
        () => (
          <box>
            <text>
              Base text
              <br />
              <span style={{ fg: "red" }}>
                <Show when={showExtra()}>extra styled text</Show>
              </span>
              <br />
              <b>
                <Show when={showExtra()}>extra bold text</Show>
              </b>
            </text>
          </box>
        ),
        { width: 30, height: 5 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      console.log(frame)
      expect(frame).toContain("Base text")
      expect(frame).toContain("extra styled text")
      expect(frame).toContain("extra bold text")

      setShowExtra(false)
      await testSetup.renderOnce()
      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Base text")
      expect(frame).not.toContain("extra styled text")
      expect(frame).not.toContain("extra bold text")
    })

    it("should handle <Show> inside <For>", async () => {
      const items = ["A", "B", "C", "D"]
      const [visibleItems, setVisibleItems] = createSignal(new Set(["A", "C"]))

      testSetup = await testRender(
        () => (
          <box>
            <For each={items}>
              {(item) => (
                <Show when={visibleItems().has(item)}>
                  <text>Item: {item}</text>
                </Show>
              )}
            </For>
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item: A")
      expect(frame).toContain("Item: C")
      expect(frame).not.toContain("Item: B")
      expect(frame).not.toContain("Item: D")

      setVisibleItems(new Set(["B", "D"]))
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item: B")
      expect(frame).toContain("Item: D")
      expect(frame).not.toContain("Item: A")
      expect(frame).not.toContain("Item: C")
    })

    it("should handle <Switch> with <For> inside matches", async () => {
      const [mode, setMode] = createSignal<"list" | "grid">("list")
      const items = ["One", "Two", "Three"]

      testSetup = await testRender(
        () => (
          <box>
            <Switch>
              <Match when={mode() === "list"}>
                <For each={items}>{(item) => <text>• {item}</text>}</For>
              </Match>
              <Match when={mode() === "grid"}>
                <For each={items}>{(item) => <text>[{item}]</text>}</For>
              </Match>
            </Switch>
          </box>
        ),
        { width: 25, height: 10 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("• One")
      expect(frame).toContain("• Two")
      expect(frame).toContain("• Three")

      setMode("grid")
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("[One]")
      expect(frame).toContain("[Two]")
      expect(frame).toContain("[Three]")
      expect(frame).not.toContain("• One")
    })

    it("should be able to anchor to slot nodes", async () => {
      testSetup = await testRender(
        () => (
          <box>
            <box border title="A" />
            <Show when={false}>
              <box border title="C" />
            </Show>
            <Show when={true}>
              <box border title="B" />
            </Show>
          </box>
        ),
        { width: 25, height: 10 },
      )
      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("A")
      expect(frame).toContain("B")
      expect(frame).not.toContain("C")
      // Consistent ordering
      expect(frame).toMatchSnapshot()
    })
  })
})
