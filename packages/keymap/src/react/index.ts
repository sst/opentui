import type { KeyEvent, Renderable } from "@opentui/core"
import {
  type ActiveKey,
  type ActiveKeyOptions,
  type Layer,
  type Keymap,
  type ReactiveMatcher,
  type KeySequencePart,
  type TargetMode,
} from "../index.js"
import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type DependencyList,
  type ReactNode,
} from "react"

type OpenTuiKeymap = Keymap<Renderable, KeyEvent>

const KeymapContext = createContext<OpenTuiKeymap | null>(null)

export interface KeymapProviderProps {
  keymap: OpenTuiKeymap
  children?: ReactNode
}

export function KeymapProvider({ keymap, children }: KeymapProviderProps) {
  return createElement(KeymapContext.Provider, { value: keymap }, children)
}

export interface UseBindingsTargetRef<TRenderable extends Renderable = Renderable> {
  current: TRenderable | null
}

export interface UseBindingsLayer<TRenderable extends Renderable = Renderable> extends Omit<
  Layer<Renderable, KeyEvent>,
  "target" | "targetMode"
> {
  targetRef?: UseBindingsTargetRef<TRenderable>
  targetMode?: TargetMode
}

function resolveBindingsTarget(targetRef: UseBindingsTargetRef | undefined): Renderable | undefined {
  return targetRef?.current ?? undefined
}

export const useKeymap = (): OpenTuiKeymap => {
  const keymap = useContext(KeymapContext)

  if (!keymap) {
    throw new Error("Keymap not found. Wrap the tree in <KeymapProvider>.")
  }

  return keymap
}

// Use the batched `state` event for derived reads. Pending-sequence changes
// already flow through `state`, so subscribing to both would duplicate work.
function useKeymapStateVersion(keymap: OpenTuiKeymap): number {
  const [version, bumpVersion] = useReducer((value: number) => value + 1, 0)

  useLayoutEffect(() => {
    const dispose = keymap.on("state", () => {
      bumpVersion()
    })

    return () => {
      dispose()
    }
  }, [keymap])

  return version
}

export const useActiveKeys = (options?: ActiveKeyOptions): readonly ActiveKey[] => {
  const keymap = useKeymap()
  const version = useKeymapStateVersion(keymap)

  return useMemo(() => {
    void version
    return keymap.getActiveKeys(options)
  }, [keymap, options, version])
}

export const usePendingSequence = (): readonly KeySequencePart[] => {
  const keymap = useKeymap()
  const version = useKeymapStateVersion(keymap)

  return useMemo(() => {
    void version
    return keymap.getPendingSequence()
  }, [keymap, version])
}

export function useBindings<TRenderable extends Renderable = Renderable>(
  createLayer: () => UseBindingsLayer<TRenderable>,
  deps: DependencyList = [],
): void {
  const keymap = useKeymap()
  const layer = useMemo(createLayer, deps)
  const layerRef = useRef(layer)
  const disposeRef = useRef<(() => void) | undefined>(undefined)
  const registeredLayerRef = useRef<UseBindingsLayer<TRenderable> | undefined>(undefined)
  const registeredTargetModeRef = useRef<TargetMode | undefined>(undefined)
  const registeredTargetRef = useRef<Renderable | undefined>(undefined)

  layerRef.current = layer

  const unregister = useCallback(() => {
    disposeRef.current?.()
    disposeRef.current = undefined
    registeredLayerRef.current = undefined
    registeredTargetModeRef.current = undefined
    registeredTargetRef.current = undefined
  }, [])

  useEffect(() => {
    const currentLayer = layerRef.current
    const hasExplicitTarget = currentLayer.targetRef !== undefined
    const explicitTarget = resolveBindingsTarget(currentLayer.targetRef)
    const nextTargetMode = currentLayer.targetMode ?? (hasExplicitTarget ? "focus-within" : undefined)
    const nextTarget = nextTargetMode ? explicitTarget : undefined

    if (!hasExplicitTarget && nextTargetMode) {
      throw new Error("useBindings local bindings need a targetRef")
    }

    if (
      registeredLayerRef.current === currentLayer &&
      registeredTargetModeRef.current === nextTargetMode &&
      registeredTargetRef.current === nextTarget
    ) {
      return
    }

    unregister()

    if (!nextTarget && nextTargetMode) {
      registeredLayerRef.current = currentLayer
      registeredTargetModeRef.current = nextTargetMode
      registeredTargetRef.current = undefined
      return
    }

    const { targetRef: _targetRef, targetMode: _targetMode, ...baseLayer } = currentLayer
    disposeRef.current = keymap.registerLayer(
      !nextTargetMode
        ? {
            ...baseLayer,
          }
        : {
            ...baseLayer,
            target: nextTarget!,
            targetMode: nextTargetMode,
          },
    )
    registeredLayerRef.current = currentLayer
    registeredTargetModeRef.current = nextTargetMode
    registeredTargetRef.current = nextTarget
  })

  useEffect(() => {
    return () => {
      unregister()
    }
  }, [unregister])
}

/**
 * Adapts any `subscribe` + `getSnapshot` store to
 * `ReactiveMatcher`. Pass `predicate` when the snapshot value is not
 * already boolean.
 */
export function reactiveMatcherFromStore<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
  predicate?: (value: T) => boolean,
): ReactiveMatcher {
  return {
    get() {
      return predicate ? predicate(getSnapshot()) : Boolean(getSnapshot())
    },
    subscribe(onChange) {
      return subscribe(onChange)
    },
  }
}
