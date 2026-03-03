import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { Renderable, type RenderableOptions } from "../Renderable"
import type { RenderContext } from "../types"
import { type StdinParserMode } from "../renderer"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"

class MouseTarget extends Renderable {
  constructor(context: RenderContext, options: RenderableOptions) {
    super(context, options)
  }
}

async function createRendererWithMode(mode: StdinParserMode): Promise<{
  renderer: TestRenderer
  renderOnce: () => Promise<void>
}> {
  const { renderer, renderOnce } = await createTestRenderer({
    width: 40,
    height: 20,
    useMouse: true,
    experimental_stdinParserMode: mode,
  })

  return { renderer, renderOnce }
}

describe("renderer stdin routing", () => {
  for (const mode of ["legacy", "zig"] as const) {
    test(`mouse then key in one chunk (${mode})`, async () => {
      const { renderer, renderOnce } = await createRendererWithMode(mode)
      try {
        const target = new MouseTarget(renderer, {
          id: `target-mouse-then-key-${mode}`,
          position: "absolute",
          left: 0,
          top: 0,
          width: renderer.width,
          height: renderer.height,
        })
        renderer.root.add(target)
        await renderOnce()

        const keys: string[] = []
        let scrollCount = 0

        renderer.keyInput.on("keypress", (event) => {
          keys.push(event.name)
        })

        target.onMouseScroll = () => {
          scrollCount++
        }

        renderer.stdin.emit("data", Buffer.from("\x1b[<64;10;5Mx"))
        await Bun.sleep(20)

        expect(scrollCount).toBe(1)
        if (mode === "legacy") {
          expect(keys).toEqual([])
        } else {
          expect(keys).toEqual(["x"])
        }
      } finally {
        renderer.destroy()
      }
    })

    test(`key then mouse in one chunk (${mode})`, async () => {
      const { renderer, renderOnce } = await createRendererWithMode(mode)
      try {
        const target = new MouseTarget(renderer, {
          id: `target-key-then-mouse-${mode}`,
          position: "absolute",
          left: 0,
          top: 0,
          width: renderer.width,
          height: renderer.height,
        })
        renderer.root.add(target)
        await renderOnce()

        const keys: string[] = []
        let scrollCount = 0

        renderer.keyInput.on("keypress", (event) => {
          keys.push(event.name)
        })

        target.onMouseScroll = () => {
          scrollCount++
        }

        renderer.stdin.emit("data", Buffer.from("x\x1b[<64;10;5M"))
        await Bun.sleep(20)

        expect(keys).toEqual(["x"])
        if (mode === "legacy") {
          expect(scrollCount).toBe(0)
        } else {
          expect(scrollCount).toBe(1)
        }
      } finally {
        renderer.destroy()
      }
    })

    test(`focus and key mixed in one chunk (${mode})`, async () => {
      const { renderer } = await createRendererWithMode(mode)
      try {
        const events: string[] = []
        const keys: string[] = []

        renderer.on("focus", () => {
          events.push("focus")
        })

        renderer.keyInput.on("keypress", (event) => {
          keys.push(event.name)
        })

        renderer.stdin.emit("data", Buffer.from("\x1b[Ix"))
        await Bun.sleep(20)

        expect(events).toEqual(["focus"])
        expect(keys).toEqual(["x"])
      } finally {
        renderer.destroy()
      }
    })

    test(`focus and mouse mixed in one chunk (${mode})`, async () => {
      const { renderer, renderOnce } = await createRendererWithMode(mode)
      try {
        const events: string[] = []
        let scrollCount = 0

        const target = new MouseTarget(renderer, {
          id: `target-focus-then-mouse-${mode}`,
          position: "absolute",
          left: 0,
          top: 0,
          width: renderer.width,
          height: renderer.height,
        })
        renderer.root.add(target)
        await renderOnce()

        renderer.on("focus", () => {
          events.push("focus")
        })

        target.onMouseScroll = () => {
          scrollCount++
        }

        renderer.stdin.emit("data", Buffer.from("\x1b[I\x1b[<64;10;5M"))
        await Bun.sleep(20)

        expect(events).toEqual(["focus"])
        if (mode === "legacy") {
          expect(scrollCount).toBe(0)
        } else {
          expect(scrollCount).toBe(1)
        }
      } finally {
        renderer.destroy()
      }
    })
  }

  test("legacy shadow compare surfaces mixed-chunk mismatch", async () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "test"

    const { renderer, renderOnce } = await createTestRenderer({
      width: 40,
      height: 20,
      useMouse: true,
      experimental_stdinParserMode: "legacy",
      experimental_stdinShadowCompare: true,
    })

    try {
      const target = new MouseTarget(renderer, {
        id: "shadow-compare-target",
        position: "absolute",
        left: 0,
        top: 0,
        width: renderer.width,
        height: renderer.height,
      })
      renderer.root.add(target)
      await renderOnce()

      expect(() => {
        renderer.stdin.emit("data", Buffer.from("\x1b[<64;10;5Mx"))
      }).toThrow("[stdin-shadow-mismatch]")
    } finally {
      process.env.NODE_ENV = previousNodeEnv
      renderer.destroy()
    }
  })

  test("legacy shadow compare handles timeout-flushed escape parity", async () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "test"

    const { renderer } = await createTestRenderer({
      width: 40,
      height: 20,
      useMouse: true,
      experimental_stdinParserMode: "legacy",
      experimental_stdinShadowCompare: true,
    })

    try {
      const keys: string[] = []
      renderer.keyInput.on("keypress", (event) => {
        keys.push(event.name)
      })

      renderer.stdin.emit("data", Buffer.from("\x1b"))
      await Bun.sleep(30)

      expect(keys).toEqual(["escape"])
    } finally {
      process.env.NODE_ENV = previousNodeEnv
      renderer.destroy()
    }
  })

  test("zig mode suspend resets parser state before resume", async () => {
    const { renderer } = await createTestRenderer({
      width: 40,
      height: 20,
      useMouse: true,
      experimental_stdinParserMode: "zig",
    })

    try {
      const events: Array<{ name: string; meta: boolean }> = []
      renderer.keyInput.on("keypress", (event) => {
        events.push({ name: event.name, meta: event.meta })
      })

      renderer.stdin.emit("data", Buffer.from("\x1b["))
      await Bun.sleep(5)

      renderer.suspend()
      renderer.resume()
      await new Promise((resolve) => setImmediate(resolve))

      renderer.stdin.emit("data", Buffer.from("x"))
      await Bun.sleep(20)

      expect(events).toEqual([{ name: "x", meta: false }])
    } finally {
      renderer.destroy()
    }
  })

  test("zig mode discards oversized paste until end marker and then resumes", async () => {
    const { renderer } = await createTestRenderer({
      width: 40,
      height: 20,
      useMouse: true,
      experimental_stdinParserMode: "zig",
      experimental_stdinParserMaxBufferBytes: 64 * 1024,
    })

    try {
      const keys: string[] = []
      const pastes: string[] = []
      renderer.keyInput.on("keypress", (event) => {
        keys.push(event.name)
      })
      renderer.keyInput.on("paste", (event) => {
        pastes.push(event.text)
      })

      const largeChunk = Buffer.alloc(16 * 1024, "x")

      expect(() => {
        renderer.stdin.emit("data", Buffer.from("\x1b[200~"))
        for (let i = 0; i < 5; i++) {
          renderer.stdin.emit("data", largeChunk)
        }
      }).not.toThrow()

      renderer.stdin.emit("data", Buffer.from("z"))
      await Bun.sleep(20)

      expect(keys).toEqual([])
      expect(pastes).toEqual([])

      renderer.stdin.emit("data", Buffer.from("\x1b[20"))
      renderer.stdin.emit("data", Buffer.from("1~"))
      renderer.stdin.emit("data", Buffer.from("q"))
      await Bun.sleep(40)

      expect(keys).toEqual(["q"])
      expect(pastes).toEqual([])
    } finally {
      renderer.destroy()
    }
  })

  test("zig mode emits paste event for large bracketed paste under configured limit", async () => {
    const { renderer } = await createTestRenderer({
      width: 40,
      height: 20,
      useMouse: true,
      experimental_stdinParserMode: "zig",
      experimental_stdinParserMaxBufferBytes: 512 * 1024,
    })

    try {
      const payloadSize = 256 * 1024
      let pasteCount = 0
      let pastedBytes = 0

      renderer.keyInput.on("paste", (event) => {
        pasteCount += 1
        pastedBytes += event.text.length
      })

      const chunk = Buffer.alloc(payloadSize, "x")
      const stream = Buffer.concat([Buffer.from("\x1b[200~"), chunk, Buffer.from("\x1b[201~")])
      renderer.stdin.emit("data", stream)
      await Bun.sleep(80)

      expect(pasteCount).toBe(1)
      expect(pastedBytes).toBe(payloadSize)
    } finally {
      renderer.destroy()
    }
  })

  test("zig mode emits one paste event for one bracketed paste", async () => {
    const { renderer } = await createTestRenderer({
      width: 40,
      height: 20,
      useMouse: true,
      experimental_stdinParserMode: "zig",
    })

    try {
      const payload = "x".repeat(70_000)
      const pastes: string[] = []
      renderer.keyInput.on("paste", (event) => {
        pastes.push(event.text)
      })

      renderer.stdin.emit("data", Buffer.from(`\x1b[200~${payload}\x1b[201~`))
      await Bun.sleep(80)

      expect(pastes).toEqual([payload])
    } finally {
      renderer.destroy()
    }
  })

  test("zig mode emits empty paste for empty bracketed paste", async () => {
    const { renderer } = await createTestRenderer({
      width: 40,
      height: 20,
      useMouse: true,
      experimental_stdinParserMode: "zig",
    })

    try {
      const pastes: string[] = []
      renderer.keyInput.on("paste", (event) => {
        pastes.push(event.text)
      })

      renderer.stdin.emit("data", Buffer.from("\x1b[200~\x1b[201~"))
      await Bun.sleep(40)

      expect(pastes).toEqual([""])
    } finally {
      renderer.destroy()
    }
  })

  test("zig mode preserves UTF-8 across bracketed paste chunk boundaries", async () => {
    const { renderer } = await createTestRenderer({
      width: 40,
      height: 20,
      useMouse: true,
      experimental_stdinParserMode: "zig",
    })

    try {
      const payload = "a".repeat(4095) + "é"
      const pastes: string[] = []
      renderer.keyInput.on("paste", (event) => {
        pastes.push(event.text)
      })

      renderer.stdin.emit("data", Buffer.from(`\x1b[200~${payload}\x1b[201~`))
      await Bun.sleep(80)

      expect(pastes.join("")).toBe(payload)
    } finally {
      renderer.destroy()
    }
  })
})
