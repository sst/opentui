import type { mock as bunMock, spyOn as bunSpyOn } from "bun:test"
import { vi, expect } from "vitest"
export * from "vitest"

export const mock: typeof bunMock = vi.fn as any
export const spyOn: typeof bunSpyOn = vi.spyOn as any

// Bun's toInclude → vitest's toContain
expect.extend({
  toInclude(received: unknown, expected: unknown) {
    const pass =
      typeof received === "string"
        ? received.includes(expected as string)
        : Array.isArray(received)
          ? received.includes(expected)
          : false
    return {
      pass,
      message: () => `expected ${this.utils.printReceived(received)} to include ${this.utils.printExpected(expected)}`,
    }
  },
})
