import type { MotionVector } from "./video-frame-analyzer.js"

const CROP_DEAD_ZONE = 0.08
const CROP_RESPONSE_MS = 650
const CROP_SPEED_PER_SECOND = 0.85
const CUT_RESPONSE_MS = 120
const CUT_SPEED_PER_SECOND = 3.2
const CUT_ACQUISITION_MS = 350

export class SubjectCropTracker {
  readonly center: MotionVector = { x: 0, y: 0 }
  private cutAcquisitionRemainingMs = 0

  update(target: MotionVector | null, deltaMs: number, sceneCut = false): MotionVector {
    const safeDeltaMs = Math.max(0, Math.min(250, Number.isFinite(deltaMs) ? deltaMs : 0))
    if (sceneCut) this.cutAcquisitionRemainingMs = CUT_ACQUISITION_MS
    if (!target) {
      this.cutAcquisitionRemainingMs = Math.max(0, this.cutAcquisitionRemainingMs - safeDeltaMs)
      return this.center
    }
    const targetX = Math.max(-1, Math.min(1, target.x))
    const targetY = Math.max(-1, Math.min(1, target.y))
    const deltaX = Math.abs(targetX - this.center.x) > CROP_DEAD_ZONE ? targetX - this.center.x : 0
    const deltaY = Math.abs(targetY - this.center.y) > CROP_DEAD_ZONE ? targetY - this.center.y : 0
    const acquiringCut = this.cutAcquisitionRemainingMs > 0
    const responseMs = acquiringCut ? CUT_RESPONSE_MS : CROP_RESPONSE_MS
    const response = 1 - Math.exp(-safeDeltaMs / responseMs)
    const speed = acquiringCut ? CUT_SPEED_PER_SECOND : CROP_SPEED_PER_SECOND
    const maxStep = (speed * safeDeltaMs) / 1000
    this.center.x = Math.max(-1, Math.min(1, this.center.x + Math.max(-maxStep, Math.min(maxStep, deltaX * response))))
    this.center.y = Math.max(-1, Math.min(1, this.center.y + Math.max(-maxStep, Math.min(maxStep, deltaY * response))))
    this.cutAcquisitionRemainingMs = Math.max(0, this.cutAcquisitionRemainingMs - safeDeltaMs)
    return this.center
  }

  reset(): void {
    this.center.x = 0
    this.center.y = 0
    this.cutAcquisitionRemainingMs = 0
  }
}

export function sampleFlowingContour(
  detail: Float32Array,
  width: number,
  height: number,
  column: number,
  row: number,
  velocityCells: MotionVector,
  age: number,
): number {
  const sourceColumn = Math.round(column - velocityCells.x * age)
  const sourceRow = Math.round(row - velocityCells.y * age)
  if (sourceColumn < 0 || sourceColumn >= width || sourceRow < 0 || sourceRow >= height) return 0
  return detail[sourceRow * width + sourceColumn] ?? 0
}
