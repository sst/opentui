import { createRoot } from "@opentui/solid"
import { ConsolePosition, createCliRenderer } from "@opentui/core"
import ExampleSelector from "./components/ExampleSelector"

// Uncomment to debug solidjs reconciler
// process.env.DEBUG = "true"

const renderer = await createCliRenderer({
  targetFps: 30,
  consoleOptions: {
    position: ConsolePosition.BOTTOM,
    maxStoredLogs: 1000,
    sizePercent: 40,
  },
})

const App = () => <ExampleSelector />
createRoot(renderer).render(App)
