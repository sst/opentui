import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { TextBuffer } from "../text-buffer"
import { TextBufferView } from "../text-buffer-view"
import { stringToStyledText } from "../lib/styled-text"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import { TextRenderable } from "../renderables/Text"
import { BoxRenderable } from "../renderables/Box"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"

describe("Wrap resize performance", () => {
  describe("Full TextRenderable resize simulation", () => {
    let renderer: TestRenderer
    let renderOnce: () => Promise<void>
    let resize: (width: number, height: number) => void

    beforeEach(async () => {
      ;({ renderer, renderOnce, resize } = await createTestRenderer({
        width: 100,
        height: 50,
      }))
    })

    afterEach(() => {
      renderer.destroy()
    })

    it("should test word wrap with text that has actual word breaks", async () => {
      const charCount = 100000

      // Test 1: No spaces (worst case - no word breaks)
      {
        const text = "x".repeat(charCount)

        const container = new BoxRenderable(renderer, {
          width: 80,
          height: 30,
          border: true,
        })
        renderer.root.add(container)

        const textRenderable = new TextRenderable(renderer, {
          content: text,
          wrapMode: "word",
          width: "100%",
        })
        container.add(textRenderable)

        await renderOnce()

        const textBufferView = (textRenderable as any).textBufferView as TextBufferView

        const start = performance.now()
        textBufferView.measureForDimensions(83, 28)
        const time = performance.now() - start

        // Should be fast even without word breaks (was 8ms+ before fix)
        expect(time).toBeLessThan(1)

        container.destroyRecursively()
      }

      // Test 2: Space every 10 chars (many word breaks)
      {
        const wordLength = 10
        const words = Math.ceil(charCount / (wordLength + 1))
        const text = Array(words).fill("x".repeat(wordLength)).join(" ")

        const container = new BoxRenderable(renderer, {
          width: 80,
          height: 30,
          border: true,
        })
        renderer.root.add(container)

        const textRenderable = new TextRenderable(renderer, {
          content: text,
          wrapMode: "word",
          width: "100%",
        })
        container.add(textRenderable)

        await renderOnce()

        const textBufferView = (textRenderable as any).textBufferView as TextBufferView

        const start = performance.now()
        textBufferView.measureForDimensions(83, 28)
        const time = performance.now() - start

        expect(time).toBeLessThan(1)

        container.destroyRecursively()
      }
    })

    it("should compare full render cycle performance", async () => {
      const charCount = 100000

      // Test with spaces (realistic)
      {
        const wordLength = 10
        const words = Math.ceil(charCount / (wordLength + 1))
        const text = Array(words).fill("x".repeat(wordLength)).join(" ")

        const container = new BoxRenderable(renderer, {
          width: 80,
          height: 30,
          border: true,
        })
        renderer.root.add(container)

        const textRenderable = new TextRenderable(renderer, {
          content: text,
          wrapMode: "word",
          width: "100%",
        })
        container.add(textRenderable)

        await renderOnce()

        // Measure resize performance
        const times: number[] = []
        for (const newWidth of [81, 82, 83, 84, 85]) {
          container.width = newWidth
          const start = performance.now()
          await renderOnce()
          times.push(performance.now() - start)
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length
        expect(avgTime).toBeLessThan(10) // Should be well under 10ms

        container.destroyRecursively()
      }

      // Test without spaces (worst case)
      {
        const text = "x".repeat(charCount)

        const container = new BoxRenderable(renderer, {
          width: 80,
          height: 30,
          border: true,
        })
        renderer.root.add(container)

        const textRenderable = new TextRenderable(renderer, {
          content: text,
          wrapMode: "word",
          width: "100%",
        })
        container.add(textRenderable)

        await renderOnce()

        // Measure resize performance
        const times: number[] = []
        for (const newWidth of [81, 82, 83, 84, 85]) {
          container.width = newWidth
          const start = performance.now()
          await renderOnce()
          times.push(performance.now() - start)
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length
        // Should be fast even without word breaks (was 16ms+ before fix)
        expect(avgTime).toBeLessThan(10)

        container.destroyRecursively()
      }
    })
  })
})
