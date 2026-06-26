import { expect, test } from "bun:test"

import { audioShadowResponse, automaticLightPosition, audioLightPosition } from "./audio-light-motion.js"

test("automatic light preserves the original orbit", () => {
  const elapsedMs = 4321
  const time = elapsedMs * 0.00018

  expect(automaticLightPosition(elapsedMs)).toEqual({
    x: Math.sin(time * 1.07) * 0.86,
    y: Math.sin(time * 0.73 + 1.1) * 0.78,
  })
})

test("silent audio is identical to automatic light motion", () => {
  const elapsedMs = 8765

  expect(audioLightPosition(elapsedMs, { bass: 0, mid: 0, treble: 0 })).toEqual(automaticLightPosition(elapsedMs))
})

test("equalizer motion stays close to the automatic orbit", () => {
  for (let elapsedMs = 0; elapsedMs <= 60_000; elapsedMs += 250) {
    const automatic = automaticLightPosition(elapsedMs)
    const audio = audioLightPosition(elapsedMs, { bass: 1, mid: 1, treble: 1 })

    expect(Math.hypot(audio.x - automatic.x, audio.y - automatic.y)).toBeLessThanOrEqual(0.2)
  }
})

test("silent audio leaves the shadow unchanged", () => {
  expect(audioShadowResponse({ pulse: 0, treble: 0 })).toEqual({ expansion: 0, edgeLift: 0 })
})

test("beat and treble response is noticeable but bounded", () => {
  const response = audioShadowResponse({ pulse: 1, treble: 1 })

  expect(response.expansion).toBeGreaterThanOrEqual(0.1)
  expect(response.expansion).toBeLessThanOrEqual(0.14)
  expect(response.edgeLift).toBeGreaterThanOrEqual(0.2)
  expect(response.edgeLift).toBeLessThanOrEqual(0.3)
})
