import { afterEach, expect, test } from "bun:test"
import { createTestRenderer, type TestRenderer } from "@opentui/core/testing"
import { destroy, run } from "./native-image-demo.js"

let renderer: TestRenderer | undefined

afterEach(() => {
  if (renderer) {
    destroy(renderer)
    renderer.destroy()
    renderer = undefined
  }
})

test("destroy cancels pending startup", async () => {
  renderer = (await createTestRenderer({ width: 80, height: 24 })).renderer

  const pending = run(renderer)
  destroy(renderer)
  await pending

  expect(renderer.root.getChildren().some((child) => child.id === "native-image-demo")).toBe(false)
})
