import {
  ASCIIFontRenderable,
  BoxRenderable,
  type CliRenderer,
  createCliRenderer,
  TextRenderable,
  RGBA,
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
  // Add an ASCII renderable at the top (index 0) for immediate visibility
  addAsciiRenderable(0)

  for (let index = 1; index < 1000; index++) {
    if ((index + 1) % 100 === 0) {
      addAsciiRenderable(index)
    } else {
      addBox(index)
    }
  }

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
    scrollBox!.add(box)
  }

  function addAsciiRenderable(i: number) {
    const fonts = ["tiny", "block", "shade", "slick"] as const
    const font = fonts[i % fonts.length]
    const colors = [
      [RGBA.fromInts(0, 255, 0, 255), RGBA.fromInts(0, 128, 255, 255)],
      [RGBA.fromInts(255, 0, 0, 255), RGBA.fromInts(255, 255, 0, 255)],
      [RGBA.fromInts(0, 255, 255, 255), RGBA.fromInts(255, 0, 255, 255)],
      [RGBA.fromInts(0, 128, 255, 255), RGBA.fromInts(0, 255, 255, 255)],
    ][i % 4]

    const longText =
      `ASCII FONT RENDERABLE #${i + 1} - ${font.toUpperCase()} STYLE - This is an extremely long piece of text that will definitely exceed the width of the scrollbox and trigger horizontal scrolling functionality. `.repeat(
        15,
      ) +
      `Additional content includes: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. `.repeat(
        12,
      ) +
      `The quick brown fox jumps over the lazy dog while the sly red panda silently observes from the treetops, contemplating the mysteries of the universe and wondering about the meaning of life. Meanwhile, technology continues to advance at an unprecedented rate, bringing both amazing opportunities and challenging ethical dilemmas to humanity's doorstep. From artificial intelligence to quantum computing, the future holds limitless possibilities that our ancestors could only dream of in their wildest imaginations.`.repeat(
        8,
      )

    const asciiRenderable = new ASCIIFontRenderable(renderer!, {
      id: `ascii-${i + 1}`,
      text: longText,
      font: font,
      fg: colors,
      bg: RGBA.fromInts(10, 20, 30, 255),
      selectionBg: "#ff6b6b",
      selectionFg: "#ffffff",
      zIndex: 10,
    })

    scrollBox!.add(asciiRenderable)
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
