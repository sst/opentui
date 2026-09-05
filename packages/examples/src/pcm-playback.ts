#!/usr/bin/env bun

// Run: bun src/pcm-playback.ts [--headless]
import { Audio } from "@opentui/core"

const headless = process.argv.includes("--headless")
const audio = Audio.create({ autoStart: false })
const controller = new AbortController()
const onInterrupt = () => controller.abort()
process.once("SIGINT", onInterrupt)
audio.on("error", (error) => console.error(error.message))
let mixer: ReturnType<typeof setInterval> | undefined

try {
  if (!(headless ? audio.startMixer() : audio.start())) throw new Error("Unable to start audio output")
  if (headless) mixer = setInterval(() => audio.mixFrames(480), 10)
  const stream = audio.createPcmStream({ sampleRate: 44100, channels: 1, signal: controller.signal })
  // A generated source can reuse this allocation after each awaited write.
  const chunk = new Float32Array(441)
  for (let offset = 0; offset < 44100 * 2; offset += chunk.length) {
    for (let i = 0; i < chunk.length; i++) {
      const time = (offset + i) / 44100
      const envelope = Math.min(1, time * 20, (2 - time) * 20)
      chunk[i] = Math.sin(2 * Math.PI * 440 * time) * 0.15 * envelope
    }
    await stream.write(chunk)
  }
  await stream.end()
  console.log(stream.getStats())
} catch (error) {
  if (!(error instanceof Error && error.name === "AbortError")) throw error
} finally {
  if (mixer !== undefined) clearInterval(mixer)
  process.removeListener("SIGINT", onInterrupt)
  audio.dispose()
}
