import { basename, resolve } from "node:path"

import {
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent,
  type OptimizedBuffer,
  NativeVideo,
  RGBA,
  TextRenderable,
  VRenderable,
  createCliRenderer,
} from "@opentui/core"

import { AUDIO_ANALYSIS_FRAMES, AUDIO_SPECTRUM_BANDS, AudioRhythmAnalyzer } from "./lib/audio-rhythm-analyzer.js"
import { AudioAnalysisBuffer, audioDecayDeltaMs, audioTapReadFrames } from "./lib/audio-analysis-buffer.js"
import { AudioVisualChoreographer } from "./lib/audio-visual-choreographer.js"
import { SubjectCropTracker, sampleFlowingContour } from "./lib/cinematic-motion.js"
import { parseShadowCinemaArgs } from "./lib/shadow-cinema-args.js"
import {
  RECEIVER_HEIGHT,
  RECEIVER_WIDTH,
  type VideoFrameColor,
  type VideoFrameAnalysis,
  VIDEO_FRAME_WIDTH,
  analyzeVideoFrame,
  smoothVideoFrameColor,
} from "./lib/video-frame-analyzer.js"

interface ColorStop {
  background: string
  foreground: string
  shadow: string
  accent: string
}

interface Oklch {
  lightness: number
  chroma: number
  hue: number
}

interface AmbientStop {
  background: Oklch
  foreground: Oklch
}

type ColorMode = "video" | "ambient" | "fixed"

interface ColorCycleSpeed {
  name: string
  responseMs: number
  holdMs: number
  transitionMs: number
}

interface Vec2 {
  x: number
  y: number
}

interface ShadowMemory {
  detail: Float32Array
  capturedAt: number
  strength: number
  velocityCells: Vec2
}

interface ReceiverPalette {
  background: RGBA
  foreground: RGBA
  shadow: RGBA
  accent: RGBA
  spectrum: readonly RGBA[]
}

const LOGO_SOURCE = ["▄▄▄ ▄▄▄ ▄▄▄ ▄▄  █▄▄ ▄ ▄ ▄", "█ █ █ █ █ ▀ █ █ █ ▄ █ █ █", "▀▀▀ █▀▀ ▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀ ▀"]

function doubleBlockLogo(lines: readonly string[]): string {
  const pixels = lines.flatMap((line) => {
    const top = [...line].flatMap((glyph) => (glyph === "▀" || glyph === "█" ? [true, true] : [false, false]))
    const bottom = [...line].flatMap((glyph) => (glyph === "▄" || glyph === "█" ? [true, true] : [false, false]))
    return [top, top, bottom, bottom]
  })
  const rows = []
  for (let row = 0; row < pixels.length; row += 2) {
    rows.push(
      pixels[row]!.map((top, column) => {
        const bottom = pixels[row + 1]![column]!
        return top ? (bottom ? "█" : "▀") : bottom ? "▄" : " "
      }).join(""),
    )
  }
  return rows.join("\n")
}

const ORIGINAL_LOGO = doubleBlockLogo(LOGO_SOURCE)
const LOGO_PLATE_HEIGHT = 10
const COLOR_STOPS: readonly ColorStop[] = [
  { background: "#031B1C", foreground: "#24F4EE", shadow: "#149E99", accent: "#FF4FD8" },
  { background: "#24031F", foreground: "#FF37CA", shadow: "#A92387", accent: "#46E6FF" },
  { background: "#050505", foreground: "#FF4B16", shadow: "#B9360F", accent: "#4D8DFF" },
  { background: "#151126", foreground: "#C3ACFF", shadow: "#7862B8", accent: "#65FBD2" },
]
const VIDEO_COLOR_FALLBACK: ColorStop = {
  background: "#0B1113",
  foreground: "#D5E1E3",
  shadow: "#728184",
  accent: "#E8C774",
}
const AMBIENT_STOPS: readonly AmbientStop[] = [
  {
    background: { lightness: 0.18, chroma: 0.025, hue: 195 },
    foreground: { lightness: 0.88, chroma: 0.15, hue: 190 },
  },
  {
    background: { lightness: 0.18, chroma: 0.03, hue: 292 },
    foreground: { lightness: 0.82, chroma: 0.14, hue: 292 },
  },
  {
    background: { lightness: 0.18, chroma: 0.035, hue: 335 },
    foreground: { lightness: 0.79, chroma: 0.22, hue: 335 },
  },
  {
    background: { lightness: 0.18, chroma: 0.025, hue: 35 },
    foreground: { lightness: 0.73, chroma: 0.2, hue: 35 },
  },
]
const COLOR_CYCLE_SPEEDS: readonly ColorCycleSpeed[] = [
  { name: "slowest", responseMs: 1100, holdMs: 2000, transitionMs: 4000 },
  { name: "slow", responseMs: 700, holdMs: 1000, transitionMs: 2400 },
  { name: "normal", responseMs: 420, holdMs: 700, transitionMs: 1600 },
  { name: "fast", responseMs: 220, holdMs: 350, transitionMs: 850 },
]
const RECEIVER_HALF_SIZE = 5
const PRESENTATION_FPS = 24
const PRESENTATION_INTERVAL_SECONDS = 1 / PRESENTATION_FPS
const PALETTE_UPDATE_INTERVAL_MS = 125
const CHROME_PALETTE_UPDATE_INTERVAL_MS = 250
const AUDIO_CHANNELS = 2
const AUDIO_TAP_CAPACITY_FRAMES = AUDIO_ANALYSIS_FRAMES * 16
const AUDIO_DECAY_GRACE_MS = 75
const EMPTY_PCM = new Float32Array()
const SHADOW_MEMORY_MAX = 5
const SHADOW_MEMORY_INTERVAL_MS = 120
const SHADOW_MEMORY_LIFETIME_MS = 850
const SCENE_CUT_REVEAL_MS = 220
const SHADOW_GLYPHS = ["⋅", "∙", "•", "⦁", "●"] as const
const AUDIO_FIELD_GLYPHS = ["·", "∙", "◦", "○", "●"] as const

const rhythmAnalyzer = new AudioRhythmAnalyzer()
const audioAnalysisBuffer = new AudioAnalysisBuffer(AUDIO_ANALYSIS_FRAMES, AUDIO_CHANNELS)
const choreography = new AudioVisualChoreographer()
const cropTracker = new SubjectCropTracker()
const shadowMemories: ShadowMemory[] = []

let rendererInstance: CliRenderer | null = null
let view: BoxRenderable | null = null
let artwork: BoxRenderable | null = null
let receiverRenderable: VRenderable | null = null
let logoPlate: BoxRenderable | null = null
let logoText: TextRenderable | null = null
let helpOverlay: BoxRenderable | null = null
let helpModal: BoxRenderable | null = null
let helpText: TextRenderable | null = null
let video: NativeVideo | null = null
let frameAnalysis: VideoFrameAnalysis | null = null
let keyHandler: ((key: KeyEvent) => void) | null = null
let resizeHandler: (() => void) | null = null
let frameHandler: ((deltaTime: number) => Promise<void>) | null = null
let prepareTimer: ReturnType<typeof setTimeout> | null = null
let elapsedMs = 0
let ambientElapsedMs = 0
let paletteAccumulatorMs = 0
let chromePaletteAccumulatorMs = 0
let playbackStartedAtMs = 0
let playbackPositionSeconds = 0
let lastAudioTapFrame = 0n
let lastAudioAnalysisAtMs = 0
let audioAnalysisStalled = false
let lastHelpSecond = -1
let lastShadowMemoryAtMs = Number.NEGATIVE_INFINITY
let lastSceneCutAtMs = Number.NEGATIVE_INFINITY
let paused = false
let muted = false
let colorMode: ColorMode = "video"
let colorIndex = 0
let colorCycleSpeedIndex = 2
let shadowGlyphIndex = -1
let equalizerProjectionVisible = true
let helpVisible = false
let videoName = ""
let previousRendererTargetFps: number | null = null
let previousRendererMaxFps: number | null = null
let renderedPalette: ColorStop = COLOR_STOPS[0]!
let chromePalette: ColorStop = renderedPalette
let receiverPalette = createReceiverPalette(renderedPalette, chromePalette)
let smoothedSceneColor: VideoFrameColor | null = null
let smoothedAccentColor: VideoFrameColor | null = null
let smoothedChromeSceneColor: VideoFrameColor | null = null
let smoothedChromeAccentColor: VideoFrameColor | null = null

const TRANSPARENT = RGBA.fromValues(0, 0, 0, 0)

function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
  const progress = Math.max(0, Math.min(1, (value - edgeStart) / (edgeEnd - edgeStart)))
  return progress * progress * (3 - 2 * progress)
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
}

function oklchLinearChannels(color: Oklch): readonly [number, number, number] {
  const radians = (color.hue * Math.PI) / 180
  const a = color.chroma * Math.cos(radians)
  const b = color.chroma * Math.sin(radians)
  const lPrime = color.lightness + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = color.lightness - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = color.lightness - 0.0894841775 * a - 1.291485548 * b
  const l = lPrime ** 3
  const m = mPrime ** 3
  const s = sPrime ** 3
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

function oklchToHex(color: Oklch): string {
  let mapped = color
  let best = { ...color, chroma: 0 }
  for (let iteration = 0, low = 0, high = color.chroma; iteration < 8; iteration += 1) {
    const channels = oklchLinearChannels(mapped)
    if (channels.every((channel) => channel >= 0 && channel <= 1)) {
      low = mapped.chroma
      best = mapped
    } else high = mapped.chroma
    mapped = { ...color, chroma: (low + high) * 0.5 }
  }
  const channels = oklchLinearChannels(best)
  return `#${channels
    .map((channel) =>
      Math.round(Math.max(0, Math.min(1, channel)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

function interpolateHue(from: number, to: number, progress: number): number {
  const difference = ((to - from + 540) % 360) - 180
  return (from + difference * progress + 360) % 360
}

function interpolateOklch(from: Oklch, to: Oklch, progress: number): Oklch {
  return {
    lightness: from.lightness + (to.lightness - from.lightness) * progress,
    chroma: from.chroma + (to.chroma - from.chroma) * progress,
    hue: interpolateHue(from.hue, to.hue, progress),
  }
}

function ambientPalette(timeMs: number): ColorStop {
  const speed = COLOR_CYCLE_SPEEDS[colorCycleSpeedIndex]!
  const segmentDuration = speed.holdMs + speed.transitionMs
  const position = timeMs / segmentDuration
  const index = Math.floor(position) % AMBIENT_STOPS.length
  const segmentTime = timeMs % segmentDuration
  const progress =
    segmentTime <= speed.holdMs ? 0 : smoothstep(0, 1, Math.min(1, (segmentTime - speed.holdMs) / speed.transitionMs))
  const from = AMBIENT_STOPS[index]!
  const to = AMBIENT_STOPS[(index + 1) % AMBIENT_STOPS.length]!
  const background = interpolateOklch(from.background, to.background, progress)
  const foreground = interpolateOklch(from.foreground, to.foreground, progress)
  return {
    background: oklchToHex(background),
    foreground: oklchToHex(foreground),
    shadow: oklchToHex({
      lightness: foreground.lightness * 0.64,
      chroma: foreground.chroma * 0.68,
      hue: foreground.hue,
    }),
    accent: oklchToHex({
      lightness: Math.min(0.88, foreground.lightness + 0.04),
      chroma: Math.max(0.14, foreground.chroma),
      hue: (foreground.hue + 85) % 360,
    }),
  }
}

function activePalette(): ColorStop {
  if (colorMode === "fixed") return COLOR_STOPS[colorIndex]!
  if (colorMode === "ambient") return ambientPalette(ambientElapsedMs)
  if (smoothedSceneColor) return videoColorPalette(smoothedSceneColor, smoothedAccentColor ?? smoothedSceneColor)
  return VIDEO_COLOR_FALLBACK
}

function activeChromePalette(): ColorStop {
  if (colorMode !== "video") return activePalette()
  if (smoothedChromeSceneColor) {
    return videoColorPalette(smoothedChromeSceneColor, smoothedChromeAccentColor ?? smoothedChromeSceneColor)
  }
  return VIDEO_COLOR_FALLBACK
}

function videoColorPalette(scene: VideoFrameColor, accent: VideoFrameColor): ColorStop {
  const backgroundLightness = Math.max(0.14, Math.min(0.3, scene.lightness * 0.48))
  const foregroundLightness = Math.max(0.76, Math.min(0.93, scene.lightness + 0.2))
  const accentLightness = Math.max(0.78, Math.min(0.94, accent.lightness + 0.16))
  const foregroundChroma = Math.max(0.11, Math.min(0.24, scene.chroma * 1.35))
  const accentChroma = Math.max(0.13, Math.min(0.26, accent.chroma * 1.4))
  return {
    background: oklchToHex({
      lightness: backgroundLightness,
      chroma: Math.max(0.035, Math.min(0.09, scene.chroma * 0.55)),
      hue: scene.hue,
    }),
    foreground: oklchToHex({
      lightness: foregroundLightness,
      chroma: foregroundChroma,
      hue: scene.hue,
    }),
    shadow: oklchToHex({
      lightness: backgroundLightness + (foregroundLightness - backgroundLightness) * 0.52,
      chroma: foregroundChroma * 0.68,
      hue: scene.hue,
    }),
    accent: oklchToHex({
      lightness: accentLightness,
      chroma: accentChroma,
      hue: accent.hue,
    }),
  }
}

function smoothVideoColor(previous: VideoFrameColor | null, next: VideoFrameColor | null): VideoFrameColor | null {
  const responseMs = COLOR_CYCLE_SPEEDS[colorCycleSpeedIndex]!.responseMs
  return smoothVideoFrameColor(previous, next, PRESENTATION_INTERVAL_SECONDS * 1000, responseMs)
}

function updateVideoColors(analysis: VideoFrameAnalysis): void {
  const responseMs = analysis.isSceneCut ? 90 : COLOR_CYCLE_SPEEDS[colorCycleSpeedIndex]!.responseMs
  smoothedSceneColor = smoothVideoFrameColor(
    smoothedSceneColor,
    analysis.sceneColor,
    PRESENTATION_INTERVAL_SECONDS * 1000,
    responseMs,
  )
  smoothedAccentColor = smoothVideoFrameColor(
    smoothedAccentColor,
    analysis.accentColor,
    PRESENTATION_INTERVAL_SECONDS * 1000,
    responseMs,
  )
  const chromeResponseMs = analysis.isSceneCut ? 450 : Math.max(1600, responseMs * 3)
  smoothedChromeSceneColor = smoothVideoFrameColor(
    smoothedChromeSceneColor,
    analysis.sceneColor,
    PRESENTATION_INTERVAL_SECONDS * 1000,
    chromeResponseMs,
  )
  smoothedChromeAccentColor = smoothVideoFrameColor(
    smoothedChromeAccentColor,
    analysis.accentColor,
    PRESENTATION_INTERVAL_SECONDS * 1000,
    chromeResponseMs,
  )
}

function hashNoise(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function videoCenter(): Vec2 {
  const center = frameAnalysis?.luminanceCentroid ?? { x: 0, y: 0 }
  return { x: center.x * RECEIVER_HALF_SIZE, y: center.y * RECEIVER_HALF_SIZE }
}

function audioSpectrumBand(position: number): number {
  const mirrored = 1 - Math.abs(Math.max(0, Math.min(1, position)) * 2 - 1)
  return Math.min(rhythmAnalyzer.spectrum.length - 1, Math.floor(mirrored * rhythmAnalyzer.spectrum.length))
}

function audioSpectrumColor(band: number, palette: ColorStop): string {
  const progress = smoothstep(0, 1, band / Math.max(1, rhythmAnalyzer.spectrum.length - 1))
  const accent = Number.parseInt(palette.accent.slice(1), 16)
  const foreground = Number.parseInt(palette.foreground.slice(1), 16)
  const channels = [16, 8, 0].map((shift) => {
    const from = (accent >> shift) & 0xff
    const to = (foreground >> shift) & 0xff
    return Math.round(from + (to - from) * progress)
      .toString(16)
      .padStart(2, "0")
  })
  return `#${channels.join("")}`
}

function createReceiverPalette(palette: ColorStop, stablePalette: ColorStop): ReceiverPalette {
  return {
    background: RGBA.fromHex(stablePalette.background),
    foreground: RGBA.fromHex(palette.foreground),
    shadow: RGBA.fromHex(palette.shadow),
    accent: RGBA.fromHex(palette.accent),
    spectrum: Array.from({ length: AUDIO_SPECTRUM_BANDS }, (_, band) =>
      RGBA.fromHex(audioSpectrumColor(band, palette)),
    ),
  }
}

function audioField(point: Vec2, center: Vec2): { strength: number; band: number } {
  const dx = point.x - center.x
  const dy = point.y - center.y
  const distance = Math.hypot(dx, dy)
  const angle = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)
  const band = audioSpectrumBand(angle)
  const bandLevel = rhythmAnalyzer.spectrum[band] ?? 0
  const orbitRadius = 1.15 + bandLevel * 2.35 + rhythmAnalyzer.pulse * 0.35
  const halo = 1 - smoothstep(0.08, 0.48 + rhythmAnalyzer.treble * 0.15, Math.abs(distance - orbitRadius))
  return { strength: halo * bandLevel * (0.72 + Math.sin(angle * Math.PI * 18) * 0.28), band }
}

function captureShadowMemory(): void {
  for (let index = shadowMemories.length - 1; index >= 0; index -= 1) {
    if (elapsedMs - shadowMemories[index]!.capturedAt > SHADOW_MEMORY_LIFETIME_MS) shadowMemories.splice(index, 1)
  }
  const motion = frameAnalysis?.motionMagnitude ?? 0
  const sceneCutSettling = elapsedMs - lastSceneCutAtMs < SCENE_CUT_REVEAL_MS
  if (
    !frameAnalysis ||
    sceneCutSettling ||
    motion < 0.018 ||
    elapsedMs - lastShadowMemoryAtMs < SHADOW_MEMORY_INTERVAL_MS
  )
    return
  shadowMemories.push({
    detail: frameAnalysis.detail.slice(),
    capturedAt: elapsedMs,
    strength: motion,
    velocityCells: {
      x: Math.max(-6, Math.min(6, frameAnalysis.motionDirection.x * RECEIVER_WIDTH * 3)),
      y: Math.max(-4, Math.min(4, frameAnalysis.motionDirection.y * RECEIVER_HEIGHT * 3)),
    },
  })
  if (shadowMemories.length > SHADOW_MEMORY_MAX) shadowMemories.shift()
  lastShadowMemoryAtMs = elapsedMs
}

function videoSample(
  column: number,
  row: number,
): { intensity: number; edge: number; detail: number; difference: number } {
  if (!frameAnalysis) return { intensity: 0, edge: 0, detail: 0, difference: 0 }
  const displacement = Math.min(2, Math.round(frameAnalysis.motionMagnitude * 18))
  const bassDisplacement = choreography.bassImpact * (2 + rhythmAnalyzer.stereoWidth * 2)
  const midDisplacement = Math.round(choreography.midImpact * (1 + rhythmAnalyzer.stereoWidth * 2))
  const impactPolarity = (row + Math.floor(column / 4)) % 2 === 0 ? -1 : 1
  const centerX = (RECEIVER_WIDTH - 1) * 0.5
  const centerY = (RECEIVER_HEIGHT - 1) * 0.5
  const radialX = ((column - centerX) / centerX) * bassDisplacement
  const radialY = ((row - centerY) / centerY) * bassDisplacement * 0.5
  const sourceColumn = Math.max(
    0,
    Math.min(
      RECEIVER_WIDTH - 1,
      Math.round(
        column - Math.sign(frameAnalysis.motionDirection.x) * displacement - radialX + impactPolarity * midDisplacement,
      ),
    ),
  )
  const sourceRow = Math.max(
    0,
    Math.min(
      RECEIVER_HEIGHT - 1,
      row - Math.sign(frameAnalysis.motionDirection.y) * displacement - Math.round(radialY),
    ),
  )
  const index = sourceRow * RECEIVER_WIDTH + sourceColumn
  return {
    intensity: frameAnalysis.intensity[index] ?? 0,
    edge: frameAnalysis.edges[index] ?? 0,
    detail: frameAnalysis.detail[index] ?? 0,
    difference: frameAnalysis.difference[index] ?? 0,
  }
}

function shadowGlyph(strength: number): (typeof SHADOW_GLYPHS)[number] {
  return shadowGlyphIndex === -1
    ? SHADOW_GLYPHS[Math.min(SHADOW_GLYPHS.length - 1, Math.floor(strength * SHADOW_GLYPHS.length))]!
    : SHADOW_GLYPHS[shadowGlyphIndex]!
}

function renderReceiver(buffer: OptimizedBuffer, originX: number, originY: number): void {
  const palette = receiverPalette
  const haloCenter = videoCenter()
  for (let row = 0; row < RECEIVER_HEIGHT; row += 1) {
    for (let column = 0; column < RECEIVER_WIDTH; column += 1) {
      const border = row === 0 || row === RECEIVER_HEIGHT - 1 || column === 0 || column === RECEIVER_WIDTH - 1
      if (border) {
        const position =
          row === 0 || row === RECEIVER_HEIGHT - 1 ? column / (RECEIVER_WIDTH - 1) : row / (RECEIVER_HEIGHT - 1)
        const band = audioSpectrumBand(position)
        const spectrum = rhythmAnalyzer.spectrum[band] ?? 0
        const glyph =
          row === 0 && column === 0
            ? "┌"
            : row === 0 && column === RECEIVER_WIDTH - 1
              ? "┐"
              : row === RECEIVER_HEIGHT - 1 && column === 0
                ? "└"
                : row === RECEIVER_HEIGHT - 1 && column === RECEIVER_WIDTH - 1
                  ? "┘"
                  : row === 0 || row === RECEIVER_HEIGHT - 1
                    ? spectrum > 0.5
                      ? "═"
                      : "─"
                    : spectrum > 0.5
                      ? "║"
                      : "│"
        buffer.setCell(
          originX + column,
          originY + row,
          glyph,
          spectrum > 0.16 ? palette.spectrum[band]! : palette.foreground,
          palette.background,
        )
        continue
      }

      const point = {
        x: ((column + 0.5) / RECEIVER_WIDTH) * RECEIVER_HALF_SIZE * 2 - RECEIVER_HALF_SIZE,
        y: ((row + 0.5) / RECEIVER_HEIGHT) * RECEIVER_HALF_SIZE * 2 - RECEIVER_HALF_SIZE,
      }
      const sample = videoSample(column, row)
      const field = equalizerProjectionVisible ? audioField(point, haloCenter) : null

      const contourStrength = Math.min(1, sample.detail + sample.difference * 0.9)
      const cutAge = elapsedMs - lastSceneCutAtMs
      const cutReveal = cutAge >= 0 && cutAge < SCENE_CUT_REVEAL_MS ? cutAge / SCENE_CUT_REVEAL_MS : 1
      const revealed = hashNoise(column * 0.73, row * 1.37) <= cutReveal
      const tonalAnchor =
        hashNoise(column * 1.7 + row * 0.13, row * 2.3 + column * 0.17) > 0.94 - sample.intensity * 0.16
      if (revealed && (contourStrength > 0.14 || tonalAnchor)) {
        const strength = Math.max(contourStrength, sample.intensity * 0.62)
        const glyph = shadowGlyph(strength)
        const color = sample.edge > 0.26 ? palette.accent : palette.foreground
        buffer.setCell(originX + column, originY + row, glyph, color, palette.background)
        continue
      }

      const trebleSparkle = choreography.trebleImpact
      if (
        trebleSparkle > 0.12 &&
        hashNoise(column + Math.floor(elapsedMs / 45), row * 2.1) > 0.992 - trebleSparkle * 0.012
      ) {
        buffer.setCell(
          originX + column,
          originY + row,
          trebleSparkle > 0.62 ? "•" : "⋅",
          palette.accent,
          palette.background,
        )
        continue
      }

      if (field && field.strength > 0.075) {
        const glyph = AUDIO_FIELD_GLYPHS[Math.min(AUDIO_FIELD_GLYPHS.length - 1, Math.floor(field.strength * 5))]!
        buffer.setCell(originX + column, originY + row, glyph, palette.spectrum[field.band]!, palette.background)
        continue
      }

      let memoryStrength = 0
      for (const memory of shadowMemories) {
        const age = (elapsedMs - memory.capturedAt) / SHADOW_MEMORY_LIFETIME_MS
        if (age < 0 || age > 1) continue
        const detail = sampleFlowingContour(
          memory.detail,
          RECEIVER_WIDTH,
          RECEIVER_HEIGHT,
          column,
          row,
          memory.velocityCells,
          (elapsedMs - memory.capturedAt) / 1000,
        )
        if (hashNoise(column + Math.floor(memory.capturedAt / 120), row) > 0.48 + age * 0.38) {
          memoryStrength = Math.max(memoryStrength, detail * (1 - age) * Math.min(1, memory.strength * 12))
        }
      }
      if (memoryStrength > 0.08) {
        buffer.setCell(
          originX + column,
          originY + row,
          memoryStrength > 0.24 ? "∙" : "⋅",
          palette.shadow,
          palette.background,
        )
      } else {
        buffer.setCell(originX + column, originY + row, " ", TRANSPARENT, palette.background)
      }
    }
  }
}

function refreshScene(captureMemory = false): void {
  if (!receiverRenderable) return
  if (captureMemory) captureShadowMemory()
  rendererInstance?.requestRender()
}

function formatTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(wholeSeconds / 60)
  return `${minutes.toString().padStart(2, "0")}:${(wholeSeconds % 60).toString().padStart(2, "0")}`
}

function updateControls(): void {
  if (!helpText || !helpVisible) return
  const glyph = shadowGlyphIndex === -1 ? "adaptive" : SHADOW_GLYPHS[shadowGlyphIndex]!
  const currentTime = video?.state.currentTime ?? playbackPositionSeconds
  lastHelpSecond = Math.floor(currentTime)
  const playback = `${paused ? "paused" : "playing"} ${formatTime(currentTime)}/${formatTime(video?.info.duration ?? 0)}`
  const controls = [
    `Space       ${paused ? "resume" : "pause"} playback`,
    `← / →       seek -/+0.25s  (${formatTime(currentTime)} / ${formatTime(video?.info.duration ?? 0)})`,
    "Shift+←/→   seek -/+5s",
    `M           audio: ${muted ? "muted" : "unmuted"}`,
    "R           restart video",
    `C           colors: ${colorMode === "fixed" ? `fixed ${colorIndex + 1}` : colorMode}`,
    `Shift+C     color speed: ${COLOR_CYCLE_SPEEDS[colorCycleSpeedIndex]!.name}`,
    "1 2 3 4     select fixed palette",
    `G           glyph: ${glyph}`,
    `E           equalizer overlay: ${equalizerProjectionVisible ? "on" : "off"}`,
    "? / Esc     close help",
    "Q           quit",
  ]
  helpText.content =
    (rendererInstance?.height ?? 40) < 18
      ? [
          `Space ${playback}  M ${muted ? "muted" : "audio"}  R restart`,
          "←/→ seek .25s  Shift+←/→ seek 5s",
          `C colors ${colorMode === "fixed" ? `fixed ${colorIndex + 1}` : colorMode}  Shift+C speed  1-4 fixed`,
          `G glyph ${glyph}  E equalizer ${equalizerProjectionVisible ? "on" : "off"}`,
          "? / Esc close  Q quit",
        ].join("\n")
      : controls.join("\n")
}

function resetAnalyzers(audioTapFrame: bigint): void {
  rhythmAnalyzer.reset()
  audioAnalysisBuffer.reset()
  choreography.reset(elapsedMs)
  frameAnalysis = null
  smoothedSceneColor = null
  smoothedAccentColor = null
  smoothedChromeSceneColor = null
  smoothedChromeAccentColor = null
  shadowMemories.length = 0
  cropTracker.reset()
  lastShadowMemoryAtMs = Number.NEGATIVE_INFINITY
  lastSceneCutAtMs = Number.NEGATIVE_INFINITY
  lastAudioTapFrame = audioTapFrame
  lastAudioAnalysisAtMs = elapsedMs
  audioAnalysisStalled = false
}

function analyzePresentedFrame(rgba: Uint8Array, width: number, height: number): void {
  const analysis = analyzeVideoFrame(rgba, width, height, frameAnalysis, { cropCenter: cropTracker.center })
  cropTracker.update(analysis.framingTarget, PRESENTATION_INTERVAL_SECONDS * 1000, analysis.isSceneCut)
  if (analysis.isSceneCut) {
    shadowMemories.length = 0
    lastShadowMemoryAtMs = Number.NEGATIVE_INFINITY
    lastSceneCutAtMs = elapsedMs
  }
  frameAnalysis = analysis
  updateVideoColors(analysis)
}

function loopVideo(): void {
  seekPlayback(0)
}

function schedulePreparation(): void {
  if (prepareTimer || paused || !video) return
  prepareTimer = setTimeout(() => {
    prepareTimer = null
    if (!video || paused) return
    video.prepareNext(PRESENTATION_INTERVAL_SECONDS, rendererInstance?.getOutputWriteSample() ?? { frameCount: 0 })
  }, 0)
}

function consumeVideoFrame(targetSeconds: number): void {
  if (!video || !rendererInstance) return
  const output = rendererInstance.getOutputWriteSample()
  const state = video.schedule(targetSeconds, PRESENTATION_INTERVAL_SECONDS, output)
  const nextImage = video.takeFrame()
  if (nextImage) {
    try {
      const late = state.framePts + PRESENTATION_INTERVAL_SECONDS * 1.5 < state.currentTime
      if (!late) {
        const raw = nextImage.raw("rgba8")
        analyzePresentedFrame(raw.data, raw.width, raw.height)
        video.frameSubmitted(output.frameCount)
      }
    } finally {
      nextImage.dispose()
    }
  }

  if (state.preparedPts < 0) schedulePreparation()
  if (state.ended || (video.info.duration > 0 && state.currentTime >= video.info.duration)) {
    loopVideo()
  }
}

function consumeAudioFrames(deltaTime: number): void {
  if (!video) return
  const activeVideo = video
  const readFrames = audioTapReadFrames(
    deltaTime,
    activeVideo.info.audioSampleRate,
    AUDIO_ANALYSIS_FRAMES,
    AUDIO_TAP_CAPACITY_FRAMES,
  )
  const tap = activeVideo.readAudioTapFrames(readFrames, AUDIO_CHANNELS)
  const tapStartFrame = tap.endFrame - BigInt(tap.framesRead)
  if (tapStartFrame > lastAudioTapFrame) {
    rhythmAnalyzer.reset()
    audioAnalysisBuffer.reset()
    lastAudioAnalysisAtMs = elapsedMs
    audioAnalysisStalled = false
  }
  const unreadStartFrame = lastAudioTapFrame > tapStartFrame ? lastAudioTapFrame : tapStartFrame
  const unreadFrames = Number(tap.endFrame - unreadStartFrame)
  const unreadOffset = Number(unreadStartFrame - tapStartFrame)
  if (unreadFrames > 0) {
    if (audioAnalysisStalled) {
      rhythmAnalyzer.reset()
      audioAnalysisBuffer.reset()
      lastAudioAnalysisAtMs = elapsedMs
      audioAnalysisStalled = false
    }
    const start = unreadOffset * AUDIO_CHANNELS
    const end = start + unreadFrames * AUDIO_CHANNELS
    const windowsEmitted = audioAnalysisBuffer.append(tap.frames.subarray(start, end), (window) => {
      rhythmAnalyzer.update(
        window,
        AUDIO_CHANNELS,
        activeVideo.info.audioSampleRate,
        (AUDIO_ANALYSIS_FRAMES / activeVideo.info.audioSampleRate) * 1000,
      )
    })
    if (windowsEmitted > 0) lastAudioAnalysisAtMs = elapsedMs
  }
  lastAudioTapFrame = tap.endFrame
}

function createScene(renderer: CliRenderer): void {
  const palette = chromePalette
  view = new BoxRenderable(renderer, {
    id: "shadow-cinema-spike",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    backgroundColor: palette.background,
  })
  artwork = new BoxRenderable(renderer, {
    id: "shadow-cinema-artwork",
    width: RECEIVER_WIDTH,
    height: RECEIVER_HEIGHT + LOGO_PLATE_HEIGHT,
    flexDirection: "column",
    flexShrink: 0,
  })
  receiverRenderable = new VRenderable(renderer, {
    id: "shadow-cinema-receiver",
    width: RECEIVER_WIDTH,
    height: RECEIVER_HEIGHT,
    render: (buffer, _deltaTime, renderable) => renderReceiver(buffer, renderable.x, renderable.y),
  })
  logoPlate = new BoxRenderable(renderer, {
    id: "shadow-cinema-logo-plate",
    width: RECEIVER_WIDTH,
    height: LOGO_PLATE_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.foreground,
  })
  logoText = new TextRenderable(renderer, {
    id: "shadow-cinema-logo",
    content: ORIGINAL_LOGO,
    fg: palette.background,
    selectable: false,
  })
  logoPlate.add(logoText)
  artwork.add(receiverRenderable)
  artwork.add(logoPlate)
  view.add(artwork)
  renderer.root.add(view)
  updateArtworkAlignment(renderer)
}

function updateArtworkAlignment(renderer: CliRenderer): void {
  if (!view) return
  view.alignItems = renderer.width < RECEIVER_WIDTH ? "flex-start" : "center"
  view.justifyContent = renderer.height < RECEIVER_HEIGHT + LOGO_PLATE_HEIGHT ? "flex-start" : "center"
}

function setHelpVisible(visible: boolean): void {
  helpVisible = visible
  if (helpOverlay) helpOverlay.visible = visible
  updateControls()
  rendererInstance?.requestRender()
}

function createHelpModal(renderer: CliRenderer): void {
  helpOverlay?.destroyRecursively()
  const palette = chromePalette
  helpOverlay = new BoxRenderable(renderer, {
    id: "shadow-cinema-help-overlay",
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: renderer.height < 9 ? "flex-start" : "center",
    visible: helpVisible,
    zIndex: 100,
    onMouseDown: () => setHelpVisible(false),
  })
  helpModal = new BoxRenderable(renderer, {
    id: "shadow-cinema-help-modal",
    width: renderer.width < 60 ? "90%" : 54,
    height: Math.max(1, Math.min(15, renderer.height)),
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    border: true,
    borderStyle: "double",
    borderColor: palette.foreground,
    backgroundColor: palette.background,
    title: "Controls",
    titleAlignment: "center",
    onMouseDown: (event: MouseEvent) => event.stopPropagation(),
  })
  helpText = new TextRenderable(renderer, {
    id: "shadow-cinema-help-text",
    content: "",
    fg: palette.foreground,
    selectable: false,
  })
  helpModal.add(helpText)
  helpOverlay.add(helpModal)
  renderer.root.add(helpOverlay)
  updateControls()
}

function applyPalette(updateChrome = true): void {
  const palette = activePalette()
  renderedPalette = palette
  if (updateChrome) chromePalette = activeChromePalette()
  receiverPalette = createReceiverPalette(palette, chromePalette)
  if (!updateChrome) return
  rendererInstance?.setBackgroundColor(chromePalette.background)
  if (view) view.backgroundColor = chromePalette.background
  if (logoPlate) logoPlate.backgroundColor = colorMode === "video" ? chromePalette.accent : chromePalette.foreground
  if (logoText) logoText.fg = chromePalette.background
  if (helpModal) {
    helpModal.backgroundColor = chromePalette.background
    helpModal.borderColor = chromePalette.foreground
  }
  if (helpText) helpText.fg = chromePalette.foreground
  refreshScene()
  updateControls()
}

function togglePause(): void {
  if (!video) return
  paused = !paused
  if (paused) {
    playbackPositionSeconds = video.state.currentTime
    video.pause()
    if (prepareTimer) clearTimeout(prepareTimer)
    prepareTimer = null
  } else {
    playbackStartedAtMs = performance.now()
    video.play()
    schedulePreparation()
  }
  updateControls()
}

function cancelPreparation(): void {
  if (prepareTimer) clearTimeout(prepareTimer)
  prepareTimer = null
}

function seekPlayback(targetSeconds: number): void {
  if (!video) return
  cancelPreparation()
  const lastDecodableTime = video.info.duration > 0 ? Math.max(0, video.info.duration - 0.000001) : targetSeconds
  const target = Math.max(0, Math.min(lastDecodableTime, targetSeconds))
  video.pause()
  video.seek(target)
  video.resetOutputTiming()
  playbackPositionSeconds = target
  playbackStartedAtMs = performance.now()
  elapsedMs = target * 1000
  resetAnalyzers(video.readAudioTapFrames(1, AUDIO_CHANNELS).endFrame)
  const state = video.update(target)
  const targetFrame = video.takeFrame()
  if (targetFrame) {
    try {
      const raw = targetFrame.raw("rgba8")
      analyzePresentedFrame(raw.data, raw.width, raw.height)
      video.frameSubmitted(rendererInstance?.getOutputWriteSample().frameCount ?? 0)
    } finally {
      targetFrame.dispose()
    }
  }
  if (state.preparedPts < 0 && !paused) schedulePreparation()
  if (!paused) {
    video.play()
  }
  applyPalette()
  refreshScene()
  updateControls()
}

export async function run(renderer: CliRenderer, videoPath: string): Promise<void> {
  rendererInstance = renderer
  videoName = basename(videoPath)
  elapsedMs = 0
  ambientElapsedMs = 0
  paletteAccumulatorMs = 0
  chromePaletteAccumulatorMs = 0
  playbackPositionSeconds = 0
  playbackStartedAtMs = performance.now()
  paused = false
  muted = false
  colorMode = "video"
  colorIndex = 0
  colorCycleSpeedIndex = 2
  shadowGlyphIndex = -1
  equalizerProjectionVisible = true
  helpVisible = false
  lastHelpSecond = -1
  renderedPalette = activePalette()
  chromePalette = renderedPalette
  receiverPalette = createReceiverPalette(renderedPalette, chromePalette)

  const nextVideo = NativeVideo.open(resolve(videoPath))
  try {
    if (!nextVideo.info.hasAudio || nextVideo.info.audioSampleRate <= 0) {
      throw new Error("shadow cinema requires an MP4 with an AAC audio track")
    }
    const decodeHeight = Math.max(1, Math.round(VIDEO_FRAME_WIDTH / (16 / 9)))
    nextVideo.configureOutput(VIDEO_FRAME_WIDTH, decodeHeight, true)
    nextVideo.enableAudioTap(AUDIO_TAP_CAPACITY_FRAMES)
    nextVideo.setMuted(false)
    previousRendererTargetFps = renderer.targetFps
    previousRendererMaxFps = renderer.maxFps
    renderer.targetFps = PRESENTATION_FPS
    renderer.maxFps = PRESENTATION_FPS
    video = nextVideo
    resetAnalyzers(nextVideo.readAudioTapFrames(1, AUDIO_CHANNELS).endFrame)
    nextVideo.update(0)
    const initialFrame = nextVideo.takeFrame()
    if (initialFrame) {
      try {
        const raw = initialFrame.raw("rgba8")
        analyzePresentedFrame(raw.data, raw.width, raw.height)
        nextVideo.frameSubmitted(renderer.getOutputWriteSample().frameCount)
      } finally {
        initialFrame.dispose()
      }
    }
    renderedPalette = activePalette()
    chromePalette = renderedPalette
    receiverPalette = createReceiverPalette(renderedPalette, chromePalette)
    createScene(renderer)
    createHelpModal(renderer)
    applyPalette()
    renderer.start()
    nextVideo.play()
    schedulePreparation()
  } catch (error) {
    restoreRendererCadence(renderer)
    nextVideo.dispose()
    video = null
    throw error
  }

  frameHandler = async (deltaTime: number) => {
    if (paused || !video) return
    elapsedMs += deltaTime
    consumeAudioFrames(deltaTime)
    const decayDeltaMs = audioDecayDeltaMs(elapsedMs, lastAudioAnalysisAtMs, deltaTime, AUDIO_DECAY_GRACE_MS)
    if (decayDeltaMs > 0) {
      rhythmAnalyzer.update(EMPTY_PCM, AUDIO_CHANNELS, video.info.audioSampleRate, decayDeltaMs)
      audioAnalysisStalled = true
    }
    choreography.update(elapsedMs, rhythmAnalyzer)
    if (colorMode !== "fixed") {
      if (colorMode === "ambient") ambientElapsedMs += deltaTime
      paletteAccumulatorMs += deltaTime
      chromePaletteAccumulatorMs += deltaTime
      if (paletteAccumulatorMs >= PALETTE_UPDATE_INTERVAL_MS) {
        paletteAccumulatorMs %= PALETTE_UPDATE_INTERVAL_MS
        const updateChrome = colorMode === "ambient" || chromePaletteAccumulatorMs >= CHROME_PALETTE_UPDATE_INTERVAL_MS
        if (updateChrome) chromePaletteAccumulatorMs %= CHROME_PALETTE_UPDATE_INTERVAL_MS
        applyPalette(updateChrome)
      }
    }
    const targetSeconds = playbackPositionSeconds + (performance.now() - playbackStartedAtMs) / 1000
    consumeVideoFrame(targetSeconds)
    refreshScene(true)
    if (helpVisible && Math.floor(video.state.currentTime) !== lastHelpSecond) updateControls()
  }
  renderer.setFrameCallback(frameHandler)

  keyHandler = (key: KeyEvent) => {
    if (key.sequence === "?" && !key.ctrl && !key.meta) {
      setHelpVisible(!helpVisible)
      key.preventDefault()
      return
    }
    if (key.name === "q" && !key.ctrl && !key.meta) {
      destroy(renderer)
      renderer.destroy()
      key.preventDefault()
      return
    }
    if (key.name === "escape") {
      if (helpVisible) setHelpVisible(false)
      else {
        destroy(renderer)
        renderer.destroy()
      }
      key.preventDefault()
      return
    }
    if (key.name === "space" && !key.ctrl && !key.meta && !key.shift) {
      togglePause()
      key.preventDefault()
    } else if ((key.name === "left" || key.name === "right") && !key.ctrl && !key.meta) {
      const direction = key.name === "left" ? -1 : 1
      seekPlayback((video?.state.currentTime ?? playbackPositionSeconds) + direction * (key.shift ? 5 : 0.25))
      key.preventDefault()
    } else if (key.name === "m" && !key.ctrl && !key.meta && !key.shift && video) {
      muted = !muted
      video.setMuted(muted)
      updateControls()
      key.preventDefault()
    } else if (key.name === "r" && !key.ctrl && !key.meta && !key.shift) {
      seekPlayback(0)
      key.preventDefault()
    } else if (key.name === "c" && key.shift && !key.ctrl && !key.meta) {
      colorCycleSpeedIndex = (colorCycleSpeedIndex + 1) % COLOR_CYCLE_SPEEDS.length
      if (colorMode === "ambient") ambientElapsedMs = 0
      if (colorMode !== "fixed") applyPalette()
      else updateControls()
      key.preventDefault()
    } else if (key.name === "c" && !key.ctrl && !key.meta && !key.shift) {
      colorMode = colorMode === "video" ? "ambient" : "video"
      if (colorMode === "ambient") ambientElapsedMs = 0
      paletteAccumulatorMs = 0
      chromePaletteAccumulatorMs = 0
      applyPalette()
      key.preventDefault()
    } else if (/^[1-4]$/.test(key.sequence) && !key.ctrl && !key.meta && !key.shift) {
      colorMode = "fixed"
      colorIndex = Number(key.sequence) - 1
      applyPalette()
      key.preventDefault()
    } else if (key.name === "g" && !key.ctrl && !key.meta && !key.shift) {
      shadowGlyphIndex = shadowGlyphIndex === SHADOW_GLYPHS.length - 1 ? -1 : shadowGlyphIndex + 1
      refreshScene()
      updateControls()
      key.preventDefault()
    } else if (key.name === "e" && !key.ctrl && !key.meta && !key.shift) {
      equalizerProjectionVisible = !equalizerProjectionVisible
      refreshScene()
      updateControls()
      key.preventDefault()
    }
  }
  resizeHandler = () => {
    updateArtworkAlignment(renderer)
    createHelpModal(renderer)
  }
  renderer.keyInput.on("keypress", keyHandler)
  renderer.on("resize", resizeHandler)
}

function restoreRendererCadence(renderer: CliRenderer): void {
  if (previousRendererTargetFps !== null) renderer.targetFps = previousRendererTargetFps
  if (previousRendererMaxFps !== null) renderer.maxFps = previousRendererMaxFps
  previousRendererTargetFps = null
  previousRendererMaxFps = null
}

export function destroy(renderer: CliRenderer): void {
  if (frameHandler) renderer.removeFrameCallback(frameHandler)
  if (keyHandler) renderer.keyInput.off("keypress", keyHandler)
  if (resizeHandler) renderer.off("resize", resizeHandler)
  cancelPreparation()
  if (video) {
    const currentVideo = video
    video = null
    try {
      currentVideo.pause()
    } finally {
      try {
        currentVideo.disableAudioTap()
      } finally {
        currentVideo.dispose()
      }
    }
  }
  view?.destroyRecursively()
  helpOverlay?.destroyRecursively()
  renderer.setBackgroundColor("transparent")
  restoreRendererCadence(renderer)
  view = null
  artwork = null
  receiverRenderable = null
  logoPlate = null
  logoText = null
  helpOverlay = null
  helpModal = null
  helpText = null
  rendererInstance = null
  frameHandler = null
  keyHandler = null
  resizeHandler = null
  frameAnalysis = null
  shadowMemories.length = 0
}

const USAGE =
  "Usage: bun src/shadow-cinema-spike.ts <video.mp4>\n       bun src/shadow-cinema-spike.ts --video <video.mp4>"

if (import.meta.main) {
  let videoPath: string
  try {
    videoPath = parseShadowCinemaArgs(process.argv.slice(2)).videoPath
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n${USAGE}\n`)
    process.exit(1)
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: PRESENTATION_FPS,
    maxFps: PRESENTATION_FPS,
    onDestroy: () => {
      if (rendererInstance) destroy(rendererInstance)
    },
  })
  try {
    await run(renderer, videoPath)
  } catch (error) {
    renderer.destroy()
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Failed to start shadow cinema: ${message}\n`)
    process.exit(1)
  }
}
