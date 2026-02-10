import { describe, expect, it } from "bun:test"
import { TextBuffer } from "../text-buffer"
import { TextBufferView } from "../text-buffer-view"
import { stringToStyledText } from "../lib/styled-text"

/**
 * These tests verify algorithmic complexity rather than absolute performance.
 * By comparing ratios of execution times for different input sizes, we can
 * detect O(n²) regressions regardless of the machine's speed.
 *
 * For O(n) algorithms: doubling input size should roughly double the time (ratio ~2)
 * For O(n²) algorithms: doubling input size should quadruple the time (ratio ~4)
 *
 * We use a threshold that allows for CI variance while still catching O(n²) behavior.
 * The threshold is set to catch quadratic complexity (ratio ~4) while allowing
 * linear complexity with noise (ratio ~2-3.5).
 */
describe("Word wrap algorithmic complexity", () => {
  function measureMedian(fn: () => void, iterations = 11): number {
    const times: number[] = []
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      fn()
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    return times[Math.floor(times.length / 2)]
  }

  const COMPLEXITY_THRESHOLD = 1.75

  it("should have O(n) complexity for word wrap without word breaks", () => {
    const smallSize = 20000
    const largeSize = 40000

    const smallText = "x".repeat(smallSize)
    const largeText = "x".repeat(largeSize)

    const smallBuffer = TextBuffer.create("wcwidth")
    const largeBuffer = TextBuffer.create("wcwidth")

    smallBuffer.setStyledText(stringToStyledText(smallText))
    largeBuffer.setStyledText(stringToStyledText(largeText))

    const smallView = TextBufferView.create(smallBuffer)
    const largeView = TextBufferView.create(largeBuffer)

    smallView.setWrapMode("word")
    largeView.setWrapMode("word")
    smallView.setWrapWidth(80)
    largeView.setWrapWidth(80)

    smallView.measureForDimensions(80, 100)
    largeView.measureForDimensions(80, 100)

    const smallTime = measureMedian(() => {
      smallView.measureForDimensions(80, 100)
    })

    const largeTime = measureMedian(() => {
      largeView.measureForDimensions(80, 100)
    })

    smallView.destroy()
    largeView.destroy()
    smallBuffer.destroy()
    largeBuffer.destroy()

    const ratio = largeTime / smallTime
    const inputRatio = largeSize / smallSize

    expect(ratio).toBeLessThan(inputRatio * COMPLEXITY_THRESHOLD)
  })

  it("should have O(n) complexity for word wrap with word breaks", () => {
    const smallSize = 20000
    const largeSize = 40000

    const makeText = (size: number) => {
      const words = Math.ceil(size / 11)
      return Array(words).fill("xxxxxxxxxx").join(" ").slice(0, size)
    }

    const smallText = makeText(smallSize)
    const largeText = makeText(largeSize)

    const smallBuffer = TextBuffer.create("wcwidth")
    const largeBuffer = TextBuffer.create("wcwidth")

    smallBuffer.setStyledText(stringToStyledText(smallText))
    largeBuffer.setStyledText(stringToStyledText(largeText))

    const smallView = TextBufferView.create(smallBuffer)
    const largeView = TextBufferView.create(largeBuffer)

    smallView.setWrapMode("word")
    largeView.setWrapMode("word")
    smallView.setWrapWidth(80)
    largeView.setWrapWidth(80)

    // Warm up
    smallView.measureForDimensions(80, 100)
    largeView.measureForDimensions(80, 100)

    const smallTime = measureMedian(() => {
      smallView.measureForDimensions(80, 100)
    })

    const largeTime = measureMedian(() => {
      largeView.measureForDimensions(80, 100)
    })

    smallView.destroy()
    largeView.destroy()
    smallBuffer.destroy()
    largeBuffer.destroy()

    const ratio = largeTime / smallTime
    const inputRatio = largeSize / smallSize

    expect(ratio).toBeLessThan(inputRatio * COMPLEXITY_THRESHOLD)
  })

  it("should have O(n) complexity for char wrap mode", () => {
    const smallSize = 20000
    const largeSize = 40000

    const smallText = "x".repeat(smallSize)
    const largeText = "x".repeat(largeSize)

    const smallBuffer = TextBuffer.create("wcwidth")
    const largeBuffer = TextBuffer.create("wcwidth")

    smallBuffer.setStyledText(stringToStyledText(smallText))
    largeBuffer.setStyledText(stringToStyledText(largeText))

    const smallView = TextBufferView.create(smallBuffer)
    const largeView = TextBufferView.create(largeBuffer)

    smallView.setWrapMode("char")
    largeView.setWrapMode("char")
    smallView.setWrapWidth(80)
    largeView.setWrapWidth(80)

    smallView.measureForDimensions(80, 100)
    largeView.measureForDimensions(80, 100)

    const smallTime = measureMedian(() => {
      smallView.measureForDimensions(80, 100)
    })

    const largeTime = measureMedian(() => {
      largeView.measureForDimensions(80, 100)
    })

    smallView.destroy()
    largeView.destroy()
    smallBuffer.destroy()
    largeBuffer.destroy()

    const ratio = largeTime / smallTime
    const inputRatio = largeSize / smallSize

    expect(ratio).toBeLessThan(inputRatio * COMPLEXITY_THRESHOLD)
  })

  // NOTE: Is flaky
  it.skip("should scale linearly when wrap width changes", () => {
    const text = "x".repeat(50000)

    const buffer = TextBuffer.create("wcwidth")
    buffer.setStyledText(stringToStyledText(text))

    const view = TextBufferView.create(buffer)
    view.setWrapMode("word")

    const widths = [60, 70, 80, 90, 100]
    const times: number[] = []

    // Warmup
    view.setWrapWidth(50)
    view.measureForDimensions(50, 100)

    // Measure first (uncached) call for each width
    for (const width of widths) {
      view.setWrapWidth(width)
      const start = performance.now()
      view.measureForDimensions(width, 100)
      times.push(performance.now() - start)
    }

    view.destroy()
    buffer.destroy()

    // All times should be roughly similar (within 3x of each other)
    // since the text size is the same
    const maxTime = Math.max(...times)
    const minTime = Math.min(...times)

    expect(maxTime / minTime).toBeLessThan(3)
  })
})
