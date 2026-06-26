export class AudioAnalysisBuffer {
  readonly windowFrames: number
  readonly channels: number
  private readonly samples: Float32Array
  private samplesBuffered = 0

  constructor(windowFrames: number, channels: number) {
    if (!Number.isInteger(windowFrames) || windowFrames <= 0) throw new RangeError("windowFrames must be positive")
    if (!Number.isInteger(channels) || channels <= 0) throw new RangeError("channels must be positive")
    this.windowFrames = windowFrames
    this.channels = channels
    this.samples = new Float32Array(windowFrames * channels)
  }

  get framesBuffered(): number {
    return this.samplesBuffered / this.channels
  }

  append(pcm: Float32Array, emit: (window: Float32Array) => void): number {
    if (pcm.length % this.channels !== 0) throw new RangeError("PCM samples must contain complete frames")
    let windowsEmitted = 0
    let offset = 0
    while (offset < pcm.length) {
      const copyLength = Math.min(this.samples.length - this.samplesBuffered, pcm.length - offset)
      this.samples.set(pcm.subarray(offset, offset + copyLength), this.samplesBuffered)
      this.samplesBuffered += copyLength
      offset += copyLength
      if (this.samplesBuffered === this.samples.length) {
        emit(this.samples)
        windowsEmitted += 1
        this.samplesBuffered = 0
      }
    }
    return windowsEmitted
  }

  reset(): void {
    this.samplesBuffered = 0
  }
}

export function audioTapReadFrames(
  deltaMs: number,
  sampleRate: number,
  windowFrames: number,
  capacityFrames: number,
): number {
  const elapsedFrames = Math.ceil((Math.max(0, deltaMs) * sampleRate) / 1000)
  return Math.min(capacityFrames, Math.max(windowFrames * 2, elapsedFrames + windowFrames))
}

export function audioDecayDeltaMs(
  elapsedMs: number,
  lastAnalysisAtMs: number,
  deltaMs: number,
  graceMs: number,
): number {
  const timeBeyondGrace = elapsedMs - lastAnalysisAtMs - graceMs
  return Math.min(Math.max(0, deltaMs), Math.max(0, timeBeyondGrace))
}
