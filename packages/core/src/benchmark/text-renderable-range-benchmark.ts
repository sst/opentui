import { performance } from "node:perf_hooks"
import { StyledText } from "../lib/styled-text.js"
import { TextRenderable } from "../renderables/Text.js"
import { createTestRenderer } from "../testing/test-renderer.js"
import { resolveRenderLib } from "../zig.js"
import type { CapturedFrame } from "../types.js"

const leafCount = Number(process.env.TEXT_RANGE_LEAVES ?? 1_000)
const updates = Number(process.env.TEXT_RANGE_UPDATES ?? 200)
const rounds = Number(process.env.TEXT_RANGE_ROUNDS ?? 5)

type Sample = { rangeMs: number; replacementMs: number; frameHash: number }

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0
}

function frameHash(frame: CapturedFrame): number {
  let hash = 2166136261
  for (const line of frame.lines) {
    for (const span of line.spans) {
      const values = [span.text, span.fg.toInts().join(","), span.bg.toInts().join(","), String(span.attributes)]
      for (const value of values) {
        for (let index = 0; index < value.length; index++) {
          hash ^= value.charCodeAt(index)
          hash = Math.imul(hash, 16777619)
        }
      }
    }
  }
  return hash >>> 0
}

function chunks(values: string[], attributes: number[], order: number[]) {
  return order.map((index) => ({ __isChunk: true as const, text: values[index]!, attributes: attributes[index] }))
}

function applyModelMutation(values: string[], attributes: number[], order: number[], index: number): number {
  const leafIndex = index % values.length
  values[leafIndex] = `${index.toString().padStart(4, "x")} `
  attributes[leafIndex] = index & 1
  if (index % 20 === 0) {
    order.splice(order.indexOf(leafIndex), 1)
    order.push(leafIndex)
  }
  return leafIndex
}

async function runPerFrameRound(round: number): Promise<Sample> {
  const rangeSetup = await createTestRenderer({ width: 120, height: 20 })
  const replacementSetup = await createTestRenderer({ width: 120, height: 20 })
  const initialValues = Array.from({ length: leafCount }, (_, index) => `${index.toString().padStart(4, "0")} `)
  const rangeValues = [...initialValues]
  const replacementValues = [...initialValues]
  const rangeAttributes = initialValues.map(() => 0)
  const replacementAttributes = initialValues.map(() => 0)
  const rangeOrder = initialValues.map((_, index) => index)
  const replacementOrder = [...rangeOrder]
  const leaves = initialValues.map((content) => new TextRenderable(rangeSetup.renderer, { content }, false))
  const rangeRoot = new TextRenderable(rangeSetup.renderer, {})
  rangeRoot.children = leaves
  rangeSetup.renderer.root.add(rangeRoot)
  const replacementRoot = new TextRenderable(replacementSetup.renderer, {
    content: new StyledText(chunks(replacementValues, replacementAttributes, replacementOrder)),
  })
  replacementSetup.renderer.root.add(replacementRoot)

  // Initial renders warm native projection, wrapping, drawing, and both framework paths.
  await rangeSetup.renderOnce()
  await replacementSetup.renderOnce()
  let rangeMs = 0
  let replacementMs = 0
  let rollingHash = 0
  try {
    for (let index = 0; index < updates; index++) {
      const runRange = async () => {
        const start = performance.now()
        const leafIndex = applyModelMutation(rangeValues, rangeAttributes, rangeOrder, index)
        const leaf = leaves[leafIndex]!
        leaf.content = rangeValues[leafIndex]!
        leaf.attributes = rangeAttributes[leafIndex]!
        if (index % 20 === 0) rangeRoot.add(leaf, rangeRoot.getChildrenCount())
        await rangeSetup.renderOnce()
        rangeMs += performance.now() - start
      }
      const runReplacement = async () => {
        const start = performance.now()
        applyModelMutation(replacementValues, replacementAttributes, replacementOrder, index)
        replacementRoot.content = new StyledText(chunks(replacementValues, replacementAttributes, replacementOrder))
        await replacementSetup.renderOnce()
        replacementMs += performance.now() - start
      }
      if ((round + index) % 2 === 0) {
        await runRange()
        await runReplacement()
      } else {
        await runReplacement()
        await runRange()
      }
      const rangeHash = frameHash(rangeSetup.captureSpans())
      const replacementHash = frameHash(replacementSetup.captureSpans())
      if (rangeRoot.plainText !== replacementRoot.plainText || rangeHash !== replacementHash) {
        throw new Error(`benchmark outputs diverged after mutation ${index}`)
      }
      rollingHash = Math.imul(rollingHash ^ rangeHash, 16777619) >>> 0
    }
    return { rangeMs, replacementMs, frameHash: rollingHash }
  } finally {
    rangeSetup.renderer.destroy()
    replacementSetup.renderer.destroy()
  }
}

async function runCoalescedRound(round: number): Promise<Sample> {
  const rangeSetup = await createTestRenderer({ width: 120, height: 20 })
  const replacementSetup = await createTestRenderer({ width: 120, height: 20 })
  const initialValues = Array.from({ length: leafCount }, (_, index) => `${index.toString().padStart(4, "0")} `)
  const rangeValues = [...initialValues]
  const replacementValues = [...initialValues]
  const rangeAttributes = initialValues.map(() => 0)
  const replacementAttributes = initialValues.map(() => 0)
  const rangeOrder = initialValues.map((_, index) => index)
  const replacementOrder = [...rangeOrder]
  const leaves = initialValues.map((content) => new TextRenderable(rangeSetup.renderer, { content }, false))
  const rangeRoot = new TextRenderable(rangeSetup.renderer, {})
  rangeRoot.children = leaves
  rangeSetup.renderer.root.add(rangeRoot)
  const replacementRoot = new TextRenderable(replacementSetup.renderer, {
    content: new StyledText(chunks(replacementValues, replacementAttributes, replacementOrder)),
  })
  replacementSetup.renderer.root.add(replacementRoot)
  await rangeSetup.renderOnce()
  await replacementSetup.renderOnce()

  const runRange = async () => {
    const start = performance.now()
    for (let index = 0; index < updates; index++) {
      const leafIndex = applyModelMutation(rangeValues, rangeAttributes, rangeOrder, index)
      const leaf = leaves[leafIndex]!
      leaf.content = rangeValues[leafIndex]!
      leaf.attributes = rangeAttributes[leafIndex]!
      if (index % 20 === 0) rangeRoot.add(leaf, rangeRoot.getChildrenCount())
    }
    await rangeSetup.renderOnce()
    return performance.now() - start
  }
  const runReplacement = async () => {
    const start = performance.now()
    for (let index = 0; index < updates; index++) {
      applyModelMutation(replacementValues, replacementAttributes, replacementOrder, index)
    }
    replacementRoot.content = new StyledText(chunks(replacementValues, replacementAttributes, replacementOrder))
    await replacementSetup.renderOnce()
    return performance.now() - start
  }
  try {
    let rangeMs: number
    let replacementMs: number
    if (round % 2 === 0) {
      rangeMs = await runRange()
      replacementMs = await runReplacement()
    } else {
      replacementMs = await runReplacement()
      rangeMs = await runRange()
    }
    const rangeHash = frameHash(rangeSetup.captureSpans())
    const replacementHash = frameHash(replacementSetup.captureSpans())
    if (rangeRoot.plainText !== replacementRoot.plainText || rangeHash !== replacementHash) {
      throw new Error("coalesced benchmark outputs diverged")
    }
    return { rangeMs, replacementMs, frameHash: rangeHash }
  } finally {
    rangeSetup.renderer.destroy()
    replacementSetup.renderer.destroy()
  }
}

const lib = resolveRenderLib()
const allocationStart = lib.getAllocatorStats()
const arenaStart = lib.getArenaAllocatedBytes()
const perFrame: Sample[] = []
const coalesced: Sample[] = []
for (let round = 0; round < rounds; round++) perFrame.push(await runPerFrameRound(round))
for (let round = 0; round < rounds; round++) coalesced.push(await runCoalescedRound(round))
const allocationEnd = lib.getAllocatorStats()
const arenaEnd = lib.getArenaAllocatedBytes()

const summarize = (samples: Sample[]) => ({
  range: {
    medianMs: percentile(
      samples.map((sample) => sample.rangeMs),
      0.5,
    ),
    p95Ms: percentile(
      samples.map((sample) => sample.rangeMs),
      0.95,
    ),
  },
  fullReplacement: {
    medianMs: percentile(
      samples.map((sample) => sample.replacementMs),
      0.5,
    ),
    p95Ms: percentile(
      samples.map((sample) => sample.replacementMs),
      0.95,
    ),
  },
  frameHashes: samples.map((sample) => sample.frameHash),
})

console.log(
  JSON.stringify(
    {
      leafCount,
      updates,
      rounds,
      perFrame: summarize(perFrame),
      coalescedFrameworkCommit: summarize(coalesced),
      nativeMemory: {
        activeAllocationDelta: allocationEnd.activeAllocations - allocationStart.activeAllocations,
        requestedByteDelta: allocationEnd.totalRequestedBytes - allocationStart.totalRequestedBytes,
        requestedBytesValid: allocationStart.requestedBytesValid && allocationEnd.requestedBytesValid,
        persistentArenaByteDelta: arenaEnd - arenaStart,
      },
    },
    null,
    2,
  ),
)
