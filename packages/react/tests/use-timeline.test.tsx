import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test"
import { useTimeline } from "../src/hooks/use-timeline.js"
import { testRender } from "../src/test-utils.js"

let testSetup: Awaited<ReturnType<typeof testRender>>

function Probe({ autoplay, onTimeline }: { autoplay?: boolean; onTimeline: (t: ReturnType<typeof useTimeline>) => void }) {
  const timeline = useTimeline(autoplay === undefined ? {} : { autoplay })
  onTimeline(timeline)
  return null
}

describe("useTimeline autoplay", () => {
  let originalConsoleError: (...args: any[]) => void

  beforeAll(() => {
    originalConsoleError = console.error
    console.error = mock(() => {})
  })

  afterAll(() => {
    console.error = originalConsoleError
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  it("plays by default when autoplay is not specified", async () => {
    let timeline: ReturnType<typeof useTimeline> | undefined
    testSetup = await testRender(<Probe onTimeline={(t) => (timeline = t)} />, { width: 10, height: 5 })
    await testSetup.renderOnce()
    expect(timeline!.isPlaying).toBe(true)
  })

  it("plays when autoplay is explicitly true", async () => {
    let timeline: ReturnType<typeof useTimeline> | undefined
    testSetup = await testRender(<Probe autoplay={true} onTimeline={(t) => (timeline = t)} />, {
      width: 10,
      height: 5,
    })
    await testSetup.renderOnce()
    expect(timeline!.isPlaying).toBe(true)
  })

  it("does not play when autoplay is explicitly false", async () => {
    let timeline: ReturnType<typeof useTimeline> | undefined
    testSetup = await testRender(<Probe autoplay={false} onTimeline={(t) => (timeline = t)} />, {
      width: 10,
      height: 5,
    })
    await testSetup.renderOnce()
    expect(timeline!.isPlaying).toBe(false)
  })
})
