import { ASCIIFontRenderable, BoxRenderable, type CliRenderer, createCliRenderer, TextRenderable } from "../index"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let scrollBox: ScrollBoxRenderable | null = null
let renderer: CliRenderer | null = null

export function run(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.setBackgroundColor("#001122")

  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "scroll-box",
    width: "100%",
    height: "100%",
    rootOptions: {
      backgroundColor: "#730000",
      border: true,
    },
    wrapperOptions: {
      backgroundColor: "#9f0045",
    },
    viewportOptions: {
      backgroundColor: "#005dbb",
    },
    contentOptions: {
      backgroundColor: "#7fbfff",
    },
    scrollbarOptions: {
      showArrows: true,
      thumbOptions: {
        backgroundColor: "#fe9d15",
      },
      trackOptions: {
        backgroundColor: "#fff693",
      },
    },
  })

  scrollBox.focus()

  renderer.root.add(scrollBox)

  for (let index = 0; index < 20; index++) addItem(`Item ${index + 1}`)

  const item = new BoxRenderable(renderer, {
    id: "scroll-item",
    width: 120,
    margin: 5,
    height: 5,
    backgroundColor: "red",
  })

  scrollBox.content.add(item)

  item.add(
    new ASCIIFontRenderable(renderer, {
      text: "OPENTUI Scroll",
      margin: "auto",
    }),
  )

  for (let index = 0; index < 20; index++) addItem(`Item ${index + 1}`)

  function addItem(content: string) {
    scrollBox!.content.add(
      new TextRenderable(renderer!, {
        content,
      }),
    )
  }
}

export function destroy(rendererInstance: CliRenderer): void {
  if (scrollBox) {
    rendererInstance.root.remove(scrollBox.id)
    scrollBox.destroy()
    scrollBox = null
  }
  renderer = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
}
