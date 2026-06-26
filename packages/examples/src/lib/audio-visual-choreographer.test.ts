import { expect, test } from "bun:test"

import { AudioVisualChoreographer } from "./audio-visual-choreographer.js"

test("impact triggers once per armed pulse and decays to zero", () => {
  const choreography = new AudioVisualChoreographer()
  choreography.update(1_000, { level: 0.8, pulse: 0.9 })
  choreography.update(1_050, { level: 0.8, pulse: 0.9 })
  expect(choreography.impact).toBeGreaterThan(0)

  choreography.update(1_170, { level: 0.8, pulse: 0.9 })
  expect(choreography.impact).toBe(0)
  choreography.update(1_200, { level: 0.8, pulse: 0.2 })
  choreography.update(1_250, { level: 0.8, pulse: 0.9 })
  choreography.update(1_280, { level: 0.8, pulse: 0.9 })
  expect(choreography.impact).toBeGreaterThan(0)
})

test("reset cancels active choreography", () => {
  const choreography = new AudioVisualChoreographer()
  choreography.update(1_000, { level: 0.8, pulse: 0.9 })
  choreography.update(1_050, { level: 0.8, pulse: 0.9 })
  choreography.reset(1_050)

  expect(choreography.impact).toBe(0)
})
