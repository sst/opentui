import {
  engine,
  findClosestKeyboardScope,
  PasteEvent,
  Renderable,
  Selection,
  Timeline,
  type CliRenderer,
  type KeyEvent,
  type TimelineOptions,
} from "@opentui/core"
import { createContext, createSignal, onCleanup, onMount, useContext } from "solid-js"

export const RendererContext = createContext<CliRenderer>()

export const useRenderer = () => {
  const renderer = useContext(RendererContext)

  if (!renderer) {
    throw new Error("No renderer found")
  }

  return renderer
}

export const onResize = (callback: (width: number, height: number) => void) => {
  const renderer = useRenderer()

  onMount(() => {
    renderer.on("resize", callback)
  })

  onCleanup(() => {
    renderer.off("resize", callback)
  })
}

export const useTerminalDimensions = () => {
  const renderer = useRenderer()
  const [terminalDimensions, setTerminalDimensions] = createSignal<{
    width: number
    height: number
  }>({ width: renderer.width, height: renderer.height })

  const callback = (width: number, height: number) => {
    setTerminalDimensions({ width, height })
  }

  onResize(callback)

  return terminalDimensions
}

// ── Keyboard hooks ───────────────────────────────────────────────────

export interface UseKeyboardOptions {
  /** Include release events - callback receives events with eventType: "release" */
  release?: boolean
  /** Ref used to discover the nearest keyboard scope. Falls back to global when none exists. */
  ref?: () => Renderable
}

export const useKeyboard = (callback: (key: KeyEvent) => void, options?: UseKeyboardOptions) => {
  const renderer = useRenderer()

  onMount(() => {
    const refTarget = options?.ref?.()
    const target: Renderable | ReturnType<typeof useRenderer>["keyInput"] =
      (refTarget ? findClosestKeyboardScope(refTarget) : null) ?? renderer.keyInput
    target.on("keypress", callback)
    if (options?.release) target.on("keyrelease", callback)

    onCleanup(() => {
      target.off("keypress", callback)
      if (options?.release) target.off("keyrelease", callback)
    })
  })
}

export const usePaste = (callback: (event: PasteEvent) => void) => {
  const renderer = useRenderer()
  const keyHandler = renderer.keyInput
  onMount(() => {
    keyHandler.on("paste", callback)
  })

  onCleanup(() => {
    keyHandler.off("paste", callback)
  })
}

/**
 * @deprecated renamed to useKeyboard
 */
export const useKeyHandler = useKeyboard

export const useSelectionHandler = (callback: (selection: Selection) => void) => {
  const renderer = useRenderer()

  onMount(() => {
    renderer.on("selection", callback)
  })

  onCleanup(() => {
    renderer.off("selection", callback)
  })
}

export const useTimeline = (options: TimelineOptions = {}): Timeline => {
  const timeline = new Timeline(options)

  onMount(() => {
    if (options.autoplay !== false) {
      timeline.play()
    }
    engine.register(timeline)
  })

  onCleanup(() => {
    timeline.pause()
    engine.unregister(timeline)
  })

  return timeline
}
