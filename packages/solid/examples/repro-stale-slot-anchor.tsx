import { onMount } from "solid-js"
import { createSlotNode, insertNode, render, useRenderer } from "@opentui/solid"
import type { TextRenderable } from "@opentui/core"
import { TextNodeRenderable } from "@opentui/core"

process.env.DEBUG = "true"

/**
 * Repro for #1245 / #1246: reconciler passes anchorIndex -1 to
 * `parent.add()` when the anchor can't be found in the parent's children.
 *
 * Root cause (packages/solid/src/elements/slot.ts, `SlotRenderable`):
 * a slot's per-parent placeholder (`layoutNodesByParent`/`textNodesByParent`)
 * only gets forgotten in `didRemoveSlotChild` when the slot is still attached
 * to *another* parent. When a <For>/<Show> expression's placeholder is torn
 * down from its *only* parent -- the ordinary "empty list becomes non-empty"
 * transition -- the stale, already-detached proxy stays cached. If that same
 * slot is resolved again as an anchor, `_insertNode` gets handed back the
 * stale proxy, which is no longer a member of the parent's real children:
 * `children.indexOf(anchor) === -1`.
 *
 * For a <text> parent this is not just a "does it throw" edge case: before
 * this fix, `parent.add(node, -1)` reaches `TextNodeRenderable.add()`, whose
 * `prepareChildInsert` clamps index -1 to 0 -- the new node is silently
 * *prepended* instead of appended, exactly the "node placed at an incorrect
 * position" behavior #1245 describes.
 *
 * Reaching this from plain compiled JSX is not straightforward -- inspecting
 * babel-preset-solid's output shows adjacent dynamic expressions each get
 * their own independent `marker` (or `null`, i.e. plain append), they don't
 * share a single SlotRenderable as a cross-sibling anchor. So this repro
 * drives the exact sequence directly through the reconciler primitives the
 * framework itself uses internally (`createSlotNode`, `insertNode`) against
 * a real, JSX-mounted <text> parent -- the same approach
 * packages/solid/tests/slot-reconciler-move.test.ts already uses for this
 * class of SlotRenderable lifecycle edge case.
 *
 * Run with `bun examples/repro-stale-slot-anchor.tsx` from packages/solid.
 * Watch the console: "RESULT: PASS" means the anchor-not-found fallback
 * appended correctly; "RESULT: FAIL" means it silently misplaced the node.
 */

const App = () => {
  const renderer = useRenderer()
  renderer.consoleMode = "console-overlay"
  renderer.console.show()

  let textParent: TextRenderable | undefined

  onMount(() => {
    const parent = textParent!

    // 1. A <For>/<Show> placeholder gets inserted into the <text> parent
    //    (its own "empty" content).
    const slot = createSlotNode()
    insertNode(parent, slot)
    const proxy = parent.getTextChildren()[0]

    // 2. A sibling elsewhere captures `slot` itself (not just its resolved
    //    proxy) and will use it as an anchor later.
    const anchor = slot

    // 3. The list becomes non-empty: its placeholder is torn down using the
    //    exact sequence reconciler.ts's private `_removeNode` uses for a
    //    SlotRenderable node.
    const slotChild = anchor.getSlotChildForRemoval(parent)!
    parent.remove(slotChild)
    anchor.didRemoveSlotChild(parent, slotChild)
    console.log("stale proxy still cached for this parent?", anchor.getSlotChild(parent) === proxy)

    // 4. The sibling's own effect now runs, inserting new content anchored
    //    at the stale slot -- this is `anchorIndex === -1` territory. "Base
    //    text" (rendered by JSX below) is the existing sibling already in
    //    `parent` at this point.
    const newChild = new TextNodeRenderable({ id: "new-node" })
    newChild.add("new node")

    insertNode(parent, newChild, anchor)

    const order = parent.getTextChildren().map((c) => c.id)
    console.log("child order after anchor-not-found insert:", order)
    console.log(
      order[order.length - 1] === "new-node"
        ? "RESULT: PASS (appended after existing content)"
        : "RESULT: FAIL (misplaced before existing content)",
    )
  })

  return (
    <box border title="repro: stale slot anchor (#1245)">
      <text ref={(node) => (textParent = node)}>Base text (existing sibling) -- see console for RESULT</text>
    </box>
  )
}

render(App)
