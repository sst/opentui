import { describe, expect, it, afterAll, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockMouse, type MockInput } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMouse: MockMouse
let currentMockInput: MockInput

describe("Textarea - Stress Tests", () => {
  beforeEach(async () => {
    ;({
      renderer: currentRenderer,
      renderOnce,
      mockMouse: currentMouse,
      mockInput: currentMockInput,
    } = await createTestRenderer({
      width: 80,
      height: 24,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })
})
