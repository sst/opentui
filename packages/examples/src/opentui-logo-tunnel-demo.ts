import {
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent,
  StyledText,
  TextRenderable,
  createCliRenderer,
  fg,
} from "@opentui/core"

import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

interface ColorStop {
  background: string
  foreground: string
  shadow: string
}

interface Vec2 {
  x: number
  y: number
}

interface Vec3 extends Vec2 {
  z: number
}

const ORIGINAL_LOGO = ["▄▄▄ ▄▄▄ ▄▄▄ ▄▄  █▄▄ ▄ ▄ ▄", "█ █ █ █ █ ▀ █ █ █ ▄ █ █ █", "▀▀▀ █▀▀ ▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀ ▀"].join("\n")
const COLOR_STOPS: readonly ColorStop[] = [
  { background: "#031B1C", foreground: "#24F4EE", shadow: "#149E99" },
  { background: "#24031F", foreground: "#FF37CA", shadow: "#A92387" },
  { background: "#050505", foreground: "#FF4B16", shadow: "#B9360F" },
  { background: "#151126", foreground: "#C3ACFF", shadow: "#7862B8" },
]
const COLOR_STOP_DURATION = 900
const RECEIVER_HALF_SIZE = 5
const RECEIVER_DEPTH = 4
const LIGHT_DEPTH = -4
const CASTER_DEPTH = 1.4
const CASTER_HALF_SIZE = 1.35
const SHADOW_GLYPHS = ["⋅", "∙", "•", "⦁", "●"] as const

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
let colorIndex = 0
let colorCycling = false
let shadowEnabled = true
let shadowGlyphIndex = -1
let windEnabled = true
let autoLight = false
let helpVisible = false
let elapsed = 0
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
  const polygon = convexHull(casterVertices(casterCenter, wind).map((vertex) => projectShadow(vertex, light)))
  const lightDistance = Math.hypot(light.x, light.y)
  const penumbra = 0.5 + lightDistance * 0.035
  const palette = COLOR_STOPS[colorIndex]!
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
  helpText.content = [
    "Mouse       move light source",
    `C           colors: ${colorCycling ? "cycling" : "fixed"}`,
    "1 2 3 4     select fixed color",
    `W           wind: ${windEnabled ? "moving" : "frozen"}`,
    `L           light: ${autoLight ? "automatic" : "mouse"}`,
    `S           shadow: ${shadowEnabled ? "visible" : "hidden"}`,
    `G           texture: ${texture}`,
    "R           reset scene",
    "? / Esc     close help",
  ].join("\n")
}

function setHelpVisible(visible: boolean): void {
  helpVisible = visible
  if (helpOverlay) helpOverlay.visible = visible
  updateControls()
  rendererInstance?.requestRender()
}

function updateColors(): void {
  const { background, foreground } = COLOR_STOPS[colorIndex]!
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
  if (!renderer || !receiverText) return
  autoLight = false
  lightX = (Math.max(0, Math.min(renderer.width - 1, event.x)) / Math.max(1, renderer.width - 1)) * 2 - 1
  lightY = (Math.max(0, Math.min(renderer.height - 1, event.y)) / Math.max(1, renderer.height - 1)) * 2 - 1
  receiverText.content = buildReceiver(sceneWidth, sceneHeight)
  updateControls()
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
    height: 12,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    border: true,
    borderStyle: "double",
    borderColor: COLOR_STOPS[colorIndex]!.foreground,
    backgroundColor: COLOR_STOPS[colorIndex]!.background,
    title: "Controls",
    titleAlignment: "center",
    onMouseDown: (event: MouseEvent) => event.stopPropagation(),
  })
  helpText = new TextRenderable(renderer, {
    id: "opentui-logo-help-text",
    content: "",
    fg: COLOR_STOPS[colorIndex]!.foreground,
    selectable: false,
  })
  helpModal.add(helpText)
  helpOverlay.add(helpModal)
  renderer.root.add(helpOverlay)
  updateControls()
}

export function run(renderer: CliRenderer): void {
  rendererInstance = renderer
  colorIndex = 0
  colorCycling = false
  shadowEnabled = true
  shadowGlyphIndex = -1
  windEnabled = true
  autoLight = false
  helpVisible = false
  elapsed = 0
  frameAccumulator = 0
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
    if (windEnabled || colorCycling || autoLight) elapsed += deltaTime
    frameAccumulator += deltaTime
    if (frameAccumulator < 1000 / 12) return
    frameAccumulator %= 1000 / 12
    if (colorCycling) {
      const nextColorIndex = Math.floor(elapsed / COLOR_STOP_DURATION) % COLOR_STOPS.length
      if (nextColorIndex !== colorIndex) {
        colorIndex = nextColorIndex
        updateColors()
        return
      }
    }
    if (autoLight) {
      const lightTime = elapsed * 0.00018
      lightX = Math.sin(lightTime * 1.07) * 0.86
      lightY = Math.sin(lightTime * 0.73 + 1.1) * 0.78
    }
    if ((windEnabled || autoLight) && receiverText) receiverText.content = buildReceiver(sceneWidth, sceneHeight)
  }
  renderer.setFrameCallback(frameHandler)

  keyHandler = (key: KeyEvent) => {
    if (key.sequence === "?") {
      setHelpVisible(!helpVisible)
      key.preventDefault()
    } else if (key.name === "escape" && helpVisible) {
      setHelpVisible(false)
      key.preventDefault()
    } else if (helpVisible) {
      return
    } else if (key.name === "c" && !key.ctrl && !key.meta && !key.shift) {
      colorCycling = !colorCycling
      if (!colorCycling) colorIndex = 0
      updateColors()
    } else if (/^[1-4]$/.test(key.sequence) && !key.ctrl && !key.meta && !key.shift) {
      colorCycling = false
      colorIndex = Number(key.sequence) - 1
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
      autoLight = !autoLight
      if (receiverText) receiverText.content = buildReceiver(sceneWidth, sceneHeight)
      updateControls()
    } else if (key.name === "g" && !key.ctrl && !key.meta && !key.shift) {
      shadowGlyphIndex = shadowGlyphIndex === SHADOW_GLYPHS.length - 1 ? -1 : shadowGlyphIndex + 1
      if (receiverText) receiverText.content = buildReceiver(sceneWidth, sceneHeight)
      updateControls()
    } else if (key.name === "r" && !key.ctrl && !key.meta && !key.shift) {
      elapsed = 0
      frameAccumulator = 0
      colorIndex = 0
      lightX = 0.35
      lightY = -0.25
      autoLight = false
      updateColors()
    }
  }
  resizeHandler = () => {
    renderArtwork(renderer)
    createHelpModal(renderer)
  }
  renderer.keyInput.on("keypress", keyHandler)
  renderer.on("resize", resizeHandler)
}

export function destroy(renderer: CliRenderer): void {
  if (frameHandler) renderer.removeFrameCallback(frameHandler)
  if (keyHandler) renderer.keyInput.off("keypress", keyHandler)
  if (resizeHandler) renderer.off("resize", resizeHandler)
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
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    onDestroy: () => {
      frameHandler = null
      keyHandler = null
      resizeHandler = null
    },
  })
  setupCommonDemoKeys(renderer)
  run(renderer)
}
