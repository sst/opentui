#!/usr/bin/env bun

import {
  Audio,
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  type AudioCaptureDevice,
  type AudioCaptureStats,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const CHANNELS = 1
const READ_FRAMES = 2048
const POLL_INTERVAL_MS = 40
const METER_WIDTH = 44
const MAX_VISIBLE_DEVICES = 8

function displayText(value: string, maxLength = 72): string {
  const sanitized = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim()
  return sanitized.length <= maxLength ? sanitized : `${sanitized.slice(0, maxLength - 3)}...`
}

function meter(value: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * METER_WIDTH)
  return `[${"#".repeat(filled)}${"-".repeat(METER_WIDTH - filled)}]`
}

class AudioCaptureDemo {
  private readonly renderer: CliRenderer
  private readonly root: BoxRenderable
  private readonly view: TextRenderable
  private readonly frameCallback: (deltaMs: number) => Promise<void>
  private audio: Audio | null = null
  private devices: AudioCaptureDevice[] = []
  private selectedDevice: AudioCaptureDevice | null = null
  private stats: AudioCaptureStats | null = null
  private status = "Initializing microphone capture"
  private peak = 0
  private rms = 0
  private lastFramesRead = 0
  private elapsedMs = 0
  private canRead = false
  private liveRequested = false
  private destroyed = false

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.renderer.setBackgroundColor("#09131A")

    this.root = new BoxRenderable(renderer, {
      id: "audio-capture-demo-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      padding: 1,
      backgroundColor: "#09131A",
      border: true,
      borderStyle: "rounded",
      borderColor: "#2DD4BF",
      title: " NATIVE AUDIO CAPTURE ",
    })
    this.view = new TextRenderable(renderer, {
      id: "audio-capture-demo-view",
      width: "100%",
      height: "100%",
      content: "",
      fg: "#D8F3F0",
    })
    this.root.add(this.view)
    this.renderer.root.add(this.root)

    this.renderer.keyInput.on("keypress", this.handleKeyPress)
    this.frameCallback = async (deltaMs: number): Promise<void> => {
      this.update(deltaMs)
    }
    this.renderer.setFrameCallback(this.frameCallback)
    this.renderer.requestLive()
    this.liveRequested = true

    this.initializeCapture()
    this.refresh()
  }

  private initializeCapture(): void {
    try {
      const audio = Audio.create({ autoStart: false })
      this.audio = audio
      audio.on("error", (error, context) => {
        if (this.destroyed) return
        this.status = `${context.action}: ${error.message}`
        this.refresh()
      })

      const devices = audio.listCaptureDevices()
      if (devices == null) {
        this.status = "Could not enumerate capture devices"
        return
      }

      this.devices = devices
      this.selectedDevice = devices.find((device) => device.isDefault) ?? devices[0] ?? null
      if (!this.selectedDevice) {
        this.status = "No microphone input device is available"
        return
      }

      if (!audio.selectCaptureDevice(this.selectedDevice.index)) {
        this.status = `Could not select ${displayText(this.selectedDevice.name)}`
        return
      }

      this.startCapture()
    } catch (error) {
      this.status = error instanceof Error ? error.message : "Audio initialization failed"
    }
  }

  private startCapture(): void {
    if (!this.audio || !this.selectedDevice) return
    if (this.audio.isCapturing()) return

    this.peak = 0
    this.rms = 0
    this.lastFramesRead = 0
    this.stats = null
    this.canRead = false

    if (!this.audio.startCapture({ channels: CHANNELS })) {
      this.status = "Microphone capture failed; check the input device and OS permission"
      this.refresh()
      return
    }

    this.canRead = true
    this.status = `Capturing ${displayText(this.selectedDevice.name)}`
    this.stats = this.audio.getCaptureStats()
    this.refresh()
  }

  private stopCapture(): void {
    if (!this.audio) return
    if (!this.audio.stopCapture()) return
    this.status = this.canRead ? "Capture stopped; draining buffered PCM" : "Capture stopped"
    this.refresh()
  }

  private restartCapture(): void {
    if (!this.audio || !this.selectedDevice) return
    if (this.audio.isCapturing() && !this.audio.stopCapture()) return
    this.startCapture()
  }

  private update(deltaMs: number): void {
    if (this.destroyed || !this.audio || !this.canRead) return
    this.elapsedMs += deltaMs
    if (this.elapsedMs < POLL_INTERVAL_MS) return
    this.elapsedMs %= POLL_INTERVAL_MS

    const result = this.audio.readCaptureFrames(READ_FRAMES)
    if (result == null) {
      this.canRead = false
      return
    }

    this.lastFramesRead = result.framesRead
    const validSampleCount = result.framesRead * CHANNELS
    let peak = 0
    let sumSquares = 0
    for (let index = 0; index < validSampleCount; index += 1) {
      const sample = result.frames[index] ?? 0
      peak = Math.max(peak, Math.abs(sample))
      sumSquares += sample * sample
    }
    this.peak = peak
    this.rms = validSampleCount > 0 ? Math.sqrt(sumSquares / validSampleCount) : 0

    const stats = this.audio.getCaptureStats()
    if (stats) this.stats = stats
    if (!this.audio.isCapturing() && (this.stats?.bufferedFrames ?? 0) === 0) {
      this.canRead = false
      this.status = "Capture stopped; buffer drained"
    }
    this.refresh()
  }

  private handleKeyPress = (key: KeyEvent): void => {
    if (key.ctrl || key.meta) return
    if (key.name === "s") {
      key.preventDefault()
      this.stopCapture()
    } else if (key.name === "r") {
      key.preventDefault()
      this.restartCapture()
    }
  }

  private refresh(): void {
    const deviceLines = this.devices.slice(0, MAX_VISIBLE_DEVICES).map((device) => {
      const selected = device.index === this.selectedDevice?.index ? ">" : " "
      const defaultMark = device.isDefault ? "default" : "       "
      return `${selected} [${defaultMark}] ${displayText(device.name)}`
    })
    if (deviceLines.length === 0) deviceLines.push("  (no capture devices found)")
    if (this.devices.length > MAX_VISIBLE_DEVICES) {
      deviceLines.push(`  ... ${this.devices.length - MAX_VISIBLE_DEVICES} more devices`)
    }

    const stats = this.stats
    const state = this.audio?.isCapturing() ? "CAPTURING" : "STOPPED"
    this.view.content = `Status  ${displayText(this.status, 100)}
State   ${state}

Capture devices (${this.devices.length})
${deviceLines.join("\n")}

Peak ${meter(this.peak)} ${this.peak.toFixed(3)}
RMS  ${meter(this.rms)} ${this.rms.toFixed(3)}

Chunk     ${this.lastFramesRead}/${READ_FRAMES} frames
Format    ${stats?.sampleRate ?? this.audio?.sampleRate ?? 0} Hz, ${stats?.channels ?? CHANNELS} channel
Buffer    ${stats?.bufferedFrames ?? 0}/${stats?.capacityFrames ?? 0} frames
Received  ${stats?.framesReceived.toString() ?? "0"} frames
Read      ${stats?.framesRead.toString() ?? "0"} frames
Dropped   ${stats?.framesDropped.toString() ?? "0"} frames

S stop and drain | R restart (resets buffer) | Esc back`
    this.renderer.requestRender()
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
    this.audio?.stopCapture()
    this.audio?.dispose()
    this.audio = null
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
