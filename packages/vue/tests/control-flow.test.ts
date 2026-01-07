import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { defineComponent, h, ref, nextTick, onErrorCaptured, Fragment } from "vue"
import { testRender } from "../src/test-utils"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Vue Renderer | Control Flow Tests", () => {
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

  describe("List Rendering", () => {
    it("should render items with .map()", async () => {
      const items = ["First", "Second", "Third"]

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              items.map((item, index) => h("textRenderable", { key: item }, `${index + 1}. ${item}`)),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 10 })
      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()

      expect(frame).toContain("1. First")
      expect(frame).toContain("2. Second")
      expect(frame).toContain("3. Third")

      const children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(3)
    })

    it("should handle reactive array updates", async () => {
      const items = ref(["A", "B"])

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              items.value.map((item) => h("textRenderable", { key: item }, `Item: ${item}`)),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 10 })
      await testSetup.renderOnce()

      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)

      items.value = ["A", "B", "C", "D"]
      await nextTick()
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(4)

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item: A")
      expect(frame).toContain("Item: D")
    })

    it("should handle empty arrays", async () => {
      const items = ref(["Item"])

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              items.value.map((item) => h("textRenderable", { key: item }, item)),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 10 })
      await testSetup.renderOnce()

      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(1)

      items.value = []
      await nextTick()
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(0)
    })

    it("should handle complex objects in arrays", async () => {
      const todos = ref([
        { id: 1, text: "Learn Vue", done: false },
        { id: 2, text: "Build TUI", done: true },
      ])

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              todos.value.map((todo, index) =>
                h("textRenderable", { key: todo.id }, `${index + 1}. ${todo.done ? "[x]" : "[ ]"} ${todo.text}`),
              ),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 10 })
      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()

      expect(frame).toContain("1. [ ] Learn Vue")
      expect(frame).toContain("2. [x] Build TUI")
    })

    it("should handle array item removal", async () => {
      const items = ref(["A", "B", "C", "D"])

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              items.value.map((item) => h("textRenderable", { key: item }, `Item: ${item}`)),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 10 })
      await testSetup.renderOnce()

      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(4)

      items.value = ["A", "D"]
      await nextTick()
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item: A")
      expect(frame).toContain("Item: D")
      expect(frame).not.toContain("Item: B")
      expect(frame).not.toContain("Item: C")
    })

    it("should handle array reordering", async () => {
      const items = ref(["First", "Second", "Third"])

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              { id: "container" },
              items.value.map((item) =>
                h("boxRenderable", { key: item, id: `item-${item}` }, [h("textRenderable", {}, item)]),
              ),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 10 })
      await testSetup.renderOnce()

      const container = testSetup.renderer.root.findDescendantById("container")!
      let children = container.getChildren()
      expect(children[0]?.id).toBe("item-First")
      expect(children[1]?.id).toBe("item-Second")
      expect(children[2]?.id).toBe("item-Third")

      items.value = ["Third", "Second", "First"]
      await nextTick()
      await testSetup.renderOnce()

      children = container.getChildren()
      expect(children[0]?.id).toBe("item-Third")
      expect(children[1]?.id).toBe("item-Second")
      expect(children[2]?.id).toBe("item-First")
    })
  })

  describe("Conditional Rendering", () => {
    it("should conditionally render content with ternary operator", async () => {
      const showContent = ref(true)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("boxRenderable", {}, [
              showContent.value ? h("textRenderable", {}, "Main content") : h("textRenderable", {}, "Fallback content"),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Main content")
      expect(frame).not.toContain("Fallback content")

      showContent.value = false
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Fallback content")
      expect(frame).not.toContain("Main content")
    })

    it("should handle && operator for conditional rendering", async () => {
      const visible = ref(true)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              [
                visible.value && h("textRenderable", {}, "Visible content"),
                h("textRenderable", {}, "Always visible"),
              ].filter(Boolean),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 8 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Visible content")
      expect(frame).toContain("Always visible")

      visible.value = false
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).not.toContain("Visible content")
      expect(frame).toContain("Always visible")
    })

    it("should handle reactive condition changes", async () => {
      const count = ref(5)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("boxRenderable", {}, [
              count.value > 3
                ? h("textRenderable", {}, `Count is high: ${count.value}`)
                : h("textRenderable", {}, "Count too low"),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 25, height: 5 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Count is high: 5")

      count.value = 2
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Count too low")
      expect(frame).not.toContain("Count is high")
    })

    it("should verify correct ordering when conditionally rendering", async () => {
      const showContent = ref(false)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              { id: "container" },
              [
                h("boxRenderable", { id: "first" }),
                showContent.value ? h("boxRenderable", { id: "second" }) : null,
                h("boxRenderable", { id: "third" }),
              ].filter(Boolean),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      showContent.value = true
      await nextTick()
      await testSetup.renderOnce()

      const container = testSetup.renderer.root.findDescendantById("container")!
      const children = container.getChildren()

      expect(children.length).toBe(3)
      expect(children[0]!.id).toBe("first")
      expect(children[1]!.id).toBe("second")
      expect(children[2]!.id).toBe("third")
    })

    it("should conditionally render content in fragment with correct order", async () => {
      const showContent = ref(false)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              { id: "fragment-container" },
              [
                h("boxRenderable", { id: "first" }),
                showContent.value ? h("boxRenderable", { id: "second" }) : null,
                h("boxRenderable", { id: "third" }),
              ].filter(Boolean),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      showContent.value = true
      await nextTick()
      await testSetup.renderOnce()

      const container = testSetup.renderer.root.findDescendantById("fragment-container")!
      const children = container.getChildren()

      expect(children.length).toBe(3)
      expect(children[0]!.id).toBe("first")
      expect(children[1]!.id).toBe("second")
      expect(children[2]!.id).toBe("third")
    })

    it("should handle null/undefined in children array", async () => {
      const showFirst = ref(true)
      const showSecond = ref(false)
      const showThird = ref(true)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              [
                showFirst.value ? h("textRenderable", {}, "First") : null,
                showSecond.value ? h("textRenderable", {}, "Second") : undefined,
                showThird.value ? h("textRenderable", {}, "Third") : null,
              ].filter(Boolean),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 8 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("First")
      expect(frame).not.toContain("Second")
      expect(frame).toContain("Third")

      showFirst.value = false
      showSecond.value = true
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).not.toContain("First")
      expect(frame).toContain("Second")
      expect(frame).toContain("Third")
    })
  })

  describe("Switch/Match Equivalent", () => {
    it("should render based on value matching using switch statement", async () => {
      const value = ref("option1")

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("boxRenderable", {}, [
              (() => {
                switch (value.value) {
                  case "option1":
                    return h("textRenderable", {}, "Option 1 selected")
                  case "option2":
                    return h("textRenderable", {}, "Option 2 selected")
                  default:
                    return h("textRenderable", {}, "No match")
                }
              })(),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 25, height: 5 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Option 1 selected")
      expect(frame).not.toContain("Option 2 selected")

      value.value = "option2"
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Option 2 selected")
      expect(frame).not.toContain("Option 1 selected")

      value.value = "unknown"
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("No match")
    })

    it("should handle reactive conditions with if/else chains", async () => {
      const score = ref(85)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("boxRenderable", {}, [
              (() => {
                if (score.value >= 90) {
                  return h("textRenderable", {}, "Grade: A")
                } else if (score.value >= 80) {
                  return h("textRenderable", {}, "Grade: B")
                } else if (score.value >= 70) {
                  return h("textRenderable", {}, "Grade: C")
                } else {
                  return h("textRenderable", {}, "Grade: F")
                }
              })(),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 15, height: 5 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Grade: B")

      score.value = 95
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Grade: A")

      score.value = 65
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Grade: F")
    })

    it("should handle object-based matching pattern", async () => {
      type Status = "loading" | "success" | "error"
      const status = ref<Status>("loading")

      const renderStatus = (s: Status) => {
        const renderers: Record<Status, () => ReturnType<typeof h>> = {
          loading: () => h("textRenderable", {}, "Loading..."),
          success: () => h("textRenderable", {}, "Success!"),
          error: () => h("textRenderable", {}, "Error occurred"),
        }
        return renderers[s]()
      }

      const TestComponent = defineComponent({
        setup() {
          return () => h("boxRenderable", {}, [renderStatus(status.value)])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Loading...")

      status.value = "success"
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Success!")

      status.value = "error"
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Error occurred")
    })
  })

  describe("Error Handling", () => {
    it("should catch and handle errors with onErrorCaptured", async () => {
      const shouldError = ref(false)
      const errorMessage = ref("")

      const ErrorComponent = defineComponent({
        props: {
          shouldError: { type: Boolean, default: false },
        },
        setup(props) {
          return () => {
            if (props.shouldError) {
              throw new Error("Test error")
            }
            return h("textRenderable", {}, "Normal content")
          }
        },
      })

      const TestComponent = defineComponent({
        setup() {
          onErrorCaptured((err: Error) => {
            errorMessage.value = err.message
            return false
          })

          return () =>
            h("boxRenderable", {}, [
              errorMessage.value
                ? h("textRenderable", {}, `Error caught: ${errorMessage.value}`)
                : h(ErrorComponent, { shouldError: shouldError.value }),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 5 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Normal content")
      expect(frame).not.toContain("Error caught")

      shouldError.value = true
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Error caught: Test error")
      expect(frame).not.toContain("Normal content")
    })
  })

  describe("Combined Control Flow", () => {
    it("should handle list inside conditional", async () => {
      const showList = ref(true)
      const items = ref(["A", "B", "C"])

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              showList.value
                ? items.value.map((item) => h("textRenderable", { key: item }, `Item: ${item}`))
                : [h("textRenderable", {}, "List is hidden")],
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 10 })
      await testSetup.renderOnce()

      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(3)

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item: A")
      expect(frame).toContain("Item: C")

      showList.value = false
      await nextTick()
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(1)

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("List is hidden")
      expect(frame).not.toContain("Item: A")
    })

    it("should handle conditional inside list (filtering)", async () => {
      const items = ["A", "B", "C", "D"]
      const visibleItems = ref(new Set(["A", "C"]))

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              items
                .filter((item) => visibleItems.value.has(item))
                .map((item) => h("textRenderable", { key: item }, `Item: ${item}`)),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 10 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item: A")
      expect(frame).toContain("Item: C")
      expect(frame).not.toContain("Item: B")
      expect(frame).not.toContain("Item: D")

      visibleItems.value = new Set(["B", "D"])
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item: B")
      expect(frame).toContain("Item: D")
      expect(frame).not.toContain("Item: A")
      expect(frame).not.toContain("Item: C")
    })

    it("should handle nested conditionals", async () => {
      const showOuter = ref(true)
      const showInner = ref(true)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("boxRenderable", {}, [
              showOuter.value
                ? h("boxRenderable", {}, [
                    h("textRenderable", {}, "Outer content"),
                    showInner.value
                      ? h("textRenderable", {}, "Inner content")
                      : h("textRenderable", {}, "Inner hidden"),
                  ])
                : h("textRenderable", {}, "Outer hidden"),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 10 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Outer content")
      expect(frame).toContain("Inner content")

      showInner.value = false
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Outer content")
      expect(frame).toContain("Inner hidden")
      expect(frame).not.toContain("Inner content")

      showOuter.value = false
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Outer hidden")
      expect(frame).not.toContain("Outer content")
    })

    it("should handle switch with list inside matches", async () => {
      const mode = ref<"list" | "grid">("list")
      const items = ["One", "Two", "Three"]

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("boxRenderable", {}, [
              (() => {
                switch (mode.value) {
                  case "list":
                    return h(
                      Fragment,
                      items.map((item) => h("textRenderable", { key: `list-${item}` }, `* ${item}`)),
                    )
                  case "grid":
                    return h(
                      Fragment,
                      items.map((item) => h("textRenderable", { key: `grid-${item}` }, `[${item}]`)),
                    )
                  default:
                    return h("textRenderable", {}, "Unknown mode")
                }
              })(),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 25, height: 10 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("* One")
      expect(frame).toContain("* Two")
      expect(frame).toContain("* Three")

      mode.value = "grid"
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("[One]")
      expect(frame).toContain("[Two]")
      expect(frame).toContain("[Three]")
      expect(frame).not.toContain("* One")
    })

    it("should handle complex dynamic data with mixed control flow", async () => {
      interface Item {
        id: string
        name: string
        visible: boolean
        children?: string[]
      }

      const items = ref<Item[]>([
        { id: "1", name: "Parent 1", visible: true, children: ["Child A", "Child B"] },
        { id: "2", name: "Parent 2", visible: false },
        { id: "3", name: "Parent 3", visible: true, children: ["Child C"] },
      ])

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              items.value
                .filter((item) => item.visible)
                .map((item) =>
                  h("boxRenderable", { key: item.id }, [
                    h("textRenderable", {}, `Name: ${item.name}`),
                    ...(item.children
                      ? item.children.map((child) => h("textRenderable", { key: child }, `  - ${child}`))
                      : []),
                  ]),
                ),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 25, height: 15 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Name: Parent 1")
      expect(frame).toContain("- Child A")
      expect(frame).toContain("- Child B")
      expect(frame).not.toContain("Name: Parent 2")
      expect(frame).toContain("Name: Parent 3")
      expect(frame).toContain("- Child C")

      items.value = [
        { id: "1", name: "Parent 1", visible: false },
        { id: "2", name: "Parent 2", visible: true, children: ["Child D"] },
        { id: "3", name: "Parent 3", visible: true, children: ["Child C", "Child E"] },
      ]
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).not.toContain("Name: Parent 1")
      expect(frame).toContain("Name: Parent 2")
      expect(frame).toContain("- Child D")
      expect(frame).toContain("- Child E")
    })

    it("should find descendants by id through conditional renderables", async () => {
      const showContent = ref(false)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              { id: "parent-box" },
              [
                h("boxRenderable", { id: "always-visible", style: { border: true }, title: "Always" }),
                showContent.value
                  ? h("boxRenderable", { id: "conditional-child", style: { border: true }, title: "Conditional" }, [
                      h("boxRenderable", { id: "nested-child", style: { border: true }, title: "Nested" }),
                    ])
                  : null,
                h("boxRenderable", { id: "another-visible", style: { border: true }, title: "Another" }),
              ].filter(Boolean),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 15 })
      await testSetup.renderOnce()

      const parentBox = testSetup.renderer.root.findDescendantById("parent-box")
      expect(parentBox).toBeDefined()

      const anotherVisible = parentBox?.findDescendantById("another-visible")
      expect(anotherVisible).toBeDefined()
      expect(anotherVisible?.id).toBe("another-visible")
    })

    it("should handle rapid reactive updates", async () => {
      const count = ref(0)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("boxRenderable", {}, [
              count.value % 2 === 0
                ? h("textRenderable", {}, `Even: ${count.value}`)
                : h("textRenderable", {}, `Odd: ${count.value}`),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })

      for (let i = 0; i < 10; i++) {
        count.value = i
        await nextTick()
        await testSetup.renderOnce()

        const frame = testSetup.captureCharFrame()
        if (i % 2 === 0) {
          expect(frame).toContain(`Even: ${i}`)
        } else {
          expect(frame).toContain(`Odd: ${i}`)
        }
      }
    })

    it("should handle conditional text elements", async () => {
      const showExtra = ref(true)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              [
                h("textRenderable", {}, "Base text"),
                showExtra.value ? h("textRenderable", { style: { fg: "red" } }, "Extra text") : null,
              ].filter(Boolean),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 5 })
      await testSetup.renderOnce()

      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Base text")
      expect(frame).toContain("Extra text")

      showExtra.value = false
      await nextTick()
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Base text")
      expect(frame).not.toContain("Extra text")
    })
  })

  describe("Edge Cases", () => {
    it("should handle empty conditional blocks", async () => {
      const show = ref(false)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              [
                h("textRenderable", {}, "Before"),
                show.value ? h("textRenderable", {}, "Conditional") : null,
                h("textRenderable", {}, "After"),
              ].filter(Boolean),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 5 })
      await testSetup.renderOnce()

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Before")
      expect(frame).toContain("After")
      expect(frame).not.toContain("Conditional")

      const children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)
    })

    it("should handle deeply nested lists", async () => {
      const data = ref([
        {
          id: "1",
          items: [
            { id: "1-1", values: ["a", "b"] },
            { id: "1-2", values: ["c"] },
          ],
        },
        { id: "2", items: [{ id: "2-1", values: ["d", "e", "f"] }] },
      ])

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              data.value.map((group) =>
                h(
                  "boxRenderable",
                  { key: group.id },
                  group.items.map((item) =>
                    h(
                      "boxRenderable",
                      { key: item.id },
                      item.values.map((value) => h("textRenderable", { key: value }, value)),
                    ),
                  ),
                ),
              ),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 15 })
      await testSetup.renderOnce()

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("a")
      expect(frame).toContain("b")
      expect(frame).toContain("c")
      expect(frame).toContain("d")
      expect(frame).toContain("e")
      expect(frame).toContain("f")
    })

    it("should handle boolean false in array (not rendered)", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(
              "boxRenderable",
              {},
              [
                h("textRenderable", {}, "First"),
                false,
                h("textRenderable", {}, "Second"),
                null,
                h("textRenderable", {}, "Third"),
              ].filter(Boolean),
            )
        },
      })

      testSetup = await testRender(TestComponent, { width: 20, height: 10 })
      await testSetup.renderOnce()

      const children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(3)

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("First")
      expect(frame).toContain("Second")
      expect(frame).toContain("Third")
    })
  })
})
