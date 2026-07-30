import { expect, test } from "bun:test"
import { resolveRenderLib } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { destroy, run } from "./audio-capture-demo.js"

function replaceMethod(target: object, name: string, replacement: unknown): () => void {
  const previous = Object.getOwnPropertyDescriptor(target, name)
  Object.defineProperty(target, name, { configurable: true, writable: true, value: replacement })
  return () => {
    if (previous) Object.defineProperty(target, name, previous)
    else delete (target as Record<string, unknown>)[name]
  }
}

test("capture demo presents a failed capture stream as errored", async () => {
  const lib = resolveRenderLib()
  let statsCalls = 0
  const restores = [
    replaceMethod(lib, "audioRefreshCaptureDevices", () => 0),
    replaceMethod(lib, "audioGetCaptureDeviceCount", () => 1),
    replaceMethod(lib, "audioGetCaptureDeviceName", () => "Test Microphone"),
    replaceMethod(lib, "audioIsCaptureDeviceDefault", () => true),
    replaceMethod(lib, "audioSelectCaptureDevice", () => 0),
    replaceMethod(lib, "audioStartCapture", () => 0),
    replaceMethod(lib, "audioStopCapture", () => 0),
    replaceMethod(lib, "audioIsCaptureRunning", () => true),
    replaceMethod(lib, "audioGetCaptureStats", () => {
      statsCalls += 1
      if (statsCalls >= 3) return { status: -5, stats: null }
      return {
        status: 0,
        stats: {
          framesReceived: 0n,
          framesRead: 0n,
          framesDropped: 0n,
          sampleRate: 48_000,
          channels: 1,
          bufferedFrames: 0,
          capacityFrames: 48_000,
        },
      }
    }),
  ]
  const setup = await createTestRenderer({ width: 100, height: 24 })
  try {
    run(setup.renderer)
    let frame = ""
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await setup.renderOnce()
      frame = setup.captureCharFrame()
      if (frame.includes("stats: Audio capture stream stats failed")) break
    }
    expect(frame).toContain("ERRORED")
  } finally {
    destroy(setup.renderer)
    setup.renderer.destroy()
    for (const restore of restores.reverse()) restore()
  }
})
