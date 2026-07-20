#!/usr/bin/env bun

import { opendir, readFile, stat } from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"
import {
  Audio,
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type CliRenderer,
  StyledText,
  TextRenderable,
  createCliRenderer,
  fg,
  type AudioErrorContext,
  type AudioSound,
  type AudioVoice,
  type KeyEvent,
  type SelectOption,
} from "@opentui/core"
import FFT from "fft.js"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const SAMPLE_RATE = 48_000
const FFT_SIZE = 2048
const FFT_UPDATE_MS = 50
const FFT_DB_FLOOR = -72
const FFT_DB_CEILING = 0
const FFT_PEAK_FALLOFF_PER_SECOND = 0.8
const BAND_CENTERS = [63, 160, 400, 1000, 2500, 6000, 12000, 16000] as const
const SUPPORTED_AUDIO_EXTENSIONS = new Set([".flac", ".mp3", ".wav", ".wave"])
const MAX_AUDIO_FILE_BYTES = 256 * 1024 * 1024
const MAX_PICKER_ENTRIES = 4096
const LOGO_ROWS = ["▄▄▄ ▄▄▄ ▄▄▄ ▄▄  █▄▄ ▄ ▄ ▄", "█ █ █ █ █ ▀ █ █ █ ▄ █ █ █", "▀▀▀ █▀▀ ▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀ ▀"] as const
const LOGO_WIDTH = Math.max(...LOGO_ROWS.map((row) => [...row].length))
const DEFAULT_LOGO_COLORS = ["#FF5C5C", "#FF9F43", "#FFE66D", "#5EF38C", "#46C7FF", "#788BFF", "#D875FF"] as const
const SPECTRUM_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const

interface Groove {
  name: string
  bpm: number
  swing: number
  kick: string
  snare: string
  hat: string
}

const GROOVES: readonly Groove[] = [
  {
    name: "BOOM BAP",
    bpm: 92,
    swing: 0.08,
    kick: "x-----x-x-----x-",
    snare: "----x-------x---",
    hat: "x-x-x-x-x-x-x-x-",
  },
  {
    name: "DUSTY POCKET",
    bpm: 84,
    swing: 0.18,
    kick: "x-----x---x---x-",
    snare: "----x-------x---",
    hat: "x-x-xxx-x-x-xxx-",
  },
  {
    name: "LATE NIGHT",
    bpm: 104,
    swing: 0.12,
    kick: "x--x----x-----x-",
    snare: "----x-------x---",
    hat: "x-xxx-x-x-xxx-x-",
  },
] as const

type Drum = "kick" | "snare" | "hat"

type FilePickerEntryType = "parent" | "directory" | "file" | "empty"

interface FilePickerEntry {
  type: FilePickerEntryType
  path: string
  name: string
}

interface FilePickerOption extends SelectOption {
  value: FilePickerEntry
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function sanitizeDisplayText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim()
}

function isSupportedAudioFile(fileName: string): boolean {
  return SUPPORTED_AUDIO_EXTENSIONS.has(extname(fileName).toLowerCase())
}

async function classifyPickerEntry(
  directory: string,
  name: string,
  isDirectory: boolean,
  isFile: boolean,
): Promise<FilePickerEntry | null> {
  if (name.startsWith(".")) return null
  const entryPath = join(directory, name)
  if (isDirectory) return { type: "directory", path: entryPath, name }
  if (isFile) return isSupportedAudioFile(name) ? { type: "file", path: entryPath, name } : null

  try {
    const entryStats = await stat(entryPath)
    if (entryStats.isDirectory()) return { type: "directory", path: entryPath, name }
    if (entryStats.isFile() && isSupportedAudioFile(name)) return { type: "file", path: entryPath, name }
  } catch {
    return null
  }
  return null
}

function pickerOption(entry: FilePickerEntry): FilePickerOption {
  return {
    name: `${sanitizeDisplayText(entry.name)}${entry.type === "directory" ? "/" : ""}`,
    description: "",
    value: entry,
  }
}

function hsvColor(hue: number, saturation: number, value: number): string {
  const segment = (((hue % 1) + 1) % 1) * 6
  const chroma = value * saturation
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1))
  const minimum = value - chroma
  const [red, green, blue] =
    segment < 1
      ? [chroma, secondary, 0]
      : segment < 2
        ? [secondary, chroma, 0]
        : segment < 3
          ? [0, chroma, secondary]
          : segment < 4
            ? [0, secondary, chroma]
            : segment < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary]
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round((channel + minimum) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

function randomLogoColors(): string[] {
  const startingHue = Math.random()
  return DEFAULT_LOGO_COLORS.map((_color, index) =>
    hsvColor(startingHue + index / DEFAULT_LOGO_COLORS.length + (Math.random() - 0.5) * 0.06, 0.62, 0.96),
  )
}

function buildLogoMatrix(): boolean[][] {
  const matrix: boolean[][] = []
  for (const row of LOGO_ROWS) {
    const top: boolean[] = []
    const bottom: boolean[] = []
    for (const character of [...row.padEnd(LOGO_WIDTH)]) {
      top.push(character === "▀" || character === "█")
      bottom.push(character === "▄" || character === "█")
    }
    matrix.push(top, bottom)
  }
  return matrix
}

const LOGO_MATRIX = buildLogoMatrix()

function renderLogo(scale: number, colorOffset: number, colors: readonly string[]): StyledText {
  const matrix = LOGO_MATRIX.flatMap((row) =>
    Array.from({ length: scale }, () => row.flatMap((pixel) => Array<boolean>(scale).fill(pixel))),
  )
  const chunks = []

  for (let row = 0; row < matrix.length; row += 2) {
    for (let column = 0; column < matrix[0]!.length; column++) {
      const top = matrix[row]?.[column] ?? false
      const bottom = matrix[row + 1]?.[column] ?? false
      const character = [" ", "▀", "▄", "█"][Number(top) + Number(bottom) * 2]!
      if (character === " ") {
        chunks.push({ __isChunk: true as const, text: character })
      } else {
        const sourceColumn = Math.floor(column / scale)
        const baseColor = Math.floor((sourceColumn * colors.length) / LOGO_WIDTH)
        chunks.push(fg(colors[(baseColor + colorOffset) % colors.length]!)(character))
      }
    }
    if (row + 2 < matrix.length) chunks.push({ __isChunk: true as const, text: "\n" })
  }

  return new StyledText(chunks)
}

function buildDrumWav(drum: Drum): Uint8Array {
  const duration = drum === "kick" ? 0.24 : drum === "snare" ? 0.18 : 0.07
  const sampleCount = Math.ceil(SAMPLE_RATE * duration)
  const output = new Uint8Array(44 + sampleCount * 2)
  const view = new DataView(output.buffer)
  let noiseState = drum === "snare" ? 0x5f3759df : 0x12345678
  let previousNoise = 0

  output.set([0x52, 0x49, 0x46, 0x46], 0)
  view.setUint32(4, output.length - 8, true)
  output.set([0x57, 0x41, 0x56, 0x45], 8)
  output.set([0x66, 0x6d, 0x74, 0x20], 12)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  output.set([0x64, 0x61, 0x74, 0x61], 36)
  view.setUint32(40, sampleCount * 2, true)

  for (let index = 0; index < sampleCount; index++) {
    const time = index / SAMPLE_RATE
    noiseState = (noiseState * 1_664_525 + 1_013_904_223) >>> 0
    const noise = (noiseState / 0xffffffff) * 2 - 1
    let sample: number

    if (drum === "kick") {
      const phase = 2 * Math.PI * (46 * time + (112 * (1 - Math.exp(-32 * time))) / 32)
      const body = Math.sin(phase) * Math.exp(-15 * time)
      const click = time < 0.009 ? noise * (1 - time / 0.009) * 0.18 : 0
      sample = body * 0.92 + click
    } else if (drum === "snare") {
      const highNoise = noise - previousNoise * 0.55
      const body = Math.sin(2 * Math.PI * 185 * time) * Math.exp(-24 * time) * 0.22
      sample = (highNoise * 0.64 + body) * Math.exp(-17 * time)
    } else {
      sample = (noise - previousNoise) * Math.exp(-62 * time) * 0.34
    }

    previousNoise = noise
    view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true)
  }

  return output
}

class OpenTUIBeatDemo {
  private readonly renderer: CliRenderer
  private readonly root: BoxRenderable
  private readonly logo: TextRenderable
  private readonly title: TextRenderable
  private readonly sequencer: TextRenderable
  private readonly pickerContainer: BoxRenderable
  private readonly pickerTitle: TextRenderable
  private readonly pickerSelect: SelectRenderable
  private readonly fft = new FFT(FFT_SIZE)
  private readonly fftInput = new Float32Array(FFT_SIZE)
  private readonly fftOutput = this.fft.createComplexArray()
  private readonly fftWindow = new Float32Array(FFT_SIZE)
  private readonly fftMagnitudes = new Float32Array(BAND_CENTERS.length)
  private readonly spectrum = new Float32Array(BAND_CENTERS.length)
  private readonly spectrumPeaks = new Float32Array(BAND_CENTERS.length)
  private readonly frameCallback: (deltaMs: number) => Promise<void>
  private readonly keyHandler: (key: KeyEvent) => void
  private readonly audioErrorHandler: (error: Error, context: AudioErrorContext) => void
  private readonly pickerSelectionHandler: (index: number, option: SelectOption) => void

  private audio: Audio | null = null
  private sounds: Partial<Record<Drum, AudioSound>> = {}
  private trackPath: string | null = null
  private trackSound: AudioSound | null = null
  private trackVoice: AudioVoice | null = null
  private grooveIndex = 0
  private bpm = GROOVES[0]!.bpm
  private playing = true
  private muted = false
  private nextStep = 0
  private activeStep = -1
  private timeUntilNextStep = 0
  private kickEnvelope = 0
  private snareEnvelope = 0
  private animationTimeMs = 0
  private colorOffset = 0
  private logoColors: readonly string[] = DEFAULT_LOGO_COLORS
  private colorRevision = 0
  private renderedScale = 0
  private renderedColorOffset = -1
  private renderedColorRevision = -1
  private playbackAvailable = false
  private mixerAvailable = false
  private tapEnabled = false
  private fftWindowSum = 0
  private fftElapsedMs = 0
  private lastAnalyzedFrame = -1n
  private peak = 0
  private rms = 0
  private pickerDirectory = resolve(process.cwd())
  private pickerVisible = false
  private pickerRequestId = 0
  private loadRequestId = 0
  private lastAction = "Ready"
  private liveRequested = false
  private destroyed = false

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.renderer.setBackgroundColor("#080A0F")

    for (let index = 0; index < FFT_SIZE; index++) {
      const windowValue = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1)))
      this.fftWindow[index] = windowValue
      this.fftWindowSum += windowValue
    }

    this.root = new BoxRenderable(renderer, {
      id: "opentui-beat-demo-root",
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#080A0F",
      overflow: "hidden",
    })

    const titleBar = new BoxRenderable(renderer, {
      id: "opentui-beat-demo-title-bar",
      position: "absolute",
      top: 1,
      width: "100%",
      height: 1,
      alignItems: "center",
      justifyContent: "center",
    })
    this.title = new TextRenderable(renderer, {
      id: "opentui-beat-demo-title",
      content: "OPEN TERMINAL RADIO  /  BEAT TAPE 001",
      fg: "#5F6673",
      flexShrink: 0,
    })
    titleBar.add(this.title)
    this.root.add(titleBar)

    this.logo = new TextRenderable(renderer, {
      id: "opentui-beat-demo-logo",
      content: renderLogo(1, 0, this.logoColors),
      flexShrink: 0,
      zIndex: 2,
    })
    this.root.add(this.logo)

    const sequencerBar = new BoxRenderable(renderer, {
      id: "opentui-beat-demo-sequencer-bar",
      position: "absolute",
      bottom: 0,
      width: "100%",
      height: 5,
      alignItems: "center",
      justifyContent: "center",
    })
    this.sequencer = new TextRenderable(renderer, {
      id: "opentui-beat-demo-sequencer",
      content: "",
      flexShrink: 0,
    })
    sequencerBar.add(this.sequencer)
    this.root.add(sequencerBar)

    const pickerWidth = Math.max(1, Math.min(92, this.renderer.terminalWidth - 4))
    const pickerHeight = Math.max(1, Math.min(24, this.renderer.terminalHeight - 4))
    this.pickerContainer = new BoxRenderable(renderer, {
      id: "opentui-beat-demo-file-picker",
      position: "absolute",
      left: "50%",
      top: "50%",
      width: pickerWidth,
      height: pickerHeight,
      marginLeft: -Math.floor(pickerWidth / 2),
      marginTop: -Math.floor(pickerHeight / 2),
      zIndex: 100,
      border: true,
      borderStyle: "rounded",
      borderColor: "#FFB454",
      backgroundColor: "#11151F",
      flexDirection: "column",
      padding: 1,
      visible: false,
    })
    this.pickerTitle = new TextRenderable(renderer, {
      id: "opentui-beat-demo-file-picker-title",
      content: "Choose an audio file",
      fg: "#FFB454",
      height: 3,
      flexShrink: 0,
    })
    this.pickerContainer.add(this.pickerTitle)
    this.pickerSelect = new SelectRenderable(renderer, {
      id: "opentui-beat-demo-file-picker-select",
      width: "100%",
      height: Math.max(1, pickerHeight - 5),
      options: [],
      backgroundColor: "#11151F",
      focusedBackgroundColor: "#171D2A",
      textColor: "#B8C0CF",
      focusedTextColor: "#F5F7FA",
      selectedBackgroundColor: "#51351F",
      selectedTextColor: "#FFFFFF",
      showDescription: false,
      showScrollIndicator: true,
      wrapSelection: false,
      fastScrollStep: 5,
    })
    this.pickerSelectionHandler = (_index, option) => {
      void this.handlePickerOption(option)
    }
    this.pickerSelect.on(SelectRenderableEvents.ITEM_SELECTED, this.pickerSelectionHandler)
    this.pickerContainer.add(this.pickerSelect)
    this.root.add(this.pickerContainer)
    this.renderer.root.add(this.root)

    this.audioErrorHandler = (error, context) => {
      this.lastAction = `${context.action}: ${sanitizeDisplayText(error.message)}`
      this.updateSequencer()
    }
    this.initializeAudio()

    this.frameCallback = async (deltaMs) => {
      this.update(Math.min(deltaMs, 100))
    }
    this.keyHandler = (key) => this.handleKey(key)
    this.renderer.setFrameCallback(this.frameCallback)
    this.renderer.requestLive()
    this.liveRequested = true
    this.renderer.keyInput.prependListener("keypress", this.keyHandler)
    this.updateSequencer()
  }

  private initializeAudio(): void {
    let nextAudio: Audio | null = null
    try {
      nextAudio = Audio.create({ autoStart: false, sampleRate: SAMPLE_RATE })
      nextAudio.on("error", this.audioErrorHandler)
      const outputStarted = nextAudio.start()
      if (!outputStarted && !nextAudio.startMixer()) throw new Error("Audio mixer did not start")

      const kick = nextAudio.loadSound(buildDrumWav("kick"))
      const snare = nextAudio.loadSound(buildDrumWav("snare"))
      const hat = nextAudio.loadSound(buildDrumWav("hat"))
      if (kick == null || snare == null || hat == null) throw new Error("Drum samples did not load")

      this.audio = nextAudio
      this.sounds = { kick, snare, hat }
      this.playbackAvailable = nextAudio.isStarted()
      this.mixerAvailable = nextAudio.isMixerStarted()
      this.tapEnabled = nextAudio.enableTap(8192)
      this.lastAction = this.tapEnabled
        ? this.playbackAvailable
          ? "Audio output and spectrum ready"
          : "Mixer-only spectrum mode"
        : "Audio ready; spectrum tap unavailable"
    } catch (error) {
      this.lastAction = error instanceof Error ? sanitizeDisplayText(error.message) : "Audio unavailable"
      nextAudio?.dispose()
      nextAudio?.off("error", this.audioErrorHandler)
      this.audio = null
      this.sounds = {}
      this.playbackAvailable = false
      this.mixerAvailable = false
      this.tapEnabled = false
    }
  }

  private updatePickerTitle(message?: string): void {
    const suffix = message ? `\n${sanitizeDisplayText(message)}` : ""
    this.pickerTitle.content = `WAV / MP3 / FLAC  |  Enter open/load  |  Backspace parent  |  Esc close\n${sanitizeDisplayText(this.pickerDirectory)}${suffix}`
  }

  private async refreshPicker(directory: string = this.pickerDirectory): Promise<void> {
    const requestId = ++this.pickerRequestId
    const requestedDirectory = resolve(directory)
    this.pickerDirectory = requestedDirectory
    this.updatePickerTitle("Loading...")

    try {
      const dirents = []
      let truncated = false
      const directory = await opendir(requestedDirectory)
      for await (const dirent of directory) {
        if (this.destroyed || requestId !== this.pickerRequestId) return
        if (dirents.length >= MAX_PICKER_ENTRIES) {
          truncated = true
          break
        }
        dirents.push(dirent)
      }
      const classified = await Promise.all(
        dirents.map((dirent) =>
          classifyPickerEntry(requestedDirectory, dirent.name, dirent.isDirectory(), dirent.isFile()),
        ),
      )
      if (this.destroyed || requestId !== this.pickerRequestId) return

      const entries = classified
        .filter((entry): entry is FilePickerEntry => entry != null)
        .sort((left, right) => {
          if (left.type !== right.type) return left.type === "directory" ? -1 : 1
          return left.name.localeCompare(right.name)
        })
      const parentDirectory = dirname(requestedDirectory)
      const options: FilePickerOption[] = []
      if (parentDirectory !== requestedDirectory) {
        options.push({
          name: "../",
          description: "",
          value: { type: "parent", path: parentDirectory, name: ".." },
        })
      }
      options.push(...entries.map(pickerOption))
      if (options.length === 0) {
        options.push({
          name: "(no supported audio files)",
          description: "",
          value: { type: "empty", path: requestedDirectory, name: "" },
        })
      }

      this.pickerSelect.options = options
      this.pickerSelect.setSelectedIndex(0)
      this.updatePickerTitle(truncated ? `Showing first ${MAX_PICKER_ENTRIES} entries` : undefined)
    } catch (error) {
      if (this.destroyed || requestId !== this.pickerRequestId) return
      const message = error instanceof Error ? error.message : "Unknown directory error"
      this.pickerSelect.options = [
        {
          name: "(directory unreadable)",
          description: "",
          value: { type: "empty", path: requestedDirectory, name: "" },
        },
      ]
      this.pickerSelect.setSelectedIndex(0)
      this.updatePickerTitle(`Error: ${message}`)
    }
  }

  private showPicker(): void {
    if (!this.audio || !this.mixerAvailable) {
      this.lastAction = "Audio engine unavailable"
      this.updateSequencer()
      return
    }
    this.pickerVisible = true
    this.pickerContainer.visible = true
    this.pickerSelect.focus()
    this.lastAction = "Choose an audio file"
    this.updateSequencer()
    void this.refreshPicker()
  }

  private hidePicker(): void {
    this.pickerRequestId++
    this.pickerVisible = false
    this.pickerSelect.blur()
    this.pickerContainer.visible = false
  }

  private async handlePickerOption(option: SelectOption): Promise<void> {
    const entry = (option as FilePickerOption).value
    if (!entry || entry.type === "empty") return
    if (entry.type === "parent" || entry.type === "directory") {
      await this.refreshPicker(entry.path)
      return
    }

    this.hidePicker()
    await this.loadTrack(entry.path)
  }

  private async loadTrack(filePath: string): Promise<void> {
    const audio = this.audio
    if (!audio || !this.mixerAvailable) {
      this.lastAction = "Audio engine unavailable"
      this.updateSequencer()
      return
    }
    if (!isSupportedAudioFile(filePath)) {
      this.lastAction = "Unsupported audio format"
      this.updateSequencer()
      return
    }

    const requestId = ++this.loadRequestId
    const displayName = sanitizeDisplayText(basename(filePath)) || "audio file"
    this.lastAction = `Loading ${displayName}...`
    this.updateSequencer()

    try {
      const fileStats = await stat(filePath)
      if (this.destroyed || requestId !== this.loadRequestId || this.audio !== audio) return
      if (!fileStats.isFile()) throw new Error("Selection is not a file")
      if (fileStats.size > MAX_AUDIO_FILE_BYTES) throw new Error("File exceeds the 256 MiB encoded-size limit")

      const bytes = await readFile(filePath)
      if (this.destroyed || requestId !== this.loadRequestId || this.audio !== audio) return

      const nextSound = audio.loadSound(bytes)
      if (nextSound == null) throw new Error("Audio decode failed")
      const nextVoice = audio.play(nextSound, { volume: 0.72, pan: 0, loop: true })
      if (nextVoice == null) {
        audio.unloadSound(nextSound)
        throw new Error("Audio playback failed")
      }

      const previousVoice = this.trackVoice
      const previousSound = this.trackSound
      this.trackPath = filePath
      this.trackSound = nextSound
      this.trackVoice = nextVoice
      if (previousVoice != null) audio.stopVoice(previousVoice)
      if (previousSound != null) audio.unloadSound(previousSound)
      this.lastAction = `Playing ${displayName}`
    } catch (error) {
      if (this.destroyed || requestId !== this.loadRequestId) return
      const message = error instanceof Error ? sanitizeDisplayText(error.message) : "Audio load failed"
      this.lastAction = `Load failed: ${message}`
    }
    this.updateSequencer()
  }

  private toggleTrack(): void {
    const audio = this.audio
    if (!audio || this.trackSound == null) {
      this.lastAction = "Choose an audio file first"
      this.updateSequencer()
      return
    }

    if (this.trackVoice != null) {
      audio.stopVoice(this.trackVoice)
      this.trackVoice = null
      this.lastAction = "Audio file stopped"
    } else {
      this.trackVoice = audio.play(this.trackSound, { volume: 0.72, pan: 0, loop: true })
      this.lastAction = this.trackVoice == null ? "Audio file failed to start" : "Audio file restarted"
    }
    this.updateSequencer()
  }

  private stepDuration(step: number): number {
    const sixteenth = 60_000 / this.bpm / 4
    const swing = GROOVES[this.grooveIndex]!.swing
    return sixteenth * (step % 2 === 0 ? 1 + swing : 1 - swing)
  }

  private hit(drum: Drum): void {
    if (drum === "kick") this.kickEnvelope = 1
    if (drum === "snare") {
      this.snareEnvelope = 1
      this.colorOffset = (this.colorOffset + 1) % this.logoColors.length
    }

    const sound = this.sounds[drum]
    if (!this.muted && this.audio && sound != null) {
      this.audio.play(sound, { volume: drum === "kick" ? 0.9 : drum === "snare" ? 0.52 : 0.16 })
    }
  }

  private playStep(step: number): void {
    const groove = GROOVES[this.grooveIndex]!
    if (groove.kick[step] === "x") this.hit("kick")
    if (groove.snare[step] === "x") this.hit("snare")
    if (groove.hat[step] === "x") this.hit("hat")
    this.activeStep = step
    this.updateSequencer()
  }

  private decaySpectrum(elapsedMs: number): void {
    const decay = Math.exp(-elapsedMs / 240)
    for (let index = 0; index < this.spectrum.length; index++) this.spectrum[index] *= decay
  }

  private computeSpectrum(pcm: Float32Array): void {
    for (let index = 0; index < FFT_SIZE; index++) {
      const left = pcm[index * 2] ?? 0
      const right = pcm[index * 2 + 1] ?? left
      this.fftInput[index] = (left + right) * 0.5 * this.fftWindow[index]!
    }
    this.fft.realTransform(this.fftOutput, this.fftInput)

    const sampleRate = this.audio?.sampleRate ?? SAMPLE_RATE
    for (let band = 0; band < BAND_CENTERS.length; band++) {
      const center = BAND_CENTERS[band]!
      const previous = BAND_CENTERS[band - 1]
      const next = BAND_CENTERS[band + 1]
      const low = previous ? Math.sqrt(previous * center) : center / Math.sqrt((next ?? center * 2) / center)
      const high = next ? Math.sqrt(center * next) : center * Math.sqrt(center / (previous ?? center / 2))
      const firstBin = Math.max(1, Math.floor((low * FFT_SIZE) / sampleRate))
      const lastBin = Math.min(FFT_SIZE / 2, Math.ceil((high * FFT_SIZE) / sampleRate))
      let maximum = 0
      for (let bin = firstBin; bin < lastBin; bin++) {
        const real = this.fftOutput[bin * 2] ?? 0
        const imaginary = this.fftOutput[bin * 2 + 1] ?? 0
        maximum = Math.max(maximum, (2 * Math.hypot(real, imaginary)) / this.fftWindowSum)
      }
      this.fftMagnitudes[band] = maximum
    }

    for (let index = 0; index < this.spectrum.length; index++) {
      const decibels = 20 * Math.log10(Math.max(this.fftMagnitudes[index] ?? 0, 1e-8))
      const incoming = clamp((decibels - FFT_DB_FLOOR) / (FFT_DB_CEILING - FFT_DB_FLOOR), 0, 1)
      const previous = this.spectrum[index] ?? 0
      this.spectrum[index] = incoming > previous ? incoming : previous * 0.8 + incoming * 0.2
    }
  }

  private updateSpectrum(deltaMs: number): void {
    const audio = this.audio
    this.fftElapsedMs += deltaMs
    if (!audio || !this.tapEnabled || this.fftElapsedMs < FFT_UPDATE_MS) return

    const elapsedMs = this.fftElapsedMs
    this.fftElapsedMs %= FFT_UPDATE_MS
    const stats = audio.getStats()
    const incomingPeak = stats?.lastPeak ?? 0
    const incomingRms = stats?.lastRms ?? 0
    this.peak = incomingPeak > this.peak ? incomingPeak : this.peak * Math.exp(-elapsedMs / 120)
    this.rms = incomingRms > this.rms ? incomingRms : this.rms * 0.72 + incomingRms * 0.28

    if (stats && stats.framesMixed !== this.lastAnalyzedFrame) {
      this.lastAnalyzedFrame = stats.framesMixed
      const tap = audio.readTapFrames(FFT_SIZE, 2)
      if (tap && tap.framesRead >= FFT_SIZE) this.computeSpectrum(tap.frames)
      else this.decaySpectrum(elapsedMs)
    } else {
      this.decaySpectrum(elapsedMs)
    }

    const falloff = (elapsedMs / 1000) * FFT_PEAK_FALLOFF_PER_SECOND
    for (let index = 0; index < this.spectrumPeaks.length; index++) {
      this.spectrumPeaks[index] = Math.max(this.spectrum[index] ?? 0, (this.spectrumPeaks[index] ?? 0) - falloff)
    }
    this.updateSequencer()
  }

  private bassPulse(): number {
    const bass = Math.max(this.spectrum[0] ?? 0, this.spectrum[1] ?? 0)
    return clamp((bass - 0.42) / 0.42, 0, 1)
  }

  private midPulse(): number {
    const mids = Math.max(this.spectrum[2] ?? 0, this.spectrum[3] ?? 0, this.spectrum[4] ?? 0)
    return clamp((mids - 0.48) / 0.38, 0, 1)
  }

  private highPulse(): number {
    const highs = Math.max(this.spectrum[5] ?? 0, this.spectrum[6] ?? 0, this.spectrum[7] ?? 0)
    return clamp((highs - 0.52) / 0.34, 0, 1)
  }

  private logoScale(): number {
    const widthCapacity = Math.floor(Math.max(1, this.renderer.terminalWidth - 2) / LOGO_WIDTH)
    const heightCapacity = Math.floor(Math.max(3, this.renderer.terminalHeight - 12) / LOGO_ROWS.length)
    const capacity = Math.max(1, Math.min(widthCapacity, heightCapacity))
    const restingScale = Math.max(1, Math.min(3, capacity - 1))
    const pulse = Math.max(this.kickEnvelope, this.bassPulse(), clamp(this.peak * 1.4, 0, 1))
    return pulse > 0.48 ? Math.min(capacity, restingScale + 1) : restingScale
  }

  private update(deltaMs: number): void {
    this.animationTimeMs += deltaMs
    this.kickEnvelope *= Math.exp(-deltaMs / 145)
    this.snareEnvelope *= Math.exp(-deltaMs / 105)

    if (this.audio && !this.audio.isStarted() && this.audio.isMixerStarted()) {
      const frameCount = Math.max(64, Math.min(2048, Math.round((this.audio.sampleRate * deltaMs) / 1000)))
      this.audio.mixFrames(frameCount, 2)
    }

    if (this.playing) {
      this.timeUntilNextStep -= deltaMs
      while (this.timeUntilNextStep <= 0) {
        const step = this.nextStep
        this.playStep(step)
        this.timeUntilNextStep += this.stepDuration(step)
        this.nextStep = (step + 1) % 16
      }
    }
    this.updateSpectrum(deltaMs)

    const scale = this.logoScale()
    if (
      scale !== this.renderedScale ||
      this.colorOffset !== this.renderedColorOffset ||
      this.colorRevision !== this.renderedColorRevision
    ) {
      this.logo.content = renderLogo(scale, this.colorOffset, this.logoColors)
      this.renderedScale = scale
      this.renderedColorOffset = this.colorOffset
      this.renderedColorRevision = this.colorRevision
    }
    const bass = this.bassPulse()
    const mids = this.midPulse()
    const highs = this.highPulse()
    const level = clamp(this.rms * 3.5, 0, 1)
    this.logo.bottom = Math.round(this.kickEnvelope * 2 + this.snareEnvelope + bass * 3)
    this.logo.left = Math.round(
      Math.sin(this.snareEnvelope * 28) * this.snareEnvelope * 2 + Math.sin(this.animationTimeMs * 0.045) * mids * 2,
    )
    this.logo.opacity = 0.76 + Math.max(this.kickEnvelope, this.snareEnvelope, level) * 0.24
    this.title.opacity = 0.25 + Math.max(this.kickEnvelope * 0.7, this.snareEnvelope * 0.5, highs * 0.75, level * 0.5)
  }

  private updateSequencer(): void {
    const groove = GROOVES[this.grooveIndex]!
    const audioStatus = !this.mixerAvailable
      ? "NO AUDIO"
      : !this.playbackAvailable
        ? "MIXER ONLY"
        : this.muted
          ? "AUDIO MUTED"
          : "AUDIO ON"
    const chunks = [
      fg("#E8ECF3")(`${groove.name}  `),
      fg("#FFB454")(`${this.bpm} BPM  `),
      fg("#727A89")(`SWING ${Math.round(groove.swing * 100)}%  `),
      fg(this.playing ? "#5EF38C" : "#FFB454")(this.playing ? "PLAYING" : "PAUSED"),
      fg("#474D59")("  /  "),
      fg(this.playbackAvailable && !this.muted ? "#46C7FF" : "#727A89")(audioStatus),
      fg("#474D59")("  /  "),
      fg("#727A89")(this.lastAction),
      { __isChunk: true as const, text: "\n" },
    ]

    for (const [label, pattern, color] of [
      ["K", groove.kick, "#FF5C5C"],
      ["S", groove.snare, "#D875FF"],
    ] as const) {
      chunks.push(fg(color)(`${label}  `))
      for (let step = 0; step < 16; step++) {
        const hit = pattern[step] === "x"
        const active = step === this.activeStep
        chunks.push(fg(active ? "#FFFFFF" : hit ? color : "#343A45")(active ? "◆" : hit ? "●" : "·"))
        if (step < 15) chunks.push({ __isChunk: true as const, text: " " })
      }
      chunks.push({ __isChunk: true as const, text: "\n" })
    }

    const trackName = this.trackPath ? sanitizeDisplayText(basename(this.trackPath)) : "NO FILE"
    chunks.push(fg(this.trackVoice != null ? "#5EF38C" : "#727A89")(`♫ ${trackName}  `))
    for (let index = 0; index < this.spectrumPeaks.length; index++) {
      const level = clamp(this.spectrumPeaks[index] ?? 0, 0, 1)
      const glyphIndex = Math.min(SPECTRUM_GLYPHS.length - 1, Math.floor(level * SPECTRUM_GLYPHS.length))
      chunks.push(fg(this.logoColors[index % this.logoColors.length]!)(SPECTRUM_GLYPHS[glyphIndex]!))
    }
    chunks.push(
      fg("#727A89")(
        `  PK ${Math.round(clamp(this.peak, 0, 1) * 100)
          .toString()
          .padStart(3)}  RMS ${Math.round(clamp(this.rms, 0, 1) * 100)
          .toString()
          .padStart(3)}`,
      ),
      { __isChunk: true as const, text: "\n" },
      fg("#727A89")("F file   B file play/stop   C colors   ←/→ tempo   G groove   SPACE drums   M mute   K/S hit"),
    )
    this.sequencer.content = new StyledText(chunks)
  }

  private randomizeColors(): void {
    this.logoColors = randomLogoColors()
    this.colorOffset = 0
    this.colorRevision++
    this.lastAction = "Logo colors randomized"
  }

  private handleKey(key: KeyEvent): void {
    if (this.pickerVisible) {
      switch (key.name) {
        case "escape":
          key.preventDefault()
          key.stopPropagation()
          this.hidePicker()
          this.lastAction = "File picker closed"
          this.updateSequencer()
          break
        case "backspace":
          key.preventDefault()
          key.stopPropagation()
          void this.refreshPicker(dirname(this.pickerDirectory))
          break
        case "r":
          key.preventDefault()
          key.stopPropagation()
          void this.refreshPicker()
          break
      }
      return
    }

    switch (key.name) {
      case "left":
        this.bpm = Math.max(60, this.bpm - 2)
        break
      case "right":
        this.bpm = Math.min(160, this.bpm + 2)
        break
      case "g":
        this.grooveIndex = (this.grooveIndex + 1) % GROOVES.length
        this.bpm = GROOVES[this.grooveIndex]!.bpm
        this.nextStep = 0
        this.timeUntilNextStep = 0
        break
      case "space":
        this.playing = !this.playing
        if (this.playing) this.timeUntilNextStep = 0
        break
      case "m":
        this.muted = !this.muted
        this.audio?.setMasterVolume(this.muted ? 0 : 1)
        break
      case "k":
        this.hit("kick")
        break
      case "s":
        this.hit("snare")
        break
      case "f":
        this.showPicker()
        return
      case "b":
        this.toggleTrack()
        return
      case "c":
        this.randomizeColors()
        break
      default:
        return
    }
    key.preventDefault()
    this.updateSequencer()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.pickerRequestId++
    this.loadRequestId++
    this.renderer.removeFrameCallback(this.frameCallback)
    if (this.liveRequested) {
      this.renderer.dropLive()
      this.liveRequested = false
    }
    this.renderer.keyInput.off("keypress", this.keyHandler)
    this.pickerSelect.off(SelectRenderableEvents.ITEM_SELECTED, this.pickerSelectionHandler)
    this.pickerSelect.blur()

    const audio = this.audio
    const trackVoice = this.trackVoice
    const trackSound = this.trackSound
    this.trackVoice = null
    this.trackSound = null
    this.trackPath = null
    if (audio && trackVoice != null) audio.stopVoice(trackVoice)
    if (audio && trackSound != null) audio.unloadSound(trackSound)
    if (audio && this.tapEnabled) audio.disableTap()
    audio?.dispose()
    audio?.off("error", this.audioErrorHandler)
    this.audio = null
    this.sounds = {}
    this.tapEnabled = false
    this.mixerAvailable = false
    this.playbackAvailable = false
    this.spectrum.fill(0)
    this.spectrumPeaks.fill(0)
    this.root.destroyRecursively()
  }
}

let demo: OpenTUIBeatDemo | null = null

export function run(renderer: CliRenderer): void {
  demo?.destroy()
  demo = new OpenTUIBeatDemo(renderer)
}

export function destroy(): void {
  demo?.destroy()
  demo = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
