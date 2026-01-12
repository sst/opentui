import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import { Renderable } from "../Renderable"
import { resolveRenderLib } from "../zig"

function findBrokenAnsiSequences(output: string): string[] {
  const broken: string[] = []

  const truncatedColorPattern = /(?<!\x1b\[\d?)(\d;2;\d+;\d+;\d+m)/g
  let match
  while ((match = truncatedColorPattern.exec(output)) !== null) {
    const before = output.substring(Math.max(0, match.index - 3), match.index)
    if (!/\x1b\[\d$/.test(before)) {
      broken.push(match[1])
    }
  }

  return broken
}

function validateAnsiSequences(output: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  let i = 0
  while (i < output.length) {
    if (output[i] === "\x1b" && i + 1 < output.length && output[i + 1] === "[") {
      const start = i
      i += 2

      while (i < output.length) {
        const c = output[i]
        if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
          i++
          break
        } else if (c === "\x1b") {
          errors.push(`Incomplete CSI at position ${start}: ${JSON.stringify(output.slice(start, i))}`)
          break
        }
        i++
      }
    } else {
      i++
    }
  }

  const brokenFragments = findBrokenAnsiSequences(output)
  for (const fragment of brokenFragments) {
    errors.push(`Orphaned ANSI fragment: ${JSON.stringify(fragment)}`)
  }

  return { valid: errors.length === 0, errors }
}

class ColorfulRenderable extends Renderable {
  constructor(renderer: TestRenderer, options: any) {
    super(renderer, options)
  }

  protected override internalRender(): void {
    for (let y = 0; y < this.bounds.height; y++) {
      for (let x = 0; x < this.bounds.width; x++) {
        const r = ((x * 10) % 256) / 255
        const g = ((y * 10) % 256) / 255
        const b = (((x + y) * 5) % 256) / 255

        this.buffer?.setCell(x, y, "█".charCodeAt(0), { r, g, b, a: 1 }, { r: 0, g: 0, b: 0, a: 1 }, 0)
      }
    }
  }
}

describe("ANSI sequence integrity", () => {
  let renderer: TestRenderer
  let renderOnce: () => Promise<void>

  beforeEach(async () => {
    ;({ renderer, renderOnce } = await createTestRenderer({
      width: 80,
      height: 24,
      useThread: true,
    }))
  })

  afterEach(() => {
    renderer.destroy()
  })

  test("output should not contain broken color sequence fragments", async () => {
    const colorful = new ColorfulRenderable(renderer, {
      width: 80,
      height: 24,
    })
    renderer.root.add(colorful)

    const lib = resolveRenderLib()
    const reportedPattern = /(?<!\x1b\[[\d;]*)55;255;255m/

    for (let i = 0; i < 20; i++) {
      await renderOnce()

      const output = lib.getLastOutputForTestString(renderer.rendererPtr)
      const match = output.match(reportedPattern)

      if (match) {
        const index = output.indexOf(match[0])
        const contextStart = Math.max(0, index - 20)
        const contextEnd = Math.min(output.length, index + match[0].length + 20)
        throw new Error(
          `Found broken ANSI sequence: ${match[0]} in context: ${JSON.stringify(output.slice(contextStart, contextEnd))}`,
        )
      }
    }
  })

  test("render output should have valid ANSI sequences", async () => {
    const colorful = new ColorfulRenderable(renderer, {
      width: 40,
      height: 12,
    })
    renderer.root.add(colorful)

    await renderOnce()

    const lib = resolveRenderLib()
    const output = lib.getLastOutputForTestString(renderer.rendererPtr)
    const validation = validateAnsiSequences(output)

    expect(validation.valid).toBe(true)
  })

  test("multiple rapid renders should maintain ANSI sequence integrity", async () => {
    const colorful = new ColorfulRenderable(renderer, {
      width: 80,
      height: 24,
    })
    renderer.root.add(colorful)

    const lib = resolveRenderLib()
    const allErrors: string[] = []

    for (let i = 0; i < 10; i++) {
      await renderOnce()

      const output = lib.getLastOutputForTestString(renderer.rendererPtr)
      const validation = validateAnsiSequences(output)

      if (!validation.valid) {
        allErrors.push(`Frame ${i}: ${validation.errors.join(", ")}`)
      }
    }

    expect(allErrors.length).toBe(0)
  })
})
