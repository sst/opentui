import { expect, test } from "bun:test"
import { createCliRenderer } from "../renderer.js"
import { resolveRenderLib } from "../zig.js"

test("invalid tmuxClipboardMode is rejected before native allocation", async () => {
  const lib = resolveRenderLib()
  const before = lib.getAllocatorStats()

  await expect(
    createCliRenderer({
      bufferedOutput: "memory",
      tmuxClipboardMode: "invalid" as any,
    }),
  ).rejects.toThrow('tmuxClipboardMode must be "passthrough", "raw", or "off"')

  const after = lib.getAllocatorStats()
  expect(after.activeAllocations).toBe(before.activeAllocations)
})
