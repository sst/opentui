import { test, expect, describe, beforeEach, afterEach, spyOn } from "bun:test"
import { BoxRenderable } from "./Box.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { TextRenderable } from "./Text.js"
import type { OptimizedBuffer } from "../buffer.js"
import type { BorderStyle } from "../lib/border.js"
import type { CapturedFrame } from "../types.js"
import { RGBA } from "../lib/RGBA.js"

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureCharFrame: () => string
let captureSpans: () => CapturedFrame
let warnSpy: ReturnType<typeof spyOn>

beforeEach(async () => {
  ;({
    renderer: testRenderer,
    renderOnce,
    captureCharFrame,
    captureSpans,
  } = await createTestRenderer({
    width: 24,
    height: 6,
  }))
  warnSpy = spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  testRenderer.destroy()
  warnSpy.mockRestore()
})

describe("BoxRenderable - focusable option", () => {
  test("is not focusable by default", async () => {
    const box = new BoxRenderable(testRenderer, {
      id: "test-box",
      width: 10,
      height: 5,
    })

    expect(box.focusable).toBe(false)
    box.focus()
    expect(box.focused).toBe(false)
  })

  test("can be made focusable via option", async () => {
    const box = new BoxRenderable(testRenderer, {
      id: "test-box",
      focusable: true,
      width: 10,
      height: 5,
    })

    expect(box.focusable).toBe(true)
    box.focus()
    expect(box.focused).toBe(true)
  })
})

describe("BoxRenderable - borderStyle validation", () => {
  describe("regression: invalid borderStyle via constructor does not crash", () => {
    test("handles invalid string borderStyle in constructor", async () => {
      const box = new BoxRenderable(testRenderer, {
        id: "test-box",
        borderStyle: "invalid-style" as BorderStyle,
        border: true,
        width: 10,
        height: 5,
      })

      testRenderer.root.add(box)
      await renderOnce()

      expect(box.borderStyle).toBe("single")
      expect(box.isDestroyed).toBe(false)
    })

    test("handles undefined borderStyle in constructor", async () => {
      const box = new BoxRenderable(testRenderer, {
        id: "test-box",
        borderStyle: undefined,
        border: true,
        width: 10,
        height: 5,
      })

      testRenderer.root.add(box)
      await renderOnce()

      expect(box.borderStyle).toBe("single")
      expect(box.isDestroyed).toBe(false)
    })
  })

  describe("regression: invalid borderStyle via setter does not crash", () => {
    test("handles invalid string borderStyle via setter", async () => {
      const box = new BoxRenderable(testRenderer, {
        id: "test-box",
        borderStyle: "double",
        border: true,
        width: 10,
        height: 5,
      })

      testRenderer.root.add(box)
      await renderOnce()

      expect(box.borderStyle).toBe("double")

      box.borderStyle = "invalid-style" as BorderStyle
      await renderOnce()

      expect(box.borderStyle).toBe("single")
      expect(box.isDestroyed).toBe(false)
    })

    test("renders correctly after fallback from invalid borderStyle", async () => {
      const box = new BoxRenderable(testRenderer, {
        id: "test-box",
        borderStyle: "invalid" as BorderStyle,
        border: true,
        width: 10,
        height: 5,
      })

      testRenderer.root.add(box)

      // Should not throw during render
      await expect(renderOnce()).resolves.toBeUndefined()
      expect(box.isDestroyed).toBe(false)
    })
  })

  describe("valid borderStyle values work correctly", () => {
    test.each(["single", "double", "rounded", "heavy"] as BorderStyle[])(
      "accepts valid borderStyle '%s' in constructor",
      async (style) => {
        const box = new BoxRenderable(testRenderer, {
          id: "test-box",
          borderStyle: style,
          border: true,
          width: 10,
          height: 5,
        })

        testRenderer.root.add(box)
        await renderOnce()

        expect(box.borderStyle).toBe(style)
      },
    )

    test.each(["single", "double", "rounded", "heavy"] as BorderStyle[])(
      "accepts valid borderStyle '%s' via setter",
      async (style) => {
        const box = new BoxRenderable(testRenderer, {
          id: "test-box",
          border: true,
          width: 10,
          height: 5,
        })

        testRenderer.root.add(box)
        await renderOnce()

        box.borderStyle = style
        await renderOnce()

        expect(box.borderStyle).toBe(style)
      },
    )
  })
})

describe("BoxRenderable - border titles (top and bottom)", () => {
  test("renders top and bottom titles on their respective borders", async () => {
    const box = new BoxRenderable(testRenderer, {
      id: "border-title-box",
      border: true,
      width: 16,
      height: 5,
      title: "Top",
      titleAlignment: "left",
      bottomTitle: "Bot",
      bottomTitleAlignment: "right",
    })

    testRenderer.root.add(box)
    await renderOnce()

    const lines = captureCharFrame().split("\n")

    expect(lines[0].slice(0, 16)).toBe("┌─Top──────────┐")
    expect(lines[4].slice(0, 16)).toBe("└──────────Bot─┘")
  })

  test.each([
    ["left", "└─Bot────────────┘"],
    ["center", "└──────Bot───────┘"],
    ["right", "└────────────Bot─┘"],
  ] as const)("renders bottom title with %s alignment", async (alignment, expectedBorder) => {
    const box = new BoxRenderable(testRenderer, {
      id: `bottom-title-${alignment}`,
      border: true,
      width: 18,
      height: 5,
      bottomTitle: "Bot",
      bottomTitleAlignment: alignment,
    })

    testRenderer.root.add(box)
    await renderOnce()

    const lines = captureCharFrame().split("\n")
    expect(lines[4].slice(0, 18)).toBe(expectedBorder)
  })
})

describe("BoxRenderable - transparent border blending", () => {
  test("blends transparent border foreground against the box background", async () => {
    const panel = RGBA.fromHex("#123456")
    const box = new BoxRenderable(testRenderer, {
      id: "transparent-border-box",
      width: 6,
      height: 3,
      border: ["left"],
      borderStyle: "heavy",
      borderColor: RGBA.fromInts(0, 0, 0, 0),
      backgroundColor: panel,
    })

    testRenderer.root.add(box)
    await renderOnce()

    const buffer = testRenderer.currentRenderBuffer
    expect(buffer.buffers.char[0]).toBe("┃".codePointAt(0))
    expect({
      fg: RGBA.fromArray(buffer.buffers.fg.slice(0, 4)).toInts(),
      bg: RGBA.fromArray(buffer.buffers.bg.slice(0, 4)).toInts(),
    }).toEqual({
      fg: panel.toInts(),
      bg: panel.toInts(),
    })
  })
})

describe("BoxRenderable - focus-within", () => {
  test("hasFocusedDescendant is false initially", async () => {
    const parent = new BoxRenderable(testRenderer, {
      id: "parent",
      focusable: true,
      border: true,
      width: 10,
      height: 5,
    })
    const child = new BoxRenderable(testRenderer, {
      id: "child",
      focusable: true,
      width: 5,
      height: 3,
    })

    parent.add(child)
    testRenderer.root.add(parent)
    await renderOnce()

    expect(parent.hasFocusedDescendant).toBe(false)
  })

  test("hasFocusedDescendant becomes true when child is focused", async () => {
    const parent = new BoxRenderable(testRenderer, {
      id: "parent",
      focusable: true,
      border: true,
      width: 10,
      height: 5,
    })
    const child = new BoxRenderable(testRenderer, {
      id: "child",
      focusable: true,
      width: 5,
      height: 3,
    })

    parent.add(child)
    testRenderer.root.add(parent)
    await renderOnce()

    child.focus()

    expect(child.focused).toBe(true)
    expect(parent.hasFocusedDescendant).toBe(true)
  })

  test("hasFocusedDescendant becomes false when child is blurred", async () => {
    const parent = new BoxRenderable(testRenderer, {
      id: "parent",
      focusable: true,
      border: true,
      width: 10,
      height: 5,
    })
    const child = new BoxRenderable(testRenderer, {
      id: "child",
      focusable: true,
      width: 5,
      height: 3,
    })

    parent.add(child)
    testRenderer.root.add(parent)
    await renderOnce()

    child.focus()
    expect(parent.hasFocusedDescendant).toBe(true)

    child.blur()
    expect(parent.hasFocusedDescendant).toBe(false)
  })

  test("propagates up the ancestor chain", async () => {
    const grandparent = new BoxRenderable(testRenderer, {
      id: "grandparent",
      focusable: true,
      border: true,
      width: 20,
      height: 10,
    })
    const parent = new BoxRenderable(testRenderer, {
      id: "parent",
      focusable: true,
      width: 15,
      height: 8,
    })
    const child = new BoxRenderable(testRenderer, {
      id: "child",
      focusable: true,
      width: 5,
      height: 3,
    })

    grandparent.add(parent)
    parent.add(child)
    testRenderer.root.add(grandparent)
    await renderOnce()

    child.focus()

    expect(parent.hasFocusedDescendant).toBe(true)
    expect(grandparent.hasFocusedDescendant).toBe(true)
  })
})

describe("BoxRenderable - no-op rendering", () => {
  test("skips drawBox for transparent layout-only boxes", () => {
    const box = new BoxRenderable(testRenderer, {
      id: "layout-only",
      width: 10,
      height: 5,
    })

    let drawBoxCalled = false
    let fillRectCalled = false
    let clipFillCalled = false
    const buffer = {
      width: 80,
      height: 24,
      getCurrentOpacity() {
        return 1
      },
      drawBox() {
        drawBoxCalled = true
      },
      fillRect() {
        fillRectCalled = true
      },
      fillRectClipWideGraphemes() {
        clipFillCalled = true
      },
    }

    ;(box as any).renderSelf(buffer, 0)
    expect(drawBoxCalled).toBe(false)
    expect(fillRectCalled).toBe(false)
    expect(clipFillCalled).toBe(false)
  })

  test("still fills boxes with a visible background", () => {
    const box = new BoxRenderable(testRenderer, {
      id: "filled-box",
      width: 10,
      height: 5,
      backgroundColor: "#112233",
    })

    let drawBoxCalled = false
    let fillRectCalled = false
    const buffer = {
      width: 80,
      height: 24,
      getCurrentOpacity() {
        return 1
      },
      drawBox() {
        drawBoxCalled = true
      },
      fillRect() {
        fillRectCalled = true
      },
      fillRectClipWideGraphemes() {
        throw new Error("opaque fills should not use clip-wide fill path")
      },
    }

    ;(box as any).renderSelf(buffer, 0)
    expect(fillRectCalled).toBe(true)
    expect(drawBoxCalled).toBe(false)
  })

  test("still draws boxes with borders", () => {
    const box = new BoxRenderable(testRenderer, {
      id: "bordered-box",
      width: 10,
      height: 5,
      border: true,
    })

    let drawBoxCalled = false
    const buffer = {
      width: 80,
      height: 24,
      getCurrentOpacity() {
        return 1
      },
      drawBox() {
        drawBoxCalled = true
      },
      fillRect() {},
      fillRectClipWideGraphemes() {},
    }

    ;(box as any).renderSelf(buffer, 0)
    expect(drawBoxCalled).toBe(true)
  })
})

describe("BoxRenderable - wide grapheme alpha fill", () => {
  test("leaves wide text untouched when a transparent box would otherwise take the clipping path", async () => {
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-0",
        content: "ab東cd",
        position: "absolute",
        left: 0,
        top: 0,
      }),
    )

    testRenderer.root.add(
      new BoxRenderable(testRenderer, {
        id: "overlay",
        position: "absolute",
        left: 3,
        top: 0,
        width: 4,
        height: 1,
        border: false,
        backgroundColor: "transparent",
      }),
    )

    await renderOnce()

    const topRow = captureCharFrame().split("\n")[0]
    expect(topRow?.startsWith("ab東cd")).toBe(true)
  })

  test("clips a partially offscreen translucent fill to the visible rect", async () => {
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-0",
        content: "abcd",
        position: "absolute",
        left: 0,
        top: 0,
      }),
    )

    testRenderer.root.add(
      new BoxRenderable(testRenderer, {
        id: "overlay",
        position: "absolute",
        left: -1,
        top: 0,
        width: 2,
        height: 1,
        border: false,
        backgroundColor: RGBA.fromInts(0, 136, 255, 24),
      }),
    )

    await renderOnce()

    const spans = captureSpans().lines[0].spans
    expect(spans[0]?.text).toBe("a")
    expect(spans[0]?.bg.a).toBeGreaterThan(0)
    expect(spans[1]?.text.startsWith("bcd")).toBe(true)
    expect(spans[1]?.bg.a).toBe(0)
  })

  test("clips boundary-crossing wide graphemes while preserving fully interior graphemes", async () => {
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-0",
        content: "ab東cd",
        position: "absolute",
        left: 0,
        top: 0,
      }),
    )
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-1",
        content: "abcd東ef",
        position: "absolute",
        left: 0,
        top: 1,
      }),
    )

    testRenderer.root.add(
      new BoxRenderable(testRenderer, {
        id: "overlay",
        position: "absolute",
        left: 3,
        top: 0,
        width: 6,
        height: 3,
        border: false,
        backgroundColor: RGBA.fromInts(0, 136, 255, 24),
      }),
    )

    await renderOnce()

    const [topRow, middleRow] = captureCharFrame().split("\n")
    expect(topRow.startsWith("ab       ")).toBe(true)
    expect(middleRow.startsWith("abc 東ef")).toBe(true)
  })

  test("applies the same clipping when the translucent overlay box is buffered", async () => {
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-0",
        content: "ab東cd",
        position: "absolute",
        left: 0,
        top: 0,
      }),
    )
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-1",
        content: "abcd東ef",
        position: "absolute",
        left: 0,
        top: 1,
      }),
    )

    testRenderer.root.add(
      new BoxRenderable(testRenderer, {
        id: "overlay",
        buffered: true,
        position: "absolute",
        left: 3,
        top: 0,
        width: 6,
        height: 3,
        border: false,
        backgroundColor: RGBA.fromInts(0, 136, 255, 24),
      }),
    )

    await renderOnce()

    const [topRow, middleRow] = captureCharFrame().split("\n")
    expect(topRow.startsWith("ab       ")).toBe(true)
    expect(middleRow.startsWith("abc 東ef")).toBe(true)
  })

  test("treats ancestor overflow clipping as a visible edge for wide-grapheme clipping", async () => {
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-0",
        content: "ab東cd",
        position: "absolute",
        left: 0,
        top: 1,
      }),
    )

    const parent = new BoxRenderable(testRenderer, {
      id: "parent",
      position: "absolute",
      left: 3,
      top: 0,
      width: 3,
      height: 3,
      border: false,
      shouldFill: false,
      overflow: "hidden",
    })
    testRenderer.root.add(parent)

    parent.add(
      new BoxRenderable(testRenderer, {
        id: "overlay",
        position: "absolute",
        left: -1,
        top: 0,
        width: 4,
        height: 3,
        border: false,
        backgroundColor: RGBA.fromInts(0, 136, 255, 24),
      }),
    )

    await renderOnce()

    const middleRow = captureCharFrame().split("\n")[1]
    expect(middleRow?.startsWith("ab  c ")).toBe(true)
  })

  test("treats buffered ancestor overflow clipping as a visible edge for wide-grapheme clipping", async () => {
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-0",
        content: "ab東cd",
        position: "absolute",
        left: 0,
        top: 1,
      }),
    )

    const parent = new BoxRenderable(testRenderer, {
      id: "parent",
      buffered: true,
      position: "absolute",
      left: 3,
      top: 0,
      width: 3,
      height: 3,
      border: false,
      shouldFill: false,
      overflow: "hidden",
    })
    testRenderer.root.add(parent)

    parent.add(
      new BoxRenderable(testRenderer, {
        id: "overlay",
        position: "absolute",
        left: -1,
        top: 0,
        width: 4,
        height: 3,
        border: false,
        backgroundColor: RGBA.fromInts(0, 136, 255, 24),
      }),
    )

    await renderOnce()

    const middleRow = captureCharFrame().split("\n")[1]
    expect(middleRow?.startsWith("ab  c ")).toBe(true)
  })

  test("clips buffered overflow-hidden children in screen coordinates", async () => {
    const parent = new BoxRenderable(testRenderer, {
      id: "parent",
      buffered: true,
      position: "absolute",
      left: 3,
      top: 0,
      width: 3,
      height: 3,
      border: false,
      shouldFill: false,
      overflow: "hidden",
    })
    testRenderer.root.add(parent)

    parent.add(
      new TextRenderable(testRenderer, {
        id: "child",
        content: "abcdef",
        position: "absolute",
        left: -1,
        top: 1,
      }),
    )

    await renderOnce()

    const middleRow = captureCharFrame().split("\n")[1]
    expect(middleRow?.startsWith("   bc")).toBe(true)
  })

  test("renders buffered opaque boxes from framebuffer-local coordinates", async () => {
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-0",
        content: "abcdefgh",
        position: "absolute",
        left: 0,
        top: 1,
      }),
    )

    testRenderer.root.add(
      new BoxRenderable(testRenderer, {
        id: "overlay",
        buffered: true,
        position: "absolute",
        left: 3,
        top: 1,
        width: 4,
        height: 1,
        border: false,
        backgroundColor: "#ff0000",
      }),
    )

    await renderOnce()

    const middleRow = captureCharFrame().split("\n")[1]
    expect(middleRow?.startsWith("abc    h")).toBe(true)
  })

  test("retains buffered opaque framebuffer contents across unrelated rerenders", async () => {
    let firstFrame = true
    const box = new BoxRenderable(testRenderer, {
      id: "overlay",
      buffered: true,
      position: "absolute",
      left: 0,
      top: 0,
      width: 5,
      height: 1,
      border: false,
      shouldFill: false,
      backgroundColor: "#000000",
      renderAfter(buffer) {
        if (!firstFrame) {
          return
        }

        buffer.drawText("A", 0, 0, RGBA.fromInts(255, 255, 255, 255))
        firstFrame = false
      },
    })
    const tick = new TextRenderable(testRenderer, {
      id: "tick",
      content: "x",
      position: "absolute",
      left: 0,
      top: 1,
    })

    testRenderer.root.add(box)
    testRenderer.root.add(tick)

    await renderOnce()
    expect(captureCharFrame().split("\n")[0]?.startsWith("A")).toBe(true)

    tick.content = "y"
    await renderOnce()

    expect(captureCharFrame().split("\n")[0]?.startsWith("A")).toBe(true)
  })

  test("keeps renderAfter callbacks framebuffer-local while clipping wide grapheme edges", async () => {
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-0",
        content: "ab東cd",
        position: "absolute",
        left: 0,
        top: 0,
      }),
    )
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-1",
        content: "abcd東ef",
        position: "absolute",
        left: 0,
        top: 1,
      }),
    )

    testRenderer.root.add(
      new BoxRenderable(testRenderer, {
        id: "overlay",
        buffered: true,
        position: "absolute",
        left: 3,
        top: 0,
        width: 6,
        height: 3,
        border: false,
        backgroundColor: RGBA.fromInts(0, 136, 255, 24),
        renderAfter(buffer) {
          buffer.drawText("X", 5, 0, RGBA.fromInts(255, 255, 255, 255))
        },
      }),
    )

    await renderOnce()

    const [topRow, middleRow] = captureCharFrame().split("\n")
    expect(topRow?.startsWith("ab      X")).toBe(true)
    expect(middleRow?.startsWith("abc 東ef")).toBe(true)
  })

  test("keeps renderBefore callbacks beneath direct translucent fill for buffered boxes", async () => {
    testRenderer.root.add(
      new BoxRenderable(testRenderer, {
        id: "overlay",
        buffered: true,
        position: "absolute",
        left: 3,
        top: 1,
        width: 4,
        height: 1,
        border: false,
        backgroundColor: RGBA.fromInts(0, 136, 255, 24),
        renderBefore(buffer) {
          buffer.drawText("X", 0, 0, RGBA.fromInts(255, 255, 255, 255))
        },
      }),
    )

    await renderOnce()

    const xSpan = captureSpans().lines[1].spans.find((span) => span.text.includes("X"))
    expect(xSpan).toBeDefined()
    expect(xSpan!.fg.r).toBeLessThan(1)
    expect(xSpan!.bg.a).toBeGreaterThan(0)
  })

  test("does not accumulate translucent buffered box tint across identical rerenders", async () => {
    testRenderer.root.add(
      new BoxRenderable(testRenderer, {
        id: "overlay",
        buffered: true,
        position: "absolute",
        left: 4,
        top: 1,
        width: 4,
        height: 2,
        border: false,
        backgroundColor: RGBA.fromInts(0, 136, 255, 24),
        renderAfter(buffer) {
          buffer.drawText("X", 0, 0, RGBA.fromInts(255, 255, 255, 255))
        },
      }),
    )

    await renderOnce()
    const firstSpan = captureSpans().lines[1].spans.find((span) => span.text.includes("X"))
    expect(firstSpan).toBeDefined()

    await renderOnce()
    const secondSpan = captureSpans().lines[1].spans.find((span) => span.text.includes("X"))
    expect(secondSpan).toBeDefined()

    expect(secondSpan!.bg.r).toBeCloseTo(firstSpan!.bg.r, 6)
    expect(secondSpan!.bg.g).toBeCloseTo(firstSpan!.bg.g, 6)
    expect(secondSpan!.bg.b).toBeCloseTo(firstSpan!.bg.b, 6)
    expect(secondSpan!.bg.a).toBeCloseTo(firstSpan!.bg.a, 6)
  })

  test("keeps subclass renderSelf framebuffer-local while clipping wide grapheme edges", async () => {
    class BufferedLabelBox extends BoxRenderable {
      protected override renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
        super.renderSelf(buffer, deltaTime)
        buffer.drawText("X", 5, 0, RGBA.fromInts(255, 255, 255, 255))
      }
    }

    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-0",
        content: "ab東cd",
        position: "absolute",
        left: 0,
        top: 0,
      }),
    )
    testRenderer.root.add(
      new TextRenderable(testRenderer, {
        id: "line-1",
        content: "abcd東ef",
        position: "absolute",
        left: 0,
        top: 1,
      }),
    )

    testRenderer.root.add(
      new BufferedLabelBox(testRenderer, {
        id: "overlay",
        buffered: true,
        position: "absolute",
        left: 3,
        top: 0,
        width: 6,
        height: 3,
        border: false,
        backgroundColor: RGBA.fromInts(0, 136, 255, 24),
      }),
    )

    await renderOnce()

    const [topRow, middleRow] = captureCharFrame().split("\n")
    expect(topRow?.startsWith("ab      X")).toBe(true)
    expect(middleRow?.startsWith("abc 東ef")).toBe(true)
  })

  test("does not replay stale framebuffer contents after switching back from bypass rendering", async () => {
    const box = new BoxRenderable(testRenderer, {
      id: "overlay",
      buffered: true,
      position: "absolute",
      left: 2,
      top: 1,
      width: 3,
      height: 1,
      border: false,
      shouldFill: false,
      backgroundColor: RGBA.fromInts(0, 136, 255, 24),
      renderAfter(buffer) {
        buffer.drawText("A", 0, 0, RGBA.fromInts(255, 255, 255, 255))
      },
    })
    testRenderer.root.add(box)

    await renderOnce()
    expect(captureCharFrame().split("\n")[1]?.startsWith("  A")).toBe(true)

    box.renderAfter = undefined
    await renderOnce()
    expect(captureCharFrame().split("\n")[1]?.trim()).toBe("")

    box.renderAfter = function (buffer) {
      buffer.drawText("B", 1, 0, RGBA.fromInts(255, 255, 255, 255))
    }
    await renderOnce()

    const middleRow = captureCharFrame().split("\n")[1]
    expect(middleRow?.startsWith("  AB")).toBe(false)
    expect(middleRow?.startsWith("   B")).toBe(true)
  })
})
