import { render } from "@opentui/solid"
import { ConsolePosition } from "@opentui/core/src/console"
import ExampleSelector from "./components/ExampleSelector"

const App = () => <ExampleSelector />

render(App, {
  targetFps: 30,
  consoleOptions: {
    position: ConsolePosition.BOTTOM,
    maxStoredLogs: 1000,
    sizePercent: 40,
  },
})
