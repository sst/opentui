#!/usr/bin/env bun

import {
  Audio,
  BoxRenderable,
  CliRenderer,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  bold,
  createCliRenderer,
  fg,
  t,
  type AudioGroup,
  type AudioStream,
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
const BAND_CENTERS = [60, 120, 250, 500, 1000, 2000, 4000, 8000]
const BAR_WIDTH = 20

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

function meter(value: number, width: number = BAR_WIDTH): string {
  const filled = Math.round(clamp(value, 0, 1) * width)
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`
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

class AudioStreamingDemo {
  private readonly renderer: CliRenderer
  private readonly root: BoxRenderable
  private readonly urlInput: InputRenderable
  private readonly stationButtons: Array<{ box: BoxRenderable; label: TextRenderable }> = []
  private readonly spectrumText: TextRenderable
  private readonly statsText: TextRenderable
  private readonly controlsText: TextRenderable
  private readonly audio: Audio
  private readonly fullGroup: AudioGroup
  private readonly dimGroup: AudioGroup
  private readonly fft = new FFT(FFT_SIZE)
  private readonly fftInput = new Float32Array(FFT_SIZE)
  private readonly fftOutput = this.fft.createComplexArray()
  private readonly fftWindow = new Float32Array(FFT_SIZE)
  private readonly spectrum = new Float32Array(BAND_CENTERS.length)
  private readonly frameCallback: (deltaMs: number) => Promise<void>

  private stream: AudioStream | null = null
  private streamController: AbortController | null = null
  private streamStats: AudioStreamStats | null = null
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
  private lastAnalyzedFrame = -1n
  private peak = 0
  private rms = 0

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.renderer.setBackgroundColor(PALETTE.background)

    for (let index = 0; index < FFT_SIZE; index += 1) {
      this.fftWindow[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1)))
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
    })
    this.spectrumText = new TextRenderable(renderer, {
      id: "audio-streaming-demo-spectrum",
      content: "",
      fg: PALETTE.signal,
      width: "100%",
      height: "100%",
    })
    spectrumPanel.add(this.spectrumText)

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
      minWidth: 30,
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

    this.urlInput.focus()
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
    this.spectrum.fill(0)
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
      nextStream = await this.audio.playStream(url, {
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
          retryOnEnd: true,
          initialDelayMs: 1000,
          maxDelayMs: 15_000,
          backoffFactor: 2,
        },
      })
    } catch (error) {
      if (this.destroyed || generation !== this.connectionGeneration) return
      this.statusMessage = error instanceof Error ? error.message : "Stream connection failed"
      this.statusColor = PALETTE.error
      this.refreshText()
      return
    }

    if (this.destroyed || generation !== this.connectionGeneration) {
      nextStream.dispose()
      return
    }

    this.stream = nextStream
    nextStream.on("error", (error) => {
      if (!this.isCurrent(nextStream, generation)) return
      this.streamStats = nextStream.getStats()
      this.statusMessage = error.message
      this.statusColor = PALETTE.error
    })
    nextStream.on("reconnecting", ({ attempt, delayMs, error }) => {
      if (!this.isCurrent(nextStream, generation)) return
      this.statusMessage = `Reconnect ${attempt} in ${delayMs}ms: ${error.message}`
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
    this.refreshText()
  }

  private computeSpectrum(pcm: Float32Array): void {
    for (let index = 0; index < FFT_SIZE; index += 1) {
      const left = pcm[index * 2] ?? 0
      const right = pcm[index * 2 + 1] ?? left
      this.fftInput[index] = (left + right) * 0.5 * this.fftWindow[index]
    }
    this.fft.realTransform(this.fftOutput, this.fftInput)

    const nyquist = SAMPLE_RATE / 2
    const magnitudes = new Float32Array(BAND_CENTERS.length)
    for (let band = 0; band < BAND_CENTERS.length; band += 1) {
      const center = BAND_CENTERS[band] ?? 60
      const previous = BAND_CENTERS[band - 1]
      const next = BAND_CENTERS[band + 1]
      const low = previous ? Math.sqrt(previous * center) : 30
      const high = next ? Math.sqrt(center * next) : nyquist
      const firstBin = Math.max(1, Math.floor((low / nyquist) * (FFT_SIZE / 2 - 1)))
      const lastBin = Math.min(FFT_SIZE / 2, Math.ceil((high / nyquist) * (FFT_SIZE / 2 - 1)))
      let total = 0
      let count = 0
      for (let bin = firstBin; bin < lastBin; bin += 1) {
        const real = this.fftOutput[bin * 2] ?? 0
        const imaginary = this.fftOutput[bin * 2 + 1] ?? 0
        total += Math.sqrt(real * real + imaginary * imaginary)
        count += 1
      }
      magnitudes[band] = count > 0 ? total / count : 0
    }

    const maximum = Math.max(0.00001, ...magnitudes)
    for (let index = 0; index < this.spectrum.length; index += 1) {
      const incoming = Math.pow((magnitudes[index] ?? 0) / maximum, 0.45)
      const previous = this.spectrum[index] ?? 0
      this.spectrum[index] = incoming > previous ? incoming : previous * 0.8 + incoming * 0.2
    }
  }

  private refreshText(): void {
    const state = this.streamStats?.state ?? (this.stream ? this.stream.state : "idle")

    const spectrumLines = [
      `Peak ${meter(this.peak)} ${this.peak.toFixed(3)}`,
      `RMS  ${meter(this.rms)} ${this.rms.toFixed(3)}`,
      "",
      ...BAND_CENTERS.map((frequency, index) => {
        const label = `${formatFrequency(frequency)} Hz`.padStart(6)
        return `${label} ${meter(this.spectrum[index] ?? 0)}`
      }),
    ]
    this.spectrumText.content = spectrumLines.join("\n")

    const stats = this.streamStats
    const capacityMs = stats && stats.sampleRate > 0 ? (stats.capacityFrames * 1000) / stats.sampleRate : 0
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
    const label = (value: string) => fg(PALETTE.muted)(value.padEnd(13))
    const underruns = stats?.underruns ?? 0
    const reconnects = stats?.reconnectAttempts ?? 0

    this.statsText.content = t`${label("state")}${bold(fg(stateColor)(state))}
${label("output")}${fg(PALETTE.accent)(this.outputMode)}
${label("status")}${fg(this.statusColor)(this.statusMessage)}
${label("buffer")}${fg(bufferColor)(`${stats?.bufferedDurationMs.toFixed(0) ?? "0"} / ${capacityMs.toFixed(0)} ms`)}
${label("")}${fg(bufferColor)(meter(bufferRatio, 16))}
${label("received")}${fg(PALETTE.accent)(formatBytes(stats?.bytesReceived ?? 0n))}
${label("decoded")}${fg(PALETTE.purple)(`${stats?.framesDecoded.toString() ?? "0"} frames`)}
${label("played")}${fg(PALETTE.signal)(`${stats?.framesPlayed.toString() ?? "0"} frames`)}
${label("underruns")}${fg(underruns > 0 ? PALETTE.error : PALETTE.muted)(underruns)}
${label("reconnects")}${fg(reconnects > 0 ? PALETTE.warning : PALETTE.muted)(reconnects)}
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
