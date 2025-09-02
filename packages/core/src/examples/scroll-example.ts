import {
  ASCIIFontRenderable,
  BoxRenderable,
  type CliRenderer,
  createCliRenderer,
  TextRenderable,
  t,
  fg,
  bold,
  underline,
  italic,
  blue,
  green,
  red,
  cyan,
  magenta,
  yellow,
} from "../index"
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

  // Generate 1000 boxes, each with multiline styled text
  for (let index = 0; index < 1000; index++) addBox(index)

  function addBox(i: number) {
    const box = new BoxRenderable(renderer!, {
      id: `box-${i + 1}`,
      width: "100%",
      padding: 1,
      marginBottom: 1,
      backgroundColor: i % 2 === 0 ? "#10304a" : "#14283a",
    })

    const content = makeMultilineContent(i)
    const text = new TextRenderable(renderer!, {
      content,
    })

    box.add(text)
    scrollBox!.content.add(box)
  }

  function makeMultilineContent(i: number) {
    const palette = [blue, green, red, cyan, magenta, yellow]
    const colorize = palette[i % palette.length]
    const id = (i + 1).toString().padStart(4, "0")
    const tag = i % 3 === 0 ? underline("INFO") : i % 3 === 1 ? bold("WARN") : bold(red("ERROR"))

    const barUnits = 10 + (i % 30)
    const bar = "█".repeat(Math.floor(barUnits * 0.6)).padEnd(barUnits, "░")
    const details = "data ".repeat((i % 4) + 2)

    return t`${fg("#888")(`[${id}]`)} ${bold(colorize(`Box ${i + 1}`))} ${fg("#666")("|")} ${tag}
${fg("#aac")("Multiline content with mixed styles for stress testing.")}
${colorize("• Title:")} ${bold(italic(`Lorem ipsum ${i}`))}
${green("• Detail A:")} ${fg("#ccc")(details.trim())}
${magenta("• Detail B:")} ${fg("#bbb")("The quick brown fox jumps over the lazy dog.")}
${cyan("• Progress:")} ${fg("#0f0")(bar)} ${fg("#777")(barUnits)}
${fg("#aaa")("— end of box —")}`
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
