import { createComponent, createElement, spread } from "./src/reconciler.js"

export function jsx(type: any, props: Record<string, any>, key?: string): any {
  if (key !== undefined && key !== null) {
    props = { ...props, key }
  }

  if (typeof type === "function") {
    return createComponent(type, props)
  }

  const node = createElement(type)
  spread(node, props, false)
  return node
}

export function jsxs(type: any, props: any, key?: string): any {
  return jsx(type, props, key)
}

export function Fragment(props: { children?: any }): any {
  return props.children
}
