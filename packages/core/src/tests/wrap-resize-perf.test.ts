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
 * We use a threshold of 3 to allow for some variance while still catching O(n²) behavior.
 */
describe("Word wrap algorithmic complexity", () => {
  // Run each measurement multiple times and take the median to reduce noise
  function measureMedian(fn: () => void, iterations = 5): number {
    const times: number[] = []
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      fn()
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    return times[Math.floor(times.length / 2)]
  }

  it("should have O(n) complexity for word wrap without word breaks", () => {
    // Test with text that has NO word breaks - this was the O(n²) case before the fix
    const smallSize = 20000
    const largeSize = 40000 // 2x the small size

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

    // Warm up - first call populates caches
    smallView.measureForDimensions(80, 100)
    largeView.measureForDimensions(80, 100)

    // Measure multiple times and take median
    const smallTime = measureMedian(() => {
      smallView.measureForDimensions(80, 100)
    })

    const largeTime = measureMedian(() => {
      largeView.measureForDimensions(80, 100)
    })

    // Clean up
    smallView.destroy()
    largeView.destroy()
    smallBuffer.destroy()
    largeBuffer.destroy()

    // Calculate the ratio: for O(n), ratio should be ~2 when input doubles
    // For O(n²), ratio would be ~4
    // We use 3 as threshold to allow variance while catching quadratic behavior
    const ratio = largeTime / smallTime
    const inputRatio = largeSize / smallSize // Should be 2

    // The time ratio should not exceed inputRatio * 1.5 (allowing 50% variance)
    // This catches O(n²) which would have ratio ~4 for input ratio of 2
    expect(ratio).toBeLessThan(inputRatio * 1.5)
  })

  it("should have O(n) complexity for word wrap with word breaks", () => {
    // Test with text that HAS word breaks - should also be O(n)
    const smallSize = 20000
    const largeSize = 40000

    // Create text with spaces every 10 chars
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

    expect(ratio).toBeLessThan(inputRatio * 1.5)
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

    expect(ratio).toBeLessThan(inputRatio * 1.5)
  })

  it("should scale linearly when wrap width changes", () => {
    // This tests that changing wrap width doesn't cause O(n²) behavior
    const text = "x".repeat(50000)

    const buffer = TextBuffer.create("wcwidth")
    buffer.setStyledText(stringToStyledText(text))

    const view = TextBufferView.create(buffer)
    view.setWrapMode("word")

    // Measure time for multiple width changes
    const widths = [60, 70, 80, 90, 100]
    const times: number[] = []

    // Warm up with first width
    view.setWrapWidth(widths[0])
    view.measureForDimensions(widths[0], 100)

    for (const width of widths) {
      view.setWrapWidth(width)
      const time = measureMedian(() => {
        view.measureForDimensions(width, 100)
      })
      times.push(time)
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
