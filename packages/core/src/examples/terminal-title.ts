import { TextRenderable, createCliRenderer } from "../index"

async function testTerminalTitle() {
  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  renderer.console.show()

  const text = new TextRenderable(renderer, {
    content: "Press Ctrl+C to exit",
    margin: 2,
  })

  renderer.root.add(text)
  console.log("Setting title to: 'OpenTUI Test'")
  renderer.setTerminalTitle("OpenTUI Test")

  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log("Setting title to: 'Terminal Title Demo'")
  renderer.setTerminalTitle("Terminal Title Demo")

  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log("Setting title to: '🎉 Success! 🎉'")
  renderer.setTerminalTitle("🎉 Success! 🎉")

  await new Promise((resolve) => setTimeout(resolve, 2000))
}

testTerminalTitle().catch(console.error)
