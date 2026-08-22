import { performance } from "node:perf_hooks"
import { StyledText } from "../lib/styled-text.js"
import { TextRenderable } from "../renderables/Text.js"
import { createTestRenderer } from "../testing/test-renderer.js"
import { TextBuffer } from "../text-buffer.js"

const leafCount = Number(process.env.TEXT_RANGE_LEAVES ?? 1_000)
const updates = Number(process.env.TEXT_RANGE_UPDATES ?? 200)
const setup = await createTestRenderer({ width: 120, height: 20 })
const root = new TextRenderable(setup.renderer, {})
const leaves = Array.from(
  { length: leafCount },
  (_, index) => new TextRenderable(setup.renderer, { content: `${index.toString().padStart(4, "0")} ` }, false),
)
const initialValues = leaves.map((leaf) => leaf.plainText)
root.children = leaves
setup.renderer.root.add(root)
await setup.renderOnce()

const rangeStart = performance.now()
for (let index = 0; index < updates; index++) {
  const leaf = leaves[index % leaves.length]!
  leaf.content = `${index.toString().padStart(4, "x")} `
  leaf.attributes = index & 1
  if (index % 20 === 0) root.add(leaf, root.getChildrenCount())
}
await setup.renderOnce()
const rangeMs = performance.now() - rangeStart
const finalText = root.plainText

const compatibility = TextBuffer.create(setup.renderer.widthMethod)
const compatibilityValues = [...initialValues]
const compatibilityOrder = leaves.map((_, index) => index)
let compatibilityText = compatibilityValues.join("")
compatibility.setStyledText(new StyledText([{ __isChunk: true, text: compatibilityText }]))
const compatibilityStart = performance.now()
for (let index = 0; index < updates; index++) {
  const leafIndex = index % leaves.length
  compatibilityValues[leafIndex] = `${index.toString().padStart(4, "x")} `
  if (index % 20 === 0) {
    compatibilityOrder.splice(compatibilityOrder.indexOf(leafIndex), 1)
    compatibilityOrder.push(leafIndex)
  }
  compatibilityText = compatibilityOrder.map((valueIndex) => compatibilityValues[valueIndex]).join("")
  compatibility.setStyledText(new StyledText([{ __isChunk: true, text: compatibilityText, attributes: index & 1 }]))
}
const compatibilityMs = performance.now() - compatibilityStart

if (finalText !== compatibilityText) throw new Error("benchmark outputs diverged")
console.log(
  JSON.stringify({ leafCount, updates, rangeMs, compatibilityMs, rangePerUpdateMs: rangeMs / updates }, null, 2),
)

compatibility.destroy()
setup.renderer.destroy()
