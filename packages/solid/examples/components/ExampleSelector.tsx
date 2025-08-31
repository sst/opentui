import { measureText, TextRenderable } from "@opentui/core"
import { useTerminalDimensions, useRenderer, useKeyHandler } from "@opentui/solid"
import { createSignal, Show, onMount, Switch, Match } from "solid-js"
import { SplitModeDemo } from "./animation-demo.tsx"
import InputScene from "./input-demo.tsx"
import MouseScene from "./mouse-demo.tsx"
import TextStyleScene from "./text-style-demo.tsx"
import TextSelectionDemo from "./text-selection-demo.tsx"
import TabSelectDemo from "./tab-select-demo.tsx"
import ExtendDemo from "./extend-demo.tsx"

const EXAMPLES = [
  {
    name: "Text Selection Demo",
    description: "Text selection across multiple renderables with mouse drag",
    scene: "text-selection-demo",
  },
  {
    name: "Input Demo",
    description: "Interactive InputElement demo with validation and multiple fields",
    scene: "input-demo",
  },
  {
    name: "Mouse demo",
    description: "Mouse interaction",
    scene: "mouse-demo",
  },
  {
    name: "Text Style Demo",
    description: "Template literals with styled text, colors, and formatting",
    scene: "text-style-scene",
  },
  {
    name: "Animation Demo WIP",
    description: "Keyframs api and split mode demo",
    scene: "split-mode",
  },
  {
    name: "Tab Select Demo",
    description: "Tab selection demo",
    scene: "tab-select-demo",
  },
  {
    name: "Extend Demo",
    description: "Extend demo",
    scene: "extend-demo",
  },
]

const ExampleSelector = () => {
  const renderer = useRenderer()

  onMount(() => {
    renderer.useConsole = true
    // renderer.console.show();
  })

  const terminalDimensions = useTerminalDimensions()

  const titleText = "OPENTUI EXAMPLES"
  const titleFont = "tiny"
  const { width: titleWidth, height: titleHeight } = measureText({ text: titleText, font: titleFont })

  const [selected, setSelected] = createSignal(-1)

  const handleSelect = (idx: number) => {
    console.log("Selected:", EXAMPLES.at(idx)?.name)
    setSelected(idx)
  }

  useKeyHandler((key) => {
    switch (key.name) {
      case "escape":
        setSelected(-1)
        break
      case "`":
        renderer.console.toggle()
        break
      case "t":
        renderer.toggleDebugOverlay()
        break
      case "g":
        if (key.ctrl) {
          renderer.dumpHitGrid()
        }
        break
    }

    switch (key.raw) {
      case "\u0003":
        renderer.stop()
        process.exit(0)
    }
  })

  const selectedScene = () => (selected() === -1 ? "menu" : EXAMPLES.at(selected())?.scene)

  return (
    <Switch>
      <Match when={selectedScene() === "split-mode"}>
        <SplitModeDemo />
      </Match>
      <Match when={selectedScene() === "input-demo"}>
        <InputScene />
      </Match>
      <Match when={selectedScene() === "mouse-demo"}>
        <MouseScene />
      </Match>
      <Match when={selectedScene() === "text-style-scene"}>
        <TextStyleScene />
      </Match>
      <Match when={selectedScene() === "text-selection-demo"}>
        <TextSelectionDemo />
      </Match>
      <Match when={selectedScene() === "tab-select-demo"}>
        <TabSelectDemo />
      </Match>
      <Match when={selectedScene() === "extend-demo"}>
        <ExtendDemo />
      </Match>
      <Match when={selected() === -1}>
        <box style={{ height: terminalDimensions().height, backgroundColor: "#001122", padding: 1 }}>
          <box alignItems="center">
            <ascii_font
              style={{
                width: titleWidth,
                height: titleHeight,
                font: titleFont,
              }}
              text={titleText}
            />
          </box>
          <text style={{ fg: "#AAAAAA", marginTop: 1, marginLeft: 1, marginRight: 1 }}>
            Use ↑↓ or j/k to navigate, Shift+↑↓ or Shift+j/k for fast scroll, Enter to run, Escape to return, for
            console, ctrl+c to quit {selected()} {terminalDimensions().height}
          </text>
          <box
            title="Examples"
            style={{
              border: true,
              flexGrow: 1,
              marginTop: 1,
              borderStyle: "single",
              titleAlignment: "center",
              focusedBorderColor: "#00AAFF",
            }}
          >
            <select
              focused
              onSelect={(index) => {
                handleSelect(index)
              }}
              options={EXAMPLES.map((ex, i) => ({
                name: ex.name,
                description: ex.description,
                value: i,
              }))}
              style={{
                height: 30,
                backgroundColor: "transparent",
                focusedBackgroundColor: "transparent",
                selectedBackgroundColor: "#334455",
                selectedTextColor: "#FFFF00",
                descriptionColor: "#888888",
              }}
              showScrollIndicator
              wrapSelection
              fastScrollStep={5}
            />
          </box>
        </box>
      </Match>
    </Switch>
  )
}

export default ExampleSelector
