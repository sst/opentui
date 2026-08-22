import { performance } from "node:perf_hooks"
import { StyledText } from "../lib/styled-text.js"
import { TextRenderable } from "../renderables/Text.js"
import { createTestRenderer } from "../testing/test-renderer.js"
import { resolveRenderLib } from "../zig.js"
import type { AllocatorStats, TextBufferDebugMetrics } from "../zig.js"
import type { CapturedFrame } from "../types.js"

const leafCount = Number(process.env.TEXT_RANGE_LEAVES ?? 1_000)
const updates = Number(process.env.TEXT_RANGE_UPDATES ?? 200)
const rounds = Number(process.env.TEXT_RANGE_ROUNDS ?? 5)

if (!Number.isInteger(rounds) || rounds < 1) throw new Error("TEXT_RANGE_ROUNDS must be a positive integer")

type BufferMemory = {
  peakArenaCount: number
  peakArenaBytes: number
  peakTotalArenaBytes: number
  peakBackingStoreBytes: number
  peakBackingStoreCapacity: number
  peakHistoryRetainedBytes: number
  endLiveArenaCount: number
  endLiveArenaBytes: number
  endTotalArenaBytes: number
  endBackingStoreBytes: number
  endBackingStoreCapacity: number
  endHistoryRetainedBytes: number
}
type LiveMemory = {
  range: BufferMemory
  replacement: BufferMemory
  activeAllocations: { start: number; peakGrowth: number; endLiveGrowth: number; afterTeardownGrowth: number }
}
type Sample = { rangeMs: number; replacementMs: number; frameHash: number; renderCount: number; memory: LiveMemory }

// Nearest-rank: rank = ceil(p * n), one-based. With five rounds p95 is the maximum sample.
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

function trackLiveMemory(rangeRoot: TextRenderable, replacementRoot: TextRenderable) {
  const lib = resolveRenderLib()
  const textBuffer = (root: TextRenderable) =>
    (root as unknown as { textBuffer: { getDebugMetrics(): TextBufferDebugMetrics } }).textBuffer
  const start = lib.getAllocatorStats()
  let peakActiveGrowth = 0
  let rangePeak = {
    transactionArenaCount: 0,
    transactionArenaBytes: 0,
    arenaBytes: 0,
    backingStoreBytes: 0,
    backingStoreCapacity: 0,
    historyRetainedBytes: 0,
  }
  let replacementPeak = { ...rangePeak }
  const sample = () => {
    const allocations = lib.getAllocatorStats()
    const range = textBuffer(rangeRoot).getDebugMetrics()
    const replacement = textBuffer(replacementRoot).getDebugMetrics()
    peakActiveGrowth = Math.max(peakActiveGrowth, allocations.activeAllocations - start.activeAllocations)
    if (range.transactionArenaCount > rangePeak.transactionArenaCount)
      rangePeak.transactionArenaCount = range.transactionArenaCount
    if (range.transactionArenaBytes > rangePeak.transactionArenaBytes)
      rangePeak.transactionArenaBytes = range.transactionArenaBytes
    if (replacement.transactionArenaCount > replacementPeak.transactionArenaCount)
      replacementPeak.transactionArenaCount = replacement.transactionArenaCount
    if (replacement.transactionArenaBytes > replacementPeak.transactionArenaBytes)
      replacementPeak.transactionArenaBytes = replacement.transactionArenaBytes
    rangePeak.arenaBytes = Math.max(rangePeak.arenaBytes, range.arenaBytes)
    rangePeak.backingStoreBytes = Math.max(rangePeak.backingStoreBytes, range.backingStoreBytes)
    rangePeak.backingStoreCapacity = Math.max(rangePeak.backingStoreCapacity, range.backingStoreCapacity)
    rangePeak.historyRetainedBytes = Math.max(rangePeak.historyRetainedBytes, range.historyRetainedBytes)
    replacementPeak.arenaBytes = Math.max(replacementPeak.arenaBytes, replacement.arenaBytes)
    replacementPeak.backingStoreBytes = Math.max(replacementPeak.backingStoreBytes, replacement.backingStoreBytes)
    replacementPeak.backingStoreCapacity = Math.max(
      replacementPeak.backingStoreCapacity,
      replacement.backingStoreCapacity,
    )
    replacementPeak.historyRetainedBytes = Math.max(
      replacementPeak.historyRetainedBytes,
      replacement.historyRetainedBytes,
    )
  }
  sample()
  return {
    sample,
    finishLive(): { memory: LiveMemory; start: AllocatorStats } {
      sample()
      const allocationEnd = lib.getAllocatorStats()
      const rangeEnd = textBuffer(rangeRoot).getDebugMetrics()
      const replacementEnd = textBuffer(replacementRoot).getDebugMetrics()
      return {
        start,
        memory: {
          range: {
            peakArenaCount: rangePeak.transactionArenaCount,
            peakArenaBytes: rangePeak.transactionArenaBytes,
            peakTotalArenaBytes: rangePeak.arenaBytes,
            peakBackingStoreBytes: rangePeak.backingStoreBytes,
            peakBackingStoreCapacity: rangePeak.backingStoreCapacity,
            peakHistoryRetainedBytes: rangePeak.historyRetainedBytes,
            endLiveArenaCount: rangeEnd.transactionArenaCount,
            endLiveArenaBytes: rangeEnd.transactionArenaBytes,
            endTotalArenaBytes: rangeEnd.arenaBytes,
            endBackingStoreBytes: rangeEnd.backingStoreBytes,
            endBackingStoreCapacity: rangeEnd.backingStoreCapacity,
            endHistoryRetainedBytes: rangeEnd.historyRetainedBytes,
          },
          replacement: {
            peakArenaCount: replacementPeak.transactionArenaCount,
            peakArenaBytes: replacementPeak.transactionArenaBytes,
            peakTotalArenaBytes: replacementPeak.arenaBytes,
            peakBackingStoreBytes: replacementPeak.backingStoreBytes,
            peakBackingStoreCapacity: replacementPeak.backingStoreCapacity,
            peakHistoryRetainedBytes: replacementPeak.historyRetainedBytes,
            endLiveArenaCount: replacementEnd.transactionArenaCount,
            endLiveArenaBytes: replacementEnd.transactionArenaBytes,
            endTotalArenaBytes: replacementEnd.arenaBytes,
            endBackingStoreBytes: replacementEnd.backingStoreBytes,
            endBackingStoreCapacity: replacementEnd.backingStoreCapacity,
            endHistoryRetainedBytes: replacementEnd.historyRetainedBytes,
          },
          activeAllocations: {
            start: start.activeAllocations,
            peakGrowth: peakActiveGrowth,
            endLiveGrowth: allocationEnd.activeAllocations - start.activeAllocations,
            afterTeardownGrowth: 0,
          },
        },
      }
    },
  }
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
  const memoryTracker = trackLiveMemory(rangeRoot, replacementRoot)
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
      memoryTracker.sample()
      rollingHash = Math.imul(rollingHash ^ rangeHash, 16777619) >>> 0
    }
    const live = memoryTracker.finishLive()
    const sample: Sample = { rangeMs, replacementMs, frameHash: rollingHash, renderCount: updates, memory: live.memory }
    rangeSetup.renderer.destroy()
    replacementSetup.renderer.destroy()
    sample.memory.activeAllocations.afterTeardownGrowth =
      resolveRenderLib().getAllocatorStats().activeAllocations - live.start.activeAllocations
    return sample
  } finally {
    if (!rangeSetup.renderer.isDestroyed) rangeSetup.renderer.destroy()
    if (!replacementSetup.renderer.isDestroyed) replacementSetup.renderer.destroy()
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
  const memoryTracker = trackLiveMemory(rangeRoot, replacementRoot)

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
    memoryTracker.sample()
    const live = memoryTracker.finishLive()
    const sample: Sample = { rangeMs, replacementMs, frameHash: rangeHash, renderCount: 1, memory: live.memory }
    rangeSetup.renderer.destroy()
    replacementSetup.renderer.destroy()
    sample.memory.activeAllocations.afterTeardownGrowth =
      resolveRenderLib().getAllocatorStats().activeAllocations - live.start.activeAllocations
    return sample
  } finally {
    if (!rangeSetup.renderer.isDestroyed) rangeSetup.renderer.destroy()
    if (!replacementSetup.renderer.isDestroyed) replacementSetup.renderer.destroy()
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

const timing = (values: number[]) =>
  values.length === 1
    ? { sampleKind: "raw" as const, rawMs: values[0] }
    : { medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95) }
const summarize = (samples: Sample[]) => ({
  range: timing(samples.map((sample) => sample.rangeMs)),
  fullReplacement: timing(samples.map((sample) => sample.replacementMs)),
  frameHashes: samples.map((sample) => sample.frameHash),
  renderCounts: samples.map((sample) => sample.renderCount),
  liveMemoryByRound: samples.map((sample) => sample.memory),
  liveMemoryBounds: {
    rangePeakArenaCount: Math.max(...samples.map((sample) => sample.memory.range.peakArenaCount)),
    rangePeakArenaBytes: Math.max(...samples.map((sample) => sample.memory.range.peakArenaBytes)),
    replacementPeakArenaCount: Math.max(...samples.map((sample) => sample.memory.replacement.peakArenaCount)),
    replacementPeakArenaBytes: Math.max(...samples.map((sample) => sample.memory.replacement.peakArenaBytes)),
    rangePeakBackingStoreBytes: Math.max(...samples.map((sample) => sample.memory.range.peakBackingStoreBytes)),
    rangePeakBackingStoreCapacity: Math.max(...samples.map((sample) => sample.memory.range.peakBackingStoreCapacity)),
    rangePeakHistoryRetainedBytes: Math.max(...samples.map((sample) => sample.memory.range.peakHistoryRetainedBytes)),
    replacementPeakBackingStoreBytes: Math.max(
      ...samples.map((sample) => sample.memory.replacement.peakBackingStoreBytes),
    ),
    replacementPeakBackingStoreCapacity: Math.max(
      ...samples.map((sample) => sample.memory.replacement.peakBackingStoreCapacity),
    ),
    replacementPeakHistoryRetainedBytes: Math.max(
      ...samples.map((sample) => sample.memory.replacement.peakHistoryRetainedBytes),
    ),
    peakActiveAllocationGrowth: Math.max(...samples.map((sample) => sample.memory.activeAllocations.peakGrowth)),
  },
})

console.log(
  JSON.stringify(
    {
      leafCount,
      updates,
      rounds,
      statistics:
        rounds === 1
          ? { estimator: "raw sample only; no median or p95 claim" }
          : { estimator: "nearest-rank percentile (rank = ceil(p * n)); p95 with five rounds is the maximum" },
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
