import { readdir, readFile, stat } from "node:fs/promises"
import { basename, extname, join, parse, resolve } from "node:path"

export interface AudioTextPair {
  textPath: string
  audioPath: string
}

export interface PcmWav {
  channels: 1 | 2
  sampleRate: number
  samples: Float32Array
  frameCount: number
  durationSeconds: number
}

export interface TranscriptPart {
  text: string
  wordIndex: number | null
  lineIndex: number
  emphasis: boolean
}

export interface TimedWord {
  text: string
  partIndex: number
  lineIndex: number
  emphasis: boolean
  startFrame: number
  endFrame: number
}

export interface TranscriptTimeline {
  parts: TranscriptPart[]
  words: TimedWord[]
  lineCount: number
}

export interface AudioTextRecording extends AudioTextPair {
  name: string
  audio: PcmWav
  transcript: TranscriptTimeline
}

const TEXT_EXTENSION = ".txt"
const AUDIO_EXTENSION = ".wav"
const EMPHASIS_MARKER = "[emphasis]"
const SPEECH_ONSET_PADDING_WINDOWS = 3

function extensionKind(path: string): "text" | "audio" | null {
  const extension = extname(path).toLowerCase()
  if (extension === TEXT_EXTENSION) return "text"
  if (extension === AUDIO_EXTENSION) return "audio"
  return null
}

async function validatePair(firstPath: string, secondPath: string): Promise<AudioTextPair> {
  const first = resolve(firstPath)
  const second = resolve(secondPath)
  const firstKind = extensionKind(first)
  const secondKind = extensionKind(second)
  if (!firstKind || !secondKind || firstKind === secondKind) {
    throw new Error(`Expected one .txt and one .wav after --pair, received '${firstPath}' and '${secondPath}'`)
  }
  const [firstStats, secondStats] = await Promise.all([stat(first), stat(second)])
  if (!firstStats.isFile() || !secondStats.isFile()) throw new Error("Explicit pair paths must be files")
  return firstKind === "text" ? { textPath: first, audioPath: second } : { textPath: second, audioPath: first }
}

async function collectAutomaticPaths(inputPaths: readonly string[]): Promise<string[]> {
  const paths: string[] = []
  for (const inputPath of inputPaths) {
    const absolutePath = resolve(inputPath)
    const inputStats = await stat(absolutePath).catch(() => null)
    if (!inputStats) throw new Error(`Input does not exist: ${inputPath}`)
    if (inputStats.isFile()) {
      if (!extensionKind(absolutePath)) throw new Error(`Unsupported input (expected .txt or .wav): ${inputPath}`)
      paths.push(absolutePath)
      continue
    }
    if (!inputStats.isDirectory()) throw new Error(`Input is not a file or directory: ${inputPath}`)
    const entries = await readdir(absolutePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && extensionKind(entry.name)) paths.push(join(absolutePath, entry.name))
    }
  }
  return paths
}

function pairAutomaticPaths(paths: readonly string[]): AudioTextPair[] {
  const grouped = new Map<string, Partial<AudioTextPair>>()
  for (const path of paths) {
    const parsed = parse(path)
    const key = join(parsed.dir, parsed.name)
    const pair = grouped.get(key) ?? {}
    if (extensionKind(path) === "text") {
      if (pair.textPath) throw new Error(`Duplicate transcript for '${key}'`)
      pair.textPath = path
    } else {
      if (pair.audioPath) throw new Error(`Duplicate recording for '${key}'`)
      pair.audioPath = path
    }
    grouped.set(key, pair)
  }

  const pairs: AudioTextPair[] = []
  for (const [key, pair] of grouped) {
    if (!pair.textPath || !pair.audioPath) {
      throw new Error(`Missing ${pair.textPath ? ".wav" : ".txt"} partner for '${key}'`)
    }
    pairs.push({ textPath: pair.textPath, audioPath: pair.audioPath })
  }
  return pairs.sort((left, right) => left.textPath.localeCompare(right.textPath))
}

export async function resolveAudioTextPairs(args: readonly string[]): Promise<AudioTextPair[]> {
  const automaticInputs: string[] = []
  const explicitPairs: Promise<AudioTextPair>[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument !== "--pair") {
      automaticInputs.push(argument)
      continue
    }
    const first = args[index + 1]
    const second = args[index + 2]
    if (!first || !second) throw new Error("--pair requires two paths")
    explicitPairs.push(validatePair(first, second))
    index += 2
  }

  const automaticPaths = await collectAutomaticPaths(automaticInputs)
  const pairs = [...(await Promise.all(explicitPairs)), ...pairAutomaticPaths(automaticPaths)]
  if (pairs.length === 0) throw new Error("No .txt/.wav pairs found")
  return pairs
}

function fourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

export function parsePcmWav(bytes: Uint8Array): PcmWav {
  if (bytes.byteLength < 44) throw new Error("WAV file is too short")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (fourCc(view, 0) !== "RIFF" || fourCc(view, 8) !== "WAVE") throw new Error("Expected a RIFF/WAVE file")

  let formatOffset = -1
  let formatSize = 0
  let dataOffset = -1
  let dataSize = 0
  for (let offset = 12; offset + 8 <= view.byteLength; ) {
    const chunkName = fourCc(view, offset)
    const chunkSize = view.getUint32(offset + 4, true)
    const payloadOffset = offset + 8
    if (payloadOffset + chunkSize > view.byteLength) throw new Error(`Invalid WAV ${chunkName} chunk size`)
    if (chunkName === "fmt ") {
      formatOffset = payloadOffset
      formatSize = chunkSize
    } else if (chunkName === "data") {
      dataOffset = payloadOffset
      dataSize = chunkSize
    }
    offset = payloadOffset + chunkSize + (chunkSize & 1)
  }
  if (formatOffset < 0 || formatSize < 16) throw new Error("WAV file has no valid fmt chunk")
  if (dataOffset < 0) throw new Error("WAV file has no data chunk")

  let audioFormat = view.getUint16(formatOffset, true)
  const channels = view.getUint16(formatOffset + 2, true)
  const sampleRate = view.getUint32(formatOffset + 4, true)
  const blockAlign = view.getUint16(formatOffset + 12, true)
  const bitsPerSample = view.getUint16(formatOffset + 14, true)
  if (audioFormat === 0xfffe && formatSize >= 40) audioFormat = view.getUint16(formatOffset + 24, true)
  if (channels !== 1 && channels !== 2) throw new Error(`WAV must contain one or two channels, received ${channels}`)
  if (sampleRate <= 0) throw new Error("WAV sample rate must be positive")
  if (blockAlign <= 0 || dataSize % blockAlign !== 0) throw new Error("WAV data is not aligned to complete frames")

  const bytesPerSample = bitsPerSample / 8
  const supportedPcm = audioFormat === 1 && [8, 16, 24, 32].includes(bitsPerSample)
  const supportedFloat = audioFormat === 3 && bitsPerSample === 32
  if (!supportedPcm && !supportedFloat) {
    throw new Error(`Unsupported WAV encoding: format ${audioFormat}, ${bitsPerSample} bits`)
  }
  if (blockAlign < channels * bytesPerSample) throw new Error("WAV block alignment is smaller than its samples")

  const frameCount = dataSize / blockAlign
  const samples = new Float32Array(frameCount * channels)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = dataOffset + frame * blockAlign
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = frameOffset + channel * bytesPerSample
      let sample: number
      if (audioFormat === 3) sample = view.getFloat32(offset, true)
      else if (bitsPerSample === 8) sample = (view.getUint8(offset) - 128) / 128
      else if (bitsPerSample === 16) sample = view.getInt16(offset, true) / 32768
      else if (bitsPerSample === 24) {
        const unsigned = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
        sample = ((unsigned & 0x800000 ? unsigned | 0xff000000 : unsigned) << 0) / 8388608
      } else sample = view.getInt32(offset, true) / 2147483648
      samples[frame * channels + channel] = Math.max(-1, Math.min(1, sample))
    }
  }

  return {
    channels,
    sampleRate,
    samples,
    frameCount,
    durationSeconds: frameCount / sampleRate,
  }
}

function tokenizeTranscript(text: string): Omit<TranscriptTimeline, "words"> & { wordParts: number[] } {
  const parts: TranscriptPart[] = []
  const wordParts: number[] = []
  const tokens =
    text
      .replace(/\r\n?/g, "\n")
      .trim()
      .match(/\[emphasis\]|[^\s]+|\s+/gi) ?? []
  let lineIndex = 0
  let emphasis = false
  for (const token of tokens) {
    if (token.toLowerCase() === EMPHASIS_MARKER) {
      emphasis = true
      continue
    }
    if (/^\s+$/.test(token)) {
      parts.push({ text: token, wordIndex: null, lineIndex, emphasis: false })
      lineIndex += [...token].filter((character) => character === "\n").length
      continue
    }
    const wordIndex = wordParts.length
    parts.push({ text: token, wordIndex, lineIndex, emphasis })
    wordParts.push(parts.length - 1)
    emphasis = false
  }
  return { parts, wordParts, lineCount: parts.length === 0 ? 0 : lineIndex + 1 }
}

function percentile(sorted: readonly number[], position: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(position * (sorted.length - 1))))] ?? 0
}

interface SpeechPause {
  startFrame: number
  endFrame: number
}

interface SpeechActivity {
  windowFrames: number
  sampleRate: number
  weights: Float32Array
  pauses: SpeechPause[]
}

interface TranscriptAnchor {
  wordIndex: number
  strength: 1 | 2
  expectedProgress: number
}

function activeSpeechWindows(audio: PcmWav): SpeechActivity {
  const windowFrames = Math.max(1, Math.round(audio.sampleRate * 0.01))
  const windowCount = Math.ceil(audio.frameCount / windowFrames)
  const rms = new Float32Array(windowCount)
  for (let window = 0; window < windowCount; window += 1) {
    const startFrame = window * windowFrames
    const endFrame = Math.min(audio.frameCount, startFrame + windowFrames)
    let energy = 0
    let count = 0
    for (let frame = startFrame; frame < endFrame; frame += 1) {
      for (let channel = 0; channel < audio.channels; channel += 1) {
        const sample = audio.samples[frame * audio.channels + channel] ?? 0
        energy += sample * sample
        count += 1
      }
    }
    rms[window] = count > 0 ? Math.sqrt(energy / count) : 0
  }

  const sorted = [...rms].sort((left, right) => left - right)
  const peak = percentile(sorted, 0.98)
  const noise = percentile(sorted, 0.1)
  const threshold = Math.max(0.0015, peak * 0.08, noise * 2)
  const rawPauses: SpeechPause[] = []
  const minimumPauseWindows = Math.max(1, Math.round((0.08 * audio.sampleRate) / windowFrames))
  const minimumRawPauseWindows = Math.max(1, Math.round((0.03 * audio.sampleRate) / windowFrames))
  const mergeGapFrames = audio.sampleRate * 0.05
  let pauseStart = -1
  for (let window = 0; window <= windowCount; window += 1) {
    const silent = window < windowCount && (rms[window] ?? 0) < threshold
    if (silent && pauseStart < 0) pauseStart = window
    if (!silent && pauseStart >= 0) {
      if (window - pauseStart >= minimumRawPauseWindows) {
        rawPauses.push({
          startFrame: pauseStart * windowFrames,
          endFrame: Math.min(audio.frameCount, window * windowFrames),
        })
      }
      pauseStart = -1
    }
  }
  const mergedPauses: SpeechPause[] = []
  for (const pause of rawPauses) {
    const previous = mergedPauses.at(-1)
    if (previous && pause.startFrame - previous.endFrame <= mergeGapFrames) previous.endFrame = pause.endFrame
    else mergedPauses.push({ ...pause })
  }
  const pauses = mergedPauses.filter((pause) => pause.endFrame - pause.startFrame >= minimumPauseWindows * windowFrames)

  const active = new Uint8Array(windowCount)
  for (let window = 0; window < windowCount; window += 1) {
    if ((rms[window] ?? 0) < threshold) continue
    for (
      let neighbor = Math.max(0, window - SPEECH_ONSET_PADDING_WINDOWS);
      neighbor <= Math.min(windowCount - 1, window + SPEECH_ONSET_PADDING_WINDOWS);
      neighbor += 1
    ) {
      active[neighbor] = 1
    }
  }
  const weights = new Float32Array(windowCount)
  for (let window = 0; window < windowCount; window += 1) weights[window] = active[window] ? 1 : 0
  if (!weights.some((weight) => weight > 0)) weights.fill(1)
  return { windowFrames, sampleRate: audio.sampleRate, weights, pauses }
}

function frameAtSpeechWeightBetween(
  targetWeight: number,
  activity: SpeechActivity,
  totalWeight: number,
  startFrame: number,
  endFrame: number,
): number {
  const firstWindow = Math.max(0, Math.floor(startFrame / activity.windowFrames))
  const finalWindow = Math.min(activity.weights.length, Math.ceil(endFrame / activity.windowFrames))
  if (targetWeight <= 0) {
    for (let window = firstWindow; window < finalWindow; window += 1) {
      if ((activity.weights[window] ?? 0) > 0) return Math.max(startFrame, window * activity.windowFrames)
    }
    return startFrame
  }
  if (targetWeight >= totalWeight) {
    for (let window = finalWindow - 1; window >= firstWindow; window -= 1) {
      if ((activity.weights[window] ?? 0) > 0) return Math.min(endFrame, (window + 1) * activity.windowFrames)
    }
    return endFrame
  }
  let consumed = 0
  for (let window = firstWindow; window < finalWindow; window += 1) {
    const weight = activity.weights[window] ?? 0
    if (weight > 0 && consumed + weight >= targetWeight) {
      const progress = (targetWeight - consumed) / weight
      return Math.min(endFrame, Math.max(startFrame, Math.round((window + progress) * activity.windowFrames)))
    }
    consumed += weight
  }
  return endFrame
}

function speechWeightBetween(activity: SpeechActivity, startFrame: number, endFrame: number): number {
  const firstWindow = Math.max(0, Math.floor(startFrame / activity.windowFrames))
  const finalWindow = Math.min(activity.weights.length, Math.ceil(endFrame / activity.windowFrames))
  let total = 0
  for (let window = firstWindow; window < finalWindow; window += 1) total += activity.weights[window] ?? 0
  return total
}

function wordWeight(text: string): number {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (normalized.length === 0) return 1
  const vowelGroups = normalized.match(/[aeiouy]+/g)?.length ?? 1
  const syllables = normalized.length > 3 && normalized.endsWith("e") ? Math.max(1, vowelGroups - 1) : vowelGroups
  return syllables + normalized.length * 0.12
}

function transcriptAnchors(
  tokenized: ReturnType<typeof tokenizeTranscript>,
  wordWeights: readonly number[],
): TranscriptAnchor[] {
  const totalWeight = wordWeights.reduce((total, weight) => total + weight, 0)
  const anchors: TranscriptAnchor[] = []
  let elapsedWeight = 0
  for (let wordIndex = 0; wordIndex < tokenized.wordParts.length - 1; wordIndex += 1) {
    elapsedWeight += wordWeights[wordIndex]!
    const partIndex = tokenized.wordParts[wordIndex]!
    const text = tokenized.parts[partIndex]!.text
    const nextPartIndex = tokenized.wordParts[wordIndex + 1]!
    const lineBreak = tokenized.parts.slice(partIndex + 1, nextPartIndex).some((part) => part.text.includes("\n"))
    const major = lineBreak || /[.!?]["')\]]*$/.test(text)
    const minor = /[,;:]["')\]]*$/.test(text)
    if (major || minor) {
      anchors.push({
        wordIndex,
        strength: major ? 2 : 1,
        expectedProgress: elapsedWeight / totalWeight,
      })
    }
  }
  return anchors
}

function matchAnchorsToPauses(
  anchors: readonly TranscriptAnchor[],
  activity: SpeechActivity,
  frameCount: number,
): Map<number, SpeechPause> {
  const pauses = activity.pauses.filter(
    (pause) => pause.startFrame > 0 && pause.startFrame < frameCount - activity.sampleRate * 0.25,
  )
  const columns = pauses.length + 1
  const costs = new Float64Array((anchors.length + 1) * columns)
  const operations = new Uint8Array(costs.length)
  costs.fill(Number.POSITIVE_INFINITY)
  costs[0] = 0
  const indexOf = (anchorCount: number, pauseCount: number): number => anchorCount * columns + pauseCount

  // Match in order while allowing unspoken punctuation and unmarked prosodic pauses on either side.
  for (let anchorCount = 0; anchorCount <= anchors.length; anchorCount += 1) {
    for (let pauseCount = 0; pauseCount <= pauses.length; pauseCount += 1) {
      if (anchorCount === 0 && pauseCount === 0) continue
      const index = indexOf(anchorCount, pauseCount)
      if (anchorCount > 0) {
        const anchor = anchors[anchorCount - 1]!
        const cost = costs[indexOf(anchorCount - 1, pauseCount)]! + (anchor.strength === 2 ? 1 : 0.9)
        if (cost < costs[index]!) {
          costs[index] = cost
          operations[index] = 1
        }
      }
      if (pauseCount > 0) {
        const cost = costs[indexOf(anchorCount, pauseCount - 1)]! + 0.2
        if (cost < costs[index]!) {
          costs[index] = cost
          operations[index] = 2
        }
      }
      if (anchorCount > 0 && pauseCount > 0) {
        const anchor = anchors[anchorCount - 1]!
        const pause = pauses[pauseCount - 1]!
        const pauseProgress = (pause.startFrame + pause.endFrame) / 2 / frameCount
        const positionDifference = Math.abs(anchor.expectedProgress - pauseProgress)
        const maximumPositionDifference = anchor.strength === 2 ? 0.15 : 0.1
        if (positionDifference > maximumPositionDifference) continue
        const pauseSeconds = (pause.endFrame - pause.startFrame) / activity.sampleRate
        const durationPenalty = pauseSeconds < 0.14 ? (anchor.strength === 2 ? 1 : 0.3) : 0
        const cost = costs[indexOf(anchorCount - 1, pauseCount - 1)]! + positionDifference * 4 + durationPenalty
        if (cost <= costs[index]!) {
          costs[index] = cost
          operations[index] = 3
        }
      }
    }
  }

  const matches = new Map<number, SpeechPause>()
  let anchorCount = anchors.length
  let pauseCount = pauses.length
  while (anchorCount > 0 || pauseCount > 0) {
    const operation = operations[indexOf(anchorCount, pauseCount)]
    if (operation === 3) {
      matches.set(anchors[anchorCount - 1]!.wordIndex, pauses[pauseCount - 1]!)
      anchorCount -= 1
      pauseCount -= 1
    } else if (operation === 2) pauseCount -= 1
    else if (operation === 1) anchorCount -= 1
    else break
  }
  return matches
}

function alignWordRange(
  words: TimedWord[],
  wordWeights: readonly number[],
  activity: SpeechActivity,
  firstWord: number,
  finalWord: number,
  startFrame: number,
  endFrame: number,
): void {
  const totalSpeechWeight = speechWeightBetween(activity, startFrame, endFrame)
  const totalWordWeight = wordWeights.slice(firstWord, finalWord + 1).reduce((total, weight) => total + weight, 0)
  let elapsedWordWeight = 0
  for (let wordIndex = firstWord; wordIndex <= finalWord; wordIndex += 1) {
    const startProgress = elapsedWordWeight / totalWordWeight
    elapsedWordWeight += wordWeights[wordIndex]!
    const endProgress = elapsedWordWeight / totalWordWeight
    if (totalSpeechWeight <= 0) {
      words[wordIndex]!.startFrame = Math.round(startFrame + (endFrame - startFrame) * startProgress)
      words[wordIndex]!.endFrame = Math.round(startFrame + (endFrame - startFrame) * endProgress)
      continue
    }
    words[wordIndex]!.startFrame = frameAtSpeechWeightBetween(
      startProgress * totalSpeechWeight,
      activity,
      totalSpeechWeight,
      startFrame,
      endFrame,
    )
    words[wordIndex]!.endFrame = frameAtSpeechWeightBetween(
      endProgress * totalSpeechWeight,
      activity,
      totalSpeechWeight,
      startFrame,
      endFrame,
    )
  }
}

export function buildTranscriptTimeline(text: string, audio: PcmWav): TranscriptTimeline {
  const tokenized = tokenizeTranscript(text)
  if (tokenized.wordParts.length === 0) return { parts: tokenized.parts, words: [], lineCount: tokenized.lineCount }
  const activity = activeSpeechWindows(audio)
  const wordWeights = tokenized.wordParts.map((partIndex) => wordWeight(tokenized.parts[partIndex]!.text))
  const words = tokenized.wordParts.map((partIndex, wordIndex) => {
    const part = tokenized.parts[partIndex]!
    part.wordIndex = wordIndex
    return {
      text: part.text,
      partIndex,
      lineIndex: part.lineIndex,
      emphasis: part.emphasis,
      startFrame: 0,
      endFrame: 0,
    }
  })
  const matches = matchAnchorsToPauses(transcriptAnchors(tokenized, wordWeights), activity, audio.frameCount)
  let firstWord = 0
  let startFrame = 0
  for (const [wordIndex, pause] of [...matches].sort((left, right) => left[0] - right[0])) {
    alignWordRange(words, wordWeights, activity, firstWord, wordIndex, startFrame, pause.startFrame)
    firstWord = wordIndex + 1
    startFrame = Math.max(pause.startFrame, pause.endFrame - activity.windowFrames * SPEECH_ONSET_PADDING_WINDOWS)
  }
  alignWordRange(words, wordWeights, activity, firstWord, words.length - 1, startFrame, audio.frameCount)
  return { parts: tokenized.parts, words, lineCount: tokenized.lineCount }
}

export function wordIndexAtFrame(words: readonly TimedWord[], frame: number): number {
  if (words.length === 0 || frame < words[0]!.startFrame) return -1
  let low = 0
  let high = words.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (words[middle]!.startFrame <= frame) low = middle + 1
    else high = middle - 1
  }
  return Math.min(words.length - 1, Math.max(0, high))
}

export function activeWordIndexAtFrame(words: readonly TimedWord[], frame: number): number {
  const wordIndex = wordIndexAtFrame(words, frame)
  return wordIndex >= 0 && frame < words[wordIndex]!.endFrame ? wordIndex : -1
}

export async function loadAudioTextRecordings(pairs: readonly AudioTextPair[]): Promise<AudioTextRecording[]> {
  return Promise.all(
    pairs.map(async (pair) => {
      const [text, audioBytes] = await Promise.all([readFile(pair.textPath, "utf8"), readFile(pair.audioPath)])
      const audio = parsePcmWav(audioBytes)
      return {
        ...pair,
        name: basename(pair.textPath, extname(pair.textPath)),
        audio,
        transcript: buildTranscriptTimeline(text, audio),
      }
    }),
  )
}
