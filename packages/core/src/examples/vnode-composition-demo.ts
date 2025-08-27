import { MouseEvent, type CliRenderer } from "../renderer"
import { mountInto, Group, Box, Text, type VNode, instantiate, hostOverride } from "../renderables/composition/vnode"
import type { RenderContext } from "../types"

// Function component that composes Group(Group(Box(children)))
// This is NOT react and not reactive, it's just a way to compose renderables
// and mount them into a parent container.
function MyRenderable(props: any, children: VNode[] = []) {
  const mouseHandler = (event: MouseEvent) => {
    console.log("mouseHandler", event.type)
  }

  return Group(
    { id: "__outer" },
    Group(
      { id: "__inner" },
      Box(
        {
          id: "__box",
          border: true,
          borderStyle: "double",
          padding: 1,
          onMouseDown: mouseHandler,
        },
        ...children,
      ),
    ),
  )
}

function MyComponentRenderable(props: any, children: VNode[] = []) {
  return hostOverride(
    "__box3",
    Group({ id: "__outer3" }, Group({ id: "__inner3" }, Box({ id: "__box3", border: true, padding: 1 }, ...children))),
  )
}

function MyInstancedRenderable(renderer: RenderContext, props: any, children: VNode[] = []) {
  return instantiate(renderer, MyComponentRenderable(props, children))
}

export function run(renderer: CliRenderer) {
  const tree = MyRenderable({ id: "demo-root" }, [
    Box({ id: "child-1", width: 20, height: 3, border: true, marginBottom: 1 }, Text({ content: "Hello" })),
    Box({ id: "child-2", width: 24, height: 3, border: true }, Text({ content: "VNode world" })),
  ])

  mountInto(renderer.root, tree)

  const instance = MyInstancedRenderable(renderer, { id: "demo-root" }, [
    Box({ id: "child-1", width: 20, height: 3, border: true, marginBottom: 1 }, Text({ content: "Hello" })),
    Box({ id: "child-2", width: 24, height: 3, border: true }, Text({ content: "VNode world" })),
  ])

  renderer.root.add(instance)

  instance.add(
    instantiate(
      renderer,
      Box({ id: "child-3", width: 24, height: 3, border: true }, Text({ content: "VNode world 2" })),
    ),
  )

  renderer.needsUpdate()
}

export function destroy(renderer: CliRenderer) {
  // Remove demo root if present
  renderer.root.remove("demo-root")
  renderer.needsUpdate()
}
