#!/usr/bin/env bun

import {
  Audio,
  BoxRenderable,
  TextRenderable,
  bold,
  createCliRenderer,
  fg,
  t,
  type AudioCaptureDevice,
  type AudioCaptureStats,
  type AudioErrorContext,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core"
import { AUDIO_DEMO_PALETTE, AUDIO_SPECTRUM_FFT_SIZE, AudioSpectrumRenderable } from "./lib/AudioSpectrum.js"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const SAMPLE_RATE = 48_000
const CHANNELS = 1
const CAPACITY_FRAMES = SAMPLE_RATE
const READ_FRAMES = 2048
const MAX_READS_PER_UPDATE = 8
const VISUALIZATION_INTERVAL_MS = 50
const MAX_VISIBLE_DEVICES = 5

type CaptureState = "capturing" | "draining" | "stopped" | "unavailable"

function displayText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim() || "-"
}

class AudioCaptureDemo {
  private readonly renderer: CliRenderer
  private readonly root: BoxRenderable
  private readonly statusText: TextRenderable
  private readonly deviceButtons: Array<{ box: BoxRenderable; label: TextRenderable }> = []
  private readonly noDevicesText: TextRenderable
  private readonly spectrumPanel: AudioSpectrumRenderable
  private readonly statsText: TextRenderable
  private readonly controlsText: TextRenderable
  private readonly frameCallback: (deltaMs: number) => Promise<void>

  private audio: Audio | null = null
  private devices: AudioCaptureDevice[] = []
  private selectedDevice: AudioCaptureDevice | null = null
  private stats: AudioCaptureStats | null = null
  private visibleDeviceOffset = 0
  private statusMessage = "Initializing microphone capture"
  private statusColor: string = AUDIO_DEMO_PALETTE.warning
  private errorVersion = 0
  private peak = 0
  private rms = 0
  private consecutiveSilentFrames = 0
  private noSignalDetected = false
  private lastFramesRead = 0
  private visualizationElapsedMs = 0
  private captureRunning = false
  private captureDeviceOpen = false
  private canRead = false
  private intentionalStop = false
  private liveRequested = false
  private destroyed = false

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.renderer.setBackgroundColor(AUDIO_DEMO_PALETTE.background)

    this.root = new BoxRenderable(renderer, {
      id: "audio-capture-demo-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      gap: 0,
      backgroundColor: AUDIO_DEMO_PALETTE.background,
    })

    const inputPanel = new BoxRenderable(renderer, {
      id: "audio-capture-demo-input-panel",
      title: " MICROPHONE INPUT / native capture devices ",
      width: "100%",
      height: 6,
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      borderColor: AUDIO_DEMO_PALETTE.border,
      focusedBorderColor: AUDIO_DEMO_PALETTE.accent,
      backgroundColor: AUDIO_DEMO_PALETTE.panel,
      paddingLeft: 1,
      paddingRight: 1,
      flexShrink: 0,
    })
    this.statusText = new TextRenderable(renderer, {
      id: "audio-capture-demo-status",
      width: "100%",
      height: 1,
      content: "",
      fg: AUDIO_DEMO_PALETTE.text,
      flexShrink: 0,
      wrapMode: "none",
      truncate: true,
    })
    inputPanel.add(this.statusText)

    const deviceRow = new BoxRenderable(renderer, {
      id: "audio-capture-demo-devices",
      width: "100%",
      height: 3,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 0,
      flexShrink: 0,
    })
    for (let slot = 0; slot < MAX_VISIBLE_DEVICES; slot += 1) {
      const box = new BoxRenderable(renderer, {
        id: `audio-capture-demo-device-${slot + 1}`,
        height: 3,
        border: true,
        borderStyle: "single",
        borderColor: AUDIO_DEMO_PALETTE.border,
        backgroundColor: AUDIO_DEMO_PALETTE.panel,
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        alignItems: "center",
        justifyContent: "center",
        visible: false,
        onMouseDown: (event) => {
          event.stopPropagation()
          const device = this.devices[this.visibleDeviceOffset + slot]
          if (device) this.selectDevice(device)
        },
      })
      const label = new TextRenderable(renderer, {
        id: `audio-capture-demo-device-label-${slot + 1}`,
        content: "",
        fg: AUDIO_DEMO_PALETTE.muted,
        height: 1,
        wrapMode: "none",
        truncate: true,
      })
      box.add(label)
      deviceRow.add(box)
      this.deviceButtons.push({ box, label })
    }
    this.noDevicesText = new TextRenderable(renderer, {
      id: "audio-capture-demo-no-devices",
      content: "No capture inputs discovered. Press D to refresh.",
      fg: AUDIO_DEMO_PALETTE.error,
      height: 1,
      wrapMode: "none",
      truncate: true,
    })
    deviceRow.add(this.noDevicesText)
    inputPanel.add(deviceRow)
    this.root.add(inputPanel)

    const body = new BoxRenderable(renderer, {
      id: "audio-capture-demo-body",
      width: "100%",
      flexDirection: "row",
      flexGrow: 1,
      flexShrink: 1,
      gap: 0,
      minHeight: 12,
    })
    this.spectrumPanel = new AudioSpectrumRenderable(renderer, {
      id: "audio-capture-demo-spectrum-panel",
      sampleRate: SAMPLE_RATE,
      title: " Input spectrum / 48 kHz mono ",
      border: true,
      borderStyle: "rounded",
      borderColor: AUDIO_DEMO_PALETTE.signal,
      backgroundColor: AUDIO_DEMO_PALETTE.panel,
      paddingLeft: 1,
      paddingRight: 1,
      flexGrow: 2,
      flexBasis: 0,
      minWidth: 0,
    })

    const statsPanel = new BoxRenderable(renderer, {
      id: "audio-capture-demo-stats-panel",
      title: " Capture telemetry ",
      border: true,
      borderStyle: "rounded",
      borderColor: AUDIO_DEMO_PALETTE.purple,
      backgroundColor: AUDIO_DEMO_PALETTE.panel,
      paddingLeft: 1,
      paddingRight: 1,
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 30,
    })
    this.statsText = new TextRenderable(renderer, {
      id: "audio-capture-demo-stats",
      content: "",
      fg: AUDIO_DEMO_PALETTE.text,
      width: "100%",
      height: "100%",
      wrapMode: "none",
      truncate: true,
    })
    statsPanel.add(this.statsText)
    body.add(this.spectrumPanel)
    body.add(statsPanel)
    this.root.add(body)

    const controlsPanel = new BoxRenderable(renderer, {
      id: "audio-capture-demo-controls-panel",
      title: " Controls ",
      width: "100%",
      height: 4,
      border: true,
      borderStyle: "single",
      borderColor: AUDIO_DEMO_PALETTE.border,
      backgroundColor: AUDIO_DEMO_PALETTE.panel,
      paddingLeft: 1,
      paddingRight: 1,
      flexShrink: 0,
    })
    this.controlsText = new TextRenderable(renderer, {
      id: "audio-capture-demo-controls",
      content: "",
      fg: AUDIO_DEMO_PALETTE.muted,
      height: 2,
      wrapMode: "none",
      truncate: true,
    })
    controlsPanel.add(this.controlsText)
    this.root.add(controlsPanel)
    this.renderer.root.add(this.root)

    this.renderer.keyInput.on("keypress", this.handleKeyPress)
    this.frameCallback = async (deltaMs: number): Promise<void> => {
      this.updateFrame(deltaMs)
    }
    this.renderer.setFrameCallback(this.frameCallback)
    this.renderer.requestLive()
    this.liveRequested = true

    this.refreshControls()
    this.initializeCapture()
    this.refreshText()
  }

  private readonly handleAudioError = (error: Error, context: AudioErrorContext): void => {
    if (this.destroyed) return
    this.errorVersion += 1
    this.setStatus(`${context.action}: ${error.message}`, AUDIO_DEMO_PALETTE.error)
    this.refreshText()
  }

  private readonly handleCaptureStopped = (): void => {
    if (this.destroyed) return
    const externallyStopped = this.captureRunning && !this.intentionalStop
    this.captureRunning = false
    if (externallyStopped && this.statusColor !== AUDIO_DEMO_PALETTE.error) {
      this.setStatus("Input stopped externally; draining buffered PCM", AUDIO_DEMO_PALETTE.warning)
    }
    this.refreshText()
  }

  private initializeCapture(): void {
    try {
      const audio = Audio.create({ autoStart: false, sampleRate: SAMPLE_RATE })
      this.audio = audio
      audio.on("error", this.handleAudioError)
      audio.on("captureStopped", this.handleCaptureStopped)
      this.refreshDevices(true)
    } catch (error) {
      this.setStatus(
        error instanceof Error ? `Audio initialization failed: ${error.message}` : "Audio initialization failed",
        AUDIO_DEMO_PALETTE.error,
      )
    }
  }

  private setStatus(message: string, color: string): void {
    this.statusMessage = displayText(message)
    this.statusColor = color
  }

  private setFallbackError(version: number, message: string): void {
    if (this.errorVersion === version) this.setStatus(message, AUDIO_DEMO_PALETTE.error)
  }

  private closeCaptureForReset(): boolean {
    const audio = this.audio
    if (!audio) return false

    const nativeRunning = audio.isCapturing()
    this.captureRunning = nativeRunning
    if (!nativeRunning && !this.captureDeviceOpen && !this.canRead) return true

    const errorVersion = this.errorVersion
    this.intentionalStop = true
    let stopped = false
    try {
      stopped = audio.stopCapture()
    } finally {
      this.intentionalStop = false
    }
    if (!stopped) {
      this.setFallbackError(errorVersion, "Could not stop the current capture device")
      this.refreshText()
      return false
    }

    this.captureRunning = false
    this.captureDeviceOpen = false
    return true
  }

  private resetSignal(): void {
    this.canRead = false
    this.stats = null
    this.lastFramesRead = 0
    this.peak = 0
    this.rms = 0
    this.consecutiveSilentFrames = 0
    this.noSignalDetected = false
    this.spectrumPanel.reset()
  }

  private refreshDevices(startAfterRefresh: boolean): void {
    const audio = this.audio
    if (!audio || this.destroyed) return

    const previousSelection = this.selectedDevice
    const devices = audio.listCaptureDevices()
    if (devices == null) {
      if (this.statusColor !== AUDIO_DEMO_PALETTE.error) {
        this.setStatus("Could not refresh microphone inputs; current capture is unchanged", AUDIO_DEMO_PALETTE.error)
      }
      this.refreshText()
      return
    }
    if (!this.closeCaptureForReset()) return

    this.resetSignal()
    this.devices = devices
    if (devices.length === 0) {
      this.selectedDevice = null
      this.visibleDeviceOffset = 0
      this.setStatus("No microphone input is available; check OS permission and hardware", AUDIO_DEMO_PALETTE.error)
      this.refreshText()
      return
    }

    const device =
      (previousSelection
        ? (devices.find(
            (candidate) =>
              candidate.name === previousSelection.name && candidate.isDefault === previousSelection.isDefault,
          ) ?? devices.find((candidate) => candidate.name === previousSelection.name))
        : null) ??
      devices.find((candidate) => candidate.isDefault) ??
      devices[0]!

    const errorVersion = this.errorVersion
    if (!audio.selectCaptureDevice(device.index)) {
      this.setFallbackError(errorVersion, `Could not select ${displayText(device.name)}`)
      this.ensureSelectedDeviceVisible()
      this.refreshText()
      return
    }

    this.selectedDevice = device
    this.ensureSelectedDeviceVisible()
    if (startAfterRefresh) {
      this.startCapture()
    } else {
      this.setStatus(
        `Found ${devices.length} input${devices.length === 1 ? "" : "s"}; capture remains stopped`,
        AUDIO_DEMO_PALETTE.muted,
      )
      this.refreshText()
    }
  }

  private ensureSelectedDeviceVisible(): void {
    const selectedIndex = this.selectedDevice ? this.devices.indexOf(this.selectedDevice) : -1
    if (selectedIndex >= 0) {
      this.visibleDeviceOffset = Math.floor(selectedIndex / MAX_VISIBLE_DEVICES) * MAX_VISIBLE_DEVICES
      return
    }
    const lastPage = Math.max(0, Math.floor((this.devices.length - 1) / MAX_VISIBLE_DEVICES) * MAX_VISIBLE_DEVICES)
    this.visibleDeviceOffset = Math.min(this.visibleDeviceOffset, lastPage)
  }

  private selectDevice(device: AudioCaptureDevice): void {
    const audio = this.audio
    if (!audio || this.destroyed || !this.devices.includes(device)) return
    if (device === this.selectedDevice && this.captureRunning) {
      this.setStatus(`Already capturing ${displayText(device.name)}`, AUDIO_DEMO_PALETTE.signal)
      this.refreshText()
      return
    }
    if (device === this.selectedDevice) {
      this.restartCapture()
      return
    }
    if (!this.closeCaptureForReset()) return

    this.resetSignal()
    const errorVersion = this.errorVersion
    if (!audio.selectCaptureDevice(device.index)) {
      this.setFallbackError(errorVersion, `Could not select ${displayText(device.name)}`)
      this.refreshText()
      return
    }

    this.selectedDevice = device
    this.ensureSelectedDeviceVisible()
    this.startCapture()
  }

  private cycleDevice(direction: -1 | 1): void {
    if (this.devices.length === 0) return
    let selectedIndex = this.selectedDevice ? this.devices.indexOf(this.selectedDevice) : -1
    if (selectedIndex < 0 && this.selectedDevice) {
      selectedIndex = this.devices.findIndex((device) => device.name === this.selectedDevice?.name)
    }
    const nextIndex =
      selectedIndex < 0
        ? direction > 0
          ? 0
          : this.devices.length - 1
        : (selectedIndex + direction + this.devices.length) % this.devices.length
    const device = this.devices[nextIndex]
    if (device) this.selectDevice(device)
  }

  private startCapture(): void {
    const audio = this.audio
    const device = this.selectedDevice
    if (!audio || !device || this.destroyed) return

    const errorVersion = this.errorVersion
    if (!audio.startCapture({ channels: CHANNELS, capacityFrames: CAPACITY_FRAMES })) {
      this.captureRunning = false
      this.captureDeviceOpen = false
      this.canRead = false
      this.setFallbackError(errorVersion, "Capture failed; check the selected input and OS microphone permission")
      this.refreshText()
      return
    }

    this.captureRunning = true
    this.captureDeviceOpen = true
    this.canRead = true
    this.setStatus(`Capturing ${displayText(device.name)}`, AUDIO_DEMO_PALETTE.signal)
    const stats = audio.getCaptureStats()
    if (stats) this.stats = stats
    this.refreshText()
  }

  private stopAndDrain(): void {
    const audio = this.audio
    if (!audio || this.destroyed) return

    this.captureRunning = audio.isCapturing()
    if (this.captureRunning || this.captureDeviceOpen) {
      const errorVersion = this.errorVersion
      this.intentionalStop = true
      let stopped = false
      try {
        stopped = audio.stopCapture()
      } finally {
        this.intentionalStop = false
      }
      if (!stopped) {
        this.setFallbackError(errorVersion, "Could not stop microphone capture")
        this.refreshText()
        return
      }
      this.captureRunning = false
      this.captureDeviceOpen = false
    }

    if (this.statusColor !== AUDIO_DEMO_PALETTE.error) {
      this.setStatus(
        this.canRead ? "Capture stopped; draining buffered PCM" : "Capture is stopped",
        this.canRead ? AUDIO_DEMO_PALETTE.warning : AUDIO_DEMO_PALETTE.muted,
      )
    }
    this.refreshText()
  }

  private restartCapture(): void {
    if (!this.audio || !this.selectedDevice || this.destroyed) {
      this.setStatus("No microphone input is selected", AUDIO_DEMO_PALETTE.error)
      this.refreshText()
      return
    }
    if (!this.closeCaptureForReset()) return
    this.resetSignal()
    this.startCapture()
  }

  private refreshDeviceEnumeration(): void {
    const audio = this.audio
    if (!audio || this.destroyed) return
    const restartAfterRefresh = audio.isCapturing()
    this.captureRunning = restartAfterRefresh
    this.refreshDevices(restartAfterRefresh)
  }

  private handleKeyPress = (key: KeyEvent): void => {
    if (key.ctrl || key.meta) return

    const slot = Number.parseInt(key.name, 10) - 1
    if (key.name.length === 1 && slot >= 0 && slot < MAX_VISIBLE_DEVICES) {
      const device = this.devices[this.visibleDeviceOffset + slot]
      if (device) {
        key.preventDefault()
        this.selectDevice(device)
      }
      return
    }

    switch (key.name) {
      case "[":
        key.preventDefault()
        this.cycleDevice(-1)
        break
      case "]":
        key.preventDefault()
        this.cycleDevice(1)
        break
      case "d":
        key.preventDefault()
        this.refreshDeviceEnumeration()
        break
      case "r":
        key.preventDefault()
        this.restartCapture()
        break
      case "s":
        key.preventDefault()
        this.stopAndDrain()
        break
    }
  }

  private decaySignal(): void {
    this.peak = this.peak < 0.0001 ? 0 : this.peak * 0.78
    this.rms = this.rms < 0.0001 ? 0 : this.rms * 0.78
    this.spectrumPanel.update({ mode: "decay", peak: this.peak, rms: this.rms })
  }

  private updateFrame(deltaMs: number): void {
    if (this.destroyed) return
    this.visualizationElapsedMs += deltaMs
    if (this.visualizationElapsedMs < VISUALIZATION_INTERVAL_MS) return
    this.visualizationElapsedMs %= VISUALIZATION_INTERVAL_MS

    const audio = this.audio
    if (!audio) {
      this.decaySignal()
      this.refreshText()
      return
    }

    const nativeRunning = audio.isCapturing()
    this.captureRunning = nativeRunning
    if (!this.canRead) {
      this.lastFramesRead = 0
      this.decaySignal()
      this.refreshText()
      return
    }

    let totalFramesRead = 0
    let totalSamplesRead = 0
    let sumSquares = 0
    let peak = 0
    let finalReadSize = 0
    let spectrumPcm: Float32Array | null = null

    for (let readIndex = 0; readIndex < MAX_READS_PER_UPDATE; readIndex += 1) {
      const result = audio.readCaptureFrames(READ_FRAMES)
      if (result == null) {
        this.canRead = false
        this.lastFramesRead = 0
        if (this.captureDeviceOpen) {
          this.intentionalStop = true
          try {
            if (audio.stopCapture()) {
              this.captureRunning = false
              this.captureDeviceOpen = false
            } else {
              this.captureRunning = audio.isCapturing()
            }
          } finally {
            this.intentionalStop = false
          }
        }
        this.decaySignal()
        this.refreshText()
        return
      }

      const framesRead = Math.min(result.framesRead, READ_FRAMES, Math.floor(result.frames.length / CHANNELS))
      const sampleCount = framesRead * CHANNELS
      finalReadSize = framesRead
      totalFramesRead += framesRead
      totalSamplesRead += sampleCount
      if (framesRead >= AUDIO_SPECTRUM_FFT_SIZE) spectrumPcm = result.frames

      for (let index = 0; index < sampleCount; index += 1) {
        const sample = result.frames[index] ?? 0
        peak = Math.max(peak, Math.abs(sample))
        sumSquares += sample * sample
      }
      if (framesRead < READ_FRAMES) break
    }

    this.lastFramesRead = totalFramesRead
    if (totalSamplesRead > 0) {
      this.peak = peak
      this.rms = Math.sqrt(sumSquares / totalSamplesRead)
      if (nativeRunning && peak === 0) {
        this.consecutiveSilentFrames += totalFramesRead
        if (!this.noSignalDetected && this.consecutiveSilentFrames >= SAMPLE_RATE) {
          this.noSignalDetected = true
          if (this.statusColor !== AUDIO_DEMO_PALETTE.error) {
            this.setStatus(
              "No input signal: allow microphone access for the host terminal/app, or check input mute and routing",
              AUDIO_DEMO_PALETTE.warning,
            )
          }
        }
      } else {
        this.consecutiveSilentFrames = 0
        if (this.noSignalDetected && peak > 0) {
          this.noSignalDetected = false
          this.setStatus(
            `Signal detected from ${displayText(this.selectedDevice?.name ?? "selected input")}`,
            AUDIO_DEMO_PALETTE.signal,
          )
        }
      }
      if (spectrumPcm) {
        this.spectrumPanel.update({
          mode: "analyze",
          pcm: spectrumPcm,
          framesRead: AUDIO_SPECTRUM_FFT_SIZE,
          channels: CHANNELS,
          peak: this.peak,
          rms: this.rms,
        })
      } else {
        this.spectrumPanel.update({ mode: "hold", peak: this.peak, rms: this.rms })
      }
    } else {
      this.decaySignal()
    }

    const stats = audio.getCaptureStats()
    if (stats) this.stats = stats
    if (!nativeRunning && finalReadSize === 0) {
      this.canRead = false
      if (this.statusColor !== AUDIO_DEMO_PALETTE.error) {
        this.setStatus("Capture stopped; buffered PCM drained", AUDIO_DEMO_PALETTE.muted)
      }
    }
    this.refreshText()
  }

  private captureState(): CaptureState {
    if (!this.audio || !this.selectedDevice) return "unavailable"
    if (this.captureRunning) return "capturing"
    if (this.canRead) return "draining"
    return "stopped"
  }

  private refreshDeviceButtons(): void {
    for (const [slot, button] of this.deviceButtons.entries()) {
      const device = this.devices[this.visibleDeviceOffset + slot]
      button.box.visible = device != null
      if (!device) continue

      const selected = device === this.selectedDevice
      button.box.borderColor = selected ? AUDIO_DEMO_PALETTE.accent : AUDIO_DEMO_PALETTE.border
      button.box.backgroundColor = selected ? AUDIO_DEMO_PALETTE.panelAlt : AUDIO_DEMO_PALETTE.panel
      button.label.fg = selected ? AUDIO_DEMO_PALETTE.signal : AUDIO_DEMO_PALETTE.muted
      button.label.content = `${slot + 1} ${device.isDefault ? "*" : ""}${displayText(device.name)}`
    }
    this.noDevicesText.visible = this.devices.length === 0
  }

  private refreshText(): void {
    const state = this.captureState()
    const stateColor =
      state === "capturing"
        ? AUDIO_DEMO_PALETTE.signal
        : state === "draining"
          ? AUDIO_DEMO_PALETTE.warning
          : state === "unavailable"
            ? AUDIO_DEMO_PALETTE.error
            : AUDIO_DEMO_PALETTE.muted
    const firstVisible = this.devices.length === 0 ? 0 : this.visibleDeviceOffset + 1
    const lastVisible = Math.min(this.visibleDeviceOffset + MAX_VISIBLE_DEVICES, this.devices.length)
    const deviceRange =
      this.devices.length > MAX_VISIBLE_DEVICES
        ? `${firstVisible}-${lastVisible}/${this.devices.length} inputs`
        : `${this.devices.length} input${this.devices.length === 1 ? "" : "s"}`
    this.statusText.content = t`${bold(fg(stateColor)(state.toUpperCase()))} ${fg(AUDIO_DEMO_PALETTE.muted)(deviceRange)}  ${fg(this.statusColor)(displayText(this.statusMessage))}`

    this.refreshDeviceButtons()

    const stats = this.stats
    const sampleRate = stats?.sampleRate ?? SAMPLE_RATE
    const channels = stats?.channels ?? CHANNELS
    const capacityFrames = stats?.capacityFrames ?? CAPACITY_FRAMES
    const bufferedFrames = stats?.bufferedFrames ?? 0
    const bufferRatio = capacityFrames > 0 ? bufferedFrames / capacityFrames : 0
    const bufferedMs = sampleRate > 0 ? (bufferedFrames / sampleRate) * 1000 : 0
    const bufferColor =
      bufferRatio >= 0.85
        ? AUDIO_DEMO_PALETTE.error
        : bufferRatio >= 0.5
          ? AUDIO_DEMO_PALETTE.warning
          : AUDIO_DEMO_PALETTE.signal
    const received = stats?.framesReceived ?? 0n
    const read = stats?.framesRead ?? 0n
    const dropped = stats?.framesDropped ?? 0n
    const lossBasisPoints = received > 0n ? Number((dropped * 10_000n) / received) : 0
    const lossPercent = (lossBasisPoints / 100).toFixed(2)
    const healthColor = this.noSignalDetected
      ? AUDIO_DEMO_PALETTE.warning
      : dropped === 0n
        ? received > 0n
          ? AUDIO_DEMO_PALETTE.signal
          : AUDIO_DEMO_PALETTE.muted
        : lossBasisPoints >= 100
          ? AUDIO_DEMO_PALETTE.error
          : AUDIO_DEMO_PALETTE.warning
    const health = this.noSignalDetected
      ? "NO SIGNAL"
      : dropped === 0n
        ? received > 0n
          ? "HEALTHY"
          : "WAITING"
        : lossBasisPoints >= 100
          ? "LOSS CRITICAL"
          : "LOSS"
    const healthDetail = this.noSignalDetected ? "check permission / mute / routing" : `loss ${lossPercent}%`
    const label = (value: string) => fg(AUDIO_DEMO_PALETTE.muted)(value.padEnd(10))

    this.statsText.content = t`${label("state")}${bold(fg(stateColor)(state))}
${label("input")}${fg(AUDIO_DEMO_PALETTE.accent)(displayText(this.selectedDevice?.name ?? "-"))}
${label("status")}${fg(this.statusColor)(displayText(this.statusMessage))}
${label("format")}${fg(AUDIO_DEMO_PALETTE.accent)(`${sampleRate} Hz / ${channels === 1 ? "mono" : `${channels} ch`}`)}
${label("drained")}${fg(AUDIO_DEMO_PALETTE.purple)(`${this.lastFramesRead} frames / tick`)}
${label("buffer")}${fg(bufferColor)(`${bufferedFrames}/${capacityFrames} f  ${bufferedMs.toFixed(0)}ms  ${Math.round(bufferRatio * 100)}%`)}
${label("received")}${fg(AUDIO_DEMO_PALETTE.accent)(`${received.toString()} frames`)}
${label("read")}${fg(AUDIO_DEMO_PALETTE.signal)(`${read.toString()} frames`)}
${label("dropped")}${fg(dropped > 0n ? healthColor : AUDIO_DEMO_PALETTE.muted)(`${dropped.toString()} frames`)}
${label("health")}${bold(fg(healthColor)(health))} ${fg(healthColor)(healthDetail)}`
  }

  private refreshControls(): void {
    const exitControl = import.meta.main ? "Ctrl+C quit" : "Esc back"
    this.controlsText.content = t`${bold(fg(AUDIO_DEMO_PALETTE.warning)("S"))} ${fg(AUDIO_DEMO_PALETTE.muted)("stop+drain")}  ${bold(fg(AUDIO_DEMO_PALETTE.signal)("R"))} ${fg(AUDIO_DEMO_PALETTE.muted)("restart")}  ${bold(fg(AUDIO_DEMO_PALETTE.purple)("D"))} ${fg(AUDIO_DEMO_PALETTE.muted)("refresh")}
${bold(fg(AUDIO_DEMO_PALETTE.accent)("1-5"))} ${fg(AUDIO_DEMO_PALETTE.muted)("select")}  ${bold(fg(AUDIO_DEMO_PALETTE.accent)("[/]"))} ${fg(AUDIO_DEMO_PALETTE.muted)("cycle")}  ${fg(AUDIO_DEMO_PALETTE.muted)("click input")}  ${fg(AUDIO_DEMO_PALETTE.border)("|")} ${fg(AUDIO_DEMO_PALETTE.text)(exitControl)}`
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    this.renderer.removeFrameCallback(this.frameCallback)
    if (this.liveRequested) {
      this.renderer.dropLive()
      this.liveRequested = false
    }
    this.renderer.keyInput.off("keypress", this.handleKeyPress)

    const audio = this.audio
    this.audio = null
    if (audio) {
      audio.off("error", this.handleAudioError)
      audio.off("captureStopped", this.handleCaptureStopped)
      audio.stopCapture()
      audio.dispose()
    }
    this.captureRunning = false
    this.captureDeviceOpen = false
    this.canRead = false
    if (!this.root.isDestroyed) this.root.destroyRecursively()
  }
}

let activeDemo: AudioCaptureDemo | null = null

export function run(renderer: CliRenderer): void {
  activeDemo?.destroy()
  activeDemo = new AudioCaptureDemo(renderer)
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
