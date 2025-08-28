import { createCliRenderer, MouseEvent, type CliRenderer } from "../renderer"
import { Group, Box, Text, Generic, type VNode, instantiate, delegate, Input } from "../renderables"
import type { RenderContext } from "../types"
import type { OptimizedBuffer } from "../buffer"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { RGBA, parseColor } from "../lib"
import type { Renderable } from "../Renderable"

// This is NOT react and not reactive, it's just a declarative way to compose renderables
// and mount them into a parent container.
function MyRenderable(props: any, children: VNode[] = []) {
  const mouseHandler = (event: MouseEvent) => {
    console.log("mouseHandler", event.type)
  }

  return Box({ id: "inner" }, [
    Box(
      {
        border: true,
        borderStyle: "double",
        padding: 1,
        onMouseDown: mouseHandler,
        flexDirection: "row",
      },
      children,
    ),
  ])
}

function Button(
  props: {
    title: string
    onClick: () => void
    borderColor?: string | RGBA
  },
  children: VNode[] = [],
) {
  return Box(
    {
      id: "button",
      border: true,
      onMouseDown: props.onClick,
      borderColor: props.borderColor,
    },
    Text({ content: props.title, selectable: false }),
    ...children,
  )
}

// Custom Rendering Functional Construct
function VNodeButton(
  props: {
    title: string
    onClick: () => void
    borderColor?: string | RGBA
  },
  children: VNode[] = [],
) {
  return Generic(
    {
      render: (buffer, deltaTime, renderable) => demoRenderFn(props, buffer, deltaTime, renderable),
      maxWidth: props.title.length + 4,
      margin: 1,
    },
    Box(
      {
        id: "button",
        height: 3,
        onMouseDown: props.onClick,
      },
      children,
    ),
  )
}

// Custom Rendering - Class Method Example
class MyRoot {
  width: number

  constructor(private readonly props: { title: string; borderColor?: string | RGBA }) {
    this.width = Math.max(props.title.length + 4, 12)
  }

  render(buffer: OptimizedBuffer, deltaTime: number, renderable: Renderable) {
    demoRenderFn(this.props, buffer, deltaTime, renderable)
  }
}

function ButtonWithClassRender(
  props: { title: string; onClick: () => void; borderColor?: string | RGBA },
  children: VNode[] = [],
) {
  return Generic(
    new MyRoot(props),
    Box(
      {
        id: "button",
        height: 3,
        onMouseDown: props.onClick,
      },
      ...children,
    ),
  )
}

// Host Override Example
function MyDelegateToVNodeRenderable(props: any, children: VNode[] = []) {
  return delegate(
    {
      add: `${props.id}_box3`,
      remove: `${props.id}_box3`,
    },
    Box({ id: `${props.id}_outer3`, border: true, borderColor: "blue" }, [
      Box({ id: `${props.id}_inner3`, border: true, borderColor: "magenta" }, [
        Box({ id: `${props.id}_box3`, flexDirection: "row", border: true, padding: 1 }, children),
      ]),
    ]),
  )
}

function MyDelegateToRenderableComponent(renderer: RenderContext, props: any, children: VNode[] = []) {
  return delegate(
    {
      add: "__box4",
      remove: "__box4",
    },
    instantiate(
      renderer,
      Box({ id: "__outer4", border: true, borderColor: "blue" }, [
        Box({ id: "__inner4", border: true, borderColor: "magenta" }, [
          Box({ id: "__box4", flexDirection: "row", border: true, padding: 1 }, children),
        ]),
      ]),
    ),
  )
}

function MyInstancedRenderable(renderer: RenderContext, props: any, children: VNode[] = []) {
  return instantiate(renderer, MyDelegateToVNodeRenderable(props, children))
}

function LabeledInput(props: { id: string; label: string; placeholder: string }) {
  return delegate(
    {
      focus: `${props.id}-input`,
    },
    Box(
      { flexDirection: "row", id: `${props.id}-labeled-outer` },
      Text({ content: props.label + " " }),
      Input({
        id: `${props.id}-input`,
        placeholder: props.placeholder,
        width: 20,
        backgroundColor: "white",
        textColor: "black",
        cursorColor: "blue",
        focusedBackgroundColor: "orange",
      }),
    ),
  )
}

export function run(renderer: CliRenderer) {
  // Proxied VNode example
  const tree = MyRenderable({ id: "demo-root" }, [
    Box({ id: "child-1", width: 20, height: 3, border: true, marginBottom: 1 }, [Text({ content: "Hello" })]),
    Box({ id: "child-2", width: 24, height: 3, border: true }, [Text({ content: "VNode world" })]),
  ])
  tree.backgroundColor = RGBA.fromInts(0, 155, 155, 100)

  renderer.root.add(tree)

  const input = LabeledInput({ id: "labeled-input", label: "Label:", placeholder: "Enter your text..." })
  input.focus()
  renderer.root.add(input)

  //
  // VNode delegated version
  const instance1 = MyDelegateToVNodeRenderable({ id: "delegated-demo-root" }, [
    Box({ id: "child-1", width: 20, height: 3, border: true, marginBottom: 1 }, [
      Text({ content: "Hello delegated 1" }),
    ]),
    Box({ id: "child-2", width: 24, height: 3, border: true }, [Text({ content: "VNode world delegated 1" })]),
  ])
  instance1.backgroundColor = RGBA.fromInts(155, 0, 155, 100)

  renderer.root.add(instance1)

  //
  // Instaced Delegated version
  const instance = MyInstancedRenderable(renderer, { id: "demo-root" }, [
    Box({ id: "child-1", width: 20, height: 3, border: true, marginBottom: 1 }, [Text({ content: "Hello 2" })]),
    Box({ id: "child-2", width: 24, height: 3, border: true }, [Text({ content: "VNode world 2" })]),
  ])

  renderer.root.add(instance)

  // Delegated to __box3, would otherwise end up in the top-level group!
  instance.add(Box({ id: "child-3", width: 24, height: 3, border: true }, [Text({ content: "VNode world 3" })]))
  instance.add(Button({ title: "Click me", onClick: () => console.log("clicked"), borderColor: "red" }))

  //
  // Renderable delegated version
  const renderableInstance = MyDelegateToRenderableComponent(renderer, { id: "demo-root" }, [
    Box({ id: "child-1", width: 20, height: 3, border: true, marginBottom: 1 }, [Text({ content: "Hello 4" })]),
    Box({ id: "child-2", width: 24, height: 3, border: true }, [Text({ content: "VNode world 4" })]),
  ])
  renderer.root.add(renderableInstance)

  // Delegated to __box4, would otherwise end up in the top-level group!
  renderableInstance.add(Button({ title: "Click me too!", onClick: () => console.log("clicked"), borderColor: "red" }))

  //
  // Add animated VNode button
  renderer.root.add(
    VNodeButton({
      title: "Animated VNode",
      onClick: () => console.log("vnode 1 clicked"),
      borderColor: "blue",
    }),
  )
  renderer.root.add(
    VNodeButton({
      title: "Same VNode, different props",
      onClick: () => console.log("vnode 2 clicked"),
      borderColor: "magenta",
    }),
  )

  //
  // Add button with class render function
  renderer.root.add(
    ButtonWithClassRender({ title: "ClassRender", onClick: () => console.log("clicked"), borderColor: "blue" }),
  )
}

export function destroy(renderer: CliRenderer) {
  renderer.root.remove("demo-root")
  renderer.needsUpdate()
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
  renderer.start()
}

function demoRenderFn(
  props: { title: string; borderColor?: string | RGBA },
  buffer: OptimizedBuffer,
  deltaTime: number,
  renderable: Renderable,
) {
  const x = renderable.x
  const y = renderable.y
  const width = renderable.width
  const height = renderable.height

  const borderColor = parseColor((props.borderColor as string) || "#FFFF00")
  const textColor = parseColor("#FFFFFF")
  const bgColor = parseColor("#333333")
  const transparent = parseColor("transparent")

  // Draw a simple animated button with pulsing border
  // Use absolute time for smooth animation without drift
  const timeInSeconds = Date.now() / 1000
  const pulse = Math.sin(timeInSeconds * 4) * 0.5 + 0.5 // Fast pulsing, 0-1 oscillation

  // More dramatic color changes - pulse between 0.1 and 1.0 for high contrast
  const pulsingBorderColor = RGBA.fromValues(
    borderColor.r * (0.1 + pulse * 0.9),
    borderColor.g * (0.1 + pulse * 0.9),
    borderColor.b * (0.1 + pulse * 0.9),
    borderColor.a,
  )

  // Also pulse the background with a different phase and frequency
  const bgPulse = Math.sin(timeInSeconds * 2 + Math.PI / 2) * 0.4 + 0.6 // Different frequency and phase
  const pulsingBgColor = RGBA.fromValues(bgColor.r * bgPulse, bgColor.g * bgPulse, bgColor.b * bgPulse, bgColor.a)

  // Fill background
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const isTop = row === 0
      const isBottom = row === height - 1
      const isLeft = col === 0
      const isRight = col === width - 1
      const isBorder = isTop || isBottom || isLeft || isRight

      if (isBorder) {
        // Animate the border character too for extra visual effect
        const borderChars = ["█", "▓", "▒", "░"]
        const charIndex = Math.floor(pulse * borderChars.length) % borderChars.length
        buffer.setCell(x + col, y + row, borderChars[charIndex], pulsingBorderColor, transparent)
      } else {
        buffer.setCell(x + col, y + row, " ", textColor, pulsingBgColor)
      }
    }
  }

  // Draw title with animated color
  const titlePulse = Math.sin(timeInSeconds * 6) * 0.5 + 0.5 // Even faster text pulse
  const pulsingTextColor = RGBA.fromValues(
    textColor.r * (0.3 + titlePulse * 0.7),
    textColor.g * (0.3 + titlePulse * 0.7),
    textColor.b,
    textColor.a,
  )

  const titleX = x + Math.floor((width - props.title.length) / 2)
  const titleY = y + Math.floor(height / 2)
  if (titleY >= y && titleY < y + height) {
    buffer.drawText(props.title, titleX, titleY, pulsingTextColor, transparent)
  }
}
