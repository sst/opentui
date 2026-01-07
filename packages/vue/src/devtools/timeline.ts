import { LayoutEvents, type CliRenderer, type Renderable } from "@opentui/core"
import { VUE_COLORS } from "./theme"

export const TIMELINE_RENDER = "opentui:render"
export const TIMELINE_LAYOUT = "opentui:layout"
export const TIMELINE_EVENTS = "opentui:events"

interface TimelineApi {
  now(): number
  addTimelineLayer(options: { id: string; label: string; color: number }): void
  addTimelineEvent(options: {
    layerId: string
    event: { time: number; title?: string; subtitle?: string; data?: Record<string, unknown> }
  }): void
  on: {
    inspectTimelineEvent(
      handler: (payload: {
        layerId: string
        event: { time: number; title?: string; subtitle?: string; data?: Record<string, unknown> }
        data: unknown
      }) => void,
    ): void
  }
}

const LAYERS = [
  { id: TIMELINE_RENDER, label: "OpenTUI Render", color: VUE_COLORS.primary },
  { id: TIMELINE_LAYOUT, label: "OpenTUI Layout", color: VUE_COLORS.secondary },
  { id: TIMELINE_EVENTS, label: "OpenTUI Events", color: VUE_COLORS.dark },
] as const

export function setupTimeline(api: unknown, cliRenderer: CliRenderer): () => void {
  const timelineApi = api as TimelineApi
  const cleanups: (() => void)[] = []

  LAYERS.forEach((layer) => timelineApi.addTimelineLayer(layer))

  timelineApi.on.inspectTimelineEvent((payload) => {
    const isOurLayer = LAYERS.some((l) => l.id === payload.layerId)
    if (!isOurLayer) return

    payload.data = {
      ...payload.event.data,
      time: payload.event.time,
      title: payload.event.title,
      subtitle: payload.event.subtitle,
    }
  })

  const emit = (layerId: string, title: string, subtitle: string, data?: Record<string, unknown>) => {
    timelineApi.addTimelineEvent({ layerId, event: { time: timelineApi.now(), title, subtitle, data } })
  }

  let frameCount = 0
  const frameCallback = async (deltaTime: number): Promise<void> => {
    frameCount++
    const fps = deltaTime > 0 ? Math.round(1000 / deltaTime) : 0
    emit(TIMELINE_RENDER, "Frame Rendered", `${deltaTime.toFixed(1)}ms`, {
      frameTime: deltaTime,
      fps,
      nodeCount: countRenderables(cliRenderer.root),
      frameNumber: frameCount,
    })
  }

  cliRenderer.setFrameCallback(frameCallback)
  cleanups.push(() => cliRenderer.removeFrameCallback(frameCallback))

  const root = cliRenderer.root

  const handlers = {
    [LayoutEvents.LAYOUT_CHANGED]: () =>
      emit(TIMELINE_LAYOUT, "Layout Changed", root.id, { rootId: root.id, width: root.width, height: root.height }),
    [LayoutEvents.ADDED]: (child: Renderable) =>
      emit(TIMELINE_LAYOUT, "Node Added", child?.id ?? "unknown", { nodeId: child?.id, parentId: root.id }),
    [LayoutEvents.REMOVED]: (child: Renderable) =>
      emit(TIMELINE_LAYOUT, "Node Removed", child?.id ?? "unknown", { nodeId: child?.id, parentId: root.id }),
    [LayoutEvents.RESIZED]: (d: { width: number; height: number }) =>
      emit(TIMELINE_LAYOUT, "Root Resized", `${d.width}x${d.height}`, d),
  } as const

  Object.entries(handlers).forEach(([event, handler]) => {
    root.on(event, handler as (...args: unknown[]) => void)
    cleanups.push(() => root.off(event, handler as (...args: unknown[]) => void))
  })

  return () => cleanups.forEach((fn) => fn())
}

function countRenderables(renderable: Renderable): number {
  return 1 + renderable.getChildren().reduce((sum, child) => sum + countRenderables(child as Renderable), 0)
}
