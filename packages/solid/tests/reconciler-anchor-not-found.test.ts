import { describe, expect, it } from "bun:test"
import { BoxRenderable, TextNodeRenderable, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createSlotNode, insertNode } from "../index.js"

/**
 * Regression coverage for #1245 / #1246.
 *
 * `SlotRenderable.didRemoveSlotChild` (src/elements/slot.ts) only forgets its
 * per-parent placeholder mapping when the slot is still attached to *another*
 * parent (`hasOtherAttachedSlotChildren`). When a slot's placeholder is torn
 * down from its only parent -- the ordinary case of a <For>/<Show> expression
 * going from empty to non-empty -- the stale, now-detached proxy stays
 * cached in `layoutNodesByParent`/`textNodesByParent`.
 *
 * If that same SlotRenderable is later resolved again as an *anchor*
 * (`_insertNode`'s `anchor = anchor.getSlotChild(parent)` call in
 * reconciler.ts), it gets handed back that stale proxy, which is no longer a
 * member of the parent's real children -- `children.indexOf(anchor)` is -1.
 *
 * This drives that exact sequence at the reconciler-primitive level, the
 * same way slot-reconciler-move.test.ts exercises SlotRenderable's other
 * cross-parent edge cases (`slot.didRemoveSlotChild(parent, child)` called
 * directly, mirroring what reconciler.ts's private `_removeNode` does).
 */
async function setupStaleAnchorSlot(parent: BoxRenderable | TextRenderable) {
  const slot = createSlotNode()
  insertNode(parent, slot)

  const getChildren = () => (parent instanceof TextRenderable ? parent.getTextChildren() : parent.getChildren())

  const proxy = getChildren()[0]
  if (!proxy) throw new Error("expected the slot placeholder to have been inserted")

  const slotChild = slot.getSlotChildForRemoval(parent)
  if (slotChild !== proxy) throw new Error("expected removal to target the placeholder proxy")

  parent.remove(slotChild)
  slot.didRemoveSlotChild(parent, slotChild)

  return { slot, getChildren }
}

describe("reconciler: anchor-not-found fallback (#1245)", () => {
  it("does not throw and still inserts the node when the anchor is a stale slot", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    const parent = new BoxRenderable(setup.renderer, { id: "parent", width: 10, height: 5 })
    setup.renderer.root.add(parent)

    try {
      const { slot, getChildren } = await setupStaleAnchorSlot(parent)
      expect(getChildren()).toHaveLength(0)

      const newChild = new BoxRenderable(setup.renderer, { id: "new-child", width: 4, height: 1 })

      expect(() => insertNode(parent, newChild, slot)).not.toThrow()
      expect(getChildren().map((c) => c.id)).toEqual(["new-child"])
    } finally {
      setup.renderer.destroy()
    }
  })

  it("appends after existing siblings instead of misplacing the node at the front (text parent)", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    const parent = new TextRenderable(setup.renderer, { id: "parent-text", content: "" })
    setup.renderer.root.add(parent)

    try {
      const { slot, getChildren } = await setupStaleAnchorSlot(parent)

      const existingSibling = new TextNodeRenderable({ id: "existing-sibling" })
      existingSibling.add("existing")
      insertNode(parent, existingSibling)
      expect(getChildren().map((c) => c.id)).toEqual(["existing-sibling"])

      const newTextNode = new TextNodeRenderable({ id: "new-node" })
      newTextNode.add("hi")

      // This is the assertion that fails under the pre-fix behavior: with
      // `parent.add(node, -1)`, TextNodeRenderable.add's `prepareChildInsert`
      // clamps index -1 to 0 and *prepends* new-node instead of appending it,
      // which is exactly the "silently inserts the node at an incorrect
      // position" behavior #1245 describes.
      insertNode(parent, newTextNode, slot)
      expect(getChildren().map((c) => c.id)).toEqual(["existing-sibling", "new-node"])
    } finally {
      setup.renderer.destroy()
    }
  })
})
