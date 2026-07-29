#!/usr/bin/env bun

import {
  Audio,
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent,
  type OptimizedBuffer,
  RGBA,
  StyledText,
  TextRenderable,
  VRenderable,
  bg,
  bold,
  createCliRenderer,
  dim,
  fg,
  type TextChunk,
} from "@opentui/core"

import { AudioRhythmAnalyzer } from "./lib/audio-rhythm-analyzer.js"
import { paletteForAppearance, type AppearanceMode } from "./lib/appearance-palette.js"
import {
  activeWordIndexAtFrame,
  loadAudioTextRecordings,
  resolveAudioTextPairs,
  wordIndexAtFrame,
  type AudioTextRecording,
} from "./lib/audio-text-recording.js"
import { sextantGlyph } from "./lib/sextant-cell.js"

interface CinemaPalette {
  background: string
  foreground: string
  shadow: string
  accent: string
}

type FieldGlyphStyle = "dots" | "sextants"
type VisualizerMode = "field" | "line"

const COLOR_STOPS: readonly CinemaPalette[] = [
  { background: "#031B1C", foreground: "#24F4EE", shadow: "#149E99", accent: "#FF4FD8" },
  { background: "#24031F", foreground: "#FF37CA", shadow: "#A92387", accent: "#46E6FF" },
  { background: "#120704", foreground: "#FF4B16", shadow: "#B9360F", accent: "#4D8DFF" },
  { background: "#151126", foreground: "#C3ACFF", shadow: "#7862B8", accent: "#65FBD2" },
]
const DOT_FIELD_GLYPHS = ["·", "⋅", "∙", "•", "●"] as const
const SEXTANT_FIELD_GLYPHS = [1, 9, 21, 29, 31, 63].map(sextantGlyph)
const PRESENTATION_FPS = 30
const PCM_BUFFER_SECONDS = 2
const AUTO_ADVANCE_DELAY_MS = 700
const PALETTE_SEGMENT_MS = 7_000
const PALETTE_UPDATE_MS = 100
const TRANSCRIPT_PRESENTATION_LEAD_MS = 25
const ANALYSIS_FRAMES = 1024
const MAX_TRANSCRIPT_ROWS = 11
const PROGRESS_BOTTOM_MARGIN = 2

let rendererInstance: CliRenderer | null = null
let recordings: AudioTextRecording[] = []
let recordingIndex = 0
let audio: Audio | null = null
let root: BoxRenderable | null = null
let transcriptLayer: BoxRenderable | null = null
let transcriptText: TextRenderable | null = null
let progressBar: VRenderable | null = null
let helpOverlay: BoxRenderable | null = null
let helpModal: BoxRenderable | null = null
let helpText: TextRenderable | null = null
let keyHandler: ((key: KeyEvent) => void) | null = null
let resizeHandler: (() => void) | null = null
let frameHandler: ((deltaTime: number) => Promise<void>) | null = null
let streamCapacityFrames = 0
let playbackOriginFrame = 0
let sourceCursorFrame = 0
let displayedWordIndex = Number.NaN
let analyzedFrame = -1
let elapsedMs = 0
let fieldPhase = 0
let paletteElapsedMs = 0
let paletteAccumulatorMs = 0
let endedAtMs: number | null = null
let paused = false
let muted = false
let playbackError: string | null = null
let helpVisible = false
let appearanceMode: AppearanceMode = "dark"
let fieldGlyphStyle: FieldGlyphStyle = "dots"
let visualizerMode: VisualizerMode = "field"
let palette: CinemaPalette = COLOR_STOPS[0]!
let fieldPalette = createFieldPalette(palette)
const rhythmAnalyzer = new AudioRhythmAnalyzer()

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function smoothstep(value: number): number {
  const progress = clamp(value, 0, 1)
  return progress * progress * (3 - 2 * progress)
}

function hashNoise(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function mixHex(from: string, to: string, progress: number): string {
  const fromValue = Number.parseInt(from.slice(1), 16)
  const toValue = Number.parseInt(to.slice(1), 16)
  const channels = [16, 8, 0].map((shift) => {
    const start = (fromValue >> shift) & 0xff
    const end = (toValue >> shift) & 0xff
    return Math.round(start + (end - start) * progress)
      .toString(16)
      .padStart(2, "0")
  })
  return `#${channels.join("")}`
}

function interpolatePalette(from: CinemaPalette, to: CinemaPalette, progress: number): CinemaPalette {
  return {
    background: mixHex(from.background, to.background, progress),
    foreground: mixHex(from.foreground, to.foreground, progress),
    shadow: mixHex(from.shadow, to.shadow, progress),
    accent: mixHex(from.accent, to.accent, progress),
  }
}

function currentPalette(): CinemaPalette {
  const position = paletteElapsedMs / PALETTE_SEGMENT_MS + recordingIndex
  const index = Math.floor(position) % COLOR_STOPS.length
  return paletteForAppearance(
    interpolatePalette(COLOR_STOPS[index]!, COLOR_STOPS[(index + 1) % COLOR_STOPS.length]!, smoothstep(position % 1)),
    appearanceMode,
  )
}

function createFieldPalette(value: CinemaPalette): Record<"background" | "foreground" | "shadow" | "accent", RGBA> {
  return {
    background: RGBA.fromHex(value.background),
    foreground: RGBA.fromHex(value.foreground),
    shadow: RGBA.fromHex(value.shadow),
    accent: RGBA.fromHex(value.accent),
  }
}

function currentRecording(): AudioTextRecording {
  const recording = recordings[recordingIndex]
  if (!recording) throw new Error("No active audio/text recording")
  return recording
}

function playbackFrame(): number {
  if (!audio) return playbackOriginFrame
  return clamp(playbackOriginFrame + Number(audio.getPcmConsumedFrames()), 0, currentRecording().audio.frameCount)
}

function writePcmQueue(): void {
  if (!audio) return
  const recording = currentRecording()
  const available = Math.max(0, streamCapacityFrames - audio.getPcmQueuedFrames())
  const frameCount = Math.min(available, recording.audio.frameCount - sourceCursorFrame)
  if (frameCount <= 0) return
  const sampleStart = sourceCursorFrame * recording.audio.channels
  const sampleEnd = (sourceCursorFrame + frameCount) * recording.audio.channels
  const written = audio.writePcm(recording.audio.samples.subarray(sampleStart, sampleEnd))
  if (written == null) {
    playbackError = "PCM write failed"
    paused = true
    return
  }
  sourceCursorFrame += written
}

function beginAudioPlayback(): boolean {
  if (!audio) return false
  if (audio.start()) return true
  playbackError = "No audio playback device is available"
  paused = true
  return false
}

function configureTrackAudio(targetFrame: number): boolean {
  audio?.dispose()
  const recording = currentRecording()
  const nextAudio = Audio.create({ sampleRate: recording.audio.sampleRate, playbackChannels: 2 })
  nextAudio.on("error", (error) => {
    playbackError = error.message
  })
  streamCapacityFrames = recording.audio.sampleRate * PCM_BUFFER_SECONDS
  if (!nextAudio.enablePcmStream(streamCapacityFrames, recording.audio.channels)) {
    nextAudio.dispose()
    throw new Error(`Could not create PCM stream for '${recording.audioPath}'`)
  }
  nextAudio.setMasterVolume(muted ? 0 : 1)
  audio = nextAudio
  playbackOriginFrame = clamp(Math.round(targetFrame), 0, recording.audio.frameCount)
  sourceCursorFrame = playbackOriginFrame
  analyzedFrame = -1
  endedAtMs = null
  rhythmAnalyzer.reset()
  writePcmQueue()
  return paused || beginAudioPlayback()
}

function selectRecording(index: number, targetFrame = 0): void {
  if (recordings.length === 0) return
  recordingIndex = (index + recordings.length) % recordings.length
  paletteElapsedMs = 0
  displayedWordIndex = Number.NaN
  playbackError = null
  configureTrackAudio(targetFrame)
  applyPalette()
  updateView(true)
}

function seekToFrame(targetFrame: number): void {
  if (!audio) return
  const recording = currentRecording()
  const wasPlaying = !paused
  if (wasPlaying) audio.stop()
  if (!audio.enablePcmStream(streamCapacityFrames, recording.audio.channels)) {
    playbackError = "Could not reset PCM stream"
    paused = true
    updateView(true)
    return
  }
  playbackOriginFrame = clamp(Math.round(targetFrame), 0, recording.audio.frameCount)
  sourceCursorFrame = playbackOriginFrame
  analyzedFrame = -1
  endedAtMs = null
  displayedWordIndex = Number.NaN
  rhythmAnalyzer.reset()
  writePcmQueue()
  if (wasPlaying) beginAudioPlayback()
  updateView(true)
}

function seekBy(seconds: number): void {
  const recording = currentRecording()
  seekToFrame(playbackFrame() + seconds * recording.audio.sampleRate)
}

function togglePause(): void {
  if (!audio) return
  const atEnd = playbackFrame() >= currentRecording().audio.frameCount
  if (atEnd) {
    paused = false
    seekToFrame(0)
    return
  }
  paused = !paused
  if (paused) audio.stop()
  else beginAudioPlayback()
  updateView(true)
}

function toggleMute(): void {
  muted = !muted
  audio?.setMasterVolume(muted ? 0 : 1)
  updateView(true)
}

function transcriptContent(
  recording: AudioTextRecording,
  activeWordIndex: number,
  spokenWordIndex: number,
): StyledText {
  const currentLine = recording.transcript.words[Math.max(activeWordIndex, spokenWordIndex)]?.lineIndex ?? 0
  const chunks: TextChunk[] = []
  for (const part of recording.transcript.parts) {
    if (part.wordIndex == null) {
      chunks.push(fg(palette.shadow)(part.text))
      continue
    }
    let chunk: TextChunk
    if (part.wordIndex === activeWordIndex) {
      chunk = bold(bg(palette.accent)(fg(palette.background)(part.text)))
    } else if (part.wordIndex <= spokenWordIndex) {
      chunk = dim(fg(palette.shadow)(part.text))
    } else if (part.emphasis) {
      chunk = bold(fg(palette.accent)(part.text))
    } else if (part.lineIndex !== currentLine) {
      chunk = dim(fg(palette.shadow)(part.text))
    } else {
      chunk = fg(palette.foreground)(part.text)
    }
    chunks.push(chunk)
  }
  return new StyledText(chunks)
}

function syncTranscriptHeight(): void {
  if (!transcriptText) return
  transcriptText.height = Math.max(1, Math.min(MAX_TRANSCRIPT_ROWS, transcriptText.virtualLineCount))
}

function updateView(force = false): void {
  if (recordings.length === 0) return
  const recording = currentRecording()
  const frame = playbackFrame()
  const transcriptFrame = Math.min(
    recording.audio.frameCount,
    frame + Math.round((recording.audio.sampleRate * TRANSCRIPT_PRESENTATION_LEAD_MS) / 1000),
  )
  const spokenWordIndex = wordIndexAtFrame(recording.transcript.words, transcriptFrame)
  const activeWordIndex = activeWordIndexAtFrame(recording.transcript.words, transcriptFrame)
  if (force || activeWordIndex !== displayedWordIndex) {
    displayedWordIndex = activeWordIndex
    if (transcriptText) {
      transcriptText.content = transcriptContent(recording, activeWordIndex, spokenWordIndex)
      syncTranscriptHeight()
      const wordProgress =
        recording.transcript.words.length <= 1
          ? 0
          : Math.max(0, spokenWordIndex) / (recording.transcript.words.length - 1)
      transcriptText.scrollY = Math.round(transcriptText.maxScrollY * wordProgress)
    }
  }
  rendererInstance?.requestRender()
}

function analyzeAudio(frame: number, deltaTime: number): void {
  if (paused || frame === analyzedFrame) return
  const recording = currentRecording()
  const endFrame = Math.max(0, Math.min(recording.audio.frameCount, frame))
  const startFrame = Math.max(0, endFrame - ANALYSIS_FRAMES)
  rhythmAnalyzer.update(
    recording.audio.samples.subarray(startFrame * recording.audio.channels, endFrame * recording.audio.channels),
    recording.audio.channels,
    recording.audio.sampleRate,
    deltaTime,
  )
  analyzedFrame = frame
}

function fieldGlyph(strength: number): string {
  const glyphs = fieldGlyphStyle === "dots" ? DOT_FIELD_GLYPHS : SEXTANT_FIELD_GLYPHS
  return glyphs[Math.min(glyphs.length - 1, Math.floor(clamp(strength, 0, 1) * glyphs.length))]!
}

function clearField(buffer: OptimizedBuffer, originX: number, originY: number, width: number, height: number): void {
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      buffer.setCell(originX + column, originY + row, " ", fieldPalette.background, fieldPalette.background)
    }
  }
}

function renderLineVisualizer(
  buffer: OptimizedBuffer,
  originX: number,
  originY: number,
  width: number,
  height: number,
): void {
  clearField(buffer, originX, originY, width, height)
  const transcriptRows = transcriptText?.height ?? Math.min(MAX_TRANSCRIPT_ROWS, Math.max(1, height - 4))
  const transcriptTop = Math.max(0, (height - transcriptRows) * 0.5)
  const maximumLineRow = Math.max(0, Math.floor(transcriptTop) - 1)
  const lineCenter = maximumLineRow * 0.5
  const maxAmplitude = Math.max(0.5, maximumLineRow * 0.5)
  for (let column = 0; column < width; column += 1) {
    const position = column / Math.max(1, width - 1)
    const band = Math.min(rhythmAnalyzer.spectrum.length - 1, Math.floor(position * rhythmAnalyzer.spectrum.length))
    const level = rhythmAnalyzer.spectrum[band] ?? 0
    const heartbeatPosition = (position * 2 + fieldPhase * 0.08) % 1
    const heartbeat =
      Math.exp(-(((heartbeatPosition - 0.48) / 0.018) ** 2)) -
      Math.exp(-(((heartbeatPosition - 0.53) / 0.035) ** 2)) * 0.48
    const wave =
      Math.sin(position * Math.PI * 6 + fieldPhase * 2.2) * (0.12 + level * 0.88) +
      heartbeat * rhythmAnalyzer.pulse * 1.15
    const lineRow = clamp(Math.round(lineCenter + wave * maxAmplitude), 0, height - 1)
    const strength = clamp(0.12 + level * 0.72 + rhythmAnalyzer.pulse * Math.max(0, heartbeat) * 0.35, 0, 1)
    const color = level > 0.62 ? fieldPalette.accent : level > 0.18 ? fieldPalette.foreground : fieldPalette.shadow
    buffer.setCell(originX + column, originY + lineRow, fieldGlyph(strength), color, fieldPalette.background)
  }
}

function renderField(buffer: OptimizedBuffer, originX: number, originY: number, width: number, height: number): void {
  if (visualizerMode === "line") {
    renderLineVisualizer(buffer, originX, originY, width, height)
    return
  }
  const colors = fieldPalette
  const centerX = (width - 1) * 0.5
  const centerY = (height - 1) * 0.5
  const quietHalfHeight = (transcriptText?.height ?? Math.min(MAX_TRANSCRIPT_ROWS, Math.max(1, height - 4))) * 0.5 + 1.5
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const normalizedX = (column - centerX) / Math.max(1, centerX)
      const normalizedY = (row - centerY) / Math.max(1, centerY)
      const horizontalDistance = Math.abs(normalizedX)
      const band = Math.min(
        rhythmAnalyzer.spectrum.length - 1,
        Math.floor(horizontalDistance * rhythmAnalyzer.spectrum.length),
      )
      const bandLevel = rhythmAnalyzer.spectrum[band] ?? 0
      const presence = 1 - smoothstep((horizontalDistance - 0.62) / 0.38)
      const flow =
        Math.sin(normalizedX * 6.5 + fieldPhase) * rhythmAnalyzer.mid * 0.9 +
        Math.sin(normalizedX * 15 - fieldPhase * 1.4) * rhythmAnalyzer.treble * 0.52 +
        rhythmAnalyzer.stereoBalance * normalizedX * 0.7
      const voiceRadius = Math.min(
        Math.max(0.5, centerY - 0.5),
        quietHalfHeight +
          0.65 +
          presence *
            (rhythmAnalyzer.level * 0.85 + bandLevel * 2.35 + rhythmAnalyzer.pulse * (1 - horizontalDistance) * 0.7),
      )
      const voiceY = row - centerY - flow
      const contourDistance = Math.abs(voiceY + voiceRadius)
      const contour = (1 - smoothstep(contourDistance / (0.58 + bandLevel * 0.38))) * presence
      const noise = hashNoise(column * 0.81, row * 1.73)
      const voice = contour * (0.36 + rhythmAnalyzer.level * 0.35 + bandLevel * 0.82)
      const upperField = row < centerY
      const voiceVisible = upperField && noise < 0.18 + voice * 0.68
      const dustNoise = hashNoise(column * 1.37 + 17.17, row * 2.11 + 41.41)
      const ambientBand = Math.min(
        rhythmAnalyzer.spectrum.length - 1,
        Math.floor(clamp((horizontalDistance + Math.abs(normalizedY)) * 0.5, 0, 1) * rhythmAnalyzer.spectrum.length),
      )
      const ambientLevel = rhythmAnalyzer.spectrum[ambientBand] ?? 0
      const dustLevel = Math.max(ambientLevel, rhythmAnalyzer.treble * 0.65, rhythmAnalyzer.level * 0.28)
      const dust = upperField && dustNoise > 0.997 - dustLevel * 0.035 ? 0.13 + dustLevel * 0.58 : 0
      const strength = Math.max(voiceVisible ? voice : 0, dust)
      if (strength > 0.12) {
        const color = strength > 0.72 ? colors.accent : strength > 0.36 ? colors.foreground : colors.shadow
        buffer.setCell(originX + column, originY + row, fieldGlyph(strength), color, colors.background)
      } else {
        buffer.setCell(originX + column, originY + row, " ", colors.background, colors.background)
      }
    }
  }
}

function renderProgress(buffer: OptimizedBuffer, originX: number, originY: number, width: number): void {
  const recording = currentRecording()
  const progress = playbackFrame() / Math.max(1, recording.audio.frameCount)
  const head = Math.round(progress * Math.max(0, width - 1))
  for (let column = 0; column < width; column += 1) {
    const glyph = column === head ? "∙" : column < head ? "·" : " "
    buffer.setCell(originX + column, originY, glyph, fieldPalette.shadow, fieldPalette.background)
  }
}

function syncLayout(renderer: CliRenderer): void {
  if (!transcriptLayer || !transcriptText) return
  const layerWidth = Math.max(1, Math.min(96, renderer.width - 6))
  const contentWidth = Math.max(1, layerWidth - 6)
  transcriptLayer.width = layerWidth
  transcriptText.width = contentWidth
  syncTranscriptHeight()
  if (progressBar) {
    progressBar.width = contentWidth
    progressBar.left = Math.max(0, Math.floor((renderer.width - contentWidth) * 0.5))
  }
}

function updateHelpText(): void {
  if (!helpText) return
  helpText.content = [
    "Space       pause / resume playback",
    "← / →       seek -/+2s",
    "Shift+←/→   previous / next track",
    "N / P       next / previous track",
    "R           restart track",
    "M           mute / unmute",
    `L           appearance: ${appearanceMode}`,
    `V           visualizer: ${visualizerMode}`,
    `G           glyphs: ${fieldGlyphStyle}`,
    "? / Esc     close help",
    "Q           quit",
  ].join("\n")
}

function setHelpVisible(visible: boolean): void {
  helpVisible = visible
  if (helpOverlay) helpOverlay.visible = visible
  updateHelpText()
  rendererInstance?.requestRender()
}

function createHelpModal(renderer: CliRenderer): void {
  helpOverlay?.destroyRecursively()
  helpOverlay = new BoxRenderable(renderer, {
    id: "audio-text-cinema-help-overlay",
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: renderer.height < 12 ? "flex-start" : "center",
    visible: helpVisible,
    zIndex: 100,
    onMouseDown: () => setHelpVisible(false),
  })
  helpModal = new BoxRenderable(renderer, {
    id: "audio-text-cinema-help-modal",
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
    id: "audio-text-cinema-help-text",
    content: "",
    fg: palette.foreground,
    selectable: false,
  })
  helpModal.add(helpText)
  helpOverlay.add(helpModal)
  renderer.root.add(helpOverlay)
  updateHelpText()
}

function applyPalette(): void {
  palette = currentPalette()
  fieldPalette = createFieldPalette(palette)
  rendererInstance?.setBackgroundColor(palette.background)
  if (root) root.backgroundColor = palette.background
  if (helpModal) {
    helpModal.backgroundColor = palette.background
    helpModal.borderColor = palette.foreground
  }
  if (helpText) helpText.fg = palette.foreground
  updateView(true)
}

function createScene(renderer: CliRenderer): void {
  root = new BoxRenderable(renderer, {
    id: "audio-text-cinema",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: palette.background,
  })
  const stage = new BoxRenderable(renderer, {
    id: "audio-text-cinema-stage",
    width: "100%",
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  })
  const field = new VRenderable(renderer, {
    id: "audio-text-cinema-field",
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    render: (buffer, _deltaTime, renderable) =>
      renderField(buffer, renderable.x, renderable.y, renderable.width, renderable.height),
  })
  transcriptLayer = new BoxRenderable(renderer, {
    id: "audio-text-cinema-transcript-layer",
    width: Math.max(1, Math.min(96, renderer.width - 6)),
    paddingLeft: 3,
    paddingRight: 3,
    flexDirection: "column",
    zIndex: 2,
  })
  transcriptText = new TextRenderable(renderer, {
    id: "audio-text-cinema-transcript",
    width: Math.max(1, Math.min(90, renderer.width - 12)),
    height: Math.max(1, Math.min(MAX_TRANSCRIPT_ROWS, renderer.height - 4)),
    content: "",
    fg: palette.foreground,
    wrapMode: "word",
    selectable: true,
  })
  progressBar = new VRenderable(renderer, {
    id: "audio-text-cinema-progress",
    position: "absolute",
    left: Math.max(0, Math.floor((renderer.width - Math.max(1, Math.min(90, renderer.width - 12))) * 0.5)),
    bottom: PROGRESS_BOTTOM_MARGIN,
    width: Math.max(1, Math.min(90, renderer.width - 12)),
    height: 1,
    zIndex: 2,
    render: (buffer, _deltaTime, renderable) => renderProgress(buffer, renderable.x, renderable.y, renderable.width),
  })
  transcriptLayer.add(transcriptText)
  stage.add(field)
  stage.add(transcriptLayer)
  stage.add(progressBar)
  root.add(stage)
  renderer.root.add(root)
  syncLayout(renderer)
}

export async function run(renderer: CliRenderer, nextRecordings: readonly AudioTextRecording[]): Promise<void> {
  if (nextRecordings.length === 0) throw new Error("At least one audio/text recording is required")
  rendererInstance = renderer
  recordings = [...nextRecordings]
  recordingIndex = 0
  elapsedMs = 0
  fieldPhase = 0
  paletteElapsedMs = 0
  paletteAccumulatorMs = 0
  displayedWordIndex = Number.NaN
  analyzedFrame = -1
  endedAtMs = null
  paused = false
  muted = false
  playbackError = null
  helpVisible = false
  appearanceMode = "dark"
  fieldGlyphStyle = "dots"
  visualizerMode = "field"
  palette = currentPalette()
  fieldPalette = createFieldPalette(palette)
  createScene(renderer)
  createHelpModal(renderer)
  if (!configureTrackAudio(0)) throw new Error(playbackError ?? "Could not start audio playback")
  applyPalette()
  renderer.start()

  frameHandler = async (deltaTime: number) => {
    if (!audio) return
    elapsedMs += deltaTime
    if (!paused) paletteElapsedMs += deltaTime
    paletteAccumulatorMs += deltaTime
    writePcmQueue()
    const frame = playbackFrame()
    analyzeAudio(frame, deltaTime)
    if (!paused) {
      fieldPhase +=
        (deltaTime / 1000) * (rhythmAnalyzer.level * 0.9 + rhythmAnalyzer.mid * 0.45 + rhythmAnalyzer.pulse * 0.65)
    }
    updateView()

    const recording = currentRecording()
    if (!paused && sourceCursorFrame >= recording.audio.frameCount && audio.getPcmQueuedFrames() === 0) {
      endedAtMs ??= elapsedMs
      if (recordingIndex < recordings.length - 1 && elapsedMs - endedAtMs >= AUTO_ADVANCE_DELAY_MS) {
        selectRecording(recordingIndex + 1)
        return
      }
    }
    if (paletteAccumulatorMs >= PALETTE_UPDATE_MS) {
      paletteAccumulatorMs %= PALETTE_UPDATE_MS
      applyPalette()
    }
    renderer.requestRender()
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
      if (key.shift) selectRecording(recordingIndex + direction)
      else seekBy(direction * 2)
      key.preventDefault()
    } else if (key.name === "n" && !key.ctrl && !key.meta && !key.shift) {
      selectRecording(recordingIndex + 1)
      key.preventDefault()
    } else if (key.name === "p" && !key.ctrl && !key.meta && !key.shift) {
      selectRecording(recordingIndex - 1)
      key.preventDefault()
    } else if (key.name === "r" && !key.ctrl && !key.meta && !key.shift) {
      seekToFrame(0)
      key.preventDefault()
    } else if (key.name === "m" && !key.ctrl && !key.meta && !key.shift) {
      toggleMute()
      key.preventDefault()
    } else if (key.name === "l" && !key.ctrl && !key.meta && !key.shift) {
      appearanceMode = appearanceMode === "dark" ? "light" : "dark"
      applyPalette()
      updateHelpText()
      key.preventDefault()
    } else if (key.name === "v" && !key.ctrl && !key.meta && !key.shift) {
      visualizerMode = visualizerMode === "field" ? "line" : "field"
      updateHelpText()
      renderer.requestRender()
      key.preventDefault()
    } else if (key.name === "g" && !key.ctrl && !key.meta && !key.shift) {
      fieldGlyphStyle = fieldGlyphStyle === "dots" ? "sextants" : "dots"
      updateHelpText()
      renderer.requestRender()
      key.preventDefault()
    }
  }
  resizeHandler = () => {
    syncLayout(renderer)
    createHelpModal(renderer)
  }
  renderer.keyInput.on("keypress", keyHandler)
  renderer.on("resize", resizeHandler)
}

export function destroy(renderer: CliRenderer): void {
  if (frameHandler) renderer.removeFrameCallback(frameHandler)
  if (keyHandler) renderer.keyInput.off("keypress", keyHandler)
  if (resizeHandler) renderer.off("resize", resizeHandler)
  audio?.dispose()
  audio = null
  root?.destroyRecursively()
  helpOverlay?.destroyRecursively()
  renderer.setBackgroundColor("transparent")
  rendererInstance = null
  recordings = []
  root = null
  transcriptLayer = null
  transcriptText = null
  progressBar = null
  helpOverlay = null
  helpModal = null
  helpText = null
  helpVisible = false
  keyHandler = null
  resizeHandler = null
  frameHandler = null
}

const USAGE = `Usage:
  bun src/audio-text-cinema.ts <directory>
  bun src/audio-text-cinema.ts <one.txt> <one.wav> [<two.txt> <two.wav> ...]
  bun src/audio-text-cinema.ts --pair <text> <wav> [--pair <text> <wav> ...]

Directories and plain file lists are paired by matching basename. --pair allows different basenames.`

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${USAGE}\n`)
    process.exit(0)
  }

  try {
    const pairs = await resolveAudioTextPairs(args)
    const loadedRecordings = await loadAudioTextRecordings(pairs)
    const renderer = await createCliRenderer({
      exitOnCtrlC: true,
      targetFps: PRESENTATION_FPS,
      maxFps: PRESENTATION_FPS,
      onDestroy: () => {
        if (rendererInstance) destroy(rendererInstance)
      },
    })
    try {
      await run(renderer, loadedRecordings)
    } catch (error) {
      renderer.destroy()
      throw error
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Failed to start audio text cinema: ${message}\n${USAGE}\n`)
    process.exit(1)
  }
}
