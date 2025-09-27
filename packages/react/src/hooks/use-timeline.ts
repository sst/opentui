import { engine, Timeline, type TimelineOptions } from "@opentui/core"
import { useEffect } from "react"

export const useTimeline = (options: TimelineOptions = {}) => {
  const timeline = new Timeline(options)

  useEffect(() => {
    if (!options.autoplay) {
      timeline.play()
    }

    engine.register(timeline)

    return () => {
      timeline.pause()
      engine.unregister(timeline)
    }
  }, [])

  return timeline
}
