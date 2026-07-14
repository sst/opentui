#!/usr/bin/env bun

import {
  Audio,
  AudioStreamError,
  BoxRenderable,
  CliRenderer,
  InputRenderable,
  InputRenderableEvents,
  OptimizedBuffer,
  RGBA,
  TextAttributes,
  TextRenderable,
  bold,
  createCliRenderer,
  fg,
  t,
  type AudioGroup,
  type AudioStream,
  type AudioStreamMetadata,
  type AudioStreamStats,
  type KeyEvent,
} from "@opentui/core"
import FFT from "fft.js"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const DEMO_STATIONS = [
  { name: "FIP", url: "https://icecast.radiofrance.fr/fip-midfi.mp3" },
  { name: "WFMU", url: "https://stream0.wfmu.org/freeform-128k" },
  { name: "NPO Radio 5", url: "https://icecast.omroep.nl/radio5-bb-mp3" },
  { name: "NPR", url: "https://npr-ice.streamguys1.com/live.mp3" },
  { name: "Dance Wave", url: "https://dancewave.online/dance.mp3" },
] as const
const DEFAULT_STREAM_URL = DEMO_STATIONS[0].url
const SAMPLE_RATE = 48_000
const FFT_SIZE = 2048
const FFT_UPDATE_MS = 50
const VOLUME_STEP = 0.1
const PAN_STEP = 0.1
const BAND_CENTERS = [63, 160, 400, 1000, 2500, 6000, 12000, 16000]
const FFT_PEAK_FALLOFF = 0.04
const FFT_DB_FLOOR = -72
const FFT_DB_CEILING = 0

const FFT_BAR_RGB = [
  [244, 63, 94],
  [249, 115, 22],
  [250, 204, 21],
  [74, 222, 128],
  [45, 212, 191],
  [56, 189, 248],
  [129, 140, 248],
  [192, 132, 252],
] as const

const BUFFER_COLORS = {
  peak: RGBA.fromInts(251, 113, 133),
  rms: RGBA.fromInts(56, 189, 248),
  value: RGBA.fromInts(226, 232, 240),
  muted: RGBA.fromInts(124, 145, 163),
}
const FFT_LABEL_COLORS = FFT_BAR_RGB.map(([red, green, blue]) => RGBA.fromInts(red, green, blue))

const PALETTE = {
  background: "#071018",
  panel: "#0C1824",
  panelAlt: "#102231",
  border: "#28465C",
  accent: "#38BDF8",
  signal: "#34D399",
  warning: "#FBBF24",
  error: "#FB7185",
  text: "#E2E8F0",
  muted: "#7C91A3",
  purple: "#C4B5FD",
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function formatBytes(value: bigint): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return `${value.toString()} B`
  if (bytes < 1024) return `${bytes.toFixed(0)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function formatFrequency(value: number): string {
  return value >= 1000 ? `${value / 1000}k` : value.toString()
}

function displayMetadata(value: string | undefined): string {
  const sanitized = value?.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim()
  return sanitized || "-"
}

function writeBufferRgb(buffer: Uint16Array, index: number, red: number, green: number, blue: number): void {
  buffer[index] = ((buffer[index] ?? 0) & 0xff00) | red
  buffer[index + 1] = ((buffer[index + 1] ?? 0) & 0xff00) | green
  buffer[index + 2] = ((buffer[index + 2] ?? 0) & 0xff00) | blue
}

class AudioStreamingDemo {
  private readonly renderer: CliRenderer
  private readonly root: BoxRenderable
  private readonly urlInput: InputRenderable
  private readonly stationButtons: Array<{ box: BoxRenderable; label: TextRenderable }> = []
  private readonly statsText: TextRenderable
  private readonly controlsText: TextRenderable
  private readonly audio: Audio
  private readonly fullGroup: AudioGroup
  private readonly dimGroup: AudioGroup
  private readonly fft = new FFT(FFT_SIZE)
  private readonly fftInput = new Float32Array(FFT_SIZE)
  private readonly fftOutput = this.fft.createComplexArray()
  private readonly fftWindow = new Float32Array(FFT_SIZE)
  private readonly fftMagnitudes = new Float32Array(BAND_CENTERS.length)
  private readonly spectrum = new Float32Array(BAND_CENTERS.length)
  private readonly spectrumPeaks = new Float32Array(BAND_CENTERS.length)
  private readonly frameCallback: (deltaMs: number) => Promise<void>

  private stream: AudioStream | null = null
  private streamController: AbortController | null = null
  private streamStats: AudioStreamStats | null = null
  private streamMetadata: AudioStreamMetadata | null = null
  private connectionGeneration = 0
  private destroyed = false
  private liveRequested = false
  private outputMode = "starting"
  private statusMessage = "Initializing native audio"
  private statusColor = PALETTE.warning
  private selectedStationIndex = 0
  private volume = 0.8
  private pan = 0
  private useDimGroup = false
  private fftElapsedMs = 0
  private fftWindowSum = 0
  private lastAnalyzedFrame = -1n
  private peak = 0
  private rms = 0

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.renderer.setBackgroundColor(PALETTE.background)

    for (let index = 0; index < FFT_SIZE; index += 1) {
      const windowValue = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1)))
      this.fftWindow[index] = windowValue
      this.fftWindowSum += windowValue
    }

    this.root = new BoxRenderable(renderer, {
      id: "audio-streaming-demo-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      gap: 0,
      backgroundColor: PALETTE.background,
    })

    const inputPanel = new BoxRenderable(renderer, {
      id: "audio-streaming-demo-input-panel",
      title: " LIVE MP3 STREAM / URL + station presets ",
      width: "100%",
      height: 6,
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      borderColor: PALETTE.border,
      focusedBorderColor: PALETTE.accent,
      backgroundColor: PALETTE.panel,
      paddingLeft: 1,
      paddingRight: 1,
      flexShrink: 0,
    })
    this.urlInput = new InputRenderable(renderer, {
      id: "audio-streaming-demo-url",
      width: "100%",
      flexShrink: 0,
      value: DEFAULT_STREAM_URL,
      placeholder: "https://example.com/live.mp3",
      maxLength: 2048,
      backgroundColor: PALETTE.panel,
      focusedBackgroundColor: PALETTE.panelAlt,
      textColor: PALETTE.text,
      focusedTextColor: "#FFFFFF",
      placeholderColor: PALETTE.muted,
      cursorColor: PALETTE.accent,
    })
    inputPanel.add(this.urlInput)

    const stationRow = new BoxRenderable(renderer, {
      id: "audio-streaming-demo-stations",
      width: "100%",
      height: 3,
      flexDirection: "row",
      gap: 0,
      flexShrink: 0,
    })
    for (const [index, station] of DEMO_STATIONS.entries()) {
      const box = new BoxRenderable(renderer, {
        id: `audio-streaming-demo-station-${index + 1}`,
        border: true,
        borderStyle: "single",
        borderColor: index === this.selectedStationIndex ? PALETTE.accent : PALETTE.border,
        backgroundColor: index === this.selectedStationIndex ? PALETTE.panelAlt : PALETTE.panel,
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        alignItems: "center",
        justifyContent: "center",
        onMouseDown: (event) => {
          event.stopPropagation()
          this.selectStation(index)
        },
      })
      const label = new TextRenderable(renderer, {
        id: `audio-streaming-demo-station-label-${index + 1}`,
        content: `${index + 1} ${station.name}`,
        fg: index === this.selectedStationIndex ? PALETTE.signal : PALETTE.muted,
        height: 1,
      })
      box.add(label)
      stationRow.add(box)
      this.stationButtons.push({ box, label })
    }
    inputPanel.add(stationRow)
    this.root.add(inputPanel)

    const body = new BoxRenderable(renderer, {
      id: "audio-streaming-demo-body",
      width: "100%",
      flexDirection: "row",
      flexGrow: 1,
      flexShrink: 1,
      gap: 0,
      minHeight: 12,
    })

    const demo = this
    const spectrumPanel = new BoxRenderable(renderer, {
      id: "audio-streaming-demo-spectrum-panel",
      title: " Master mix spectrum ",
      border: true,
      borderStyle: "rounded",
      borderColor: PALETTE.signal,
      backgroundColor: PALETTE.panel,
      paddingLeft: 1,
      paddingRight: 1,
      flexGrow: 2,
      flexBasis: 0,
      minWidth: 0,
      renderAfter(buffer) {
        demo.renderSpectrum(buffer, this)
      },
    })

    const statsPanel = new BoxRenderable(renderer, {
      id: "audio-streaming-demo-stats-panel",
      title: " Stream telemetry ",
      border: true,
      borderStyle: "rounded",
      borderColor: PALETTE.purple,
      backgroundColor: PALETTE.panel,
      paddingLeft: 1,
      paddingRight: 1,
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 40,
    })
    this.statsText = new TextRenderable(renderer, {
      id: "audio-streaming-demo-stats",
      content: "",
      fg: PALETTE.text,
      width: "100%",
      height: "100%",
    })
    statsPanel.add(this.statsText)

    body.add(spectrumPanel)
    body.add(statsPanel)
    this.root.add(body)

    const controlsPanel = new BoxRenderable(renderer, {
      id: "audio-streaming-demo-controls-panel",
      title: " Controls ",
      width: "100%",
      height: 4,
      border: true,
      borderStyle: "single",
      borderColor: PALETTE.border,
      backgroundColor: PALETTE.panel,
      paddingLeft: 1,
      paddingRight: 1,
      flexShrink: 0,
    })
    this.controlsText = new TextRenderable(renderer, {
      id: "audio-streaming-demo-controls",
      content: "",
      fg: PALETTE.muted,
      height: 2,
    })
    controlsPanel.add(this.controlsText)
    this.root.add(controlsPanel)

    this.renderer.root.add(this.root)

    this.audio = Audio.create({ autoStart: false, sampleRate: SAMPLE_RATE })
    this.audio.on("error", (error, context) => {
      if (this.destroyed) return
      this.statusMessage = `${context.action}: ${error.message}`
      this.statusColor = PALETTE.error
      this.refreshText()
    })

    this.fullGroup = this.audio.group("stream-full") ?? 0
    this.dimGroup = this.audio.group("stream-dim") ?? 0
    this.audio.setGroupVolume(this.fullGroup, 1)
    this.audio.setGroupVolume(this.dimGroup, 0.35)
    this.audio.enableTap(8192)

    if (this.audio.start()) {
      this.outputMode = "native device"
      this.statusMessage = "Audio output started"
    } else if (this.audio.startMixer()) {
      this.outputMode = "mixer only"
      this.statusMessage = "No playback device; visualization remains active"
    } else {
      this.outputMode = "unavailable"
      this.statusMessage = "Audio mixer could not start"
    }

    this.urlInput.on(InputRenderableEvents.ENTER, (value: string) => {
      this.urlInput.blur()
      this.refreshControls()
      void this.connect(value)
    })
    this.renderer.keyInput.on("keypress", this.handleKeyPress)

    this.frameCallback = async (deltaMs: number): Promise<void> => {
      this.updateFrame(deltaMs)
    }
    this.renderer.setFrameCallback(this.frameCallback)
    this.renderer.requestLive()
    this.liveRequested = true

    this.refreshText()
    void this.connect(DEFAULT_STREAM_URL)
  }

  private activeGroup(): AudioGroup {
    return this.useDimGroup ? this.dimGroup : this.fullGroup
  }

  private parseStreamUrl(rawValue: string): URL | null {
    const value = rawValue.trim()
    if (value.length === 0) {
      this.statusMessage = "Enter an MP3 stream URL"
      this.statusColor = PALETTE.error
      return null
    }

    try {
      const url = new URL(value)
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        this.statusMessage = "Stream URL must use http or https"
        this.statusColor = PALETTE.error
        return null
      }
      return url
    } catch {
      this.statusMessage = "Stream URL is not valid"
      this.statusColor = PALETTE.error
      return null
    }
  }

  private async connect(rawUrl: string): Promise<void> {
    const url = this.parseStreamUrl(rawUrl)
    if (!url || this.destroyed) {
      if (!url && !this.stream && this.streamController) {
        this.connectionGeneration += 1
        this.streamController.abort()
        this.streamController = null
      }
      this.refreshText()
      return
    }

    this.selectedStationIndex = DEMO_STATIONS.findIndex((station) => station.url === url.href)
    this.refreshStationButtons()
    const sourceName = this.selectedStationIndex >= 0 ? DEMO_STATIONS[this.selectedStationIndex]!.name : url.host

    const generation = ++this.connectionGeneration
    this.streamController?.abort()
    this.streamController = new AbortController()
    this.stream?.dispose()
    this.stream = null
    this.streamStats = null
    this.streamMetadata = null
    this.spectrum.fill(0)
    this.spectrumPeaks.fill(0)
    this.lastAnalyzedFrame = 0n
    this.peak = 0
    this.rms = 0
    this.audio.disableTap()
    this.audio.enableTap(8192)
    this.statusMessage = `Connecting to ${sourceName}`
    this.statusColor = PALETTE.warning
    this.refreshText()

    let nextStream: AudioStream
    try {
      nextStream = await this.audio.playStreamUrl(url, {
        format: "mp3",
        signal: this.streamController.signal,
        volume: this.volume,
        pan: this.pan,
        groupId: this.activeGroup(),
        buffer: {
          capacityMs: 2000,
          startupMs: 1000,
          resumeMs: 1000,
        },
        reconnect: {
          maxRetries: 5,
          retryOnEnd: true,
          initialDelayMs: 1000,
          maxDelayMs: 15_000,
          backoffFactor: 2,
        },
      })
    } catch (error) {
      if (this.destroyed || generation !== this.connectionGeneration) return
      this.statusMessage =
        error instanceof AudioStreamError
          ? `${error.context.action}: ${error.message}`
          : error instanceof Error
            ? error.message
            : "Stream connection failed"
      this.statusColor = PALETTE.error
      this.refreshText()
      return
    }

    if (this.destroyed || generation !== this.connectionGeneration) {
      nextStream.dispose()
      return
    }

    this.stream = nextStream
    this.streamMetadata = nextStream.getMetadata()
    nextStream.on("metadata", (metadata) => {
      if (!this.isCurrent(nextStream, generation)) return
      this.streamMetadata = metadata
      this.refreshText()
    })
    nextStream.on("error", (error, context) => {
      if (!this.isCurrent(nextStream, generation)) return
      this.streamStats = nextStream.getStats()
      this.statusMessage = `${context.action}: ${error.message}`
      this.statusColor = PALETTE.error
    })
    nextStream.on("reconnecting", ({ attempt, delayMs, error }) => {
      if (!this.isCurrent(nextStream, generation)) return
      this.statusMessage = `Reconnect ${attempt} in ${delayMs}ms: ${error.context.action}: ${error.message}`
      this.statusColor = PALETTE.warning
    })
    nextStream.on("ended", () => {
      if (!this.isCurrent(nextStream, generation)) return
      this.streamStats = nextStream.getStats()
      this.statusMessage = "Stream ended"
      this.statusColor = PALETTE.muted
    })

    const volumeApplied = nextStream.setVolume(this.volume)
    const panApplied = nextStream.setPan(this.pan)
    const groupApplied = nextStream.setGroup(this.activeGroup())
    this.streamStats = nextStream.getStats()
    if (volumeApplied && panApplied && groupApplied) {
      this.statusMessage = `Connected to ${sourceName}`
      this.statusColor = PALETTE.accent
    } else {
      this.statusMessage = "Connected, but current stream controls could not be applied"
      this.statusColor = PALETTE.error
    }
    this.refreshText()
  }

  private isCurrent(stream: AudioStream, generation: number): boolean {
    return !this.destroyed && this.stream === stream && this.connectionGeneration === generation
  }

  private selectStation(index: number): void {
    const station = DEMO_STATIONS[index]
    if (!station) return
    this.urlInput.value = station.url
    this.urlInput.blur()
    this.refreshControls()
    void this.connect(station.url)
  }

  private refreshStationButtons(): void {
    for (const [index, button] of this.stationButtons.entries()) {
      const selected = index === this.selectedStationIndex
      button.box.borderColor = selected ? PALETTE.accent : PALETTE.border
      button.box.backgroundColor = selected ? PALETTE.panelAlt : PALETTE.panel
      button.label.fg = selected ? PALETTE.signal : PALETTE.muted
    }
  }

  private stopStream(): void {
    this.connectionGeneration += 1
    this.streamController?.abort()
    this.streamController = null
    this.stream?.dispose()
    this.stream = null
    this.streamStats = null
    this.streamMetadata = null
    this.lastAnalyzedFrame = -1n
    this.statusMessage = "Stream stopped"
    this.statusColor = PALETTE.muted
    this.refreshText()
  }

  private adjustVolume(delta: number): void {
    const next = clamp(this.volume + delta, 0, 4)
    if (this.stream && !this.stream.setVolume(next)) {
      this.statusMessage = "Could not update stream volume"
      this.statusColor = PALETTE.error
      return
    }
    this.volume = next
    this.statusMessage = `Stream volume ${this.volume.toFixed(1)}`
    this.statusColor = PALETTE.accent
    this.refreshText()
  }

  private adjustPan(delta: number): void {
    const next = clamp(this.pan + delta, -1, 1)
    if (this.stream && !this.stream.setPan(next)) {
      this.statusMessage = "Could not update stream pan"
      this.statusColor = PALETTE.error
      return
    }
    this.pan = next
    this.statusMessage = `Stream pan ${this.pan.toFixed(1)}`
    this.statusColor = PALETTE.accent
    this.refreshText()
  }

  private toggleGroup(): void {
    const nextDimmed = !this.useDimGroup
    const nextGroup = nextDimmed ? this.dimGroup : this.fullGroup
    if (this.stream && !this.stream.setGroup(nextGroup)) {
      this.statusMessage = "Could not move the stream to another group"
      this.statusColor = PALETTE.error
      return
    }
    this.useDimGroup = nextDimmed
    this.statusMessage = nextDimmed ? "Stream routed through 35% group" : "Stream routed through full group"
    this.statusColor = PALETTE.accent
    this.refreshText()
  }

  private handleKeyPress = (key: KeyEvent): void => {
    if (key.name === "tab") {
      key.preventDefault()
      if (this.urlInput.focused) this.urlInput.blur()
      else this.urlInput.focus()
      this.refreshControls()
      return
    }

    if (this.urlInput.focused || key.ctrl || key.meta) return

    const stationIndex = Number.parseInt(key.name, 10) - 1
    if (key.name.length === 1 && stationIndex >= 0 && stationIndex < DEMO_STATIONS.length) {
      key.preventDefault()
      this.selectStation(stationIndex)
      return
    }

    switch (key.name) {
      case "r":
        key.preventDefault()
        void this.connect(this.urlInput.value)
        break
      case "s":
        key.preventDefault()
        this.stopStream()
        break
      case "j":
        key.preventDefault()
        this.adjustVolume(-VOLUME_STEP)
        break
      case "k":
        key.preventDefault()
        this.adjustVolume(VOLUME_STEP)
        break
      case "h":
        key.preventDefault()
        this.adjustPan(-PAN_STEP)
        break
      case "l":
        key.preventDefault()
        this.adjustPan(PAN_STEP)
        break
      case "g":
        key.preventDefault()
        this.toggleGroup()
        break
    }
  }

  private updateFrame(deltaMs: number): void {
    if (this.destroyed) return
    if (!this.audio.isStarted() && this.audio.isMixerStarted()) {
      const frameCount = Math.max(64, Math.min(2048, Math.round((SAMPLE_RATE * deltaMs) / 1000)))
      this.audio.mixFrames(frameCount, 2)
    }

    this.fftElapsedMs += deltaMs
    if (this.fftElapsedMs < FFT_UPDATE_MS) return
    this.fftElapsedMs %= FFT_UPDATE_MS

    if (this.stream) this.streamStats = this.stream.getStats()
    const engineStats = this.audio.getStats()
    this.peak = engineStats?.lastPeak ?? 0
    this.rms = engineStats?.lastRms ?? 0

    const playedFrames = this.streamStats?.framesPlayed ?? -1n
    if (playedFrames > 0n && playedFrames !== this.lastAnalyzedFrame) {
      this.lastAnalyzedFrame = playedFrames
      const tap = this.audio.readTapFrames(FFT_SIZE, 2)
      if (tap && tap.framesRead >= FFT_SIZE) this.computeSpectrum(tap.frames)
    } else {
      for (let index = 0; index < this.spectrum.length; index += 1) this.spectrum[index] *= 0.94
    }
    for (let index = 0; index < this.spectrumPeaks.length; index += 1) {
      this.spectrumPeaks[index] = Math.max(
        this.spectrum[index] ?? 0,
        (this.spectrumPeaks[index] ?? 0) - FFT_PEAK_FALLOFF,
      )
    }
    this.refreshText()
  }

  private computeSpectrum(pcm: Float32Array): void {
    for (let index = 0; index < FFT_SIZE; index += 1) {
      const left = pcm[index * 2] ?? 0
      const right = pcm[index * 2 + 1] ?? left
      this.fftInput[index] = (left + right) * 0.5 * this.fftWindow[index]
    }
    this.fft.realTransform(this.fftOutput, this.fftInput)

    const magnitudes = this.fftMagnitudes
    for (let band = 0; band < BAND_CENTERS.length; band += 1) {
      const center = BAND_CENTERS[band] ?? 60
      const previous = BAND_CENTERS[band - 1]
      const next = BAND_CENTERS[band + 1]
      const low = previous ? Math.sqrt(previous * center) : center / Math.sqrt((next ?? center * 2) / center)
      const high = next ? Math.sqrt(center * next) : center * Math.sqrt(center / (previous ?? center / 2))
      const firstBin = Math.max(1, Math.floor((low * FFT_SIZE) / SAMPLE_RATE))
      const lastBin = Math.min(FFT_SIZE / 2, Math.ceil((high * FFT_SIZE) / SAMPLE_RATE))
      let maximum = 0
      for (let bin = firstBin; bin < lastBin; bin += 1) {
        const real = this.fftOutput[bin * 2] ?? 0
        const imaginary = this.fftOutput[bin * 2 + 1] ?? 0
        maximum = Math.max(maximum, (2 * Math.sqrt(real * real + imaginary * imaginary)) / this.fftWindowSum)
      }
      magnitudes[band] = maximum
    }

    // A fixed dBFS scale preserves level changes instead of pinning each frame's strongest band.
    for (let index = 0; index < this.spectrum.length; index += 1) {
      const decibels = 20 * Math.log10(Math.max(magnitudes[index] ?? 0, 1e-8))
      const incoming = clamp((decibels - FFT_DB_FLOOR) / (FFT_DB_CEILING - FFT_DB_FLOOR), 0, 1)
      const previous = this.spectrum[index] ?? 0
      this.spectrum[index] = incoming > previous ? incoming : previous * 0.8 + incoming * 0.2
    }
  }

  private renderSpectrum(buffer: OptimizedBuffer, panel: BoxRenderable): void {
    const innerX = panel.x + 1
    const innerY = panel.y + 1
    const innerWidth = Math.max(0, panel.width - 2)
    const innerHeight = Math.max(0, panel.height - 2)
    if (innerWidth < 8 || innerHeight < 4) return

    const backgrounds = buffer.buffers.bg
    this.renderLevelMeter(
      buffer,
      backgrounds,
      innerX,
      innerY,
      innerWidth,
      "PEAK",
      this.peak,
      BUFFER_COLORS.peak,
      [251, 113, 133],
    )
    this.renderLevelMeter(
      buffer,
      backgrounds,
      innerX,
      innerY + 1,
      innerWidth,
      "RMS",
      this.rms,
      BUFFER_COLORS.rms,
      [56, 189, 248],
    )

    const showLabels = innerHeight >= 7
    const labelY = innerY + innerHeight - 1
    const barsTop = innerY + 2
    const barsBottom = showLabels ? labelY - 1 : innerY + innerHeight - 1
    const availableHeight = barsBottom - barsTop + 1
    if (availableHeight <= 0) return

    const bandCount = Math.min(BAND_CENTERS.length, innerWidth)
    const gap = innerWidth >= bandCount * 3 ? 1 : 0
    const barWidth = Math.max(1, Math.floor((innerWidth - gap * (bandCount - 1)) / bandCount))
    const totalWidth = bandCount * barWidth + (bandCount - 1) * gap
    const offsetX = innerX + Math.max(0, Math.floor((innerWidth - totalWidth) / 2))

    for (let bar = 0; bar < bandCount; bar += 1) {
      const band = bandCount === 1 ? 0 : Math.round((bar * (BAND_CENTERS.length - 1)) / (bandCount - 1))
      const level = clamp(this.spectrum[band] ?? 0, 0, 1)
      const peak = clamp(this.spectrumPeaks[band] ?? 0, 0, 1)
      const filledHeight = level * availableHeight
      const rows = Math.ceil(filledHeight)
      const [baseRed, baseGreen, baseBlue] = FFT_BAR_RGB[band] ?? FFT_BAR_RGB[0]
      const xStart = offsetX + bar * (barWidth + gap)

      for (let row = 0; row < rows; row += 1) {
        const y = barsBottom - row
        const coverage = Math.min(1, filledHeight - row)
        const heightRatio = availableHeight <= 1 ? 1 : row / (availableHeight - 1)
        const intensity = (0.42 + heightRatio * 0.58) * (0.35 + coverage * 0.65)
        const red = Math.round(baseRed * intensity)
        const green = Math.round(baseGreen * intensity)
        const blue = Math.round(baseBlue * intensity)
        for (let x = xStart; x < xStart + barWidth; x += 1) {
          writeBufferRgb(backgrounds, (y * buffer.width + x) * 4, red, green, blue)
        }
      }

      if (peak > 0.01) {
        const peakY = barsBottom - Math.round(peak * Math.max(0, availableHeight - 1))
        const peakRed = Math.round(baseRed * 0.45 + 140)
        const peakGreen = Math.round(baseGreen * 0.45 + 140)
        const peakBlue = Math.round(baseBlue * 0.45 + 140)
        for (let x = xStart; x < xStart + barWidth; x += 1) {
          writeBufferRgb(backgrounds, (peakY * buffer.width + x) * 4, peakRed, peakGreen, peakBlue)
        }
      }

      if (showLabels && bandCount === BAND_CENTERS.length && barWidth >= 3) {
        const label = formatFrequency(BAND_CENTERS[band] ?? 0)
        const labelX = xStart + Math.max(0, Math.floor((barWidth - label.length) / 2))
        buffer.drawText(label, labelX, labelY, FFT_LABEL_COLORS[band] ?? BUFFER_COLORS.muted)
      }
    }
  }

  private renderLevelMeter(
    buffer: OptimizedBuffer,
    backgrounds: Uint16Array,
    x: number,
    y: number,
    width: number,
    label: string,
    value: number,
    labelColor: RGBA,
    rgb: readonly [number, number, number],
  ): void {
    const valueText = value.toFixed(3)
    const valueX = x + width - valueText.length
    const meterX = x + label.length + 1
    const meterWidth = Math.max(0, valueX - meterX - 1)
    const filled = Math.round(clamp(value, 0, 1) * meterWidth)

    for (let column = 0; column < meterWidth; column += 1) {
      const active = column < filled
      const progress = meterWidth <= 1 ? 1 : column / (meterWidth - 1)
      const intensity = active ? 0.45 + progress * 0.55 : 0.16
      writeBufferRgb(
        backgrounds,
        (y * buffer.width + meterX + column) * 4,
        Math.round(rgb[0] * intensity),
        Math.round(rgb[1] * intensity),
        Math.round(rgb[2] * intensity),
      )
    }

    buffer.drawText(label, x, y, labelColor, undefined, TextAttributes.BOLD)
    buffer.drawText(valueText, valueX, y, BUFFER_COLORS.value)
  }

  private refreshText(): void {
    const state = this.streamStats?.state ?? (this.stream ? this.stream.state : "idle")

    const stats = this.streamStats
    const bufferRatio = stats && stats.capacityFrames > 0 ? stats.bufferedFrames / stats.capacityFrames : 0
    const stateColor =
      state === "playing"
        ? PALETTE.signal
        : state === "errored"
          ? PALETTE.error
          : state === "idle" || state === "ended" || state === "disposed"
            ? PALETTE.muted
            : PALETTE.warning
    const bufferColor = bufferRatio >= 0.5 ? PALETTE.signal : bufferRatio > 0 ? PALETTE.warning : PALETTE.muted
    const label = (value: string) => fg(PALETTE.muted)(value.padEnd(9))
    const underruns = stats?.underruns ?? 0
    const reconnects = stats?.reconnectAttempts ?? 0
    const station = displayMetadata(this.streamMetadata?.headers["icy-name"])
    const title = displayMetadata(this.streamMetadata?.fields.StreamTitle)

    this.statsText.content = t`${label("state")}${bold(fg(stateColor)(state))}
${label("output")}${fg(PALETTE.accent)(this.outputMode)}
${label("status")}${fg(this.statusColor)(displayMetadata(this.statusMessage))}
${label("station")}${fg(PALETTE.accent)(station)}
${label("title")}${fg(PALETTE.signal)(title)}
${label("buffer")}${fg(bufferColor)(`${stats?.bufferedDurationMs.toFixed(0) ?? "0"}ms ${Math.round(bufferRatio * 100)}%`)}
${label("received")}${fg(PALETTE.accent)(formatBytes(stats?.bytesReceived ?? 0n))}
${label("decoded")}${fg(PALETTE.purple)(`${stats?.framesDecoded.toString() ?? "0"} frames`)}
${label("played")}${fg(PALETTE.signal)(`${stats?.framesPlayed.toString() ?? "0"} frames`)}
${label("health")}${fg(underruns > 0 ? PALETTE.error : PALETTE.muted)(`u:${underruns}`)}  ${fg(reconnects > 0 ? PALETTE.warning : PALETTE.muted)(`r:${reconnects}`)}
${label("volume")}${fg(PALETTE.accent)(this.volume.toFixed(1))}  ${fg(PALETTE.muted)("pan")} ${fg(PALETTE.purple)(this.pan.toFixed(1))}
${label("group")}${fg(PALETTE.signal)(this.useDimGroup ? "dim (35%)" : "full")}`
    this.refreshControls()
  }

  private refreshControls(): void {
    const mode = this.urlInput.focused ? "URL EDIT" : "CONTROLS"
    this.controlsText.content =
      `${mode} | 1-5 stations | Enter connect | Tab edit/controls | R reconnect | S stop\n` +
      `J/K volume (${this.volume.toFixed(1)}) | H/L pan (${this.pan.toFixed(1)}) | G group (${this.useDimGroup ? "dim" : "full"}) | Esc back`
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.connectionGeneration += 1
    this.streamController?.abort()
    this.streamController = null
    this.stream?.dispose()
    this.stream = null

    this.renderer.removeFrameCallback(this.frameCallback)
    if (this.liveRequested) {
      this.renderer.dropLive()
      this.liveRequested = false
    }
    this.renderer.keyInput.off("keypress", this.handleKeyPress)
    this.urlInput.blur()
    this.audio.dispose()
    if (!this.root.isDestroyed) this.root.destroyRecursively()
  }
}

let activeDemo: AudioStreamingDemo | null = null

export function run(renderer: CliRenderer): void {
  activeDemo?.destroy()
  activeDemo = new AudioStreamingDemo(renderer)
}

export function destroy(_renderer: CliRenderer): void {
  activeDemo?.destroy()
  activeDemo = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
  renderer.start()
}
