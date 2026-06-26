import { expect, test } from "bun:test"

import { SubjectCropTracker, sampleFlowingContour } from "./cinematic-motion.js"

test("subject crop tracking is dead-zoned, smooth, and bounded", () => {
  const tracker = new SubjectCropTracker()

  expect(tracker.update({ x: 0.04, y: -0.03 }, 100)).toEqual({ x: 0, y: 0 })
  const first = tracker.update({ x: 0.9, y: 0.5 }, 100)
  expect(first.x).toBeGreaterThan(0)
  expect(first.x).toBeLessThan(0.2)
  expect(first.y).toBeGreaterThan(0)

  for (let index = 0; index < 100; index += 1) tracker.update({ x: 2, y: -2 }, 100)
  expect(tracker.center.x).toBeLessThanOrEqual(1)
  expect(tracker.center.y).toBeGreaterThanOrEqual(-1)
})

test("scene cuts retarget crop framing without an instantaneous jump", () => {
  const tracker = new SubjectCropTracker()
  for (let index = 0; index < 10; index += 1) tracker.update({ x: -0.8, y: 0 }, 100)
  const before = tracker.center.x
  const after = tracker.update({ x: 0.9, y: 0 }, 100, true).x

  expect(after).toBeGreaterThan(before)
  expect(after - before).toBeLessThan(0.35)
  for (let index = 0; index < 5; index += 1) tracker.update({ x: 0.9, y: 0 }, 42)
  expect(tracker.center.x).toBeGreaterThan(0)
})

test("targetless frames hold the last composed crop", () => {
  const tracker = new SubjectCropTracker()
  for (let index = 0; index < 10; index += 1) tracker.update({ x: 0.8, y: -0.4 }, 100)
  const before = { ...tracker.center }

  for (let index = 0; index < 20; index += 1) tracker.update(null, 100)

  expect(tracker.center).toEqual(before)
})

test("flowing contour memories advect with captured cell velocity", () => {
  const detail = new Float32Array(12)
  detail[1 * 4 + 1] = 1

  expect(sampleFlowingContour(detail, 4, 3, 2, 1, { x: 1, y: 0 }, 1)).toBe(1)
  expect(sampleFlowingContour(detail, 4, 3, 1, 1, { x: 1, y: 0 }, 1)).toBe(0)
  expect(sampleFlowingContour(detail, 4, 3, 20, 20, { x: 1, y: 1 }, 10)).toBe(0)
})
