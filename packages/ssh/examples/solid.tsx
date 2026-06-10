/**
 * Example: serve a SolidJS (@opentui/solid) app over SSH.
 *
 * Solid's `render(node, renderer)` adopts an existing CliRenderer (instanceof
 * check), so `session.renderer` passes straight in and the reactive root is
 * disposed when the renderer is destroyed.
 *
 * @opentui/solid is not a dependency of @opentui/ssh, so run this from a
 * workspace that has it, with its preload:
 *
 *   bun --preload @opentui/solid/preload packages/ssh/examples/solid.tsx
 *
 *   ssh -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
 *       guest@localhost
 */
import { createServer } from "../src/index.js"
import { render, useKeyboard } from "@opentui/solid"
import { createSignal, onCleanup } from "solid-js"

const PORT = Number(process.env.PORT ?? 2222)

const App = (props: { name: string; onQuit: () => void }) => {
  const [secs, setSecs] = createSignal(0)
  const timer = setInterval(() => setSecs((s) => s + 1), 1000)
  onCleanup(() => clearInterval(timer))

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) props.onQuit()
  })

  return (
    <box
      width="100%"
      height="100%"
      border
      borderStyle="rounded"
      borderColor="#06b6d4"
      title=" @opentui/ssh · solid "
      titleAlignment="center"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <text fg="#e2e8f0">Hello, {props.name}! 👋</text>
      <text fg="#67e8f9">connected for {secs()}s · press q or Ctrl-C to quit</text>
    </box>
  )
}

const server = createServer({
  hostKey: { path: "./host_key" }, // auto-generated & persisted on first run
  auth: "open", // explicitly public app
}).serve(async (session) => {
  // render() adopts session.renderer, so the app draws onto this SSH channel.
  // Renderer destruction on disconnect disposes the reactive root, so no onClose.
  await render(() => <App name={session.identity.username} onQuit={() => session.end()} />, session.renderer)
})

await server.listen(PORT)

process.on("SIGINT", async () => {
  await server.close()
  process.exit(0)
})
