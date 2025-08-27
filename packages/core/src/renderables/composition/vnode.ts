import { Renderable, type RenderableOptions } from "../../Renderable"
import type { RenderContext } from "../../types"
import { BoxRenderable, GroupRenderable, TextRenderable, type BoxOptions, type TextOptions } from "../.."

export type VChild = VNode | Renderable | null | undefined | false

export interface VNode<P = any> {
  type: Component<P>
  props?: P
  children?: VChild[]
  __hostId?: string
}

export interface RenderableConstructor<P extends RenderableOptions = RenderableOptions> {
  new (ctx: RenderContext, options: P): Renderable
}

export type FunctionComponent<P = any> = (props: P, children?: VChild[]) => VNode

export type Component<P = any> = RenderableConstructor<P extends RenderableOptions ? P : never> | FunctionComponent<P>

function isRenderableConstructor(value: any): value is RenderableConstructor<any> {
  return typeof value === "function" && value.prototype && Renderable.prototype.isPrototypeOf(value.prototype)
}

function ensureFlatAndFilter(children: VChild[] | undefined): VChild[] {
  if (!children || children.length === 0) return []
  const result: VChild[] = []
  for (const child of children) {
    if (Array.isArray(child)) {
      throw new TypeError("VNode children must be flat. Spread nested arrays with ...children.")
    }
    if (child !== null && child !== undefined && child !== false) {
      result.push(child)
    }
  }
  return result
}

export function h<P>(type: Component<P>, props?: P, children?: VChild[]): VNode<P> {
  return { type, props, children: ensureFlatAndFilter(children) }
}

export function instantiate(ctx: RenderContext, node: VChild): Renderable {
  if (node instanceof Renderable) return node

  if (!node || typeof node !== "object") {
    throw new TypeError("mount() received an invalid vnode")
  }

  const vnode = node as VNode
  const { type, props } = vnode
  const children = ensureFlatAndFilter(vnode.children || [])
  const hostId = (vnode as any).__hostId as string | undefined

  if (isRenderableConstructor(type)) {
    const instance = new type(ctx, (props || {}) as any)
    for (const child of children) {
      if (child instanceof Renderable) {
        instance.add(child)
      } else {
        const mounted = instantiate(ctx, child)
        instance.add(mounted)
      }
    }
    if (hostId) {
      instance.setChildHostById(hostId)
    }
    return instance
  }

  // Function component: resolve to a concrete vnode and mount it
  const resolved = (type as FunctionComponent<any>)(props || ({} as any), children)
  const inst = instantiate(ctx, resolved)
  if (hostId) {
    inst.setChildHostById(hostId)
  }
  return inst
}

export function mountInto(parent: Renderable, node: VChild): Renderable {
  const instance = instantiate(parent.ctx, node)
  parent.add(instance)
  return instance
}

// Shorthands for core renderables
export function Group(props?: RenderableOptions, children?: VChild[]): VNode<RenderableOptions> {
  return h(GroupRenderable, props || {}, children)
}

export function Box(props?: BoxOptions, children?: VChild[]): VNode<BoxOptions> {
  return h(BoxRenderable, props || {}, children)
}

export function Text(props?: TextOptions & { content?: any }, children?: VChild[]): VNode<TextOptions> {
  return h(TextRenderable as unknown as RenderableConstructor<any>, props || {}, children)
}

// Mark a vnode tree so that, when instantiated, its root will route child ops
// to the descendant with the given id.
export function hostOverride(hostId: string, vnode: VChild): VChild {
  if (vnode instanceof Renderable) {
    vnode.setChildHostById(hostId)
    return vnode
  }
  if (!vnode || typeof vnode !== "object") return vnode
  ;(vnode as VNode).__hostId = hostId
  return vnode
}
