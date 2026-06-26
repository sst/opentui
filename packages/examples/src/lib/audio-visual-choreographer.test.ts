import { expect, test } from "bun:test"

import { AudioVisualChoreographer } from "./audio-visual-choreographer.js"

test("impact triggers once per armed pulse and decays to zero", () => {
  const choreography = new AudioVisualChoreographer()
  choreography.update(1_000, { level: 0.8, pulse: 0.9, bassTransient: 0.9, midTransient: 0, trebleTransient: 0 })
  choreography.update(1_050, { level: 0.8, pulse: 0.9, bassTransient: 0.9, midTransient: 0, trebleTransient: 0 })
  expect(choreography.impact).toBeGreaterThan(0)
  expect(choreography.bassImpact).toBeGreaterThan(0)
  choreography.update(1_170, { level: 0.8, pulse: 0.9, bassTransient: 0.9, midTransient: 0, trebleTransient: 0 })
  expect(choreography.impact).toBe(0)
  choreography.update(1_200, { level: 0.8, pulse: 0.2, bassTransient: 0.1, midTransient: 0, trebleTransient: 0 })
  choreography.update(1_250, { level: 0.8, pulse: 0.9, bassTransient: 0.9, midTransient: 0, trebleTransient: 0 })
  choreography.update(1_280, { level: 0.8, pulse: 0.9, bassTransient: 0.9, midTransient: 0, trebleTransient: 0 })
  expect(choreography.impact).toBeGreaterThan(0)
})

test("mid and treble transients trigger independent gestures", () => {
  const choreography = new AudioVisualChoreographer()
  choreography.update(1_000, { level: 0.7, pulse: 0, bassTransient: 0, midTransient: 0.9, trebleTransient: 0 })
  choreography.update(1_030, { level: 0.7, pulse: 0, bassTransient: 0, midTransient: 0.9, trebleTransient: 0 })
  expect(choreography.midImpact).toBeGreaterThan(0)
  expect(choreography.bassImpact).toBe(0)

  choreography.update(1_250, { level: 0.7, pulse: 0, bassTransient: 0, midTransient: 0.1, trebleTransient: 0.9 })
  choreography.update(1_270, { level: 0.7, pulse: 0, bassTransient: 0, midTransient: 0.1, trebleTransient: 0.9 })
  expect(choreography.trebleImpact).toBeGreaterThan(0)
})

test("reset cancels active choreography", () => {
  const choreography = new AudioVisualChoreographer()
  choreography.update(1_000, { level: 0.8, pulse: 0.9, bassTransient: 0.9, midTransient: 0, trebleTransient: 0 })
  choreography.update(1_050, { level: 0.8, pulse: 0.9, bassTransient: 0.9, midTransient: 0, trebleTransient: 0 })
  choreography.reset(1_050)
  expect(choreography.impact).toBe(0)
  expect(choreography.midImpact).toBe(0)
  expect(choreography.trebleImpact).toBe(0)
})
