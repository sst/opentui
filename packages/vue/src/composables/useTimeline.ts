import { onMounted, onUnmounted } from "vue"
import { engine, Timeline, type TimelineOptions } from "@opentui/core"

export function useTimeline(options: TimelineOptions = {}): Timeline {
  const timeline = new Timeline(options)

  onMounted(() => {
    if (options.autoplay !== false) {
      timeline.play()
    }
    engine.register(timeline)
  })

  onUnmounted(() => {
    timeline.pause()
    engine.unregister(timeline)
  })

  return timeline
}
