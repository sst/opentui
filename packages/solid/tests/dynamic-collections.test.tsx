import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { createSignal } from "solid-js"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("SolidJS Renderer - Dynamic Collections", () => {
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

  describe("Basic Array Operations", () => {
    it("should render initial array items correctly", async () => {
      const items = ["Item 1", "Item 2", "Item 3"]

      testSetup = await testRender(
        () => (
          <box>
            {items.map((item, index) => (
              <text>{item}</text>
            ))}
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()

      expect(frame).toContain("Item 1")
      expect(frame).toContain("Item 2")
      expect(frame).toContain("Item 3")

      const children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(3)
    })

    it("should handle adding items to array", async () => {
      const [items, setItems] = createSignal(["Item 1", "Item 2"])

      testSetup = await testRender(
        () => (
          <box>
            {items().map((item, index) => (
              <text>{item}</text>
            ))}
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)

      setItems(["Item 1", "Item 2", "Item 3"])
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(3)

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item 3")
    })

    it("should handle removing items from array", async () => {
      const [items, setItems] = createSignal(["Item 1", "Item 2", "Item 3"])

      testSetup = await testRender(
        () => (
          <box>
            {items().map((item, index) => (
              <text>{item}</text>
            ))}
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(3)

      setItems(["Item 1", "Item 3"])
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item 1")
      expect(frame).toContain("Item 3")
      expect(frame).not.toContain("Item 2")
    })

    it("should handle updating specific array items", async () => {
      const [items, setItems] = createSignal(["First", "Second", "Third"])

      testSetup = await testRender(
        () => (
          <box>
            {items().map((item, index) => (
              <text>{item}</text>
            ))}
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toContain("Second")

      setItems(["First", "Updated", "Third"])
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toContain("Updated")
      expect(frame).not.toContain("Second")
    })

    it("should handle empty array", async () => {
      const [items, setItems] = createSignal(["Item 1", "Item 2"])

      testSetup = await testRender(
        () => (
          <box>
            {items().map((item, index) => (
              <text>{item}</text>
            ))}
          </box>
        ),
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)

      setItems([])
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(0)
    })
  })

  describe("Reactive Collection Updates", () => {
    it("should handle reactive signal updates to collections", async () => {
      const [count, setCount] = createSignal(3)
      const items = () => Array.from({ length: count() }, (_, i) => `Item ${i + 1}`)

      testSetup = await testRender(
        () => (
          <box>
            {items().map((item, index) => (
              <text>{item}</text>
            ))}
          </box>
        ),
        { width: 20, height: 15 },
      )

      await testSetup.renderOnce()
      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(3)

      setCount(5)
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(5)

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Item 5")
    })

    it("should handle complex object collections", async () => {
      const [todos, setTodos] = createSignal([
        { id: 1, text: "Learn SolidJS", completed: false },
        { id: 2, text: "Build TUI", completed: true },
      ])

      testSetup = await testRender(
        () => (
          <box>
            {todos().map((todo) => (
              <text>
                {todo.completed ? "✓" : "○"} {todo.text}
              </text>
            ))}
          </box>
        ),
        { width: 30, height: 10 },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("✓ Build TUI")
      expect(frame).toContain("○ Learn SolidJS")

      setTodos([
        { id: 1, text: "Learn SolidJS", completed: true },
        { id: 2, text: "Build TUI", completed: true },
        { id: 3, text: "Write Tests", completed: false },
      ])
      await testSetup.renderOnce()

      const updatedFrame = testSetup.captureCharFrame()
      expect(updatedFrame).toContain("✓ Learn SolidJS")
      expect(updatedFrame).toContain("Write Tests")
    })

    it("should handle collection with conditional rendering", async () => {
      const [items, setItems] = createSignal([1, 2, 3, 4, 5])
      const [showEven, setShowEven] = createSignal(false)

      testSetup = await testRender(
        () => (
          <box>
            {items()
              .filter((item) => !showEven() || item % 2 === 0)
              .map((item, index) => (
                <text>Number: {item}</text>
              ))}
          </box>
        ),
        { width: 20, height: 15 },
      )

      await testSetup.renderOnce()
      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(5)

      setShowEven(true)
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2) // Only even numbers: 2, 4

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Number: 2")
      expect(frame).toContain("Number: 4")
      expect(frame).not.toContain("Number: 1")
    })
  })

  describe("Nested Dynamic Collections", () => {
    it("should handle nested arrays", async () => {
      const [matrix, setMatrix] = createSignal([
        [1, 2],
        [3, 4],
        [5, 6],
      ])

      testSetup = await testRender(
        () => (
          <box>
            {matrix().map((row, rowIndex) => (
              <box>
                {row.map((cell, cellIndex) => (
                  <text>{cell}</text>
                ))}
              </box>
            ))}
          </box>
        ),
        { width: 20, height: 20 },
      )

      await testSetup.renderOnce()
      let rootChildren = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(rootChildren.length).toBe(3) // 3 rows

      // Each row should have 2 children
      rootChildren.forEach((row) => {
        expect(row.getChildren().length).toBe(2)
      })

      setMatrix([
        [1, 2, 3],
        [4, 5, 6],
      ])
      await testSetup.renderOnce()

      rootChildren = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(rootChildren.length).toBe(2) // 2 rows

      rootChildren.forEach((row) => {
        expect(row.getChildren().length).toBe(3) // 3 columns
      })
    })

    it("should handle tree-like structures", async () => {
      const [tree, setTree] = createSignal([
        {
          name: "Root 1",
          children: [{ name: "Child 1.1" }, { name: "Child 1.2" }],
        },
        {
          name: "Root 2",
          children: [{ name: "Child 2.1" }],
        },
      ])

      testSetup = await testRender(
        () => (
          <box>
            {tree().map((node, index) => (
              <box>
                <text>{node.name}</text>
                {node.children.map((child, childIndex) => (
                  <text> └─ {child.name}</text>
                ))}
              </box>
            ))}
          </box>
        ),
        { width: 30, height: 20 },
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Root 1")
      expect(frame).toContain("└─ Child 1.1")
      expect(frame).toContain("└─ Child 1.2")
      expect(frame).toContain("Root 2")
      expect(frame).toContain("└─ Child 2.1")
    })
  })

  describe("Edge Cases", () => {
    it("should handle collections with null/undefined values", async () => {
      const [items, setItems] = createSignal(["Valid", null, "Another", undefined, "Last"])

      testSetup = await testRender(
        () => <box>{items().map((item, index) => (item ? <text>{item}</text> : <text>[null]</text>))}</box>,
        { width: 20, height: 10 },
      )

      await testSetup.renderOnce()
      const children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(5)

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Valid")
      expect(frame).toContain("[null]")
      expect(frame).toContain("Another")
      expect(frame).toContain("Last")
    })

    it("should handle rapid collection updates", async () => {
      const [items, setItems] = createSignal(["Initial"])

      testSetup = await testRender(
        () => (
          <box>
            {items().map((item, index) => (
              <text>{item}</text>
            ))}
          </box>
        ),
        { width: 10, height: 3 },
      )

      await testSetup.renderOnce()

      // Rapid updates
      setItems(["First"])
      setItems(["First", "Second"])
      setItems(["First", "Second", "Third"])
      setItems(["First", "Second"]) // Remove one
      setItems(["First", "Second", "Fourth"]) // Update last

      await testSetup.renderOnce()

      const children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(3)

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("First")
      expect(frame).toContain("Second")
      expect(frame).toContain("Fourth")
      expect(frame).toMatchSnapshot()
    })

    it("should handle collections with mixed component types", async () => {
      const [items, setItems] = createSignal([
        { type: "text", content: "First text" },
        { type: "text", content: "Second text" },
        { type: "box", title: "Container" },
      ])

      testSetup = await testRender(
        () => (
          <box>
            {items().map((item, index) => {
              switch (item.type) {
                case "text":
                  return <text>{item.content}</text>
                case "box":
                  return (
                    <box title={item.title}>
                      <text>Box content</text>
                    </box>
                  )
                default:
                  return null
              }
            })}
          </box>
        ),
        { width: 40, height: 20 },
      )

      await testSetup.renderOnce()
      const children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(3)

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("First text")
      expect(frame).toContain("Second text")
      expect(frame).toContain("Box content")
    })
  })

  describe("Collection Transformations", () => {
    it("should handle sorting collections", async () => {
      const [items, setItems] = createSignal([3, 1, 4, 1, 5])
      const [sortOrder, setSortOrder] = createSignal<"asc" | "desc">("asc")

      testSetup = await testRender(
        () => (
          <box>
            {items()
              .slice()
              .sort((a, b) => (sortOrder() === "asc" ? a - b : b - a))
              .map((item, index) => (
                <text>Number: {item}</text>
              ))}
          </box>
        ),
        { width: 10, height: 5 },
      )

      await testSetup.renderOnce()
      let frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()

      setSortOrder("desc")
      await testSetup.renderOnce()

      frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should handle filtering collections", async () => {
      const [items, setItems] = createSignal([
        { name: "Apple", category: "fruit" },
        { name: "Carrot", category: "vegetable" },
        { name: "Banana", category: "fruit" },
        { name: "Broccoli", category: "vegetable" },
      ])
      const [filter, setFilter] = createSignal<string>("all")

      testSetup = await testRender(
        () => (
          <box>
            {items()
              .filter((item) => filter() === "all" || item.category === filter())
              .map((item, index) => (
                <text>
                  {item.name} ({item.category})
                </text>
              ))}
          </box>
        ),
        { width: 20, height: 5 },
      )

      await testSetup.renderOnce()
      let children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(4)

      setFilter("fruit")
      await testSetup.renderOnce()

      children = testSetup.renderer.root.getChildren()[0]!.getChildren()
      expect(children.length).toBe(2)

      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Apple")
      expect(frame).toContain("Banana")
      expect(frame).not.toContain("Carrot")
      expect(frame).toMatchSnapshot()
    })
  })
})
