import { basename, resolve } from "node:path"

import {
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent,
  NativeVideo,
  StyledText,
  TextRenderable,
  createCliRenderer,
  fg,
} from "@opentui/core"

import { AUDIO_ANALYSIS_FRAMES, AudioRhythmAnalyzer } from "./lib/audio-rhythm-analyzer.js"
import { AudioAnalysisBuffer, audioDecayDeltaMs, audioTapReadFrames } from "./lib/audio-analysis-buffer.js"
import { AudioVisualChoreographer } from "./lib/audio-visual-choreographer.js"
import { parseShadowCinemaArgs } from "./lib/shadow-cinema-args.js"
import {
  RECEIVER_HEIGHT,
  RECEIVER_WIDTH,
  type VideoFrameAnalysis,
  VIDEO_FRAME_WIDTH,
  analyzeVideoFrame,
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

interface ColorCycleSpeed {
  name: string
  hold: number
  transition: number
}

interface Vec2 {
  x: number
  y: number
}

interface ShadowMemory {
  detail: Float32Array
  capturedAt: number
  strength: number
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
  { name: "slowest", hold: 2000, transition: 4000 },
  { name: "slow", hold: 1000, transition: 2400 },
  { name: "normal", hold: 700, transition: 1600 },
  { name: "fast", hold: 350, transition: 850 },
]
const RECEIVER_HALF_SIZE = 5
const PRESENTATION_FPS = 24
const PRESENTATION_INTERVAL_SECONDS = 1 / PRESENTATION_FPS
const PRESENTATION_INTERVAL_MS = 1000 / PRESENTATION_FPS
const AUDIO_CHANNELS = 2
const AUDIO_TAP_CAPACITY_FRAMES = AUDIO_ANALYSIS_FRAMES * 16
const AUDIO_DECAY_GRACE_MS = 75
const EMPTY_PCM = new Float32Array()
const SHADOW_MEMORY_MAX = 5
const SHADOW_MEMORY_INTERVAL_MS = 120
const SHADOW_MEMORY_LIFETIME_MS = 850
const SHADOW_GLYPHS = ["⋅", "∙", "•", "⦁", "●"] as const
const AUDIO_FIELD_GLYPHS = ["·", "∙", "◦", "○", "●"] as const

const rhythmAnalyzer = new AudioRhythmAnalyzer()
const audioAnalysisBuffer = new AudioAnalysisBuffer(AUDIO_ANALYSIS_FRAMES, AUDIO_CHANNELS)
const choreography = new AudioVisualChoreographer()
const shadowMemories: ShadowMemory[] = []

let rendererInstance: CliRenderer | null = null
let view: BoxRenderable | null = null
let artwork: BoxRenderable | null = null
let receiverText: TextRenderable | null = null
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
let colorElapsedMs = 0
let frameAccumulatorMs = 0
let playbackStartedAtMs = 0
let playbackPositionSeconds = 0
let lastAudioTapFrame = 0n
let lastAudioAnalysisAtMs = 0
let audioAnalysisStalled = false
let lastShadowMemoryAtMs = Number.NEGATIVE_INFINITY
let paused = false
let muted = false
let colorCycling = true
let colorIndex = 0
let colorCycleSpeedIndex = 2
let shadowGlyphIndex = -1
let equalizerProjectionVisible = true
let helpVisible = false
let videoName = ""

function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
  const progress = Math.max(0, Math.min(1, (value - edgeStart) / (edgeEnd - edgeStart)))
  return progress * progress * (3 - 2 * progress)
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

function linearToSrgb(channel: number): number {
  const value = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(1, value))
}

function oklchToHex(color: Oklch): string {
  const radians = (color.hue * Math.PI) / 180
  const a = color.chroma * Math.cos(radians)
  const b = color.chroma * Math.sin(radians)
  const lPrime = color.lightness + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = color.lightness - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = color.lightness - 0.0894841775 * a - 1.291485548 * b
  const l = lPrime ** 3
  const m = mPrime ** 3
  const s = sPrime ** 3
  const channels = [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
  return `#${channels
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

function ambientPalette(timeMs: number): ColorStop {
  const speed = COLOR_CYCLE_SPEEDS[colorCycleSpeedIndex]!
  const segmentDuration = speed.hold + speed.transition
  const position = timeMs / segmentDuration
  const index = Math.floor(position) % AMBIENT_STOPS.length
  const segmentTime = timeMs % segmentDuration
  const progress =
    segmentTime <= speed.hold ? 0 : smoothstep(0, 1, Math.min(1, (segmentTime - speed.hold) / speed.transition))
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
  return colorCycling ? ambientPalette(colorElapsedMs) : COLOR_STOPS[colorIndex]!
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
  if (!frameAnalysis || motion < 0.018 || elapsedMs - lastShadowMemoryAtMs < SHADOW_MEMORY_INTERVAL_MS) return
  shadowMemories.push({
    detail: frameAnalysis.detail.slice(),
    capturedAt: elapsedMs,
    strength: motion,
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
  const impactDisplacement = Math.round(choreography.impact * (2 + rhythmAnalyzer.stereoWidth * 2))
  const impactPolarity = (row + Math.floor(column / 4)) % 2 === 0 ? -1 : 1
  const sourceColumn = Math.max(
    0,
    Math.min(
      RECEIVER_WIDTH - 1,
      column - Math.sign(frameAnalysis.motionDirection.x) * displacement + impactPolarity * impactDisplacement,
    ),
  )
  const sourceRow = Math.max(
    0,
    Math.min(
      RECEIVER_HEIGHT - 1,
      row -
        Math.sign(frameAnalysis.motionDirection.y) * displacement -
        impactPolarity * Math.ceil(impactDisplacement * 0.5),
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

function buildReceiver(): StyledText {
  const palette = activePalette()
  const haloCenter = videoCenter()
  const chunks = []
  for (let row = 0; row < RECEIVER_HEIGHT; row += 1) {
    for (let column = 0; column < RECEIVER_WIDTH; column += 1) {
      const border = row === 0 || row === RECEIVER_HEIGHT - 1 || column === 0 || column === RECEIVER_WIDTH - 1
      if (border) {
        const position =
          row === 0 || row === RECEIVER_HEIGHT - 1 ? column / (RECEIVER_WIDTH - 1) : row / (RECEIVER_HEIGHT - 1)
        const spectrum = rhythmAnalyzer.spectrum[audioSpectrumBand(position)] ?? 0
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
        chunks.push(
          fg(spectrum > 0.16 ? audioSpectrumColor(audioSpectrumBand(position), palette) : palette.foreground)(glyph),
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
      const tonalAnchor =
        hashNoise(column * 1.7 + row * 0.13, row * 2.3 + column * 0.17) > 0.94 - sample.intensity * 0.16
      if (contourStrength > 0.14 || tonalAnchor) {
        const strength = Math.max(contourStrength, sample.intensity * 0.62)
        const glyph = shadowGlyph(strength)
        const color = sample.edge > 0.26 ? palette.accent : palette.foreground
        chunks.push(fg(color)(glyph))
        continue
      }

      if (field && field.strength > 0.075) {
        const glyph = AUDIO_FIELD_GLYPHS[Math.min(AUDIO_FIELD_GLYPHS.length - 1, Math.floor(field.strength * 5))]!
        chunks.push(fg(audioSpectrumColor(field.band, palette))(glyph))
        continue
      }

      let memoryStrength = 0
      for (const memory of shadowMemories) {
        const age = (elapsedMs - memory.capturedAt) / SHADOW_MEMORY_LIFETIME_MS
        if (age < 0 || age > 1) continue
        const detail = memory.detail[row * RECEIVER_WIDTH + column] ?? 0
        if (hashNoise(column + Math.floor(memory.capturedAt / 120), row) > 0.48 + age * 0.38) {
          memoryStrength = Math.max(memoryStrength, detail * (1 - age) * Math.min(1, memory.strength * 12))
        }
      }
      if (memoryStrength > 0.08) chunks.push(fg(palette.shadow)(memoryStrength > 0.24 ? "∙" : "⋅"))
      else chunks.push({ __isChunk: true as const, text: " " })
    }
    if (row < RECEIVER_HEIGHT - 1) chunks.push({ __isChunk: true as const, text: "\n" })
  }
  return new StyledText(chunks)
}

function refreshScene(captureMemory = false): void {
  if (!receiverText) return
  if (captureMemory) captureShadowMemory()
  receiverText.content = buildReceiver()
}

function formatTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(wholeSeconds / 60)
  return `${minutes.toString().padStart(2, "0")}:${(wholeSeconds % 60).toString().padStart(2, "0")}`
}

function updateControls(): void {
  if (!helpText) return
  const glyph = shadowGlyphIndex === -1 ? "adaptive" : SHADOW_GLYPHS[shadowGlyphIndex]!
  const currentTime = video?.state.currentTime ?? playbackPositionSeconds
  const playback = `${paused ? "paused" : "playing"} ${formatTime(currentTime)}/${formatTime(video?.info.duration ?? 0)}`
  const controls = [
    `Space       ${paused ? "resume" : "pause"} playback`,
    `← / →       seek -/+0.25s  (${formatTime(currentTime)} / ${formatTime(video?.info.duration ?? 0)})`,
    "Shift+←/→   seek -/+5s",
    `M           audio: ${muted ? "muted" : "unmuted"}`,
    "R           restart video",
    `C           colors: ${colorCycling ? COLOR_CYCLE_SPEEDS[colorCycleSpeedIndex]!.name : `fixed ${colorIndex + 1}`}`,
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
          `C colors ${colorCycling ? COLOR_CYCLE_SPEEDS[colorCycleSpeedIndex]!.name : `fixed ${colorIndex + 1}`}  Shift+C speed  1-4 fixed`,
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
  shadowMemories.length = 0
  lastShadowMemoryAtMs = Number.NEGATIVE_INFINITY
  lastAudioTapFrame = audioTapFrame
  lastAudioAnalysisAtMs = elapsedMs
  audioAnalysisStalled = false
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
        frameAnalysis = analyzeVideoFrame(raw.data, raw.width, raw.height, frameAnalysis)
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
  const palette = activePalette()
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
  receiverText = new TextRenderable(renderer, {
    id: "shadow-cinema-receiver",
    content: buildReceiver(),
    selectable: false,
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
  artwork.add(receiverText)
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
  const palette = activePalette()
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

function applyPalette(refreshReceiver = true): void {
  const palette = activePalette()
  rendererInstance?.setBackgroundColor(palette.background)
  if (view) view.backgroundColor = palette.background
  if (logoPlate) logoPlate.backgroundColor = palette.foreground
  if (logoText) logoText.fg = palette.background
  if (helpModal) {
    helpModal.backgroundColor = palette.background
    helpModal.borderColor = palette.foreground
  }
  if (helpText) helpText.fg = palette.foreground
  if (refreshReceiver) refreshScene()
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
  frameAccumulatorMs = 0
  resetAnalyzers(video.readAudioTapFrames(1, AUDIO_CHANNELS).endFrame)
  const state = video.update(target)
  const targetFrame = video.takeFrame()
  if (targetFrame) {
    try {
      const raw = targetFrame.raw("rgba8")
      frameAnalysis = analyzeVideoFrame(raw.data, raw.width, raw.height)
      video.frameSubmitted(rendererInstance?.getOutputWriteSample().frameCount ?? 0)
    } finally {
      targetFrame.dispose()
    }
  }
  if (state.preparedPts < 0 && !paused) schedulePreparation()
  if (!paused) {
    video.play()
  }
  applyPalette(false)
  refreshScene()
  updateControls()
}

export async function run(renderer: CliRenderer, videoPath: string): Promise<void> {
  rendererInstance = renderer
  videoName = basename(videoPath)
  elapsedMs = 0
  colorElapsedMs = 0
  frameAccumulatorMs = 0
  playbackPositionSeconds = 0
  playbackStartedAtMs = performance.now()
  paused = false
  muted = false
  colorCycling = true
  colorIndex = 0
  colorCycleSpeedIndex = 2
  shadowGlyphIndex = -1
  equalizerProjectionVisible = true
  helpVisible = false

  const nextVideo = NativeVideo.open(resolve(videoPath))
  try {
    if (!nextVideo.info.hasAudio || nextVideo.info.audioSampleRate <= 0) {
      throw new Error("shadow cinema requires an MP4 with an AAC audio track")
    }
    const decodeHeight = Math.max(1, Math.round(VIDEO_FRAME_WIDTH / (16 / 9)))
    nextVideo.configureOutput(VIDEO_FRAME_WIDTH, decodeHeight, true)
    nextVideo.enableAudioTap(AUDIO_TAP_CAPACITY_FRAMES)
    nextVideo.setMuted(false)
    video = nextVideo
    resetAnalyzers(nextVideo.readAudioTapFrames(1, AUDIO_CHANNELS).endFrame)
    createScene(renderer)
    createHelpModal(renderer)
    renderer.start()
    nextVideo.play()
    schedulePreparation()
  } catch (error) {
    nextVideo.dispose()
    video = null
    throw error
  }

  frameHandler = async (deltaTime: number) => {
    if (paused || !video) return
    elapsedMs += deltaTime
    if (colorCycling) colorElapsedMs += deltaTime
    consumeAudioFrames(deltaTime)
    const decayDeltaMs = audioDecayDeltaMs(elapsedMs, lastAudioAnalysisAtMs, deltaTime, AUDIO_DECAY_GRACE_MS)
    if (decayDeltaMs > 0) {
      rhythmAnalyzer.update(EMPTY_PCM, AUDIO_CHANNELS, video.info.audioSampleRate, decayDeltaMs)
      audioAnalysisStalled = true
    }
    choreography.update(elapsedMs, rhythmAnalyzer)
    frameAccumulatorMs += deltaTime
    const presentVideoFrame = frameAccumulatorMs >= PRESENTATION_INTERVAL_MS
    if (presentVideoFrame) {
      frameAccumulatorMs %= PRESENTATION_INTERVAL_MS
      const targetSeconds = playbackPositionSeconds + (performance.now() - playbackStartedAtMs) / 1000
      consumeVideoFrame(targetSeconds)
    }
    applyPalette(false)
    refreshScene(presentVideoFrame)
    if (helpVisible) updateControls()
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
      colorElapsedMs = 0
      if (colorCycling) applyPalette()
      else updateControls()
      key.preventDefault()
    } else if (key.name === "c" && !key.ctrl && !key.meta && !key.shift) {
      colorCycling = !colorCycling
      if (colorCycling) colorElapsedMs = 0
      applyPalette()
      key.preventDefault()
    } else if (/^[1-4]$/.test(key.sequence) && !key.ctrl && !key.meta && !key.shift) {
      colorCycling = false
      colorIndex = Number(key.sequence) - 1
      colorElapsedMs = 0
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
  view = null
  artwork = null
  receiverText = null
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
