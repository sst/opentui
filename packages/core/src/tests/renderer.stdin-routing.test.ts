import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { Renderable, type RenderableOptions } from "../Renderable"
import type { RenderContext } from "../types"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"

class MouseTarget extends Renderable {
  constructor(context: RenderContext, options: RenderableOptions) {
    super(context, options)
  }
}

async function createRoutingRenderer(): Promise<{
  renderer: TestRenderer
  renderOnce: () => Promise<void>
}> {
  const { renderer, renderOnce } = await createTestRenderer({
    width: 40,
    height: 20,
    useMouse: true,
  })

  return { renderer, renderOnce }
}

describe("renderer stdin routing", () => {
  test("mouse then key in one chunk", async () => {
    const { renderer, renderOnce } = await createRoutingRenderer()
    try {
      const target = new MouseTarget(renderer, {
        id: "target-mouse-then-key",
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
      expect(keys).toEqual(["x"])
    } finally {
      renderer.destroy()
    }
  })

  test("key then mouse in one chunk", async () => {
    const { renderer, renderOnce } = await createRoutingRenderer()
    try {
      const target = new MouseTarget(renderer, {
        id: "target-key-then-mouse",
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
      expect(scrollCount).toBe(1)
    } finally {
      renderer.destroy()
    }
  })

  test("focus and key mixed in one chunk", async () => {
    const { renderer } = await createRoutingRenderer()
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

  test("focus and mouse mixed in one chunk", async () => {
    const { renderer, renderOnce } = await createRoutingRenderer()
    try {
      const events: string[] = []
      let scrollCount = 0

      const target = new MouseTarget(renderer, {
        id: "target-focus-then-mouse",
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
      expect(scrollCount).toBe(1)
    } finally {
      renderer.destroy()
    }
  })

  test("suspend resets parser state before resume", async () => {
    const { renderer } = await createRoutingRenderer()

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

  test("discards oversized paste until end marker and then resumes", async () => {
    const { renderer } = await createTestRenderer({
      width: 40,
      height: 20,
      useMouse: true,
      stdinParserMaxBufferBytes: 64 * 1024,
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

  test("emits paste event for large bracketed paste under configured limit", async () => {
    const { renderer } = await createTestRenderer({
      width: 40,
      height: 20,
      useMouse: true,
      stdinParserMaxBufferBytes: 512 * 1024,
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

  test("emits one paste event for one bracketed paste", async () => {
    const { renderer } = await createRoutingRenderer()

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

  test("emits empty paste for empty bracketed paste", async () => {
    const { renderer } = await createRoutingRenderer()

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

  test("preserves UTF-8 across bracketed paste chunk boundaries", async () => {
    const { renderer } = await createRoutingRenderer()

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
