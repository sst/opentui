import { describe, expect, test } from "bun:test"
import { createCliRenderer, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createRuntimePlugin } from "@opentui/core/runtime-plugin"

const nativePackageName = `@opentui/core-${process.platform}-${process.arch}`

describe("@opentui/core dist test (Bun)", () => {
  test("imports core public entrypoints", async () => {
    const core = await import("@opentui/core")
    const testing = await import("@opentui/core/testing")
    const runtimePlugin = await import("@opentui/core/runtime-plugin")

    expect(typeof core.createCliRenderer).toBe("function")
    expect(typeof core.TextRenderable).toBe("function")
    expect(typeof testing.createTestRenderer).toBe("function")
    expect(typeof runtimePlugin.createRuntimePlugin).toBe("function")
  })

  test("loads the platform-native package", async () => {
    const nativePackage = await import(nativePackageName)
    expect(typeof nativePackage.default).toBe("string")
  })

  test("renders a frame with createTestRenderer", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 20,
      height: 4,
    })

    try {
      const text = new TextRenderable(renderer, { content: "hello bun dist" })
      renderer.root.add(text)
      await renderOnce()

      expect(captureCharFrame()).toMatch(/hello bun dist/)
    } finally {
      renderer.destroy()
    }
  })

  test("createRuntimePlugin returns a valid plugin", () => {
    const plugin = createRuntimePlugin()
    expect(plugin).toBeDefined()
    expect(typeof plugin.name).toBe("string")
    expect(typeof plugin.setup).toBe("function")
  })
})
