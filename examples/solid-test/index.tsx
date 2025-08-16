import { render } from "@opentui/solid";
import { ConsolePosition } from "@opentui/core/src/console";
import ExampleSelector from "./components/ExampleSelector";

const App = () => <ExampleSelector />;

render(() => <App />, {
  targetFps: 30,
  exitOnCtrlC: false,
  consoleOptions: {
    position: ConsolePosition.BOTTOM,
    maxStoredLogs: 1000,
    sizePercent: 40,
  },
});

Bun.serve({
  development: {
    hmr: true,
    console: true,
  },

  routes: {
    "/": () => {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/index.html",
        },
      });
    },
  },
});
