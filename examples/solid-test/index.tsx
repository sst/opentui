import { measureText } from "@opentui/core";
import {
  ASCIIFont,
  Box,
  Text,
  Input,
  Select,
  TabSelect,
  Group,
  render,
  onResize,
  useTerminalDimensions,
  useRenderer,
  useKeyHandler,
} from "@opentui/solid";
import { createSignal, Show, onMount, Switch, Match } from "solid-js";
import { SplitModeDemo } from "./components/split-mode";
import InputScene from "./components/input-demo";
import { ConsolePosition } from "@opentui/core/src/console";

const EXAMPLES = [
  {
    name: "Input Demo",
    description: "Interactive InputElement demo with validation and multiple fields",
    scene: "input-demo",
  },
];

const ExampleSelector = () => {
  const renderer = useRenderer();

  onMount(() => {
    renderer.useConsole = true;
    renderer.console.show();
  });

  const terminalDimensions = useTerminalDimensions();

  const titleText = "OPENTUI EXAMPLES";
  const titleFont = "tiny";
  const { width: titleWidth, height: titleHeight } = measureText({ text: titleText, font: titleFont });

  const [selected, setSelected] = createSignal(0);
  const [inMenu, setInMenu] = createSignal(true);

  const handleSelect = (idx: number) => {
    setSelected(idx);
    setInMenu((m) => !m);
  };

  useKeyHandler((key) => {
    if (!inMenu()) {
      switch (key.name) {
        case "escape":
          setInMenu(true);
          break;
      }
    }

    switch (key.raw) {
      case "\u0003":
        renderer.stop();
        process.exit(0);
    }
  });

  return (
    <Box style={{ height: "100%", backgroundColor: "#001122", border: false, padding: 1 }}>
      <Group alignItems="center">
        <ASCIIFont
          style={{
            width: titleWidth,
            height: titleHeight,
            font: titleFont,
          }}
        >
          {titleText}
        </ASCIIFont>
      </Group>
      <Text style={{ fg: "#AAAAAA", marginTop: 1, marginLeft: 1, marginRight: 1 }}>
        Use ↑↓ or j/k to navigate, Shift+↑↓ or Shift+j/k for fast scroll, Enter to run, Escape to return, ` for console,
        ctrl+c to quit {selected()}
      </Text>
      <Box
        title="Examples"
        style={{
          flexGrow: 1,
          marginTop: 1,
          borderStyle: "single",
          titleAlignment: "center",
          focusedBorderColor: "#00AAFF",
        }}
      >
        <Show
          when={inMenu()}
          fallback={
            <Box border={false}>
              <Text fg="#00FF00">Press Escape to return to menu.</Text>
              <Switch>
                <Match when={EXAMPLES.at(selected())?.scene === "split-mode"}>
                  <SplitModeDemo />
                </Match>
                <Match when={EXAMPLES.at(selected())?.scene === "input-demo"}>
                  <InputScene />
                </Match>
              </Switch>
            </Box>
          }
        >
          <Select
            focused
            onSelect={(index) => {
              handleSelect(index);
            }}
            options={EXAMPLES.map((ex, i) => ({
              name: ex.name,
              description: ex.description,
              value: i,
            }))}
            style={{
              height: 20,
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
        </Show>
      </Box>
    </Box>
  );
};

const App = () => <ExampleSelector />;

render(() => <App />, {
  targetFps: 30,
  exitOnCtrlC: false,
  consoleOptions: {
    position: ConsolePosition.BOTTOM,
    maxStoredLogs: 1000,
    sizePercent: 40,
    maxDisplayLines: 10,
  },
});
