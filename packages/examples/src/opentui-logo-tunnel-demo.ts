import { basename, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  Audio,
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent,
  StyledText,
  TextRenderable,
  type AudioSound,
  type AudioVoice,
  createCliRenderer,
  fg,
} from "@opentui/core"

import { AUDIO_ANALYSIS_FRAMES, AudioRhythmAnalyzer } from "./lib/audio-rhythm-analyzer.js"
import { audioLightPosition, audioShadowResponse, automaticLightPosition } from "./lib/audio-light-motion.js"
import { parseAudioFileArgs } from "./lib/audio-file-args.js"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

interface ColorStop {
  background: string
  foreground: string
  shadow: string
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

interface Vec3 extends Vec2 {
  z: number
}

type LightMode = "mouse" | "automatic" | "audio"

interface LogoTunnelOptions {
  audioFile?: string
}

const ORIGINAL_LOGO = ["▄▄▄ ▄▄▄ ▄▄▄ ▄▄  █▄▄ ▄ ▄ ▄", "█ █ █ █ █ ▀ █ █ █ ▄ █ █ █", "▀▀▀ █▀▀ ▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀ ▀"].join("\n")
const COLOR_STOPS: readonly ColorStop[] = [
  { background: "#031B1C", foreground: "#24F4EE", shadow: "#149E99" },
  { background: "#24031F", foreground: "#FF37CA", shadow: "#A92387" },
  { background: "#050505", foreground: "#FF4B16", shadow: "#B9360F" },
  { background: "#151126", foreground: "#C3ACFF", shadow: "#7862B8" },
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
const RECEIVER_DEPTH = 4
const LIGHT_DEPTH = -4
const CASTER_DEPTH = 1.4
const CASTER_HALF_SIZE = 1.35
const SHADOW_GLYPHS = ["⋅", "∙", "•", "⦁", "●"] as const
const DEFAULT_AUDIO_TRACK_PATH = fileURLToPath(new URL("./koop.wav", import.meta.url))
const AUDIO_SAMPLE_RATE = 48_000
const AUDIO_CHANNELS = 2
const EMPTY_PCM = new Float32Array()
const rhythmAnalyzer = new AudioRhythmAnalyzer()

let view: BoxRenderable | null = null
let artwork: BoxRenderable | null = null
let receiverText: TextRenderable | null = null
let logoPlate: BoxRenderable | null = null
let logoText: TextRenderable | null = null
let helpOverlay: BoxRenderable | null = null
let helpModal: BoxRenderable | null = null
let helpText: TextRenderable | null = null
let rendererInstance: CliRenderer | null = null
let keyHandler: ((key: KeyEvent) => void) | null = null
let resizeHandler: (() => void) | null = null
let frameHandler: ((deltaTime: number) => Promise<void>) | null = null
let audio: Audio | null = null
let audioSound: AudioSound | null = null
let audioVoice: AudioVoice | null = null
let audioStatus: "loading" | "ready" | "playing" | "unavailable" = "loading"
let audioTrackPath = DEFAULT_AUDIO_TRACK_PATH
let audioTrackName = basename(DEFAULT_AUDIO_TRACK_PATH)
let colorIndex = 0
let colorCycling = false
let shadowEnabled = true
let shadowGlyphIndex = -1
let windEnabled = true
let lightMode: LightMode = "mouse"
let helpVisible = false
let elapsed = 0
let colorElapsed = 0
let colorCycleSpeedIndex = 2
let frameAccumulator = 0
let sceneWidth = 0
let sceneHeight = 0
let lightX = 0.35
let lightY = -0.25

function rotateCaster(point: Vec3, center: Vec2, wind: number): Vec3 {
  const pitch = 0.38 + Math.sin(wind * 0.73) * 0.08
  const yaw = -0.52 + Math.sin(wind * 0.91 + 1.2) * 0.12
  const pitchY = point.y * Math.cos(pitch) - point.z * Math.sin(pitch)
  const pitchZ = point.y * Math.sin(pitch) + point.z * Math.cos(pitch)
  return {
    x: point.x * Math.cos(yaw) + pitchZ * Math.sin(yaw) + center.x,
    y: pitchY + center.y,
    z: -point.x * Math.sin(yaw) + pitchZ * Math.cos(yaw) + CASTER_DEPTH,
  }
}

function casterVertices(center: Vec2, wind: number): Vec3[] {
  const vertices: Vec3[] = []
  for (const x of [-CASTER_HALF_SIZE, CASTER_HALF_SIZE]) {
    for (const y of [-CASTER_HALF_SIZE, CASTER_HALF_SIZE]) {
      for (const z of [-CASTER_HALF_SIZE, CASTER_HALF_SIZE]) vertices.push(rotateCaster({ x, y, z }, center, wind))
    }
  }
  return vertices
}

function projectShadow(point: Vec3, light: Vec3): Vec2 {
  const scale = (RECEIVER_DEPTH - light.z) / (point.z - light.z)
  return { x: light.x + (point.x - light.x) * scale, y: light.y + (point.y - light.y) * scale }
}

function cross(origin: Vec2, left: Vec2, right: Vec2): number {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x)
}

function convexHull(points: Vec2[]): Vec2[] {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y)
  const lower: Vec2[] = []
  const upper: Vec2[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop()
    lower.push(point)
  }
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index]!
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[index]!
    const end = polygon[previous]!
    if (
      start.y > point.y !== end.y > point.y &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    ) {
      inside = !inside
    }
  }
  return inside
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const progress =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + dx * progress), point.y - (start.y + dy * progress))
}

function distanceToPolygon(point: Vec2, polygon: Vec2[]): number {
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygon.length; index++) {
    distance = Math.min(distance, distanceToSegment(point, polygon[index]!, polygon[(index + 1) % polygon.length]!))
  }
  return distance
}

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

function ambientPalette(time: number): ColorStop {
  const speed = COLOR_CYCLE_SPEEDS[colorCycleSpeedIndex]!
  const segmentDuration = speed.hold + speed.transition
  const position = time / segmentDuration
  const index = Math.floor(position) % AMBIENT_STOPS.length
  const nextIndex = (index + 1) % AMBIENT_STOPS.length
  const segmentTime = time % segmentDuration
  const progress =
    segmentTime <= speed.hold ? 0 : smoothstep(0, 1, Math.min(1, (segmentTime - speed.hold) / speed.transition))
  const from = AMBIENT_STOPS[index]!
  const to = AMBIENT_STOPS[nextIndex]!
  const background = interpolateOklch(from.background, to.background, progress)
  const foreground = interpolateOklch(from.foreground, to.foreground, progress)
  const shadow: Oklch = {
    lightness: foreground.lightness * 0.64,
    chroma: foreground.chroma * 0.68,
    hue: foreground.hue,
  }
  return {
    background: oklchToHex(background),
    foreground: oklchToHex(foreground),
    shadow: oklchToHex(shadow),
  }
}

function activePalette(): ColorStop {
  return colorCycling ? ambientPalette(colorElapsed) : COLOR_STOPS[colorIndex]!
}

function hashNoise(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function valueNoise(x: number, y: number): number {
  const left = Math.floor(x)
  const top = Math.floor(y)
  const fx = x - left
  const fy = y - top
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const upper = hashNoise(left, top) * (1 - sx) + hashNoise(left + 1, top) * sx
  const lower = hashNoise(left, top + 1) * (1 - sx) + hashNoise(left + 1, top + 1) * sx
  return upper * (1 - sy) + lower * sy
}

function fractalNoise(x: number, y: number): number {
  return (
    valueNoise(x, y) * 0.58 + valueNoise(x * 2.03 + 9.7, y * 2.03 - 4.1) * 0.29 + valueNoise(x * 4.11, y * 4.11) * 0.13
  )
}

function shadowStrength(point: Vec2, polygon: Vec2[], penumbra: number, wind: number): number {
  const driftX = wind * 0.34
  const driftY = wind * -0.19
  const warpX = (fractalNoise(point.x * 0.72 + driftX, point.y * 0.72 + driftY) - 0.5) * 0.42
  const warpY = (fractalNoise(point.x * 0.72 + driftX + 17.3, point.y * 0.72 + driftY - 8.9) - 0.5) * 0.42
  const warpedPoint = { x: point.x + warpX, y: point.y + warpY }
  const distance = distanceToPolygon(warpedPoint, polygon)
  const dapple = fractalNoise(point.x * 0.95 + driftX * 1.4, point.y * 0.95 + driftY * 1.4)
  if (pointInPolygon(warpedPoint, polygon)) return 0.42 + dapple * 0.58
  return (1 - smoothstep(0, penumbra * (0.72 + dapple * 0.55), distance)) * (0.32 + dapple * 0.42)
}

function expandPolygon(polygon: Vec2[], expansion: number): Vec2[] {
  if (expansion === 0) return polygon
  const center = polygon.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 })
  center.x /= polygon.length
  center.y /= polygon.length
  return polygon.map((point) => ({
    x: center.x + (point.x - center.x) * (1 + expansion),
    y: center.y + (point.y - center.y) * (1 + expansion),
  }))
}

function buildReceiver(width: number, height: number): StyledText {
  const wind = elapsed * 0.00022
  const directionLength = Math.hypot(lightX, lightY)
  const direction =
    directionLength < 0.05 ? { x: 0.8, y: -0.6 } : { x: lightX / directionLength, y: lightY / directionLength }
  const lightRadius = RECEIVER_HALF_SIZE * (1.35 + Math.min(1, directionLength) * 0.65)
  const light: Vec3 = { x: direction.x * lightRadius, y: direction.y * lightRadius, z: LIGHT_DEPTH }
  const casterCenter = {
    x: direction.x * (RECEIVER_HALF_SIZE - CASTER_HALF_SIZE * 0.25) - direction.y * Math.sin(wind * 0.81) * 0.22,
    y: direction.y * (RECEIVER_HALF_SIZE - CASTER_HALF_SIZE * 0.25) + direction.x * Math.sin(wind * 0.81) * 0.22,
  }
  const shadowResponse = lightMode === "audio" ? audioShadowResponse(rhythmAnalyzer) : { expansion: 0, edgeLift: 0 }
  const polygon = expandPolygon(
    convexHull(casterVertices(casterCenter, wind).map((vertex) => projectShadow(vertex, light))),
    shadowResponse.expansion,
  )
  const lightDistance = Math.hypot(light.x, light.y)
  const penumbra = (0.5 + lightDistance * 0.035) * (1 + shadowResponse.edgeLift)
  const palette = activePalette()
  const chunks = []

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const isTop = row === 0
      const isBottom = row === height - 1
      const isLeft = column === 0
      const isRight = column === width - 1
      if (isTop || isBottom || isLeft || isRight) {
        const glyph =
          isTop && isLeft
            ? "┌"
            : isTop && isRight
              ? "┐"
              : isBottom && isLeft
                ? "└"
                : isBottom && isRight
                  ? "┘"
                  : isTop || isBottom
                    ? "─"
                    : "│"
        chunks.push(fg(palette.foreground)(glyph))
        continue
      }

      const point = {
        x: ((column + 0.5) / width) * RECEIVER_HALF_SIZE * 2 - RECEIVER_HALF_SIZE,
        y: ((row + 0.5) / height) * RECEIVER_HALF_SIZE * 2 - RECEIVER_HALF_SIZE,
      }
      const strength = shadowEnabled ? shadowStrength(point, polygon, penumbra, wind) : 0
      if (strength <= 0.025) {
        chunks.push({ __isChunk: true as const, text: " " })
        continue
      }
      const glyph =
        shadowGlyphIndex === -1
          ? SHADOW_GLYPHS[Math.min(SHADOW_GLYPHS.length - 1, Math.floor(strength * SHADOW_GLYPHS.length))]!
          : SHADOW_GLYPHS[shadowGlyphIndex]!
      chunks.push(fg(palette.shadow)(glyph))
    }
    if (row < height - 1) chunks.push({ __isChunk: true as const, text: "\n" })
  }
  return new StyledText(chunks)
}

function updateControls(): void {
  if (!helpText) return
  const texture = shadowGlyphIndex === -1 ? "adaptive" : SHADOW_GLYPHS[shadowGlyphIndex]!
  const lightStatus =
    lightMode === "audio"
      ? audioStatus === "playing"
        ? `audio (${audioTrackName})`
        : audioStatus === "loading"
          ? "audio (loading)"
          : "audio (unavailable)"
      : lightMode
  helpText.content = [
    "Mouse       move light source",
    `C           colors: ${colorCycling ? COLOR_CYCLE_SPEEDS[colorCycleSpeedIndex]!.name : "fixed"}`,
    `Shift+C     color speed: ${COLOR_CYCLE_SPEEDS[colorCycleSpeedIndex]!.name}`,
    "1 2 3 4     select fixed color",
    `W           wind: ${windEnabled ? "moving" : "frozen"}`,
    `L           light: ${lightStatus}`,
    `S           shadow: ${shadowEnabled ? "visible" : "hidden"}`,
    `G           texture: ${texture}`,
    "R           reset scene",
    "? / Esc     close help",
  ].join("\n")
}

function startAudioLight(): void {
  rhythmAnalyzer.reset()
  if (!audio || !audioSound || audioStatus === "unavailable") return
  audioVoice = audio.play(audioSound, { volume: 1, pan: 0, loop: true })
  audioStatus = audioVoice ? "playing" : "unavailable"
}

function stopAudioLight(): void {
  if (audio && audioVoice) audio.stopVoice(audioVoice)
  audioVoice = null
  rhythmAnalyzer.reset()
  if (audioStatus === "playing") audioStatus = "ready"
}

async function initializeAudio(): Promise<void> {
  const nextAudio = Audio.create({ autoStart: false, sampleRate: AUDIO_SAMPLE_RATE, playbackChannels: AUDIO_CHANNELS })
  audio = nextAudio
  nextAudio.on("error", () => {
    if (audio !== nextAudio) return
    audioStatus = "unavailable"
    updateControls()
  })

  const tapEnabled = nextAudio.enableTap(AUDIO_ANALYSIS_FRAMES * 2)
  const nextSound = await nextAudio.loadSoundFile(audioTrackPath)
  if (audio !== nextAudio) {
    nextAudio.dispose()
    return
  }
  if (!tapEnabled || !nextSound || !nextAudio.start()) {
    audioStatus = "unavailable"
    nextAudio.dispose()
    audio = null
    updateControls()
    return
  }

  audioSound = nextSound
  audioStatus = "ready"
  if (lightMode === "audio") startAudioLight()
  updateControls()
}

function setHelpVisible(visible: boolean): void {
  helpVisible = visible
  if (helpOverlay) helpOverlay.visible = visible
  updateControls()
  rendererInstance?.requestRender()
}

function updateColors(): void {
  const { background, foreground } = activePalette()
  rendererInstance?.setBackgroundColor(background)
  if (view) view.backgroundColor = background
  if (receiverText) receiverText.content = buildReceiver(sceneWidth, sceneHeight)
  if (logoPlate) logoPlate.backgroundColor = foreground
  if (logoText) logoText.fg = background
  if (helpModal) {
    helpModal.backgroundColor = background
    helpModal.borderColor = foreground
  }
  if (helpText) helpText.fg = foreground
  updateControls()
}

function updateLightFromMouse(event: MouseEvent): void {
  const renderer = rendererInstance
  if (!renderer || !receiverText || lightMode !== "mouse") return
  lightX = (Math.max(0, Math.min(renderer.width - 1, event.x)) / Math.max(1, renderer.width - 1)) * 2 - 1
  lightY = (Math.max(0, Math.min(renderer.height - 1, event.y)) / Math.max(1, renderer.height - 1)) * 2 - 1
  receiverText.content = buildReceiver(sceneWidth, sceneHeight)
}

function renderArtwork(renderer: CliRenderer): void {
  artwork?.destroyRecursively()
  const compact = renderer.width < 66 || renderer.height < 34
  const availableWidth = Math.max(29, Math.min(43, renderer.width - 2))
  const width = compact ? availableWidth - Number(availableWidth % 2 === 0) : 51
  const height = compact ? Math.max(13, Math.min(17, renderer.height - 7)) : 25
  const plateHeight = compact ? 5 : 7
  sceneWidth = width
  sceneHeight = height

  artwork = new BoxRenderable(renderer, {
    id: "opentui-logo-shadow-artwork",
    width,
    height: height + plateHeight,
    flexDirection: "column",
    flexShrink: 0,
  })
  receiverText = new TextRenderable(renderer, {
    id: "opentui-logo-shadow-receiver",
    content: buildReceiver(width, height),
    selectable: false,
  })
  logoPlate = new BoxRenderable(renderer, {
    id: "opentui-logo-shadow-plate",
    width,
    height: plateHeight,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLOR_STOPS[0]!.foreground,
  })
  logoText = new TextRenderable(renderer, {
    id: "opentui-logo-shadow-wordmark",
    content: ORIGINAL_LOGO,
    fg: COLOR_STOPS[0]!.background,
    selectable: true,
  })
  logoPlate.add(logoText)
  artwork.add(receiverText)
  artwork.add(logoPlate)
  view?.add(artwork)
  updateColors()
}

function createHelpModal(renderer: CliRenderer): void {
  helpOverlay?.destroyRecursively()
  helpOverlay = new BoxRenderable(renderer, {
    id: "opentui-logo-help-overlay",
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    visible: helpVisible,
    zIndex: 100,
    onMouseDown: () => setHelpVisible(false),
  })
  helpModal = new BoxRenderable(renderer, {
    id: "opentui-logo-help-modal",
    width: renderer.width < 60 ? "90%" : 48,
    height: 13,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    border: true,
    borderStyle: "double",
    borderColor: activePalette().foreground,
    backgroundColor: activePalette().background,
    title: "Controls",
    titleAlignment: "center",
    onMouseDown: (event: MouseEvent) => event.stopPropagation(),
  })
  helpText = new TextRenderable(renderer, {
    id: "opentui-logo-help-text",
    content: "",
    fg: activePalette().foreground,
    selectable: false,
  })
  helpModal.add(helpText)
  helpOverlay.add(helpModal)
  renderer.root.add(helpOverlay)
  updateControls()
}

export async function run(renderer: CliRenderer, options: LogoTunnelOptions = {}): Promise<void> {
  rendererInstance = renderer
  audioTrackPath = options.audioFile ? resolve(options.audioFile) : DEFAULT_AUDIO_TRACK_PATH
  audioTrackName = basename(audioTrackPath)
  colorIndex = 0
  colorCycling = false
  shadowEnabled = true
  shadowGlyphIndex = -1
  windEnabled = true
  lightMode = "mouse"
  helpVisible = false
  elapsed = 0
  colorElapsed = 0
  colorCycleSpeedIndex = 2
  frameAccumulator = 0
  audioStatus = "loading"
  rhythmAnalyzer.reset()
  renderer.start()

  view?.destroyRecursively()
  view = new BoxRenderable(renderer, {
    id: "opentui-logo-tunnel-demo",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLOR_STOPS[0]!.background,
    onMouse(event: MouseEvent): void {
      if (event.type === "move" || event.type === "drag" || event.type === "down") updateLightFromMouse(event)
    },
  })
  renderer.root.add(view)
  renderArtwork(renderer)
  createHelpModal(renderer)

  frameHandler = async (deltaTime: number) => {
    if (windEnabled || lightMode !== "mouse") elapsed += deltaTime
    if (colorCycling) colorElapsed += deltaTime
    frameAccumulator += deltaTime
    const frameInterval = 1000 / (lightMode === "audio" ? 24 : 12)
    if (frameAccumulator < frameInterval) return
    const frameDelta = frameAccumulator
    frameAccumulator %= frameInterval
    if (lightMode !== "mouse") {
      if (lightMode === "audio" && audio && audioVoice) {
        const analysis = audio.readTapFrames(AUDIO_ANALYSIS_FRAMES, AUDIO_CHANNELS)
        rhythmAnalyzer.update(
          analysis && analysis.framesRead > 0 ? analysis.frames : EMPTY_PCM,
          AUDIO_CHANNELS,
          AUDIO_SAMPLE_RATE,
          frameDelta,
        )
      } else if (lightMode === "audio") {
        rhythmAnalyzer.update(EMPTY_PCM, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, frameDelta)
      }
      const position =
        lightMode === "audio" ? audioLightPosition(elapsed, rhythmAnalyzer) : automaticLightPosition(elapsed)
      lightX = position.x
      lightY = position.y
    }
    if (colorCycling) updateColors()
    else if ((windEnabled || lightMode !== "mouse") && receiverText)
      receiverText.content = buildReceiver(sceneWidth, sceneHeight)
  }
  renderer.setFrameCallback(frameHandler)

  keyHandler = (key: KeyEvent) => {
    if (key.sequence === "?") {
      setHelpVisible(!helpVisible)
      key.preventDefault()
    } else if (key.name === "escape" && helpVisible) {
      setHelpVisible(false)
      key.preventDefault()
    } else if (key.name === "c" && key.shift && !key.ctrl && !key.meta) {
      colorCycleSpeedIndex = (colorCycleSpeedIndex + 1) % COLOR_CYCLE_SPEEDS.length
      colorElapsed = 0
      if (colorCycling) updateColors()
      else updateControls()
    } else if (key.name === "c" && !key.ctrl && !key.meta && !key.shift) {
      colorCycling = !colorCycling
      if (colorCycling) colorElapsed = 0
      else colorIndex = 0
      updateColors()
    } else if (/^[1-4]$/.test(key.sequence) && !key.ctrl && !key.meta && !key.shift) {
      colorCycling = false
      colorIndex = Number(key.sequence) - 1
      colorElapsed = 0
      updateColors()
    } else if (key.name === "s" && !key.ctrl && !key.meta && !key.shift) {
      shadowEnabled = !shadowEnabled
      if (receiverText) receiverText.content = buildReceiver(sceneWidth, sceneHeight)
      updateControls()
    } else if (key.name === "w" && !key.ctrl && !key.meta && !key.shift) {
      windEnabled = !windEnabled
      if (receiverText) receiverText.content = buildReceiver(sceneWidth, sceneHeight)
      updateControls()
    } else if (key.name === "l" && !key.ctrl && !key.meta && !key.shift) {
      if (lightMode === "mouse") {
        lightMode = "automatic"
      } else if (lightMode === "automatic") {
        lightMode = "audio"
        startAudioLight()
      } else {
        lightMode = "mouse"
        stopAudioLight()
      }
      if (receiverText) receiverText.content = buildReceiver(sceneWidth, sceneHeight)
      updateControls()
    } else if (key.name === "g" && !key.ctrl && !key.meta && !key.shift) {
      shadowGlyphIndex = shadowGlyphIndex === SHADOW_GLYPHS.length - 1 ? -1 : shadowGlyphIndex + 1
      if (receiverText) receiverText.content = buildReceiver(sceneWidth, sceneHeight)
      updateControls()
    } else if (key.name === "r" && !key.ctrl && !key.meta && !key.shift) {
      elapsed = 0
      colorElapsed = 0
      frameAccumulator = 0
      colorIndex = 0
      lightX = 0.35
      lightY = -0.25
      lightMode = "mouse"
      stopAudioLight()
      updateColors()
    }
  }
  resizeHandler = () => {
    renderArtwork(renderer)
    createHelpModal(renderer)
  }
  renderer.keyInput.on("keypress", keyHandler)
  renderer.on("resize", resizeHandler)
  await initializeAudio()
}

export function destroy(renderer: CliRenderer): void {
  if (frameHandler) renderer.removeFrameCallback(frameHandler)
  if (keyHandler) renderer.keyInput.off("keypress", keyHandler)
  if (resizeHandler) renderer.off("resize", resizeHandler)
  stopAudioLight()
  audio?.dispose()
  audio = null
  audioSound = null
  audioStatus = "loading"
  view?.destroyRecursively()
  renderer.setBackgroundColor("transparent")
  view = null
  artwork = null
  receiverText = null
  logoPlate = null
  logoText = null
  helpOverlay?.destroyRecursively()
  helpOverlay = null
  helpModal = null
  helpText = null
  rendererInstance = null
  frameHandler = null
  keyHandler = null
  resizeHandler = null
}

if (import.meta.main) {
  let options: LogoTunnelOptions
  try {
    const args = parseAudioFileArgs(process.argv.slice(2))
    options = { audioFile: args.filePath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\nUsage: bun src/opentui-logo-tunnel-demo.ts [-f <audio-file>]\n`)
    process.exit(1)
  }
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    onDestroy: () => {
      frameHandler = null
      keyHandler = null
      resizeHandler = null
    },
  })
  setupCommonDemoKeys(renderer)
  await run(renderer, options)
}
