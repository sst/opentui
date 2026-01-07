import { defineComponent, Fragment, h, onMounted, onUnmounted, watch, type PropType, type VNode, shallowRef } from "vue"
import { BoxRenderable, type Renderable } from "@opentui/core"
import { useCliRenderer } from "../composables/useCliRenderer"
import { createOpenTUIRenderer } from "../renderer"

let portalId = 0

export const Portal = defineComponent({
  name: "Portal",
  props: {
    to: {
      type: Object as PropType<Renderable>,
      default: undefined,
    },
  },
  setup(props, { slots }) {
    const cliRenderer = useCliRenderer()
    const id = `portal-${++portalId}`
    const opentuiRenderer = createOpenTUIRenderer(cliRenderer)

    let container: BoxRenderable | null = null
    let currentTarget: Renderable | null = null
    let isMounted = false
    let instanceId = 0

    const childrenRef = shallowRef<VNode[] | null>(null)

    const getTarget = (): Renderable => props.to || cliRenderer.root

    const createNewContainer = (): BoxRenderable => {
      instanceId++
      return new BoxRenderable(cliRenderer, { id: `${id}-${instanceId}` })
    }

    const destroyCurrentContainer = () => {
      if (container && currentTarget) {
        try {
          opentuiRenderer.render(null, container)
        } catch {}
        try {
          currentTarget.remove(container.id)
        } catch {}
        try {
          container.destroyRecursively()
        } catch {}
        container = null
        currentTarget = null
      }
    }

    const attachToTarget = () => {
      if (!isMounted) return

      const target = getTarget()

      if (currentTarget === target && container) {
        return
      }

      destroyCurrentContainer()

      container = createNewContainer()
      try {
        target.add(container)
      } catch {}
      currentTarget = target

      renderChildren()
    }

    const renderChildren = () => {
      if (!isMounted || !container) return

      const children = childrenRef.value

      if (!children || children.length === 0) {
        try {
          opentuiRenderer.render(null, container)
        } catch {}
        return
      }

      try {
        opentuiRenderer.render(h(Fragment, children), container)
      } catch {}
    }

    onMounted(() => {
      isMounted = true
      attachToTarget()
    })

    onUnmounted(() => {
      isMounted = false
      destroyCurrentContainer()
    })

    watch(
      () => props.to,
      () => {
        attachToTarget()
      },
    )

    watch(
      childrenRef,
      () => {
        renderChildren()
      },
      { flush: "post" },
    )

    return () => {
      const children = slots.default?.()
      childrenRef.value = (children as VNode[] | undefined) ?? null
      return null
    }
  },
})

export type PortalProps = InstanceType<typeof Portal>["$props"]
