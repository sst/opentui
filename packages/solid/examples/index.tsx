import { render } from "@opentui/solid"
import { ConsolePosition } from "@opentui/core"
import ExampleSelector from "./components/ExampleSelector.js"

// Uncomment to debug solidjs reconciler
// process.env.DEBUG = "true"

const App = () => <ExampleSelector />

render(App, {
  targetFps: 30,
  exitOnCtrlC: false,
  consoleOptions: {
    position: ConsolePosition.BOTTOM,
    maxStoredLogs: 1000,
    sizePercent: 40,
  },
})
