import {
  getKeyHandler,
  Selection,
  Timeline,
  type AnimationOptions,
  type CliRenderer,
  type JSAnimation,
  type ParsedKey,
  type SelectionState,
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

export const useKeyHandler = (callback: (key: ParsedKey) => void) => {
  const keyHandler = getKeyHandler()
  onMount(() => {
    keyHandler.on("keypress", callback)
  })

  onCleanup(() => {
    keyHandler.off("keypress", callback)
  })
}

export const useSelectionHandler = (callback: (selection: Selection) => void) => {
  const renderer = useRenderer()

  onMount(() => {
    renderer.on("selection", callback)
  })

  onCleanup(() => {
    renderer.off("selection", callback)
  })
}

export const createComponentTimeline = (options: TimelineOptions = {}): Timeline => {
  const renderer = useRenderer()
  const timeline = new Timeline(options)

  const frameCallback = async (dt: number) => timeline.update(dt)

  onMount(() => {
    if (options.autoplay !== false) {
      timeline.play()
    }
    renderer.setFrameCallback(frameCallback)
  })

  onCleanup(() => {
    renderer.removeFrameCallback(frameCallback)
    timeline.pause()
  })

  return timeline
}

export const useTimeline = <T extends Record<string, number>>(
  timeline: Timeline,
  initialValue: T,
  targetValue: T,
  options: AnimationOptions & { onUpdate?: (values: JSAnimation & { targets: T[] }) => void },
  startTime: number | string = 0,
) => {
  const [store, setStore] = createSignal<T>(initialValue)

  const { onUpdate, ...animationOptions } = options

  timeline.add(
    store(),
    {
      ...targetValue,
      ...animationOptions,
      onUpdate: (values: JSAnimation) => {
        setStore({ ...values.targets[0] })
        onUpdate?.(values)
      },
    },
    startTime,
  )

  return store
}
