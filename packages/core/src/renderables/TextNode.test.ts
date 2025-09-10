import { describe, expect, it } from "bun:test"
import { TextNodeRenderable, isTextNodeRenderable } from "./TextNode"
import { RGBA } from "../lib/RGBA"
import { StyledText, red, bold, t } from "../lib/styled-text"

describe("TextNodeRenderable", () => {
  describe("Constructor and Options", () => {
    it("should create TextNode with default options", () => {
      const node = new TextNodeRenderable({})

      expect(node.fg).toBeUndefined()
      expect(node.bg).toBeUndefined()
      expect(node.attributes).toBe(0)
      expect(node.children).toEqual([])
    })

    it("should create TextNode with custom options", () => {
      const fgColor = RGBA.fromInts(255, 0, 0, 255)
      const bgColor = RGBA.fromInts(0, 0, 255, 255)
      const attributes = 1

      const node = new TextNodeRenderable({
        fg: fgColor,
        bg: bgColor,
        attributes,
      })

      expect(node.fg).toEqual(fgColor)
      expect(node.bg).toEqual(bgColor)
      expect(node.attributes).toBe(attributes)
    })

    it("should parse color strings in constructor", () => {
      const node = new TextNodeRenderable({
        fg: "#ff0000",
        bg: "blue",
      })

      expect(node.fg?.r).toBe(1)
      expect(node.fg?.g).toBe(0)
      expect(node.fg?.b).toBe(0)
      expect(node.fg?.a).toBe(1)
      expect(node.bg?.r).toBe(0)
      expect(node.bg?.g).toBe(0)
      expect(node.bg?.b).toBe(1)
      expect(node.bg?.a).toBe(1)
    })

    it("should handle undefined colors", () => {
      const node = new TextNodeRenderable({
        fg: undefined,
        bg: undefined,
      })

      expect(node.fg).toBeUndefined()
      expect(node.bg).toBeUndefined()
    })
  })

  describe("Type Guard", () => {
    it("should identify TextNodeRenderable instances", () => {
      const node = new TextNodeRenderable({})
      const plainObject = {}

      expect(isTextNodeRenderable(node)).toBe(true)
      expect(isTextNodeRenderable(plainObject)).toBe(false)
      expect(isTextNodeRenderable(null)).toBe(false)
      expect(isTextNodeRenderable(undefined)).toBe(false)
    })
  })

  describe("add Method", () => {
    it("should add string child using add", () => {
      const node = new TextNodeRenderable({})

      const index = node.add("Hello")

      expect(index).toBe(0)
      expect(node.children).toEqual(["Hello"])
    })

    it("should add TextNode child using add", () => {
      const parent = new TextNodeRenderable({})
      const child = new TextNodeRenderable({})

      const index = parent.add(child)

      expect(index).toBe(0)
      expect(parent.children).toEqual([child])
    })

    it("should add multiple children sequentially", () => {
      const node = new TextNodeRenderable({})

      node.add("First")
      node.add("Second")
      const childNode = new TextNodeRenderable({})
      node.add(childNode)

      expect(node.children).toEqual(["First", "Second", childNode])
    })

    it("should add child at specific index using add method", () => {
      const node = new TextNodeRenderable({})
      const child1 = new TextNodeRenderable({})
      const child2 = new TextNodeRenderable({})

      node.add("First")
      node.add(child1, 0) // Insert at beginning
      node.add(child2, 2) // Insert at end

      expect(node.children).toEqual([child1, "First", child2])
    })

    it("should add string at specific index using add method", () => {
      const node = new TextNodeRenderable({})
      const child1 = new TextNodeRenderable({})

      node.add("First")
      node.add(child1, 0) // Insert at beginning
      node.add("Middle", 1) // Insert in middle
      node.add("Last") // Append at end

      expect(node.children).toEqual([child1, "Middle", "First", "Last"])
    })

    it("should reject non-TextNode children in add method", () => {
      const node = new TextNodeRenderable({})
      const invalidChild = { id: "invalid" }

      expect(() => {
        node.add(invalidChild as any, 0)
      }).toThrow("TextNodeRenderable only accepts strings, TextNodeRenderable instances, or StyledText instances")
    })

    it("should add StyledText child using add method", () => {
      const node = new TextNodeRenderable({})
      const styledText = new StyledText([
        { __isChunk: true, text: "Hello", fg: RGBA.fromInts(255, 0, 0, 255), attributes: 1 },
        { __isChunk: true, text: " World", fg: RGBA.fromInts(0, 255, 0, 255), attributes: 0 },
      ])

      const index = node.add(styledText)

      expect(index).toBe(0)
      expect(node.children).toHaveLength(2)
      expect(node.children[0]).toBeInstanceOf(TextNodeRenderable)
      expect(node.children[1]).toBeInstanceOf(TextNodeRenderable)

      const firstChild = node.children[0] as TextNodeRenderable
      const secondChild = node.children[1] as TextNodeRenderable

      expect(firstChild.children).toEqual(["Hello"])
      expect(firstChild.fg).toEqual(RGBA.fromInts(255, 0, 0, 255))
      expect(firstChild.attributes).toBe(1)

      expect(secondChild.children).toEqual([" World"])
      expect(secondChild.fg).toEqual(RGBA.fromInts(0, 255, 0, 255))
      expect(secondChild.attributes).toBe(0)
    })

    it("should add StyledText child at specific index using add method", () => {
      const node = new TextNodeRenderable({})
      node.add("First")
      node.add("Third")

      const styledText = new StyledText([
        { __isChunk: true, text: "Second", fg: RGBA.fromInts(255, 255, 0, 255), attributes: 2 },
      ])

      node.add(styledText, 1)

      expect(node.children).toHaveLength(3)
      expect(node.children[0]).toBe("First")
      expect(node.children[1]).toBeInstanceOf(TextNodeRenderable)
      expect(node.children[2]).toBe("Third")

      const styledChild = node.children[1] as TextNodeRenderable
      expect(styledChild.children).toEqual(["Second"])
      expect(styledChild.fg).toEqual(RGBA.fromInts(255, 255, 0, 255))
      expect(styledChild.attributes).toBe(2)
    })
  })

  describe("insertBefore and remove Methods", () => {
    it("should insert child before anchor node", () => {
      const node = new TextNodeRenderable({})
      const anchor = new TextNodeRenderable({})

      node.add("First")
      node.add(anchor)
      node.add("Last")

      node.insertBefore("Middle", anchor)

      expect(node.children).toEqual(["First", "Middle", anchor, "Last"])
    })

    it("should throw error when anchor node not found in insertBefore", () => {
      const node = new TextNodeRenderable({})
      const anchor = new TextNodeRenderable({})

      expect(() => {
        node.insertBefore("Test", anchor)
      }).toThrow("Anchor node not found in children")
    })

    it("should insert StyledText before anchor node", () => {
      const node = new TextNodeRenderable({})
      const anchor = new TextNodeRenderable({})
      anchor.add("Anchor")

      node.add("First")
      node.add(anchor)
      node.add("Last")

      const styledText = new StyledText([
        { __isChunk: true, text: "Middle", fg: RGBA.fromInts(128, 128, 128, 255), attributes: 4 },
      ])

      node.insertBefore(styledText, anchor)

      expect(node.children).toHaveLength(4)
      expect(node.children[0]).toBe("First")
      expect(node.children[1]).toBeInstanceOf(TextNodeRenderable)
      expect(node.children[2]).toBe(anchor)
      expect(node.children[3]).toBe("Last")

      const styledChild = node.children[1] as TextNodeRenderable
      expect(styledChild.children).toEqual(["Middle"])
      expect(styledChild.fg).toEqual(RGBA.fromInts(128, 128, 128, 255))
      expect(styledChild.attributes).toBe(4)
    })

    it("should remove child from node", () => {
      const node = new TextNodeRenderable({})
      const child = new TextNodeRenderable({})

      node.add("First")
      node.add(child)
      node.add("Last")

      node.remove(child)

      expect(node.children).toEqual(["First", "Last"])
    })

    it("should throw error when child not found in remove", () => {
      const node = new TextNodeRenderable({})
      const child = new TextNodeRenderable({})

      expect(() => {
        node.remove(child)
      }).toThrow("Child not found in children")
    })
  })

  describe("clear Method", () => {
    it("should clear all children and change log", () => {
      const node = new TextNodeRenderable({})

      node.add("Test")
      node.add(new TextNodeRenderable({}))

      expect(node.children).toHaveLength(2)

      node.clear()

      expect(node.children).toEqual([])
    })
  })

  describe("Style Inheritance and Merging", () => {
    it("should merge styles with parent styles", () => {
      const node = new TextNodeRenderable({
        fg: RGBA.fromInts(255, 0, 0, 255),
        attributes: 1,
      })

      const parentStyle = {
        bg: RGBA.fromInts(0, 0, 255, 255),
        attributes: 2,
      }

      const merged = node.mergeStyles(parentStyle)

      expect(merged.fg).toEqual(RGBA.fromInts(255, 0, 0, 255))
      expect(merged.bg).toEqual(RGBA.fromInts(0, 0, 255, 255))
      expect(merged.attributes).toBe(3)
    })

    it("should inherit undefined styles from parent", () => {
      const node = new TextNodeRenderable({
        fg: RGBA.fromInts(255, 0, 0, 255),
        // bg and attributes undefined (attributes defaults to 0)
      })

      const parentStyle = {
        bg: RGBA.fromInts(0, 0, 255, 255),
        attributes: 2,
      }

      const merged = node.mergeStyles(parentStyle)

      expect(merged.fg?.r).toBe(1)
      expect(merged.fg?.g).toBe(0)
      expect(merged.fg?.b).toBe(0)
      expect(merged.bg?.r).toBe(0)
      expect(merged.bg?.g).toBe(0)
      expect(merged.bg?.b).toBe(1)
      expect(merged.attributes).toBe(2)
    })
  })

  describe("gatherWithInheritedStyle Method", () => {
    it("should gather chunks with inherited styles", () => {
      const node = new TextNodeRenderable({
        fg: RGBA.fromInts(255, 0, 0, 255),
        bg: RGBA.fromInts(0, 0, 255, 255),
        attributes: 1,
      })

      node.add("Hello")
      node.add(" ")
      node.add("World")

      const chunks = node.gatherWithInheritedStyle()

      expect(chunks).toHaveLength(3)
      chunks.forEach((chunk) => {
        expect(chunk.fg).toEqual(RGBA.fromInts(255, 0, 0, 255))
        expect(chunk.bg).toEqual(RGBA.fromInts(0, 0, 255, 255))
        expect(chunk.attributes).toBe(1)
      })

      expect(chunks[0].text).toBe("Hello")
      expect(chunks[1].text).toBe(" ")
      expect(chunks[2].text).toBe("World")
    })

    it("should recursively gather from child TextNodes", () => {
      const parent = new TextNodeRenderable({
        fg: RGBA.fromInts(255, 0, 0, 255),
      })

      const child = new TextNodeRenderable({
        bg: RGBA.fromInts(0, 255, 0, 255),
      })

      child.add("Child")
      parent.add("Parent")
      parent.add(child)

      const chunks = parent.gatherWithInheritedStyle()

      expect(chunks).toHaveLength(2)
      expect(chunks[0].text).toBe("Parent")
      expect(chunks[0].fg).toEqual(RGBA.fromInts(255, 0, 0, 255))
      expect(chunks[0].bg).toBeUndefined()

      expect(chunks[1].text).toBe("Child")
      expect(chunks[1].fg).toEqual(RGBA.fromInts(255, 0, 0, 255)) // Inherited from parent
      expect(chunks[1].bg).toEqual(RGBA.fromInts(0, 255, 0, 255)) // Own style
    })
  })

  describe("Static Factory Methods", () => {
    it("should create TextNode from string using fromString", () => {
      const node = TextNodeRenderable.fromString("Hello World", {
        fg: "#ff0000",
        attributes: 1,
      })

      expect(node.children).toEqual(["Hello World"])
      expect(node.fg?.r).toBe(1)
      expect(node.fg?.g).toBe(0)
      expect(node.fg?.b).toBe(0)
      expect(node.attributes).toBe(1)
    })

    it("should create TextNode from nodes using fromNodes", () => {
      const child1 = new TextNodeRenderable({})
      const child2 = new TextNodeRenderable({})

      child1.add("First")
      child2.add("Second")

      const parent = TextNodeRenderable.fromNodes([child1, child2], {
        fg: RGBA.fromInts(255, 255, 0, 255),
      })

      expect(parent.children).toEqual([child1, child2])
      expect(parent.fg).toEqual(RGBA.fromInts(255, 255, 0, 255))
    })
  })

  describe("Utility Methods", () => {
    it("should convert to chunks using toChunks", () => {
      const node = new TextNodeRenderable({
        fg: "#00ff00",
      })

      node.add("Test")

      const chunks = node.toChunks()

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe("Test")
      expect(chunks[0].fg?.r).toBe(0)
      expect(chunks[0].fg?.g).toBe(1)
      expect(chunks[0].fg?.b).toBe(0)
    })

    it("should get children using getChildren", () => {
      const node = new TextNodeRenderable({})

      node.add("String child")
      const textNodeChild = new TextNodeRenderable({})
      node.add(textNodeChild)

      const children = node.getChildren()

      expect(children).toHaveLength(1)
      expect(children[0]).toBe(textNodeChild)
    })

    it("should get children count", () => {
      const node = new TextNodeRenderable({})

      expect(node.getChildrenCount()).toBe(0)

      node.add("First")
      expect(node.getChildrenCount()).toBe(1)

      node.add(new TextNodeRenderable({}))
      expect(node.getChildrenCount()).toBe(2)
    })

    it("should find renderable by id", () => {
      const node = new TextNodeRenderable({})

      const child1 = new TextNodeRenderable({ id: "child1" })
      const child2 = new TextNodeRenderable({ id: "child2" })

      node.add(child1)
      node.add(child2)

      expect(node.getRenderable("child1")).toBe(child1)
      expect(node.getRenderable("child2")).toBe(child2)
      expect(node.getRenderable("nonexistent")).toBeUndefined()
    })
  })

  describe("StyledText Integration", () => {
    it("should work with template literal styled text", () => {
      const node = new TextNodeRenderable({})
      const styled = t`Hello ${red("World")} with ${bold("bold")} text!`

      node.add(styled)

      expect(node.children).toHaveLength(5) // All parts become TextNodeRenderable instances
      expect(node.children[0]).toBeInstanceOf(TextNodeRenderable)
      expect(node.children[1]).toBeInstanceOf(TextNodeRenderable)
      expect(node.children[2]).toBeInstanceOf(TextNodeRenderable)
      expect(node.children[3]).toBeInstanceOf(TextNodeRenderable)
      expect(node.children[4]).toBeInstanceOf(TextNodeRenderable)

      // Check first chunk: "Hello " (no styling)
      const helloChild = node.children[0] as TextNodeRenderable
      expect(helloChild.children).toEqual(["Hello "])
      expect(helloChild.fg).toBeUndefined()
      expect(helloChild.attributes).toBe(0)

      // Check second chunk: "World" (red styling)
      const redChild = node.children[1] as TextNodeRenderable
      expect(redChild.children).toEqual(["World"])
      expect(redChild.fg?.r).toBe(1)
      expect(redChild.fg?.g).toBe(0)
      expect(redChild.fg?.b).toBe(0)
      expect(redChild.attributes).toBe(0)

      // Check third chunk: " with " (no styling)
      const withChild = node.children[2] as TextNodeRenderable
      expect(withChild.children).toEqual([" with "])
      expect(withChild.fg).toBeUndefined()
      expect(withChild.attributes).toBe(0)

      // Check fourth chunk: "bold" (bold styling)
      const boldChild = node.children[3] as TextNodeRenderable
      expect(boldChild.children).toEqual(["bold"])
      expect(boldChild.fg).toBeUndefined()
      expect(boldChild.attributes).toBe(1) // bold attribute

      // Check fifth chunk: " text!" (no styling)
      const textChild = node.children[4] as TextNodeRenderable
      expect(textChild.children).toEqual([" text!"])
      expect(textChild.fg).toBeUndefined()
      expect(textChild.attributes).toBe(0)
    })

    it("should preserve styles when converting StyledText to TextNodes", () => {
      const node = new TextNodeRenderable({})
      const styledText = new StyledText([
        {
          __isChunk: true,
          text: "Red",
          fg: RGBA.fromInts(255, 0, 0, 255),
          bg: RGBA.fromInts(0, 0, 0, 255),
          attributes: 1,
        },
        { __isChunk: true, text: "Blue", fg: RGBA.fromInts(0, 0, 255, 255), attributes: 2 },
        { __isChunk: true, text: "Green", fg: RGBA.fromInts(0, 255, 0, 255), attributes: 0 },
      ])

      node.add(styledText)

      expect(node.children).toHaveLength(3)

      const redNode = node.children[0] as TextNodeRenderable
      expect(redNode.children).toEqual(["Red"])
      expect(redNode.fg).toEqual(RGBA.fromInts(255, 0, 0, 255))
      expect(redNode.bg).toEqual(RGBA.fromInts(0, 0, 0, 255))
      expect(redNode.attributes).toBe(1)

      const blueNode = node.children[1] as TextNodeRenderable
      expect(blueNode.children).toEqual(["Blue"])
      expect(blueNode.fg).toEqual(RGBA.fromInts(0, 0, 255, 255))
      expect(blueNode.bg).toBeUndefined()
      expect(blueNode.attributes).toBe(2)

      const greenNode = node.children[2] as TextNodeRenderable
      expect(greenNode.children).toEqual(["Green"])
      expect(greenNode.fg).toEqual(RGBA.fromInts(0, 255, 0, 255))
      expect(greenNode.bg).toBeUndefined()
      expect(greenNode.attributes).toBe(0)
    })

    it("should handle empty StyledText", () => {
      const node = new TextNodeRenderable({})
      const emptyStyledText = new StyledText([])

      // Add empty StyledText
      const index = node.add(emptyStyledText)
      expect(index).toBe(0)

      // Should have no children since empty StyledText produces no TextNodes
      expect(node.children).toHaveLength(0)

      // Verify that gatherWithInheritedStyle returns empty array
      const chunks = node.gatherWithInheritedStyle()
      expect(chunks).toHaveLength(0)
    })

    it("should handle StyledText with empty text chunks", () => {
      const node = new TextNodeRenderable({})
      const styledTextWithEmptyChunks = new StyledText([
        { __isChunk: true, text: "", fg: RGBA.fromInts(255, 0, 0, 255), attributes: 1 },
        { __isChunk: true, text: "middle", fg: RGBA.fromInts(0, 255, 0, 255), attributes: 0 },
        { __isChunk: true, text: "", fg: RGBA.fromInts(0, 0, 255, 255), attributes: 2 },
      ])

      node.add(styledTextWithEmptyChunks)

      expect(node.children).toHaveLength(3)

      // First chunk: empty text with red styling
      const emptyRedNode = node.children[0] as TextNodeRenderable
      expect(emptyRedNode.children).toEqual([""])
      expect(emptyRedNode.fg).toEqual(RGBA.fromInts(255, 0, 0, 255))
      expect(emptyRedNode.attributes).toBe(1)

      // Second chunk: "middle" with green styling
      const middleNode = node.children[1] as TextNodeRenderable
      expect(middleNode.children).toEqual(["middle"])
      expect(middleNode.fg).toEqual(RGBA.fromInts(0, 255, 0, 255))
      expect(middleNode.attributes).toBe(0)

      // Third chunk: empty text with blue styling
      const emptyBlueNode = node.children[2] as TextNodeRenderable
      expect(emptyBlueNode.children).toEqual([""])
      expect(emptyBlueNode.fg).toEqual(RGBA.fromInts(0, 0, 255, 255))
      expect(emptyBlueNode.attributes).toBe(2)
    })
  })

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty strings", () => {
      const node = new TextNodeRenderable({})

      node.add("")
      node.add(" ")

      const chunks = node.gatherWithInheritedStyle()
      expect(chunks).toHaveLength(2)
      expect(chunks[0].text).toBe("")
      expect(chunks[1].text).toBe(" ")
    })

    it("should handle nested empty TextNodes", () => {
      const parent = new TextNodeRenderable({})
      const child = new TextNodeRenderable({})

      parent.add(child)

      const chunks = parent.gatherWithInheritedStyle()
      expect(chunks).toHaveLength(0)
    })

    it("should handle multiple operations in sequence", () => {
      const node = new TextNodeRenderable({})

      // Add multiple items
      for (let i = 0; i < 5; i++) {
        node.add(`Item ${i}`)
      }

      expect(node.children).toHaveLength(5)

      // Clear and verify
      node.clear()
      expect(node.children).toHaveLength(0)
    })

    it("should efficiently calculate positions for large trees", () => {
      const root = new TextNodeRenderable({})

      // Add many children to test position calculation efficiency
      for (let i = 0; i < 10; i++) {
        const child = new TextNodeRenderable({})
        for (let j = 0; j < 5; j++) {
          child.add(`Child ${i}-${j}`)
        }
        root.add(child)
      }

      // Insert before the 5th child - should be efficient
      const fifthChild = root.children[4] as TextNodeRenderable
      const insertChild = new TextNodeRenderable({})
      insertChild.add("Inserted")

      const startTime = performance.now()
      root.insertBefore(insertChild, fifthChild)
      const endTime = performance.now()

      // Should complete quickly (less than 1ms for this small tree)
      expect(endTime - startTime).toBeLessThan(1)

      // Verify correct position
      expect(root.children.indexOf(insertChild)).toBe(4)
    })
  })
})
