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
let operationCount = 0
const applyDocumentOperations = TextBuffer.prototype.applyDocumentOperations
TextBuffer.prototype.applyDocumentOperations = function (operations) {
  operationCount += operations.length
  return applyDocumentOperations.call(this, operations)
}

const rangeStart = performance.now()
for (let index = 0; index < updates; index++) {
  const leaf = leaves[index % leaves.length]!
  leaf.content = `${index.toString().padStart(4, "x")} `
  leaf.attributes = index & 1
  if (index % 20 === 0) root.add(leaf, root.getChildrenCount())
}
const updatesMs = performance.now() - rangeStart
await setup.renderOnce()
const rangeMs = performance.now() - rangeStart
const finalText = root.plainText
const rangeFrame = setup.captureSpans()

const compatibility = TextBuffer.create(setup.renderer.widthMethod)
const compatibilityValues = [...initialValues]
const compatibilityAttributes = leaves.map(() => 0)
const compatibilityOrder = leaves.map((_, index) => index)
let compatibilityText = compatibilityValues.join("")
compatibility.setStyledText(new StyledText([{ __isChunk: true, text: compatibilityText }]))
const compatibilityStart = performance.now()
for (let index = 0; index < updates; index++) {
  const leafIndex = index % leaves.length
  compatibilityValues[leafIndex] = `${index.toString().padStart(4, "x")} `
  compatibilityAttributes[leafIndex] = index & 1
  if (index % 20 === 0) {
    compatibilityOrder.splice(compatibilityOrder.indexOf(leafIndex), 1)
    compatibilityOrder.push(leafIndex)
  }
  const compatibilityChunks = compatibilityOrder.map((valueIndex) => ({
    __isChunk: true as const,
    text: compatibilityValues[valueIndex]!,
    attributes: compatibilityAttributes[valueIndex],
  }))
  compatibilityText = compatibilityChunks.map((chunk) => chunk.text).join("")
  compatibility.setStyledText(new StyledText(compatibilityChunks))
}
const compatibilityMs = performance.now() - compatibilityStart

if (finalText !== compatibilityText) throw new Error("benchmark outputs diverged")
TextBuffer.prototype.applyDocumentOperations = applyDocumentOperations
const compatibilitySetup = await createTestRenderer({ width: 120, height: 20 })
const compatibilityRenderable = new TextRenderable(compatibilitySetup.renderer, {
  content: new StyledText(
    compatibilityOrder.map((valueIndex) => ({
      __isChunk: true as const,
      text: compatibilityValues[valueIndex]!,
      attributes: compatibilityAttributes[valueIndex],
    })),
  ),
})
compatibilitySetup.renderer.root.add(compatibilityRenderable)
await compatibilitySetup.renderOnce()
const normalizeFrame = (frame: ReturnType<typeof setup.captureSpans>) =>
  frame.lines.map((line) =>
    line.spans.map((span) => ({
      text: span.text,
      fg: span.fg.toInts(),
      bg: span.bg.toInts(),
      attributes: span.attributes,
    })),
  )
if (JSON.stringify(normalizeFrame(rangeFrame)) !== JSON.stringify(normalizeFrame(compatibilitySetup.captureSpans()))) {
  throw new Error("benchmark rendered frames diverged")
}
console.log(
  JSON.stringify(
    {
      leafCount,
      updates,
      operationCount,
      updatesMs,
      renderMs: rangeMs - updatesMs,
      rangeMs,
      compatibilityMs,
      rangePerUpdateMs: rangeMs / updates,
    },
    null,
    2,
  ),
)

compatibility.destroy()
compatibilitySetup.renderer.destroy()
setup.renderer.destroy()
