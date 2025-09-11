import { BoxRenderable, type CliRenderer, createCliRenderer, TextRenderable, t, fg, bold } from "../index"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { getKeyHandler } from "../lib/KeyHandler"

let scrollBox: ScrollBoxRenderable | null = null
let renderer: CliRenderer | null = null
let mainContainer: BoxRenderable | null = null
let instructionsBox: BoxRenderable | null = null
let itemCount = 0

function addItem(atTop: boolean = false) {
  if (!renderer || !scrollBox) return

  itemCount++

  const box = new BoxRenderable(renderer, {
    id: `item-${itemCount}`,
    width: "100%",
    padding: 1,
    marginBottom: 1,
    backgroundColor: itemCount % 2 === 0 ? "#292e42" : "#2f3449",
  })

  const content = t`${bold(fg("#7aa2f7")(`Item #${itemCount}`))}
${fg("#9aa5ce")("This is a dynamically added item.")}
${fg("#565f89")("Added at:")} ${new Date().toLocaleTimeString()}
${fg("#565f89")("Position:")} ${atTop ? "TOP" : "BOTTOM"}`

  const text = new TextRenderable(renderer, {
    content,
  })

  box.add(text)

  if (atTop) {
    scrollBox.add(box, 0) // Add at the beginning
  } else {
    scrollBox.add(box) // Add at the end
  }
}

export function run(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.setBackgroundColor("#1a1b26")

  mainContainer = new BoxRenderable(renderer, {
    id: "main-container",
    flexGrow: 1,
    maxHeight: "100%",
    maxWidth: "100%",
    flexDirection: "column",
    backgroundColor: "#1a1b26",
  })

  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "sticky-scroll-box",
    stickyScroll: true,
    stickyStart: "bottom",
    rootOptions: {
      backgroundColor: "#24283b",
      border: true,
    },
    wrapperOptions: {
      backgroundColor: "#1f2335",
    },
    viewportOptions: {
      backgroundColor: "#1a1b26",
    },
    contentOptions: {
      backgroundColor: "#16161e",
    },
    scrollbarOptions: {
      showArrows: true,
      trackOptions: {
        foregroundColor: "#7aa2f7",
        backgroundColor: "#414868",
      },
    },
  })

  instructionsBox = new BoxRenderable(renderer, {
    id: "instructions",
    width: "100%",
    flexDirection: "column",
    backgroundColor: "#2a2b3a",
    paddingLeft: 1,
  })

  const instructionsText1 = new TextRenderable(renderer, {
    content: t`${bold(fg("#7aa2f7")("Sticky Scroll Demo"))} ${fg("#565f89")("-")} ${bold(fg("#9ece6a")("S"))} ${fg("#c0caf5")("Toggle sticky scroll")} ${fg("#565f89")("|")} ${bold(fg("#bb9af7")("T"))} ${fg("#c0caf5")("Add item at top")} ${fg("#565f89")("|")} ${bold(fg("#f7768e")("B"))} ${fg("#c0caf5")("Add item at bottom")}`,
  })

  const instructionsText2 = new TextRenderable(renderer, {
    content: t`${bold(fg("#7aa2f7")("Behavior:"))} ${fg("#c0caf5")("Scroll to top/bottom, then add items to see sticky behavior")}`,
  })

  const instructionsText3 = new TextRenderable(renderer, {
    content: t`${bold(fg("#7aa2f7")("Status:"))} ${fg("#c0caf5")("Sticky Scroll:")} ${scrollBox.stickyScroll ? fg("#9ece6a")("ENABLED") : fg("#f7768e")("DISABLED")}`,
  })

  instructionsBox.add(instructionsText1)
  instructionsBox.add(instructionsText2)
  instructionsBox.add(instructionsText3)

  mainContainer.add(scrollBox)
  mainContainer.add(instructionsBox)

  renderer.root.add(mainContainer)

  scrollBox.focus()

  // Add some initial items
  for (let i = 0; i < 10; i++) {
    addItem(false)
  }
}

export function destroy(rendererInstance: CliRenderer): void {
  if (mainContainer) {
    rendererInstance.root.remove(mainContainer.id)
    mainContainer.destroy()
    mainContainer = null
  }
  if (scrollBox) {
    scrollBox.destroy()
    scrollBox = null
  }
  if (instructionsBox) {
    instructionsBox.destroy()
    instructionsBox = null
  }
  renderer = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)

  getKeyHandler().on("keypress", (key) => {
    if (key.name === "s" && scrollBox) {
      // Toggle sticky scroll
      const currentSticky = scrollBox.stickyScroll
      scrollBox.stickyScroll = !currentSticky
      console.log(`Sticky scroll ${!currentSticky ? "enabled" : "disabled"}`)

      // Update status display
      if (instructionsBox && instructionsBox.getChildren().length >= 3) {
        const statusText = instructionsBox.getChildren()[2] as TextRenderable
        statusText.content = t`${bold(fg("#7aa2f7")("Status:"))} ${fg("#c0caf5")("Sticky Scroll:")} ${(scrollBox as any).stickyScroll ? fg("#9ece6a")("ENABLED") : fg("#f7768e")("DISABLED")}`
      }
    } else if (key.name === "t" && scrollBox) {
      addItem(true) // Add at top
      console.log("Added item at top")
    } else if (key.name === "b" && scrollBox) {
      addItem(false) // Add at bottom
      console.log("Added item at bottom")
    }
  })
}
