interface LightPosition {
  x: number
  y: number
}

interface EqualizerLevels {
  bass: number
  mid: number
  treble: number
}

interface ShadowLevels {
  pulse: number
  treble: number
}

interface ShadowResponse {
  expansion: number
  edgeLift: number
}

function clampLevel(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function automaticLightPosition(elapsedMs: number): LightPosition {
  const time = elapsedMs * 0.00018
  return {
    x: Math.sin(time * 1.07) * 0.86,
    y: Math.sin(time * 0.73 + 1.1) * 0.78,
  }
}

export function audioLightPosition(elapsedMs: number, levels: EqualizerLevels): LightPosition {
  const automatic = automaticLightPosition(elapsedMs)
  const distance = Math.hypot(automatic.x, automatic.y)
  const radialX = distance > 0.05 ? automatic.x / distance : 1
  const radialY = distance > 0.05 ? automatic.y / distance : 0
  const bass = clampLevel(levels.bass) * 0.12
  const mid = clampLevel(levels.mid) * 0.055
  const treble = clampLevel(levels.treble) * Math.sin(elapsedMs * 0.0014) * 0.02

  return {
    x: automatic.x + radialX * (bass + treble) - radialY * mid,
    y: automatic.y + radialY * (bass + treble) + radialX * mid,
  }
}

export function audioShadowResponse(levels: ShadowLevels): ShadowResponse {
  const pulse = clampLevel(levels.pulse)
  const treble = clampLevel(levels.treble)
  return {
    expansion: pulse * 0.1 + treble * 0.02,
    edgeLift: pulse * 0.16 + treble * 0.08,
  }
}
