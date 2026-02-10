import type { TestRenderer } from "./test-renderer"

export interface RecordBuffersOptions {
  fg?: boolean
  bg?: boolean
  attributes?: boolean
}

export interface RecordedBuffers {
  fg?: Float32Array
  bg?: Float32Array
  attributes?: Uint8Array
}

export interface RecordedFrame {
  frame: string
  timestamp: number
  frameNumber: number
  buffers?: RecordedBuffers
}

export interface TestRecorderOptions {
  recordBuffers?: RecordBuffersOptions
  now?: () => number
}

/**
 * TestRecorder records frames from a TestRenderer by hooking into the render pipeline.
 * It captures the character frame after each native render pass.
 */
export class TestRecorder {
  private renderer: TestRenderer
  private frames: RecordedFrame[] = []
  private recording: boolean = false
  private frameNumber: number = 0
  private startTime: number = 0
  private originalRenderNative?: () => void
  private decoder = new TextDecoder()
  private recordBuffers: RecordBuffersOptions
  private now: () => number

  constructor(renderer: TestRenderer, options?: TestRecorderOptions) {
    this.renderer = renderer
    this.recordBuffers = options?.recordBuffers || {}
    this.now = options?.now ?? (() => performance.now())
  }

  /**
   * Start recording frames. This hooks into the renderer's renderNative method.
   */
  public rec(): void {
    if (this.recording) {
      return
    }

    this.recording = true
    this.frames = []
    this.frameNumber = 0
    this.startTime = this.now()

    // Store the original renderNative method
    this.originalRenderNative = this.renderer["renderNative"].bind(this.renderer)

    // Override renderNative to capture frames after each render
    this.renderer["renderNative"] = () => {
      // Call the original renderNative
      this.originalRenderNative!()

      // Capture the frame after rendering
      this.captureFrame()
    }
  }

  /**
   * Stop recording frames and restore the original renderNative method.
   */
  public stop(): void {
    if (!this.recording) {
      return
    }

    this.recording = false

    // Restore the original renderNative method
    if (this.originalRenderNative) {
      this.renderer["renderNative"] = this.originalRenderNative
      this.originalRenderNative = undefined
    }
  }

  /**
   * Get the recorded frames.
   */
  public get recordedFrames(): RecordedFrame[] {
    return [...this.frames]
  }

  /**
   * Clear all recorded frames.
   */
  public clear(): void {
    this.frames = []
    this.frameNumber = 0
  }

  /**
   * Check if currently recording.
   */
  public get isRecording(): boolean {
    return this.recording
  }

  /**
   * Capture the current frame from the renderer's buffer.
   */
  private captureFrame(): void {
    const currentBuffer = this.renderer.currentRenderBuffer
    const frameBytes = currentBuffer.getRealCharBytes(true)
    const frame = this.decoder.decode(frameBytes)

    const recordedFrame: RecordedFrame = {
      frame,
      timestamp: this.now() - this.startTime,
      frameNumber: this.frameNumber++,
    }

    // Optionally record buffer data from currentRenderBuffer
    if (this.recordBuffers.fg || this.recordBuffers.bg || this.recordBuffers.attributes) {
      const buffers = currentBuffer.buffers
      recordedFrame.buffers = {}

      if (this.recordBuffers.fg) {
        recordedFrame.buffers.fg = new Float32Array(buffers.fg)
      }
      if (this.recordBuffers.bg) {
        recordedFrame.buffers.bg = new Float32Array(buffers.bg)
      }
      if (this.recordBuffers.attributes) {
        recordedFrame.buffers.attributes = new Uint8Array(buffers.attributes)
      }
    }

    this.frames.push(recordedFrame)
  }
}
