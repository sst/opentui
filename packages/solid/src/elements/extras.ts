import { createEffect, createMemo, getOwner, onCleanup, runWithOwner, splitProps, untrack } from "solid-js"
import { createAnchorNode, createElement, insert, spread, type DomNode } from "../reconciler"
import type { JSX } from "../../jsx-runtime"
import type { ValidComponent, ComponentProps } from "solid-js"
import { useRenderer } from "./hooks"

export function Portal(props: { mount?: DomNode; ref?: (el: {}) => void; children: JSX.Element }) {
  const renderer = useRenderer()

  const marker = createAnchorNode(renderer),
    mount = () => props.mount || renderer.root,
    owner = getOwner()
  let content: undefined | (() => JSX.Element)

  createEffect(
    () => {
      // basically we backdoor into a sort of renderEffect here
      content || (content = runWithOwner(owner, () => createMemo(() => props.children)))
      const el = mount()
      const container = createElement("box"),
        renderRoot = container

      Object.defineProperty(container, "_$host", {
        get() {
          return marker.parent
        },
        configurable: true,
      })
      insert(renderRoot, content)
      el.add(container)
      props.ref && (props as any).ref(container)
      onCleanup(() => el.remove(container.id))
    },
    undefined,
    { render: true },
  )
  return marker
}

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K]
} & {
  component: T | undefined
}

/**
 * Renders an arbitrary component or element with the given props
 *
 * This is a lower level version of the `Dynamic` component, useful for
 * performance optimizations in libraries. Do not use this unless you know
 * what you are doing.
 * ```typescript
 * const element = () => multiline() ? 'textarea' : 'input';
 * createDynamic(element, { value: value() });
 * ```
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function createDynamic<T extends ValidComponent>(
  component: () => T | undefined,
  props: ComponentProps<T>,
): JSX.Element {
  const cached = createMemo<Function | string | undefined>(component)
  return createMemo(() => {
    const component = cached()
    switch (typeof component) {
      case "function":
        // if (isDev) Object.assign(component, { [$DEVCOMP]: true })
        return untrack(() => component(props))

      case "string":
        const el = createElement(component)
        spread(el, props)
        return el

      default:
        break
    }
  }) as unknown as JSX.Element
}

/**
 * Renders an arbitrary custom or native component and passes the other props
 * ```typescript
 * <Dynamic component={multiline() ? 'textarea' : 'input'} value={value()} />
 * ```
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const [, others] = splitProps(props, ["component"])
  return createDynamic(() => props.component, others as ComponentProps<T>)
}
